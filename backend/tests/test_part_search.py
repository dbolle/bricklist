import database
from conftest import seed_set, seed_project


def seed_two_projects(db):
    """Two sets sharing part 3001; set A also has a unique plate with element id."""
    db.add(database.Color(color_id=0, name="Black", rgb="05131D"))
    db.add(database.SetModel(set_num="a-1", name="Set A"))
    db.add(database.SetModel(set_num="b-1", name="Set B"))
    db.flush()
    brick_a = database.SetPart(set_num="a-1", part_num="3001", part_name="Brick 2x4",
                               color_id=0, quantity=4, element_id="300126")
    plate_a = database.SetPart(set_num="a-1", part_num="3020", part_name="Plate 2x4",
                               color_id=0, quantity=2, element_id="302026")
    spare_a = database.SetPart(set_num="a-1", part_num="3001", part_name="Brick 2x4",
                               color_id=0, quantity=1, is_spare=True, element_id="300126")
    brick_b = database.SetPart(set_num="b-1", part_num="3001", part_name="Brick 2x4",
                               color_id=0, quantity=6, element_id="300126")
    db.add_all([brick_a, plate_a, spare_a, brick_b])
    db.flush()
    proj_a = seed_project(db, set_num="a-1", name="Castle")
    proj_b = seed_project(db, set_num="b-1", name="Spaceship")
    db.commit()
    return brick_a, plate_a, brick_b, proj_a, proj_b


def test_search_finds_part_across_all_projects(client, db):
    brick_a, plate_a, brick_b, proj_a, proj_b = seed_two_projects(db)

    results = client.get("/api/search/parts", params={"q": "3001"}).json()["results"]
    assert len(results) == 2, "both projects need part 3001; spares excluded by default"
    assert {r["project_name"] for r in results} == {"Castle", "Spaceship"}
    assert all(r["part"]["part_num"] == "3001" for r in results)


def test_search_matches_name_and_element_id(client, db):
    seed_two_projects(db)

    by_name = client.get("/api/search/parts", params={"q": "plate"}).json()["results"]
    assert len(by_name) == 1 and by_name[0]["part"]["part_num"] == "3020"

    by_element = client.get("/api/search/parts", params={"q": "302026"}).json()["results"]
    assert len(by_element) == 1 and by_element[0]["part"]["part_num"] == "3020"


def test_search_needed_projects_sort_first(client, db):
    brick_a, plate_a, brick_b, proj_a, proj_b = seed_two_projects(db)
    # Castle already has all 4 bricks; Spaceship still needs its 6
    db.add(database.PartProgress(project_id=proj_a.id, set_part_id=brick_a.id, found_qty=4))
    db.commit()

    results = client.get("/api/search/parts", params={"q": "3001"}).json()["results"]
    assert results[0]["project_name"] == "Spaceship"
    assert results[0]["found_qty"] == 0
    assert results[1]["project_name"] == "Castle"
    assert results[1]["found_qty"] == 4


def test_search_short_query_returns_nothing(client, db):
    seed_two_projects(db)
    assert client.get("/api/search/parts", params={"q": "3"}).json()["results"] == []


def test_search_can_include_spares(client, db):
    seed_two_projects(db)
    results = client.get(
        "/api/search/parts", params={"q": "3001", "include_spares": "true"}
    ).json()["results"]
    assert len(results) == 3
