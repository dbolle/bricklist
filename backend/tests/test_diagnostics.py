import json

import httpx

import brickscan
import main
import rebrickable
from test_set_source import (brickscan_404_transport, rebrickable_transport,
                             set_api_key)


def teardown_function():
    brickscan._transport = None
    rebrickable._transport = None
    rebrickable._category_cache = None


def healthy_brickscan_transport():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/health"):
            return httpx.Response(200, content=json.dumps(
                {"status": "ok", "service": "brickscan", "version": "1.4.0",
                 "engine": "brickognize"}))
        if request.url.path.endswith("/catalog/status"):
            return httpx.Response(200, content=json.dumps(
                {"database": {"imported_at": "2026-07-01T00:00:00"},
                 "refresh": {"running": False, "interval": "monthly"}}))
        return httpx.Response(404)
    brickscan._transport = httpx.MockTransport(handler)


def test_diagnostics_reports_healthy_stack(client, db):
    healthy_brickscan_transport()
    d = client.get("/api/diagnostics").json()
    assert d["brickscan"]["reachable"] is True
    assert d["brickscan"]["version"] == "1.4.0"
    assert d["brickscan"]["catalog_imported_at"] == "2026-07-01T00:00:00"
    assert d["rebrickable_key_set"] is False
    assert d["pin_set"] is False
    assert "volume" in d["backups"] and "mirror" in d["backups"]


def test_diagnostics_reports_brickscan_down(client, db):
    def handler(request):
        raise httpx.ConnectError("refused")
    brickscan._transport = httpx.MockTransport(handler)

    d = client.get("/api/diagnostics").json()
    assert d["brickscan"]["reachable"] is False
    assert "error" in d["brickscan"]


def test_fallback_counter_increments(client, db):
    brickscan_404_transport()
    rebrickable_transport()
    set_api_key(db)
    main._rebrickable_fallbacks.update(count=0, last_at=None, last_set=None)

    client.get("/api/sets/x-1/parts")  # catalog 404 -> falls back

    healthy_brickscan_transport()
    d = client.get("/api/diagnostics").json()
    assert d["rebrickable_fallbacks"]["count"] == 1
    assert d["rebrickable_fallbacks"]["last_set"] == "x-1"
    assert d["rebrickable_fallbacks"]["last_at"] is not None
