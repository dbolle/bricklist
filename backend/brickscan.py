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
