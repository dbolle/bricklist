import database
from conftest import seed_project


def seed_inventory(db):
    """Set with three non-spare parts and one spare."""
    db.add(database.Color(color_id=0, name="Black", rgb="05131D"))
    db.add(database.Color(color_id=4, name="Red", rgb="C91A09"))
    db.add(database.SetModel(set_num="a-1", name="Set A"))
    db.flush()
    brick = database.SetPart(set_num="a-1", part_num="3001", part_name="Brick 2x4",
                             color_id=0, quantity=4)
    plate = database.SetPart(set_num="a-1", part_num="3020", part_name="Plate 2x4",
                             color_id=4, quantity=2)
    tile = database.SetPart(set_num="a-1", part_num="6636", part_name="Tile 1x6",
                            color_id=0, quantity=3)
    spare = database.SetPart(set_num="a-1", part_num="3001", part_name="Brick 2x4",
                             color_id=0, quantity=1, is_spare=True)
    db.add_all([brick, plate, tile, spare])
    db.flush()
    db.commit()
    return brick, plate, tile


def test_project_missing_csv(client, db):
    brick, plate, tile = seed_inventory(db)
    project = seed_project(db, set_num="a-1")
    # brick: found 1 of 4 -> missing 3; plate: complete -> excluded;
    # tile: over-found (7 of 3) -> missing 0 -> excluded
    db.add(database.PartProgress(project_id=project.id, set_part_id=brick.id, found_qty=1))
    db.add(database.PartProgress(project_id=project.id, set_part_id=plate.id, found_qty=2))
    db.add(database.PartProgress(project_id=project.id, set_part_id=tile.id, found_qty=7))
    db.commit()

    resp = client.get(f"/api/projects/{project.id}/missing-parts.csv")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    assert 'filename="missing-a-1.csv"' in resp.headers["content-disposition"]
    assert resp.text == "Part,Color,Quantity\n3001,0,3\n"


def test_untouched_project_exports_full_inventory(client, db):
    seed_inventory(db)
    project = seed_project(db, set_num="a-1")

    lines = client.get(f"/api/projects/{project.id}/missing-parts.csv").text.strip().split("\n")
    assert lines[0] == "Part,Color,Quantity"
    assert set(lines[1:]) == {"3001,0,4", "3020,4,2", "6636,0,3"}, "spare must be excluded"


def test_group_missing_csv_aggregates_projects(client, db):
    brick, plate, tile = seed_inventory(db)
    db.add(database.SetModel(set_num="b-1", name="Set B"))
    db.flush()
    brick_b = database.SetPart(set_num="b-1", part_num="3001", part_name="Brick 2x4",
                               color_id=0, quantity=6)
    db.add(brick_b)
    db.flush()

    group = database.Group(name="Bin")
    db.add(group)
    db.flush()
    proj_a = database.Project(set_num="a-1", name="A", group_id=group.id)
    proj_b = database.Project(set_num="b-1", name="B", group_id=group.id)
    db.add_all([proj_a, proj_b])
    db.flush()
    # A: brick 1/4 found (missing 3), others complete; B: brick 2/6 found (missing 4)
    db.add(database.PartProgress(project_id=proj_a.id, set_part_id=brick.id, found_qty=1))
    db.add(database.PartProgress(project_id=proj_a.id, set_part_id=plate.id, found_qty=2))
    db.add(database.PartProgress(project_id=proj_a.id, set_part_id=tile.id, found_qty=3))
    db.add(database.PartProgress(project_id=proj_b.id, set_part_id=brick_b.id, found_qty=2))
    db.commit()

    resp = client.get(f"/api/groups/{group.id}/missing-parts.csv")
    assert resp.status_code == 200
    assert resp.text == "Part,Color,Quantity\n3001,0,7\n", "3 missing in A + 4 in B"
