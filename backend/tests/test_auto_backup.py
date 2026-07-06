import os
import shutil
import sqlite3
import time

from fastapi.testclient import TestClient

import backups
import main
from conftest import seed_set, seed_project


def fresh_dir(path="/tmp/test_bricklist_backups"):
    shutil.rmtree(path, ignore_errors=True)
    return path


def test_create_snapshot_is_valid_sqlite(db):
    seed_set(db)
    seed_project(db)
    backup_dir = fresh_dir()

    path = backups.create_snapshot(backup_dir)

    assert os.path.dirname(path) == backup_dir
    conn = sqlite3.connect(path)
    try:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 1
    finally:
        conn.close()


def test_prune_keeps_newest(db):
    backup_dir = fresh_dir()
    os.makedirs(backup_dir)
    names = [f"bricklist-auto-2026010{i}-000000.db" for i in range(1, 6)]
    for name in names:
        open(os.path.join(backup_dir, name), "w").close()
    open(os.path.join(backup_dir, "my-manual-copy.db"), "w").close()

    removed = backups.prune_snapshots(backup_dir, keep=3)

    assert removed == names[:2], "oldest snapshots go first"
    remaining = set(os.listdir(backup_dir))
    assert set(names[2:]) <= remaining
    assert "my-manual-copy.db" in remaining, "non-auto files must never be pruned"


def test_snapshot_due_respects_recent_snapshot(db):
    backup_dir = fresh_dir()
    assert backups.snapshot_due(backup_dir, 24 * 3600), "no dir yet -> due"

    os.makedirs(backup_dir)
    assert backups.snapshot_due(backup_dir, 24 * 3600), "empty dir -> due"

    recent = os.path.join(backup_dir, "bricklist-auto-20260101-000000.db")
    open(recent, "w").close()
    assert not backups.snapshot_due(backup_dir, 24 * 3600), "fresh snapshot -> not due"

    day_ago = time.time() - 25 * 3600
    os.utime(recent, (day_ago, day_ago))
    assert backups.snapshot_due(backup_dir, 24 * 3600), "old snapshot -> due"


def test_startup_takes_a_snapshot(db):
    seed_set(db)
    backup_dir = fresh_dir()

    with TestClient(main.app):
        deadline = time.time() + 3
        while time.time() < deadline:
            if os.path.isdir(backup_dir) and any(
                backups.SNAPSHOT_PATTERN.match(f) for f in os.listdir(backup_dir)
            ):
                break
            time.sleep(0.05)
        else:
            raise AssertionError("no auto-snapshot appeared after startup")
