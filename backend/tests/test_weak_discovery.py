import json

import httpx

import brickscan
from test_bins import make_bin, add_part, seed_cached_set


def transport(catalog):
    def handler(request: httpx.Request) -> httpx.Response:
        part = request.url.path.rsplit("/", 1)[-1]
        body = catalog.get(part)
        return httpx.Response(404) if body is None else httpx.Response(
            200, content=json.dumps(body))
    brickscan._transport = httpx.MockTransport(handler)


def teardown_function():
    brickscan._transport = None


def entry(set_num, qty=1):
    return {"set_num": set_num, "name": set_num, "year": 2020,
            "img_url": None, "theme": None, "quantity": qty}


def test_all_common_parts_flags_weak_discovery(client, db):
    transport({
        "3001": {"usage": {"num_sets": 4000}, "sets": [entry("a-1")], "relationships": []},
        "3020": {"usage": {"num_sets": 2500}, "sets": [entry("a-1")], "relationships": []},
    })
    seed_cached_set(db, "a-1", [("3001", 1), ("3020", 1)])

    b = make_bin(client)
    add_part(client, b["id"], "3001")
    add_part(client, b["id"], "3020")

    data = client.post(f"/api/bins/{b['id']}/match").json()
    assert data["weak_discovery"] is True
    assert data["rarest_num_sets"] == 2500


def test_one_rare_part_clears_the_flag(client, db):
    transport({
        "3001": {"usage": {"num_sets": 4000}, "sets": [entry("a-1")], "relationships": []},
        "970c00pr9": {"usage": {"num_sets": 3}, "sets": [entry("a-1")], "relationships": []},
    })
    seed_cached_set(db, "a-1", [("3001", 1), ("970c00pr9", 1)])

    b = make_bin(client)
    add_part(client, b["id"], "3001")
    add_part(client, b["id"], "970c00pr9")

    data = client.post(f"/api/bins/{b['id']}/match").json()
    assert data["weak_discovery"] is False
    assert data["rarest_num_sets"] == 3


def test_rare_relative_counts_as_signal(client, db):
    """A common base mold whose print relative is rare is discriminative."""
    transport({
        "3001": {"usage": {"num_sets": 4000}, "sets": [],
                 "relationships": [{"type": "print", "part_num": "3001pr1", "direction": "child"}]},
        "3001pr1": {"usage": {"num_sets": 2}, "sets": [entry("a-1")], "relationships": []},
    })
    seed_cached_set(db, "a-1", [("3001pr1", 1)])

    b = make_bin(client)
    add_part(client, b["id"], "3001")

    data = client.post(f"/api/bins/{b['id']}/match").json()
    assert data["weak_discovery"] is False
    assert data["rarest_num_sets"] == 2


def test_no_catalog_parts_is_weak(client, db):
    transport({})
    seed_cached_set(db, "a-1", [("3001", 1)])
    b = make_bin(client)
    add_part(client, b["id"], "unknown-xyz")

    data = client.post(f"/api/bins/{b['id']}/match").json()
    assert data["weak_discovery"] is True
    assert data["rarest_num_sets"] is None
