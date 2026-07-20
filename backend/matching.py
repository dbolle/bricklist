"""Match a bin inventory against LEGO sets.

Two stages:

1. Discovery — for every distinct part in the bin, ask BrickScan's local
   catalog which sets contain it. Rare parts are highly discriminative, so
   candidates are scored IDF-style (weight 1/num_sets per part). Common
   parts (a 2x4 brick is in thousands of sets) contribute almost nothing,
   which also neutralizes the API's 100-most-recent-sets cap: the cap only
   truncates exactly the parts that carry no signal.

2. Verification — the top candidates' full inventories are loaded through
   the set cache (BrickScan catalog preferred, Rebrickable fallback) and
   each is scored precisely against the bin.

Both stages are relationship-aware: photo identification often lands on a
mold/print variant of what a set inventory lists (base mold vs. printed
part), so each bin part is expanded into a small "family" via the
catalog's mold/print/alternate relationships and matched family-wide.
"""
import asyncio

from sqlalchemy.orm import Session

import brickscan
from database import BinPart, SetPart

DISCOVERY_SETS_PER_PART = 100
MAX_VERIFY_CANDIDATES = 8
RELATIONSHIP_TYPES = {"mold", "print", "alternate"}
FAMILY_CAP = 6  # base part + up to 5 relatives; huge families = common molds = no signal
_DISCOVERY_CONCURRENCY = 8


async def _lookup_many(part_nums: list[str]) -> dict[str, dict | None]:
    sem = asyncio.Semaphore(_DISCOVERY_CONCURRENCY)

    async def lookup(part_num: str):
        async with sem:
            return part_num, await brickscan.get_part_sets(
                part_num, limit=DISCOVERY_SETS_PER_PART
            )

    results = await asyncio.gather(*[lookup(p) for p in dict.fromkeys(part_nums)])
    return dict(results)


def _family(part_num: str, info: dict | None) -> list[str]:
    fam = [part_num]
    for rel in (info or {}).get("relationships", []):
        if len(fam) >= FAMILY_CAP:
            break
        if rel.get("type") in RELATIONSHIP_TYPES and rel.get("part_num"):
            fam.append(rel["part_num"])
    return fam


async def discover_candidates(bin_parts: list[BinPart]) -> tuple[list[dict], dict[str, list[str]]]:
    """Rank candidate sets by IDF-weighted overlap with the bin's parts.

    Returns (candidates sorted best-first, families keyed by bin part_num)
    so verification can reuse the same family expansion.
    """
    primary = await _lookup_many([p.part_num for p in bin_parts])

    families: dict[str, list[str]] = {}
    relatives: set[str] = set()
    for p in bin_parts:
        fam = _family(p.part_num, primary.get(p.part_num))
        families[p.part_num] = fam
        relatives.update(f for f in fam[1:] if f not in primary)

    secondary = await _lookup_many(sorted(relatives)) if relatives else {}
    lookups = {**primary, **secondary}

    candidates: dict[str, dict] = {}
    for p in bin_parts:
        infos = [lookups.get(f) for f in families[p.part_num]]
        infos = [i for i in infos if i and i["num_sets"]]
        if not infos:
            continue
        # One logical part per family: rarest member sets the weight, and a
        # set is credited once even if it contains several family variants.
        weight = 1.0 / min(i["num_sets"] for i in infos)
        seen: set[str] = set()
        for info in infos:
            for s in info["sets"]:
                if s["set_num"] in seen:
                    continue
                seen.add(s["set_num"])
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

    ranked = sorted(candidates.values(),
                    key=lambda c: c["candidate_score"], reverse=True)
    return ranked, families


def score_against_inventory(bin_parts: list[BinPart], set_parts: list[SetPart],
                            families: dict[str, list[str]] | None = None) -> dict:
    """Precise overlap between a bin and one set's full inventory.

    Quantities are aggregated by part_num on both sides: photo identification
    doesn't know colors, so color variants of the same mold are pooled. A bin
    part may match any member of its mold/print family in the set.
    """
    set_qty: dict[str, int] = {}
    for sp in set_parts:
        if not sp.is_spare:
            set_qty[sp.part_num] = set_qty.get(sp.part_num, 0) + sp.quantity

    bin_total = sum(p.quantity for p in bin_parts)
    set_total = sum(set_qty.values())

    matched = 0
    for p in bin_parts:
        fam = families.get(p.part_num, [p.part_num]) if families else [p.part_num]
        available = sum(set_qty.get(f, 0) for f in fam)
        matched += min(p.quantity, available)

    bin_coverage = matched / bin_total if bin_total else 0.0
    set_coverage = matched / set_total if set_total else 0.0
    return {
        "matched_pieces": matched,
        "bin_pieces": bin_total,
        "set_pieces": set_total,
        "bin_coverage": bin_coverage,
        "set_coverage": set_coverage,
        # Geometric mean balances "how much of the set is here" against "how
        # much of the bin this explains" — set_coverage alone favors small
        # sets that coincidentally share a few pieces, bin_coverage alone
        # favors huge sets full of common bricks.
        "match_score": (bin_coverage * set_coverage) ** 0.5,
    }
