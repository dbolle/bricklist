"""Automatic SQLite snapshots.

Snapshots are written into the data volume itself, so they protect against
software problems (bad migration, app bug) — off-box copies for hardware
failure are documented in the README.
"""
import os
import re
import shutil
import time
from datetime import datetime

from sqlalchemy import text

from database import engine

SNAPSHOT_PATTERN = re.compile(r"^bricklist-auto-\d{8}-\d{6}\.db$")
MONTHLY_PATTERN = re.compile(r"^bricklist-monthly-\d{6}\.db$")

# Last run outcome, surfaced by /api/diagnostics
last_run: dict | None = None


def create_snapshot(backup_dir: str) -> str:
    """Write a consistent VACUUM INTO snapshot and return its path."""
    os.makedirs(backup_dir, exist_ok=True)
    name = f"bricklist-auto-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
    path = os.path.join(backup_dir, name)
    if os.path.exists(path):  # same-second rerun
        os.remove(path)
    with engine.connect() as conn:
        conn.execution_options(isolation_level="AUTOCOMMIT").execute(
            text("VACUUM INTO :path"), {"path": path}
        )
    return path


def prune_snapshots(backup_dir: str, keep: int) -> list[str]:
    """Delete all but the newest `keep` auto-snapshots; returns removed names."""
    snapshots = sorted(f for f in os.listdir(backup_dir) if SNAPSHOT_PATTERN.match(f))
    to_remove = snapshots[:-keep] if keep > 0 else snapshots
    for name in to_remove:
        os.remove(os.path.join(backup_dir, name))
    return to_remove


def ensure_monthly(backup_dir: str, keep_monthly: int) -> str | None:
    """Promote the newest daily to a monthly snapshot once per calendar month.

    A subtle-corruption bug noticed after the daily rotation window would
    otherwise poison every restore point; monthlies extend the horizon to a
    year. Returns the created path, or None if this month already has one.
    """
    month = datetime.now().strftime("%Y%m")
    name = f"bricklist-monthly-{month}.db"
    path = os.path.join(backup_dir, name)
    if os.path.exists(path):
        return None
    dailies = sorted(f for f in os.listdir(backup_dir) if SNAPSHOT_PATTERN.match(f))
    if not dailies:
        return None
    shutil.copy2(os.path.join(backup_dir, dailies[-1]), path)
    monthlies = sorted(f for f in os.listdir(backup_dir) if MONTHLY_PATTERN.match(f))
    for old in monthlies[:-keep_monthly] if keep_monthly > 0 else monthlies:
        os.remove(os.path.join(backup_dir, old))
    return path


def mirror_snapshots(backup_dir: str, mirror_dir: str, keep: int, keep_monthly: int) -> int:
    """Copy snapshots to a second mount and apply the same retention there.

    The mirror directory is expected to be a bind mount pointing outside the
    data volume (ideally another disk or NAS) so a volume or disk failure
    doesn't take the backups with it. Returns the number of files copied.
    """
    os.makedirs(mirror_dir, exist_ok=True)
    copied = 0
    for pattern, keep_n in ((SNAPSHOT_PATTERN, keep), (MONTHLY_PATTERN, keep_monthly)):
        names = sorted(f for f in os.listdir(backup_dir) if pattern.match(f))
        for name in names:
            dest = os.path.join(mirror_dir, name)
            if not os.path.exists(dest):
                shutil.copy2(os.path.join(backup_dir, name), dest)
                copied += 1
        mirrored = sorted(f for f in os.listdir(mirror_dir) if pattern.match(f))
        for old in mirrored[:-keep_n] if keep_n > 0 else mirrored:
            os.remove(os.path.join(mirror_dir, old))
    return copied


def summarize(backup_dir: str, mirror_dir: str) -> dict:
    """Snapshot inventory for diagnostics."""
    def tier_counts(d: str) -> dict:
        if not os.path.isdir(d):
            return {"daily": 0, "monthly": 0, "newest": None}
        dailies = sorted(f for f in os.listdir(d) if SNAPSHOT_PATTERN.match(f))
        monthlies = sorted(f for f in os.listdir(d) if MONTHLY_PATTERN.match(f))
        return {
            "daily": len(dailies),
            "monthly": len(monthlies),
            "newest": dailies[-1] if dailies else None,
        }

    return {
        "last_run": last_run,
        "volume": tier_counts(backup_dir),
        "mirror": {"configured": os.path.isdir(mirror_dir), **tier_counts(mirror_dir)},
    }


def snapshot_due(backup_dir: str, max_age_seconds: float) -> bool:
    """True if there is no auto-snapshot newer than max_age_seconds.

    Keeps frequent container restarts from piling up near-identical
    snapshots and rotating the older, more useful ones out.
    """
    if not os.path.isdir(backup_dir):
        return True
    newest = None
    for name in os.listdir(backup_dir):
        if SNAPSHOT_PATTERN.match(name):
            mtime = os.path.getmtime(os.path.join(backup_dir, name))
            if newest is None or mtime > newest:
                newest = mtime
    return newest is None or (time.time() - newest) >= max_age_seconds
