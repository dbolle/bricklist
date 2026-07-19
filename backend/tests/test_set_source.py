"""Source preference for set inventories: BrickScan catalog first,
Rebrickable fallback (the only path needing an API key)."""
import json

import httpx

import brickscan
import database
import rebrickable
from conftest import seed_project


BRICKSCAN_SET = {
    "set_num": "x-1", "name": "Catalog Set", "year": 2024, "theme": "Town",
    "num_parts": 7, "img_url": "https://cdn.example/x-1.jpg", "minifigs": [],
}
BRICKSCAN_INVENTORY = {
    "set_num": "x-1", "resolved_from": None, "name": "Catalog Set",
    "inventory_version": 2, "num_parts": 7,
    "parts": [
        {"part_num": "3001", "name": "Brick 2 x 4", "part_cat_id": 11,
         "part_cat_name": "Bricks", "color_id": 4, "color_name": "Red",
         "color_rgb": "C91A09", "quantity": 5, "is_spare": False,
         "element_id": "300121", "img_url": "https://img/3001.jpg"},
        {"part_num": "3001", "name": "Brick 2 x 4", "part_cat_id": 11,
         "part_cat_name": "Bricks", "color_id": 4, "color_name": "Red",
         "color_rgb": "C91A09", "quantity": 1, "is_spare": True,
         "element_id": "300121", "img_url": "https://img/3001.jpg"},
    ],
    "minifig_parts": [
        {"fig_num": "fig-000001", "fig_name": "Astronaut", "fig_count": 2,
         "part_num": "973c01", "name": "Torso", "part_cat_id": 61,
         "part_cat_name": "Minifig Torsos", "color_id": 15,
         "color_name": "White", "color_rgb": "FFFFFF",
         "quantity_per_fig": 1, "total_quantity": 2, "is_spare": False,
         "element_id": None, "img_url": None},
    ],
}


def brickscan_ok_transport():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/parts"):
            return httpx.Response(200, content=json.dumps(BRICKSCAN_INVENTORY))
        if "/sets/" in path:
            return httpx.Response(200, content=json.dumps(BRICKSCAN_SET))
        return httpx.Response(404)
    brickscan._transport = httpx.MockTransport(handler)


def brickscan_404_transport():
    brickscan._transport = httpx.MockTransport(
        lambda r: httpx.Response(404, content='{"error":"set_not_found"}'))


def brickscan_down_transport():
    def handler(request):
        raise httpx.ConnectError("connection refused")
    brickscan._transport = httpx.MockTransport(handler)


def rebrickable_transport():
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/parts/") and "/sets/" in path:
            item = {"part": {"part_num": "9999", "name": "RB Part",
                             "part_img_url": None, "part_cat_id": 1},
                    "color": {"id": 0, "name": "Black", "rgb": "05131D"},
                    "quantity": 3, "is_spare": False, "element_id": None}
            return httpx.Response(200, content=json.dumps({"results": [item], "next": None}))
        if path.endswith("/minifigs/"):
            return httpx.Response(200, content=json.dumps({"results": [], "next": None}))
        if "part_categories" in path:
            return httpx.Response(200, content=json.dumps(
                {"results": [{"id": 1, "name": "Baseplates"}], "next": None}))
        if "/sets/" in path:
            return httpx.Response(200, content=json.dumps(
                {"set_num": "x-1", "name": "RB Set", "year": 2020, "theme_id": 5,
                 "num_parts": 3, "set_img_url": None}))
        return httpx.Response(404)
    rebrickable._transport = httpx.MockTransport(handler)
    rebrickable._category_cache = None


def teardown_function():
    brickscan._transport = None
    rebrickable._transport = None
    rebrickable._category_cache = None


def set_api_key(db, value="test-key"):
    setting = db.get(database.Setting, "rebrickable_api_key")
    setting.value = value
    db.commit()


def test_brickscan_preferred_and_needs_no_api_key(client, db):
    brickscan_ok_transport()
    # no Rebrickable API key configured at all
    resp = client.get("/api/sets/x-1/parts?include_spares=true")
    assert resp.status_code == 200
    parts = resp.json()["parts"]

    regular = next(p for p in parts if p["part_num"] == "3001" and not p["is_spare"])
    assert regular["quantity"] == 5
    assert regular["color_name"] == "Red"
    assert regular["part_cat_name"] == "Bricks"
    spare = next(p for p in parts if p["is_spare"])
    assert spare["quantity"] == 1

    fig = next(p for p in parts if p["minifig_num"])
    assert fig["minifig_num"] == "fig-000001"
    assert fig["minifig_name"] == "Astronaut"
    assert fig["quantity"] == 2, "total_quantity (fig_count x per_fig) must be used"

    db_set = db.get(database.SetModel, "x-1")
    assert db_set.name == "Catalog Set" and db_set.year == 2024


def test_fallback_to_rebrickable_when_not_in_catalog(client, db):
    brickscan_404_transport()
    rebrickable_transport()
    set_api_key(db)

    resp = client.get("/api/sets/x-1/parts")
    assert resp.status_code == 200
    parts = resp.json()["parts"]
    assert [p["part_num"] for p in parts] == ["9999"], "must come from Rebrickable"
    assert parts[0]["part_cat_name"] == "Baseplates"
    assert db.get(database.SetModel, "x-1").name == "RB Set"


def test_fallback_when_brickscan_down(client, db):
    brickscan_down_transport()
    rebrickable_transport()
    set_api_key(db)

    resp = client.get("/api/sets/x-1/parts")
    assert resp.status_code == 200
    assert resp.json()["parts"][0]["part_num"] == "9999"


def test_no_key_and_no_catalog_is_clean_error(client, db):
    brickscan_404_transport()
    resp = client.get("/api/sets/x-1/parts")
    assert resp.status_code == 400
    assert "API key" in resp.json()["detail"]


def test_brickscan_refresh_preserves_progress(client, db):
    brickscan_ok_transport()
    client.get("/api/sets/x-1/parts")  # initial cache from catalog

    project = seed_project(db, set_num="x-1")
    sp = (db.query(database.SetPart)
          .filter(database.SetPart.set_num == "x-1",
                  database.SetPart.part_num == "3001",
                  database.SetPart.is_spare == False).one())
    db.add(database.PartProgress(project_id=project.id, set_part_id=sp.id, found_qty=4))
    db.commit()

    resp = client.post("/api/sets/x-1/refresh")
    assert resp.status_code == 200

    db.expire_all()
    rows = db.query(database.PartProgress).filter_by(project_id=project.id).all()
    assert len(rows) == 1 and rows[0].found_qty == 4
    assert rows[0].set_part_id == sp.id, "upsert must preserve row identity"
