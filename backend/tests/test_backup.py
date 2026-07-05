import sqlite3
import tempfile

import database
from conftest import seed_set, seed_project


def test_backup_is_a_valid_database_with_data(client, db):
    parts = seed_set(db, parts=((3, False),))
    project = seed_project(db)
    db.add(database.PartProgress(project_id=project.id, set_part_id=parts[0].id, found_qty=2))
    db.commit()

    resp = client.get("/api/backup")
    assert resp.status_code == 200
    assert "bricklist-backup-" in resp.headers["content-disposition"]

    with tempfile.NamedTemporaryFile(suffix=".db") as f:
        f.write(resp.content)
        f.flush()
        conn = sqlite3.connect(f.name)
        try:
            assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            tables = {r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")}
            assert {"sets", "set_parts", "projects", "part_progress"} <= tables
            assert conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 1
            assert conn.execute(
                "SELECT found_qty FROM part_progress").fetchone()[0] == 2
        finally:
            conn.close()
