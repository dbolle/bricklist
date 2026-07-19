import json

import httpx

import brickscan
import database


def teardown_function():
    brickscan._transport = None


def make_bin(client, name="Mystery bin"):
    return client.post("/api/bins", json={"name": name}).json()


def add_part(client, bin_id, part_num, qty=1, name=""):
    return client.post(f"/api/bins/{bin_id}/parts",
                       json={"part_num": part_num, "quantity": qty, "name": name})


def test_bin_crud_and_part_upsert(client, db):
    b = make_bin(client)
    assert client.get("/api/bins").json()["bins"][0]["name"] == "Mystery bin"

    add_part(client, b["id"], "3001", name="Brick 2 x 4")
    add_part(client, b["id"], "3001")  # same part again -> quantity bumps
    add_part(client, b["id"], "3020", qty=3, name="Plate 2 x 4")

    detail = client.get(f"/api/bins/{b['id']}").json()
    assert detail["part_count"] == 2
    assert detail["piece_count"] == 5
    by_num = {p["part_num"]: p for p in detail["parts"]}
    assert by_num["3001"]["quantity"] == 2
    assert by_num["3020"]["quantity"] == 3

    # set quantity directly; zero deletes
    row_id = by_num["3020"]["id"]
    assert client.patch(f"/api/bins/{b['id']}/parts/{row_id}",
                        json={"quantity": 7}).json()["quantity"] == 7
    assert client.patch(f"/api/bins/{b['id']}/parts/{row_id}",
                        json={"quantity": 0}).json()["deleted"] is True
    assert client.get(f"/api/bins/{b['id']}").json()["part_count"] == 1

    client.delete(f"/api/bins/{b['id']}")
    assert client.get(f"/api/bins/{b['id']}").status_code == 404


CATALOG = {
    # rare part: only in set A -> hugely discriminative
    "970c00": {"usage": {"num_sets": 2},
               "sets": [{"set_num": "a-1", "name": "Set A", "year": 2020,
                         "img_url": None, "theme": "Town", "quantity": 2},
                        {"set_num": "c-1", "name": "Set C", "year": 2019,
                         "img_url": None, "theme": "Town", "quantity": 1}]},
    # common part: in both A and B among thousands
    "3001": {"usage": {"num_sets": 4000},
             "sets": [{"set_num": "a-1", "name": "Set A", "year": 2020,
                       "img_url": None, "theme": "Town", "quantity": 4},
                      {"set_num": "b-1", "name": "Set B", "year": 2021,
                       "img_url": None, "theme": "Space", "quantity": 6}]},
}


def catalog_transport():
    def handler(request: httpx.Request) -> httpx.Response:
        part = request.url.path.rsplit("/", 1)[-1]
        body = CATALOG.get(part)
        if body is None:
            return httpx.Response(404)
        return httpx.Response(200, content=json.dumps(body))
    brickscan._transport = httpx.MockTransport(handler)


def seed_cached_set(db, set_num, parts):
    """parts: [(part_num, qty)] — pre-cached so match verification skips Rebrickable."""
    if not db.get(database.Color, 0):
        db.add(database.Color(color_id=0, name="Black", rgb="05131D"))
    db.add(database.SetModel(set_num=set_num, name=f"Set {set_num}"))
    db.flush()
    for i, (part_num, qty) in enumerate(parts):
        db.add(database.SetPart(set_num=set_num, part_num=part_num,
                                part_name=part_num, color_id=0, quantity=qty))
    db.commit()


def test_match_ranks_discriminative_set_first(client, db):
    catalog_transport()
    # Set A: 4x 3001 + 2x rare 970c00; Set B: 6x 3001 only
    seed_cached_set(db, "a-1", [("3001", 4), ("970c00", 2)])
    seed_cached_set(db, "b-1", [("3001", 6)])
    seed_cached_set(db, "c-1", [("970c00", 1), ("9999", 50)])

    b = make_bin(client)
    add_part(client, b["id"], "3001", qty=4)
    add_part(client, b["id"], "970c00", qty=2)

    resp = client.post(f"/api/bins/{b['id']}/match")
    assert resp.status_code == 200
    data = resp.json()
    assert data["verified"] is True

    best = data["matches"][0]
    assert best["set_num"] == "a-1", "set containing the rare part must win"
    assert best["matched_pieces"] == 6 and best["set_pieces"] == 6
    assert best["set_coverage"] == 1.0
    assert best["bin_coverage"] == 1.0

    by_set = {m["set_num"]: m for m in data["matches"]}
    assert by_set["b-1"]["set_coverage"] == 4 / 6, "only the 4 bricks overlap"
    assert by_set["c-1"]["set_coverage"] == 1 / 51, "match capped at the set's own quantity"


def test_match_unknown_part_is_skipped(client, db):
    catalog_transport()
    seed_cached_set(db, "a-1", [("3001", 4), ("970c00", 2)])
    seed_cached_set(db, "b-1", [("3001", 6)])
    seed_cached_set(db, "c-1", [("970c00", 1)])

    b = make_bin(client)
    add_part(client, b["id"], "3001", qty=2)
    add_part(client, b["id"], "custom-part-xyz", qty=5)  # 404 in catalog

    resp = client.post(f"/api/bins/{b['id']}/match")
    assert resp.status_code == 200
    assert {m["set_num"] for m in resp.json()["matches"]} == {"a-1", "b-1"}


def test_match_empty_bin_rejected(client, db):
    b = make_bin(client)
    assert client.post(f"/api/bins/{b['id']}/match").status_code == 400
