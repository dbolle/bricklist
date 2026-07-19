import json

import httpx

import brickscan


BRICKSCAN_ITEMS = {
    "engine": "brickognize",
    "items": [
        {"id": "3001", "name": "Brick 2 x 4", "category": "Brick", "type": "part",
         "score": 0.90, "img_url": "https://example.com/3001.webp",
         "external_sites": [{"name": "bricklink", "url": "https://example.com"}]},
        {"id": "8880-1", "name": "Super Car", "type": "set", "score": 0.05},
        {"id": "3020", "name": "Plate 2 x 4", "category": "Plate", "type": "part",
         "score": 0.03, "img_url": None},
    ],
}


def with_transport(handler):
    brickscan._transport = httpx.MockTransport(handler)


def teardown_function():
    brickscan._transport = None


def test_identify_returns_parts_only(client, db):
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, content=json.dumps(BRICKSCAN_ITEMS))

    with_transport(handler)
    resp = client.post(
        "/api/identify?limit=3",
        files={"image": ("brick.jpg", b"fake-jpeg-bytes", "image/jpeg")},
    )
    assert resp.status_code == 200
    candidates = resp.json()["candidates"]
    assert [c["part_num"] for c in candidates] == ["3001", "3020"], "set result filtered out"
    assert candidates[0]["name"] == "Brick 2 x 4"
    assert candidates[0]["score"] == 0.90

    assert len(requests) == 1
    assert requests[0].url.path == "/api/v1/identify"
    assert requests[0].url.params["limit"] == "3"


def test_identify_empty_upload_rejected(client, db):
    with_transport(lambda r: httpx.Response(200, content='{"items": []}'))
    resp = client.post("/api/identify", files={"image": ("x.jpg", b"", "image/jpeg")})
    assert resp.status_code == 400


def test_identify_brickscan_down_returns_502(client, db):
    def handler(request):
        raise httpx.ConnectError("connection refused")

    with_transport(handler)
    resp = client.post("/api/identify", files={"image": ("x.jpg", b"data", "image/jpeg")})
    assert resp.status_code == 502
    assert "unreachable" in resp.json()["detail"].lower()


def test_identify_brickscan_error_returns_502(client, db):
    with_transport(lambda r: httpx.Response(500))
    resp = client.post("/api/identify", files={"image": ("x.jpg", b"data", "image/jpeg")})
    assert resp.status_code == 502
