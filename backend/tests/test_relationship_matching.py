"""Bin matching must bridge mold/print variants: photo identification often
returns the base mold while set inventories list the printed variant."""
import json

import httpx

import brickscan
import database
from test_bins import make_bin, add_part, seed_cached_set


# Bin holds base mold 3001; the target set's inventory only has the printed
# variant 3001pr0001. The catalog links them via a print relationship.
CATALOG = {
    "3001": {
        "usage": {"num_sets": 4000},
        "sets": [{"set_num": "other-1", "name": "Other", "year": 2020,
                  "img_url": None, "theme": "Town", "quantity": 2}],
        "relationships": [
            {"type": "print", "part_num": "3001pr0001", "direction": "child"},
            {"type": "pair", "part_num": "9998", "direction": "child"},  # ignored type
        ],
    },
    "3001pr0001": {
        "usage": {"num_sets": 1},
        "sets": [{"set_num": "a-1", "name": "Set A", "year": 2021,
                  "img_url": None, "theme": "Space", "quantity": 2}],
        "relationships": [
            {"type": "print", "part_num": "3001", "direction": "parent"},
        ],
    },
}


def catalog_transport():
    def handler(request: httpx.Request) -> httpx.Response:
        part = request.url.path.rsplit("/", 1)[-1]
        body = CATALOG.get(part)
        if body is None:
            return httpx.Response(404)
        return httpx.Response(200, content=json.dumps(body))
    brickscan._transport = httpx.MockTransport(handler)


def teardown_function():
    brickscan._transport = None


def test_print_variant_discovered_and_verified(client, db):
    catalog_transport()
    seed_cached_set(db, "a-1", [("3001pr0001", 2)])
    seed_cached_set(db, "other-1", [("3001", 2), ("7777", 10)])

    b = make_bin(client)
    add_part(client, b["id"], "3001", qty=2)

    data = client.post(f"/api/bins/{b['id']}/match").json()
    assert data["verified"] is True
    by_set = {m["set_num"]: m for m in data["matches"]}

    assert "a-1" in by_set, "set found via the print relationship"
    a = by_set["a-1"]
    assert a["matched_pieces"] == 2, "base-mold bin part matches printed variant"
    assert a["set_coverage"] == 1.0
    assert data["matches"][0]["set_num"] == "a-1", (
        "rare printed variant should dominate the common base mold")


def test_family_weight_uses_rarest_member(client, db):
    catalog_transport()
    seed_cached_set(db, "a-1", [("3001pr0001", 2)])
    seed_cached_set(db, "other-1", [("3001", 2)])

    b = make_bin(client)
    add_part(client, b["id"], "3001", qty=2)

    data = client.post(f"/api/bins/{b['id']}/match").json()
    scores = {m["set_num"]: m["candidate_score"] for m in data["matches"]}
    # rarest family member has num_sets=1, so every credited set gets weight 1.0
    assert scores["a-1"] == 1.0
    assert scores["other-1"] == 1.0


def test_ignored_relationship_types_not_fetched(client, db):
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        part = request.url.path.rsplit("/", 1)[-1]
        requests.append(part)
        body = CATALOG.get(part)
        return httpx.Response(404) if body is None else httpx.Response(
            200, content=json.dumps(body))
    brickscan._transport = httpx.MockTransport(handler)

    seed_cached_set(db, "a-1", [("3001pr0001", 2)])
    b = make_bin(client)
    add_part(client, b["id"], "3001", qty=2)
    client.post(f"/api/bins/{b['id']}/match")

    assert "9998" not in requests, "'pair' relationship type must not expand the family"
    assert "3001pr0001" in requests
