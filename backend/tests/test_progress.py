import database
from conftest import seed_set, seed_project


def test_project_summary_counts_pieces_not_rows(client, db):
    """total_parts and found_parts must both be piece counts (sum of quantities)."""
    parts = seed_set(db, parts=((3, False), (5, False), (2, True)))  # 8 non-spare pieces
    project = seed_project(db)
    db.add(database.PartProgress(project_id=project.id, set_part_id=parts[0].id, found_qty=3))
    db.add(database.PartProgress(project_id=project.id, set_part_id=parts[1].id, found_qty=2))
    db.commit()

    resp = client.get(f"/api/projects/{project.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_parts"] == 8, "total should be sum of non-spare quantities"
    assert data["found_parts"] == 5

    listing = client.get("/api/projects").json()["projects"]
    assert listing[0]["total_parts"] == 8
    assert listing[0]["found_parts"] == 5


def test_project_summary_caps_found_at_quantity(client, db):
    """If a refresh lowered a part's quantity below found_qty, progress must not exceed 100%."""
    parts = seed_set(db, parts=((3, False),))
    project = seed_project(db)
    db.add(database.PartProgress(project_id=project.id, set_part_id=parts[0].id, found_qty=7))
    db.commit()

    data = client.get(f"/api/projects/{project.id}").json()
    assert data["total_parts"] == 3
    assert data["found_parts"] == 3, "found must be capped at the part quantity"


def test_project_summary_empty_set(client, db):
    seed_set(db, parts=())
    project = seed_project(db)
    data = client.get(f"/api/projects/{project.id}").json()
    assert data["total_parts"] == 0
    assert data["found_parts"] == 0
