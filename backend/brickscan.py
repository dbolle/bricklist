"""Client for the local BrickScan service (LEGO part identification from photos).

BrickScan runs separately on the host (default port 8420) and wraps the
Brickognize engine. From inside the BrickList container it is reached via
host.docker.internal (see docker-compose.yml); override with BRICKSCAN_URL.
"""
import os

import httpx
from fastapi import HTTPException

BRICKSCAN_URL = os.getenv("BRICKSCAN_URL", "http://localhost:8420")

# Tests inject an httpx.MockTransport here, same pattern as rebrickable.py
_transport: httpx.AsyncBaseTransport | None = None


async def get_set(set_num: str) -> dict | None:
    """Set metadata from BrickScan's local catalog; None if not in catalog."""
    try:
        async with httpx.AsyncClient(timeout=15.0, transport=_transport) as client:
            resp = await client.get(f"{BRICKSCAN_URL}/api/v1/sets/{set_num}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"BrickScan unreachable: {e}")
    if resp.status_code == 404:
        return None
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"BrickScan error: {resp.status_code}")
    r = resp.json()
    return {
        "set_num": r["set_num"],
        "name": r["name"],
        "year": r.get("year"),
        "theme_id": None,  # catalog exposes theme name, not Rebrickable theme id
        "num_parts": r.get("num_parts"),
        "img_url": r.get("img_url"),
    }


async def get_set_inventory(set_num: str) -> dict | None:
    """Full color-level inventory (incl. spares and minifig parts) from the
    local catalog; None if the set isn't in the catalog."""
    try:
        async with httpx.AsyncClient(timeout=15.0, transport=_transport) as client:
            resp = await client.get(
                f"{BRICKSCAN_URL}/api/v1/sets/{set_num}/parts",
                params={"include_minifig_parts": "true"},
            )
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"BrickScan unreachable: {e}")
    if resp.status_code == 404:
        return None
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"BrickScan error: {resp.status_code}")
    return resp.json()


async def get_part_sets(part_num: str, limit: int = 100) -> dict | None:
    """Which sets contain a part, from BrickScan's local Rebrickable catalog.

    Returns {"num_sets": int, "sets": [{set_num, name, year, img_url, theme,
    quantity}]} — sets listed most-recent-first, capped at `limit` (API max
    100). None if the part isn't in the catalog.
    """
    try:
        async with httpx.AsyncClient(timeout=15.0, transport=_transport) as client:
            resp = await client.get(
                f"{BRICKSCAN_URL}/api/v1/parts/{part_num}",
                params={"sets_limit": limit},
            )
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"BrickScan unreachable: {e}")
    if resp.status_code == 404:
        return None
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"BrickScan error: {resp.status_code}")
    data = resp.json()
    return {
        "num_sets": (data.get("usage") or {}).get("num_sets", 0),
        "sets": data.get("sets", []),
    }


async def identify(image_bytes: bytes, filename: str, content_type: str | None,
                   limit: int = 5) -> list[dict]:
    """Return candidate parts for a photo, best match first."""
    files = {"image": (filename, image_bytes, content_type or "image/jpeg")}
    try:
        async with httpx.AsyncClient(timeout=30.0, transport=_transport) as client:
            resp = await client.post(
                f"{BRICKSCAN_URL}/api/v1/identify",
                params={"limit": limit},
                files=files,
            )
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"BrickScan unreachable: {e}")
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"BrickScan error: {resp.status_code}")

    data = resp.json()
    return [
        {
            "part_num": item["id"],
            "name": item.get("name", ""),
            "category": item.get("category"),
            "score": item.get("score"),
            "img_url": item.get("img_url"),
        }
        for item in data.get("items", [])
        # Brickognize can also match sets/minifigs; sorting only needs parts
        if item.get("type", "part") == "part" and item.get("id")
    ]
