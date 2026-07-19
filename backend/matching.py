"""Match a bin inventory against LEGO sets.

Two stages:

1. Discovery — for every distinct part in the bin, ask BrickScan's local
   catalog which sets contain it. Rare parts are highly discriminative, so
   candidates are scored IDF-style (weight 1/num_sets per part). Common
   parts (a 2x4 brick is in thousands of sets) contribute almost nothing,
   which also neutralizes the API's 100-most-recent-sets cap: the cap only
   truncates exactly the parts that carry no signal.

2. Verification — the top candidates' full inventories are loaded through
   the existing Rebrickable cache (ensure_set_cached), and each is scored
   precisely against the bin. Requires a Rebrickable API key for uncached
   sets; without one, discovery results are returned unverified.
"""
import asyncio

from sqlalchemy.orm import Session

import brickscan
from database import BinPart, SetPart

DISCOVERY_SETS_PER_PART = 100
MAX_VERIFY_CANDIDATES = 8
_DISCOVERY_CONCURRENCY = 8


async def discover_candidates(bin_parts: list[BinPart]) -> list[dict]:
    """Rank candidate sets by IDF-weighted overlap with the bin's parts."""
    sem = asyncio.Semaphore(_DISCOVERY_CONCURRENCY)

    async def lookup(part: BinPart):
        async with sem:
            return part, await brickscan.get_part_sets(
                part.part_num, limit=DISCOVERY_SETS_PER_PART
            )

    results = await asyncio.gather(*[lookup(p) for p in bin_parts])

    candidates: dict[str, dict] = {}
    for part, info in results:
        if not info or not info["num_sets"]:
            continue
        weight = 1.0 / info["num_sets"]
        for s in info["sets"]:
            entry = candidates.setdefault(s["set_num"], {
                "set_num": s["set_num"],
                "name": s.get("name", ""),
                "year": s.get("year"),
                "img_url": s.get("img_url"),
                "theme": s.get("theme"),
                "candidate_score": 0.0,
                "discovery_hits": 0,
            })
            entry["candidate_score"] += weight
            entry["discovery_hits"] += 1

    return sorted(candidates.values(),
                  key=lambda c: c["candidate_score"], reverse=True)


def score_against_inventory(bin_parts: list[BinPart], set_parts: list[SetPart]) -> dict:
    """Precise overlap between a bin and one set's full inventory.

    Quantities are aggregated by part_num on both sides: photo identification
    doesn't know colors, so color variants of the same mold are pooled.
    """
    set_qty: dict[str, int] = {}
    for sp in set_parts:
        if not sp.is_spare:
            set_qty[sp.part_num] = set_qty.get(sp.part_num, 0) + sp.quantity

    bin_total = sum(p.quantity for p in bin_parts)
    set_total = sum(set_qty.values())

    matched = sum(min(p.quantity, set_qty.get(p.part_num, 0)) for p in bin_parts)
    return {
        "matched_pieces": matched,
        "bin_pieces": bin_total,
        "set_pieces": set_total,
        "bin_coverage": matched / bin_total if bin_total else 0.0,
        "set_coverage": matched / set_total if set_total else 0.0,
    }
