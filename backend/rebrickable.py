import httpx
from fastapi import HTTPException

REBRICKABLE_BASE = "https://rebrickable.com/api/v3/lego"


def _headers(api_key: str) -> dict:
    return {"Authorization": f"key {api_key}"}


async def search_sets(api_key: str, query: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(
                f"{REBRICKABLE_BASE}/sets/",
                params={"search": query, "page_size": 20},
                headers=_headers(api_key),
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f"Rebrickable error: {e.response.status_code}")
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Rebrickable unreachable: {e}")

        data = resp.json()
        return [
            {
                "set_num": r["set_num"],
                "name": r["name"],
                "year": r.get("year"),
                "num_parts": r.get("num_parts"),
                "img_url": r.get("set_img_url"),
            }
            for r in data.get("results", [])
        ]


async def get_set(api_key: str, set_num: str) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(
                f"{REBRICKABLE_BASE}/sets/{set_num}/",
                headers=_headers(api_key),
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                raise HTTPException(status_code=404, detail=f"Set {set_num} not found on Rebrickable")
            raise HTTPException(status_code=502, detail=f"Rebrickable error: {e.response.status_code}")
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Rebrickable unreachable: {e}")

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
    results = []
    url = f"{REBRICKABLE_BASE}/sets/{set_num}/parts/"
    params: dict = {"page_size": 500}

    async with httpx.AsyncClient(timeout=30.0) as client:
        while url:
            try:
                resp = await client.get(url, params=params, headers=_headers(api_key))
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                raise HTTPException(status_code=502, detail=f"Rebrickable error: {e.response.status_code}")
            except httpx.RequestError as e:
                raise HTTPException(status_code=502, detail=f"Rebrickable unreachable: {e}")

            data = resp.json()
            for item in data.get("results", []):
                results.append({
                    "part_num": item["part"]["part_num"],
                    "part_name": item["part"]["name"],
                    "part_img_url": item["part"].get("part_img_url"),
                    "color_id": item["color"]["id"],
                    "color_name": item["color"]["name"],
                    "color_rgb": item["color"]["rgb"],
                    "quantity": item["quantity"],
                    "is_spare": item.get("is_spare", False),
                    "element_id": item.get("element_id"),
                })
            url = data.get("next")
            params = {}  # next URL already contains query params

    return results
