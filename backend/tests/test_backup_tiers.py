import os
import shutil

import backups


def fresh(path):
    shutil.rmtree(path, ignore_errors=True)
    os.makedirs(path)
    return path


def touch(dirpath, name, content=b"x"):
    with open(os.path.join(dirpath, name), "wb") as f:
        f.write(content)


def test_monthly_promoted_once_per_month(db):
    d = fresh("/tmp/test_tiers")
    touch(d, "bricklist-auto-20260101-000000.db", b"old")
    touch(d, "bricklist-auto-20260715-000000.db", b"new")

    path = backups.ensure_monthly(d, keep_monthly=12)
    assert path and os.path.basename(path).startswith("bricklist-monthly-")
    with open(path, "rb") as f:
        assert f.read() == b"new", "monthly must copy the newest daily"

    assert backups.ensure_monthly(d, keep_monthly=12) is None, "only one per month"


def test_monthly_pruned_to_keep(db):
    d = fresh("/tmp/test_tiers")
    touch(d, "bricklist-auto-20260715-000000.db")
    for m in ["202501", "202502", "202503"]:
        touch(d, f"bricklist-monthly-{m}.db")

    backups.ensure_monthly(d, keep_monthly=3)
    monthlies = sorted(f for f in os.listdir(d) if backups.MONTHLY_PATTERN.match(f))
    assert len(monthlies) == 3
    assert "bricklist-monthly-202501.db" not in monthlies, "oldest pruned"


def test_monthly_skipped_with_no_dailies(db):
    d = fresh("/tmp/test_tiers")
    assert backups.ensure_monthly(d, keep_monthly=12) is None


def test_mirror_copies_and_applies_retention(db):
    src = fresh("/tmp/test_tiers")
    dst = fresh("/tmp/test_tiers_mirror")
    for i in range(1, 4):
        touch(src, f"bricklist-auto-2026071{i}-000000.db")
    touch(src, "bricklist-monthly-202607.db")
    touch(src, "unrelated-file.db")
    # stale mirror-only daily that retention should age out
    touch(dst, "bricklist-auto-20260101-000000.db")

    copied = backups.mirror_snapshots(src, dst, keep=3, keep_monthly=12)
    assert copied == 4
    mirrored = set(os.listdir(dst))
    assert "bricklist-monthly-202607.db" in mirrored
    assert "unrelated-file.db" not in mirrored, "only snapshot patterns mirrored"
    assert "bricklist-auto-20260101-000000.db" not in mirrored, "mirror retention applied"
    assert len([f for f in mirrored if backups.SNAPSHOT_PATTERN.match(f)]) == 3

    assert backups.mirror_snapshots(src, dst, keep=3, keep_monthly=12) == 0, "idempotent"
