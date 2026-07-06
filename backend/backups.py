"""Automatic SQLite snapshots.

Snapshots are written into the data volume itself, so they protect against
software problems (bad migration, app bug) — off-box copies for hardware
failure are documented in the README.
"""
import os
import re
import time
from datetime import datetime

from sqlalchemy import text

from database import engine

SNAPSHOT_PATTERN = re.compile(r"^bricklist-auto-\d{8}-\d{6}\.db$")


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
