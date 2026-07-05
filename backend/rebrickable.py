import asyncio
import time

import httpx
from fastapi import HTTPException

REBRICKABLE_BASE = "https://rebrickable.com/api/v3/lego"

# The free Rebrickable tier throttles aggressively (~1 req/s sustained).
# Keep request bursts small and retry on 429 instead of failing the whole
# set fetch — a minifig-heavy set can need a dozen requests.
_MAX_CONCURRENT_REQUESTS = 3
_MAX_ATTEMPTS = 5
_MAX_BACKOFF_SECONDS = 30.0

CATEGORY_CACHE_TTL_SECONDS = 24 * 3600

# Client/semaphore are per event loop: uvicorn uses one loop, but tests may
# run several. Set _transport (tests only) before the first request to route
# traffic through a mock.
_transport: httpx.AsyncBaseTransport | None = None
_clients: dict[asyncio.AbstractEventLoop, httpx.AsyncClient] = {}
_semaphores: dict[asyncio.AbstractEventLoop, asyncio.Semaphore] = {}
_category_cache: tuple[float, dict[int, str]] | None = None


def _headers(api_key: str) -> dict:
    return {"Authorization": f"key {api_key}"}


def _get_client() -> httpx.AsyncClient:
    loop = asyncio.get_running_loop()
    client = _clients.get(loop)
    if client is None or client.is_closed:
        client = httpx.AsyncClient(timeout=30.0, transport=_transport)
        _clients[loop] = client
    return client


def _get_semaphore() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    sem = _semaphores.get(loop)
    if sem is None:
        sem = asyncio.Semaphore(_MAX_CONCURRENT_REQUESTS)
        _semaphores[loop] = sem
    return sem


async def _get(url: str, api_key: str, params: dict | None = None) -> httpx.Response:
    client = _get_client()
    sem = _get_semaphore()
    resp = None
    for attempt in range(_MAX_ATTEMPTS):
        async with sem:
            try:
                resp = await client.get(url, params=params, headers=_headers(api_key))
            except httpx.RequestError as e:
                raise HTTPException(status_code=502, detail=f"Rebrickable unreachable: {e}")
        if resp.status_code == 429 and attempt < _MAX_ATTEMPTS - 1:
            try:
                delay = float(resp.headers.get("retry-after", ""))
            except ValueError:
                delay = 2.0 ** attempt
            await asyncio.sleep(min(delay, _MAX_BACKOFF_SECONDS))
            continue
        break
    return resp


def _check(resp: httpx.Response, not_found_detail: str | None = None) -> None:
    if resp.status_code == 404 and not_found_detail:
        raise HTTPException(status_code=404, detail=not_found_detail)
    if resp.status_code == 429:
        raise HTTPException(
            status_code=502,
            detail="Rebrickable rate limit exceeded — try again in a minute",
        )
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Rebrickable error: {resp.status_code}")


async def _get_paginated(url: str, api_key: str, page_size: int) -> list[dict]:
    items: list[dict] = []
    params: dict | None = {"page_size": page_size}
    while url:
        resp = await _get(url, api_key, params)
        _check(resp)
        data = resp.json()
        items.extend(data.get("results", []))
        url = data.get("next")
        params = None  # next URL already contains query params
    return items


def _part_from_item(item: dict) -> dict:
    return {
        "part_num": item["part"]["part_num"],
        "part_name": item["part"]["name"],
        "part_img_url": item["part"].get("part_img_url"),
        "part_cat_id": item["part"].get("part_cat_id"),
        "color_id": item["color"]["id"],
        "color_name": item["color"]["name"],
        "color_rgb": item["color"]["rgb"],
        "quantity": item["quantity"],
        "is_spare": item.get("is_spare", False),
        "element_id": item.get("element_id"),
    }


async def search_sets(api_key: str, query: str) -> list[dict]:
    resp = await _get(
        f"{REBRICKABLE_BASE}/sets/",
        api_key,
        params={"search": query, "page_size": 20},
    )
    _check(resp)
    return [
        {
            "set_num": r["set_num"],
            "name": r["name"],
            "year": r.get("year"),
            "num_parts": r.get("num_parts"),
            "img_url": r.get("set_img_url"),
        }
        for r in resp.json().get("results", [])
    ]


async def get_set(api_key: str, set_num: str) -> dict:
    resp = await _get(f"{REBRICKABLE_BASE}/sets/{set_num}/", api_key)
    _check(resp, not_found_detail=f"Set {set_num} not found on Rebrickable")
    r = resp.json()
    return {
        "set_num": r["set_num"],
        "name": r["name"],
        "year": r.get("year"),
        "theme_id": r.get("theme_id"),
        "num_parts": r.get("num_parts"),
        "img_url": r.get("set_img_url"),
    }


async def get_set_parts(api_key: str, set_num: str) -> list[dict]:
    items = await _get_paginated(f"{REBRICKABLE_BASE}/sets/{set_num}/parts/", api_key, 500)
    return [_part_from_item(item) for item in items]


async def get_set_minifigs(api_key: str, set_num: str) -> list[dict]:
    items = await _get_paginated(f"{REBRICKABLE_BASE}/sets/{set_num}/minifigs/", api_key, 100)
    return [
        {
            "fig_num": item["set_num"],
            "name": item["set_name"],
            "quantity": item.get("quantity", 1),
        }
        for item in items
    ]


async def get_minifig_parts(api_key: str, fig_num: str) -> list[dict]:
    items = await _get_paginated(f"{REBRICKABLE_BASE}/minifigs/{fig_num}/parts/", api_key, 100)
    return [_part_from_item(item) for item in items]


async def get_part_categories(api_key: str) -> dict[int, str]:
    global _category_cache
    now = time.monotonic()
    if _category_cache and now - _category_cache[0] < CATEGORY_CACHE_TTL_SECONDS:
        return _category_cache[1]
    items = await _get_paginated(f"{REBRICKABLE_BASE}/part_categories/", api_key, 200)
    result = {item["id"]: item["name"] for item in items}
    _category_cache = (now, result)
    return result
