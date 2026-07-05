import asyncio
import json

import httpx
import pytest
from fastapi import HTTPException

import rebrickable


class FakeAPI:
    """MockTransport handler that can serve 429s before succeeding."""

    def __init__(self, responses_by_path=None, fail_429_times=0):
        self.responses_by_path = responses_by_path or {}
        self.fail_429_times = fail_429_times
        self.requests = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(str(request.url))
        if self.fail_429_times > 0:
            self.fail_429_times -= 1
            return httpx.Response(429, headers={"retry-after": "0"})
        body = self.responses_by_path.get(request.url.path)
        if body is None:
            return httpx.Response(404)
        return httpx.Response(200, content=json.dumps(body))


def run_with_transport(handler, coro_factory):
    rebrickable._transport = httpx.MockTransport(handler)
    rebrickable._clients.clear()
    rebrickable._semaphores.clear()
    rebrickable._category_cache = None
    try:
        return asyncio.run(coro_factory())
    finally:
        rebrickable._transport = None
        rebrickable._clients.clear()
        rebrickable._semaphores.clear()
        rebrickable._category_cache = None


SET_BODY = {"set_num": "1234-1", "name": "Test", "year": 2020, "theme_id": 1,
            "num_parts": 10, "set_img_url": None}


def test_retries_on_429_then_succeeds():
    api = FakeAPI({"/api/v3/lego/sets/1234-1/": SET_BODY}, fail_429_times=2)
    result = run_with_transport(api, lambda: rebrickable.get_set("key", "1234-1"))
    assert result["set_num"] == "1234-1"
    assert len(api.requests) == 3  # two 429s + one success


def test_persistent_429_becomes_friendly_502():
    api = FakeAPI(fail_429_times=99)
    with pytest.raises(HTTPException) as exc:
        run_with_transport(api, lambda: rebrickable.get_set("key", "1234-1"))
    assert exc.value.status_code == 502
    assert "rate limit" in exc.value.detail.lower()
    assert len(api.requests) == rebrickable._MAX_ATTEMPTS


def test_404_maps_to_not_found():
    api = FakeAPI({})
    with pytest.raises(HTTPException) as exc:
        run_with_transport(api, lambda: rebrickable.get_set("key", "9999-9"))
    assert exc.value.status_code == 404


def test_pagination_follows_next_links():
    page2_url = "https://rebrickable.com/api/v3/lego/sets/1234-1/parts/page2"

    def handler(request: httpx.Request) -> httpx.Response:
        item = {
            "part": {"part_num": "3001", "name": "Brick 2x4", "part_img_url": None,
                     "part_cat_id": 11},
            "color": {"id": 0, "name": "Black", "rgb": "05131D"},
            "quantity": 2, "is_spare": False, "element_id": "300126",
        }
        if "page2" in str(request.url):
            return httpx.Response(200, content=json.dumps({"results": [item], "next": None}))
        return httpx.Response(200, content=json.dumps({"results": [item], "next": page2_url}))

    parts = run_with_transport(handler, lambda: rebrickable.get_set_parts("key", "1234-1"))
    assert len(parts) == 2
    assert parts[0]["part_num"] == "3001"
    assert parts[0]["part_cat_id"] == 11


def test_part_categories_cached_across_calls():
    api = FakeAPI({"/api/v3/lego/part_categories/": {
        "results": [{"id": 11, "name": "Bricks"}], "next": None}})

    async def twice():
        first = await rebrickable.get_part_categories("key")
        second = await rebrickable.get_part_categories("key")
        return first, second

    first, second = run_with_transport(api, twice)
    assert first == {11: "Bricks"} and second == {11: "Bricks"}
    assert len(api.requests) == 1, "second call must be served from cache"
