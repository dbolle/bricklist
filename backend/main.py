import asyncio
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, FastAPI, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, text
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

import backups
import brickscan
import matching
import rebrickable
from database import (
    Bin, BinPart, Color, Group, PartProgress, Project,
    RemovedPartNotification, SessionLocal, SetModel, SetPart, Setting,
    engine, get_db, init_db,
)

CACHE_MAX_AGE_DAYS = 7

BACKUP_DIR = os.getenv("BACKUP_DIR", "/data/backups")
BACKUP_KEEP = int(os.getenv("BACKUP_KEEP", "7"))
BACKUP_KEEP_MONTHLY = int(os.getenv("BACKUP_KEEP_MONTHLY", "12"))
BACKUP_MIRROR_DIR = os.getenv("BACKUP_MIRROR_DIR", "/backups-mirror")
BACKUP_MAX_AGE_SECONDS = 24 * 3600
_BACKUP_CHECK_INTERVAL_SECONDS = 3600

logger = logging.getLogger("bricklist")


def _run_backup_cycle() -> None:
    status: dict = {"at": datetime.utcnow().isoformat(), "ok": True}
    try:
        if backups.snapshot_due(BACKUP_DIR, BACKUP_MAX_AGE_SECONDS):
            path = backups.create_snapshot(BACKUP_DIR)
            removed = backups.prune_snapshots(BACKUP_DIR, BACKUP_KEEP)
            status["snapshot"] = os.path.basename(path)
            logger.info("Auto-backup written: %s (pruned %d)", path, len(removed))
        monthly = backups.ensure_monthly(BACKUP_DIR, BACKUP_KEEP_MONTHLY)
        if monthly:
            status["monthly"] = os.path.basename(monthly)
            logger.info("Monthly backup promoted: %s", monthly)
        # Mirror only when the mount exists — a bind mount pointed at another
        # disk/NAS; skipping silently would hide a broken mount, so record it.
        if os.path.isdir(BACKUP_MIRROR_DIR):
            copied = backups.mirror_snapshots(
                BACKUP_DIR, BACKUP_MIRROR_DIR, BACKUP_KEEP, BACKUP_KEEP_MONTHLY)
            status["mirrored"] = copied
        else:
            status["mirror_missing"] = True
    except Exception as e:
        status["ok"] = False
        status["error"] = repr(e)
        logger.exception("Automatic backup failed")
    backups.last_run = status


async def _auto_backup_loop():
    while True:
        _run_backup_cycle()
        await asyncio.sleep(_BACKUP_CHECK_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    backup_task = asyncio.create_task(_auto_backup_loop())
    yield
    backup_task.cancel()


app = FastAPI(lifespan=lifespan)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def normalize_set_num(set_num: str) -> str:
    return set_num if "-" in set_num else f"{set_num}-1"


def get_api_key(db: Session) -> str:
    setting = db.get(Setting, "rebrickable_api_key")
    if not setting or not setting.value:
        raise HTTPException(
            status_code=400,
            detail="Rebrickable API key not configured. Go to Settings to add your key.",
        )
    return setting.value


def is_stale(cached_at: datetime) -> bool:
    return datetime.utcnow() - cached_at > timedelta(days=CACHE_MAX_AGE_DAYS)


# Sets currently being refreshed in the background, plus strong references to
# the tasks so they aren't garbage-collected mid-flight.
_refreshing_sets: set[str] = set()
_background_tasks: set[asyncio.Task] = set()


async def _refresh_set_in_background(set_num: str) -> None:
    if set_num in _refreshing_sets:
        return
    _refreshing_sets.add(set_num)
    try:
        db = SessionLocal()
        try:
            await _fetch_and_cache_set(set_num, db)
        finally:
            db.close()
    except Exception:
        logger.exception("Background refresh of set %s failed", set_num)
    finally:
        _refreshing_sets.discard(set_num)


async def ensure_set_cached(set_num: str, db: Session) -> SetModel:
    """Return the cached set, fetching it only if it has never been cached.

    A stale cache is served immediately and refreshed in the background so
    opening a project never blocks on (or fails because of) a source fetch.
    """
    set_num = normalize_set_num(set_num)
    db_set = db.get(SetModel, set_num)
    if db_set is None:
        return await _fetch_and_cache_set(set_num, db)

    if is_stale(db_set.cached_at) and set_num not in _refreshing_sets:
        task = asyncio.create_task(_refresh_set_in_background(set_num))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
    return db_set


async def _fetch_from_brickscan(set_num: str):
    """(set_data, all_parts) from BrickScan's local catalog, or None to
    trigger the Rebrickable fallback (set not in catalog, service down, or
    a malformed response)."""
    try:
        set_data, inventory = await asyncio.gather(
            brickscan.get_set(set_num),
            brickscan.get_set_inventory(set_num),
        )
        if set_data is None or inventory is None:
            return None

        all_parts: list[tuple[dict, str, str | None]] = []
        for r in inventory["parts"]:
            all_parts.append(({
                "part_num": r["part_num"],
                "part_name": r["name"],
                "part_img_url": r.get("img_url"),
                "part_cat_id": r.get("part_cat_id"),
                "part_cat_name": r.get("part_cat_name"),
                "color_id": r["color_id"],
                "color_name": r["color_name"],
                "color_rgb": r["color_rgb"],
                "quantity": r["quantity"],
                "is_spare": r.get("is_spare", False),
                "element_id": r.get("element_id"),
            }, '', None))
        for r in inventory.get("minifig_parts", []):
            all_parts.append(({
                "part_num": r["part_num"],
                "part_name": r["name"],
                "part_img_url": r.get("img_url"),
                "part_cat_id": r.get("part_cat_id"),
                "part_cat_name": r.get("part_cat_name"),
                "color_id": r["color_id"],
                "color_name": r["color_name"],
                "color_rgb": r["color_rgb"],
                "quantity": r["total_quantity"],
                "is_spare": r.get("is_spare", False),
                "element_id": r.get("element_id"),
            }, r["fig_num"], r.get("fig_name")))
        return set_data, all_parts
    except (HTTPException, KeyError, ValueError) as e:
        detail = getattr(e, "detail", repr(e))
        logger.warning("BrickScan catalog fetch for %s failed (%s); falling back to Rebrickable",
                       set_num, detail)
        return None


async def _fetch_from_rebrickable(set_num: str, api_key: str):
    set_data, parts_data, categories, minifigs = await asyncio.gather(
        rebrickable.get_set(api_key, set_num),
        rebrickable.get_set_parts(api_key, set_num),
        rebrickable.get_part_categories(api_key),
        rebrickable.get_set_minifigs(api_key, set_num),
    )

    # Fetch every minifigure's parts concurrently, then build a flat list of
    # (part_dict, minifig_num, minifig_name) covering both regular and minifig parts.
    if minifigs:
        minifig_parts_lists = await asyncio.gather(
            *[rebrickable.get_minifig_parts(api_key, mf["fig_num"]) for mf in minifigs]
        )
    else:
        minifig_parts_lists = []

    all_parts: list[tuple[dict, str, str | None]] = []
    for p in parts_data:
        p = dict(p)
        cat_id = p.get("part_cat_id")
        p["part_cat_name"] = categories.get(cat_id) if cat_id else None
        all_parts.append((p, '', None))
    for mf, mf_parts in zip(minifigs, minifig_parts_lists):
        for p in mf_parts:
            scaled = dict(p)
            scaled["quantity"] = p["quantity"] * mf["quantity"]
            cat_id = scaled.get("part_cat_id")
            scaled["part_cat_name"] = categories.get(cat_id) if cat_id else None
            all_parts.append((scaled, mf["fig_num"], mf["name"]))
    return set_data, all_parts


async def _fetch_and_cache_set(set_num: str, db: Session) -> SetModel:
    # BrickScan's local catalog is the preferred source: no rate limits, no
    # internet, ~30ms. Rebrickable is the fallback (and the only path that
    # needs an API key).
    fetched = await _fetch_from_brickscan(set_num)
    if fetched is None:
        fetched = await _fetch_from_rebrickable(set_num, get_api_key(db))
    set_data, all_parts = fetched

    db_set = db.get(SetModel, set_num)
    if db_set:
        db_set.name = set_data["name"]
        db_set.year = set_data.get("year")
        if set_data.get("theme_id") is not None:  # catalog source has no theme id
            db_set.theme_id = set_data.get("theme_id")
        db_set.num_parts = set_data.get("num_parts")
        db_set.img_url = set_data.get("img_url")
        db_set.cached_at = datetime.utcnow()
        # Index existing parts by their unique key so we can upsert
        existing = {(sp.part_num, sp.color_id, sp.is_spare, sp.minifig_num): sp for sp in db_set.parts}
    else:
        db_set = SetModel(
            set_num=set_num,
            name=set_data["name"],
            year=set_data.get("year"),
            theme_id=set_data.get("theme_id"),
            num_parts=set_data.get("num_parts"),
            img_url=set_data.get("img_url"),
        )
        db.add(db_set)
        db.flush()
        existing = {}

    seen_colors: set[int] = set()
    incoming_keys: set[tuple] = set()
    for p, mfig_num, mfig_name in all_parts:
        if p["color_id"] not in seen_colors and not db.get(Color, p["color_id"]):
            db.add(Color(color_id=p["color_id"], name=p["color_name"], rgb=p["color_rgb"]))
        seen_colors.add(p["color_id"])

        cat_id = p.get("part_cat_id")
        key = (p["part_num"], p["color_id"], p.get("is_spare", False), mfig_num)
        incoming_keys.add(key)

        if key in existing:
            # Update in-place — preserves the row id and any linked part_progress
            sp = existing[key]
            sp.part_name = p["part_name"]
            sp.part_img_url = p.get("part_img_url")
            sp.quantity = p["quantity"]
            sp.element_id = p.get("element_id")
            sp.part_cat_id = cat_id
            sp.part_cat_name = p.get("part_cat_name")
            sp.minifig_name = mfig_name
        else:
            db.add(SetPart(
                set_num=set_num,
                part_num=p["part_num"],
                part_name=p["part_name"],
                part_img_url=p.get("part_img_url"),
                color_id=p["color_id"],
                quantity=p["quantity"],
                is_spare=p.get("is_spare", False),
                element_id=p.get("element_id"),
                part_cat_id=cat_id,
                part_cat_name=p.get("part_cat_name"),
                minifig_num=mfig_num,
                minifig_name=mfig_name,
            ))

    # Remove parts that no longer exist in the set.
    # For any that were partially/fully found, save a notification so the user
    # knows to remove those bricks from their physical bag.
    for key, sp in existing.items():
        if key not in incoming_keys:
            progress_rows = (
                db.query(PartProgress)
                .filter(PartProgress.set_part_id == sp.id, PartProgress.found_qty > 0)
                .all()
            )
            for row in progress_rows:
                db.add(RemovedPartNotification(
                    project_id=row.project_id,
                    part_num=sp.part_num,
                    part_name=sp.part_name,
                    part_img_url=sp.part_img_url,
                    color_name=sp.color.name if sp.color else "",
                    color_rgb=sp.color.rgb if sp.color else "808080",
                    part_cat_name=sp.part_cat_name,
                    found_qty=row.found_qty,
                ))
            db.delete(sp)

    db.commit()
    db.refresh(db_set)
    return db_set


def set_to_dict(s: SetModel) -> dict:
    return {
        "set_num": s.set_num,
        "name": s.name,
        "year": s.year,
        "num_parts": s.num_parts,
        "img_url": s.img_url,
        "cached_at": s.cached_at.isoformat() if s.cached_at else None,
    }


def project_summary(p: Project, db: Session) -> dict:
    # Both totals are piece counts: sum of quantities, with found capped per part
    # so a shrunken inventory can never push progress past 100%.
    total = (
        db.query(func.coalesce(func.sum(SetPart.quantity), 0))
        .filter(SetPart.set_num == p.set_num, SetPart.is_spare == False)
        .scalar()
    )
    found = (
        db.query(PartProgress.found_qty, SetPart.quantity)
        .join(SetPart, PartProgress.set_part_id == SetPart.id)
        .filter(
            PartProgress.project_id == p.id,
            SetPart.is_spare == False,
        )
        .all()
    )
    found_count = sum(min(f, q) for f, q in found)
    return {
        "id": p.id,
        "set_num": p.set_num,
        "set_name": p.set.name if p.set else "",
        "set_img_url": p.set.img_url if p.set else None,
        "name": p.name,
        "group_id": p.group_id,
        "group_name": p.group.name if p.group else None,
        "created_at": p.created_at.isoformat(),
        "total_parts": total,
        "found_parts": found_count,
    }


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

class SettingsIn(BaseModel):
    rebrickable_api_key: str


@app.get("/api/settings")
def get_settings(db: Session = Depends(get_db)):
    setting = db.get(Setting, "rebrickable_api_key")
    return {"rebrickable_api_key": setting.value if setting else ""}


@app.put("/api/settings")
def update_settings(body: SettingsIn, db: Session = Depends(get_db)):
    setting = db.get(Setting, "rebrickable_api_key")
    if setting:
        setting.value = body.rebrickable_api_key
    else:
        db.add(Setting(key="rebrickable_api_key", value=body.rebrickable_api_key))
    db.commit()
    return {"rebrickable_api_key": body.rebrickable_api_key}


# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------

@app.get("/api/backup")
def download_backup():
    """Stream a consistent snapshot of the SQLite database.

    VACUUM INTO produces a standalone copy that is safe to take while the app
    is running (WAL mode) — restoring is just replacing the db file.
    """
    fd, path = tempfile.mkstemp(prefix="bricklist-backup-", suffix=".db")
    os.close(fd)
    os.remove(path)  # VACUUM INTO requires the target not to exist
    try:
        with engine.connect() as conn:
            conn.execution_options(isolation_level="AUTOCOMMIT").execute(
                text("VACUUM INTO :path"), {"path": path}
            )
    except Exception:
        if os.path.exists(path):
            os.remove(path)
        raise
    filename = f"bricklist-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
    return FileResponse(
        path,
        filename=filename,
        media_type="application/octet-stream",
        background=BackgroundTask(os.remove, path),
    )


# ---------------------------------------------------------------------------
# Rebrickable search proxy
# ---------------------------------------------------------------------------

@app.get("/api/rebrickable/search")
async def search_sets(q: str, db: Session = Depends(get_db)):
    if len(q.strip()) < 2:
        return {"results": []}
    api_key = get_api_key(db)
    results = await rebrickable.search_sets(api_key, q)
    return {"results": results}


# ---------------------------------------------------------------------------
# Sets (cache)
# ---------------------------------------------------------------------------

@app.get("/api/sets/{set_num}")
async def get_set(set_num: str, db: Session = Depends(get_db)):
    db_set = await ensure_set_cached(set_num, db)
    return set_to_dict(db_set)


@app.get("/api/sets/{set_num}/parts")
async def get_set_parts(
    set_num: str,
    include_spares: bool = False,
    db: Session = Depends(get_db),
):
    db_set = await ensure_set_cached(set_num, db)
    query = db.query(SetPart).filter(SetPart.set_num == db_set.set_num)
    if not include_spares:
        query = query.filter(SetPart.is_spare == False)
    parts = query.all()
    return {
        "set_num": db_set.set_num,
        "parts": [
            {
                "id": p.id,
                "part_num": p.part_num,
                "part_name": p.part_name,
                "part_img_url": p.part_img_url,
                "color_id": p.color_id,
                "color_name": p.color.name if p.color else "",
                "color_rgb": p.color.rgb if p.color else "808080",
                "quantity": p.quantity,
                "is_spare": p.is_spare,
                "element_id": p.element_id,
                "part_cat_id": p.part_cat_id,
                "part_cat_name": p.part_cat_name or "",
                "minifig_num": p.minifig_num,
                "minifig_name": p.minifig_name or "",
            }
            for p in parts
        ],
    }


@app.post("/api/sets/{set_num}/refresh")
async def refresh_set(set_num: str, db: Session = Depends(get_db)):
    set_num = normalize_set_num(set_num)
    db_set = await _fetch_and_cache_set(set_num, db)
    return set_to_dict(db_set)


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

class ProjectIn(BaseModel):
    set_num: str
    name: str
    group_id: Optional[int] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    group_id: Optional[int] = None


@app.get("/api/projects")
def list_projects(db: Session = Depends(get_db)):
    projects = db.query(Project).order_by(Project.created_at.desc()).all()
    return {"projects": [project_summary(p, db) for p in projects]}


@app.post("/api/projects", status_code=201)
async def create_project(body: ProjectIn, db: Session = Depends(get_db)):
    body.set_num = normalize_set_num(body.set_num)
    await ensure_set_cached(body.set_num, db)

    if body.group_id:
        group = db.get(Group, body.group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")

    project = Project(set_num=body.set_num, name=body.name, group_id=body.group_id)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project_summary(project, db)


@app.get("/api/projects/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project_summary(project, db)


@app.put("/api/projects/{project_id}")
def update_project(project_id: int, body: ProjectUpdate, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if body.name is not None:
        project.name = body.name
    if body.group_id is not None:
        if body.group_id == 0:
            project.group_id = None
        else:
            group = db.get(Group, body.group_id)
            if not group:
                raise HTTPException(status_code=404, detail="Group not found")
            project.group_id = body.group_id
    db.commit()
    db.refresh(project)
    return project_summary(project, db)


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Part progress
# ---------------------------------------------------------------------------

class PartProgressIn(BaseModel):
    found_qty: int


@app.get("/api/projects/{project_id}/progress")
def get_progress(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    rows = db.query(PartProgress).filter(PartProgress.project_id == project_id).all()
    return {"progress": {str(r.set_part_id): r.found_qty for r in rows}}


@app.patch("/api/projects/{project_id}/parts/{set_part_id}")
def update_part_progress(
    project_id: int,
    set_part_id: int,
    body: PartProgressIn,
    db: Session = Depends(get_db),
):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    part = db.get(SetPart, set_part_id)
    if not part or part.set_num != project.set_num:
        raise HTTPException(status_code=404, detail="Part not found for this project")

    found_qty = max(0, min(body.found_qty, part.quantity))

    row = (
        db.query(PartProgress)
        .filter(
            PartProgress.project_id == project_id,
            PartProgress.set_part_id == set_part_id,
        )
        .first()
    )
    if row:
        row.found_qty = found_qty
    else:
        row = PartProgress(project_id=project_id, set_part_id=set_part_id, found_qty=found_qty)
        db.add(row)
    db.commit()
    return {"set_part_id": set_part_id, "found_qty": found_qty, "quantity": part.quantity}


# ---------------------------------------------------------------------------
# Missing-parts export (Rebrickable-importable CSV: Part,Color,Quantity)
# ---------------------------------------------------------------------------

def _missing_parts_csv(projects: list[Project], db: Session) -> str:
    """Aggregate still-missing piece counts by (part_num, color_id).

    Non-spare parts only; found counts are capped at each part's quantity so
    a shrunken inventory can't produce negative missing counts.
    """
    missing: dict[tuple[str, int], int] = {}
    for project in projects:
        rows = (
            db.query(SetPart, PartProgress.found_qty)
            .outerjoin(PartProgress, and_(
                PartProgress.set_part_id == SetPart.id,
                PartProgress.project_id == project.id,
            ))
            .filter(SetPart.set_num == project.set_num, SetPart.is_spare == False)
            .all()
        )
        for sp, found_qty in rows:
            still_needed = sp.quantity - min(found_qty or 0, sp.quantity)
            if still_needed > 0:
                key = (sp.part_num, sp.color_id)
                missing[key] = missing.get(key, 0) + still_needed

    lines = ["Part,Color,Quantity"]
    for (part_num, color_id), qty in sorted(missing.items()):
        lines.append(f"{part_num},{color_id},{qty}")
    return "\n".join(lines) + "\n"


def _csv_response(content: str, filename: str) -> Response:
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/projects/{project_id}/missing-parts.csv")
def export_project_missing_parts(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return _csv_response(
        _missing_parts_csv([project], db),
        f"missing-{project.set_num}.csv",
    )


@app.get("/api/groups/{group_id}/missing-parts.csv")
def export_group_missing_parts(group_id: int, db: Session = Depends(get_db)):
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return _csv_response(
        _missing_parts_csv(list(group.projects), db),
        f"missing-group-{group.id}.csv",
    )


# ---------------------------------------------------------------------------
# Photo identification (proxied to the local BrickScan service)
# ---------------------------------------------------------------------------

MAX_IDENTIFY_IMAGE_BYTES = 15 * 1024 * 1024


@app.post("/api/identify")
async def identify_part(image: UploadFile = File(...), limit: int = 5):
    contents = await image.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty image upload")
    if len(contents) > MAX_IDENTIFY_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (15MB max)")
    candidates = await brickscan.identify(
        contents, image.filename or "photo.jpg", image.content_type,
        limit=max(1, min(limit, 10)),
    )
    return {"candidates": candidates}


# ---------------------------------------------------------------------------
# Global part search — "I'm holding this piece, which project needs it?"
# ---------------------------------------------------------------------------

@app.get("/api/search/parts")
def search_parts(q: str, include_spares: bool = False, db: Session = Depends(get_db)):
    q = q.strip()
    if len(q) < 2:
        return {"results": []}
    like = f"%{q}%"
    query = (
        db.query(SetPart, Project, PartProgress.found_qty)
        .join(Project, Project.set_num == SetPart.set_num)
        .outerjoin(PartProgress, and_(
            PartProgress.set_part_id == SetPart.id,
            PartProgress.project_id == Project.id,
        ))
        .filter(or_(
            SetPart.part_num.like(like),
            SetPart.element_id.like(like),
            SetPart.part_name.like(like),
        ))
    )
    if not include_spares:
        query = query.filter(SetPart.is_spare == False)
    rows = query.limit(500).all()

    results = [
        {
            "project_id": project.id,
            "project_name": project.name,
            "found_qty": found_qty or 0,
            "part": {
                "id": sp.id,
                "part_num": sp.part_num,
                "part_name": sp.part_name,
                "part_img_url": sp.part_img_url,
                "color_id": sp.color_id,
                "color_name": sp.color.name if sp.color else "",
                "color_rgb": sp.color.rgb if sp.color else "808080",
                "quantity": sp.quantity,
                "is_spare": sp.is_spare,
                "element_id": sp.element_id,
                "part_cat_name": sp.part_cat_name or "",
                "minifig_num": sp.minifig_num,
                "minifig_name": sp.minifig_name or "",
            },
        }
        for sp, project, found_qty in rows
    ]
    # Projects that still need the piece come first
    results.sort(key=lambda r: (
        r["found_qty"] >= r["part"]["quantity"],
        r["part"]["part_name"].lower(),
        r["project_name"].lower(),
    ))
    return {"results": results}


# ---------------------------------------------------------------------------
# Removed-part notifications
# ---------------------------------------------------------------------------


@app.get("/api/projects/{project_id}/removed-parts")
def get_removed_parts(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    rows = (
        db.query(RemovedPartNotification)
        .filter(RemovedPartNotification.project_id == project_id)
        .order_by(RemovedPartNotification.created_at.desc())
        .all()
    )
    return {
        "notifications": [
            {
                "id": r.id,
                "part_num": r.part_num,
                "part_name": r.part_name,
                "part_img_url": r.part_img_url,
                "color_name": r.color_name,
                "color_rgb": r.color_rgb,
                "part_cat_name": r.part_cat_name,
                "found_qty": r.found_qty,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ]
    }


@app.delete("/api/removed-parts/{notification_id}", status_code=204)
def dismiss_removed_part(notification_id: int, db: Session = Depends(get_db)):
    row = db.get(RemovedPartNotification, notification_id)
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    db.delete(row)
    db.commit()


@app.delete("/api/projects/{project_id}/removed-parts", status_code=204)
def dismiss_all_removed_parts(project_id: int, db: Session = Depends(get_db)):
    db.query(RemovedPartNotification).filter(
        RemovedPartNotification.project_id == project_id
    ).delete()
    db.commit()


# ---------------------------------------------------------------------------
# Bins — photo-built inventories of unsorted parts, matched against sets
# ---------------------------------------------------------------------------

class BinIn(BaseModel):
    name: str


class BinPartIn(BaseModel):
    part_num: str
    name: str = ""
    category: Optional[str] = None
    img_url: Optional[str] = None
    quantity: int = 1


class BinPartUpdate(BaseModel):
    quantity: int


def bin_part_dict(bp: BinPart) -> dict:
    return {
        "id": bp.id,
        "part_num": bp.part_num,
        "name": bp.name,
        "category": bp.category,
        "img_url": bp.img_url,
        "quantity": bp.quantity,
    }


def bin_dict(b: Bin, include_parts: bool = False) -> dict:
    d = {
        "id": b.id,
        "name": b.name,
        "created_at": b.created_at.isoformat(),
        "part_count": len(b.parts),
        "piece_count": sum(p.quantity for p in b.parts),
    }
    if include_parts:
        d["parts"] = [bin_part_dict(p) for p in
                      sorted(b.parts, key=lambda p: p.created_at, reverse=True)]
    return d


def get_bin_or_404(bin_id: int, db: Session) -> Bin:
    b = db.get(Bin, bin_id)
    if not b:
        raise HTTPException(status_code=404, detail="Bin not found")
    return b


@app.get("/api/bins")
def list_bins(db: Session = Depends(get_db)):
    bins = db.query(Bin).order_by(Bin.created_at.desc()).all()
    return {"bins": [bin_dict(b) for b in bins]}


@app.post("/api/bins", status_code=201)
def create_bin(body: BinIn, db: Session = Depends(get_db)):
    b = Bin(name=body.name)
    db.add(b)
    db.commit()
    db.refresh(b)
    return bin_dict(b)


@app.get("/api/bins/{bin_id}")
def get_bin(bin_id: int, db: Session = Depends(get_db)):
    return bin_dict(get_bin_or_404(bin_id, db), include_parts=True)


@app.put("/api/bins/{bin_id}")
def update_bin(bin_id: int, body: BinIn, db: Session = Depends(get_db)):
    b = get_bin_or_404(bin_id, db)
    b.name = body.name
    db.commit()
    return bin_dict(b)


@app.delete("/api/bins/{bin_id}", status_code=204)
def delete_bin(bin_id: int, db: Session = Depends(get_db)):
    db.delete(get_bin_or_404(bin_id, db))
    db.commit()


@app.post("/api/bins/{bin_id}/parts")
def add_bin_part(bin_id: int, body: BinPartIn, db: Session = Depends(get_db)):
    b = get_bin_or_404(bin_id, db)
    row = (
        db.query(BinPart)
        .filter(BinPart.bin_id == b.id, BinPart.part_num == body.part_num)
        .first()
    )
    if row:
        row.quantity += max(1, body.quantity)
        if body.img_url and not row.img_url:
            row.img_url = body.img_url
    else:
        row = BinPart(
            bin_id=b.id,
            part_num=body.part_num,
            name=body.name,
            category=body.category,
            img_url=body.img_url,
            quantity=max(1, body.quantity),
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return bin_part_dict(row)


@app.patch("/api/bins/{bin_id}/parts/{bin_part_id}")
def update_bin_part(bin_id: int, bin_part_id: int, body: BinPartUpdate,
                    db: Session = Depends(get_db)):
    row = db.get(BinPart, bin_part_id)
    if not row or row.bin_id != bin_id:
        raise HTTPException(status_code=404, detail="Bin part not found")
    if body.quantity <= 0:
        db.delete(row)
        db.commit()
        return {"deleted": True, "id": bin_part_id}
    row.quantity = body.quantity
    db.commit()
    return bin_part_dict(row)


@app.post("/api/bins/{bin_id}/match")
async def match_bin(bin_id: int, db: Session = Depends(get_db)):
    """Find which sets are likely in the bin.

    Discovery runs against BrickScan's local catalog; the top candidates are
    verified against full inventories from the Rebrickable cache. Without a
    Rebrickable API key the discovery ranking is returned unverified.
    """
    b = get_bin_or_404(bin_id, db)
    if not b.parts:
        raise HTTPException(status_code=400, detail="Bin has no parts yet")

    candidates, families = await matching.discover_candidates(b.parts)
    top = candidates[:matching.MAX_VERIFY_CANDIDATES]

    matches = []
    verified = True
    for cand in top:
        try:
            db_set = await ensure_set_cached(cand["set_num"], db)
        except HTTPException as e:
            if e.status_code == 400:  # no Rebrickable API key configured
                verified = False
                break
            logger.warning("Skipping candidate %s: %s", cand["set_num"], e.detail)
            continue
        matches.append({**cand, **matching.score_against_inventory(
            b.parts, db_set.parts, families)})

    if verified:
        matches.sort(key=lambda m: m["match_score"], reverse=True)
        return {"verified": True, "considered": len(candidates), "matches": matches}
    return {"verified": False, "considered": len(candidates), "matches": top}


# ---------------------------------------------------------------------------
# Groups
# ---------------------------------------------------------------------------

class GroupIn(BaseModel):
    name: str


class GroupUpdate(BaseModel):
    name: str


@app.get("/api/groups")
def list_groups(db: Session = Depends(get_db)):
    groups = db.query(Group).order_by(Group.created_at.desc()).all()
    return {
        "groups": [
            {
                "id": g.id,
                "name": g.name,
                "project_count": len(g.projects),
                "created_at": g.created_at.isoformat(),
            }
            for g in groups
        ]
    }


@app.post("/api/groups", status_code=201)
def create_group(body: GroupIn, db: Session = Depends(get_db)):
    group = Group(name=body.name)
    db.add(group)
    db.commit()
    db.refresh(group)
    return {"id": group.id, "name": group.name, "created_at": group.created_at.isoformat()}


@app.get("/api/groups/{group_id}")
def get_group(group_id: int, db: Session = Depends(get_db)):
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    from sqlalchemy.orm import joinedload
    db.refresh(group)
    return {
        "id": group.id,
        "name": group.name,
        "created_at": group.created_at.isoformat(),
        "projects": [
            {
                "id": p.id,
                "name": p.name,
                "set_num": p.set_num,
                "set_name": p.set.name if p.set else "",
            }
            for p in group.projects
        ],
    }


@app.put("/api/groups/{group_id}")
def update_group(group_id: int, body: GroupUpdate, db: Session = Depends(get_db)):
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    group.name = body.name
    db.commit()
    db.refresh(group)
    return {"id": group.id, "name": group.name, "created_at": group.created_at.isoformat()}


@app.delete("/api/groups/{group_id}")
def delete_group(group_id: int, db: Session = Depends(get_db)):
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    for project in group.projects:
        project.group_id = None
    db.delete(group)
    db.commit()
    return {"ok": True}


@app.get("/api/groups/{group_id}/parts")
def get_group_parts(
    group_id: int,
    include_spares: bool = False,
    db: Session = Depends(get_db),
):
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    spare_filter = "" if include_spares else "AND sp.is_spare = 0"
    sql = text(f"""
        SELECT
            sp.part_num,
            sp.part_name,
            sp.part_img_url,
            sp.color_id,
            c.name   AS color_name,
            c.rgb    AS color_rgb,
            sp.is_spare,
            SUM(sp.quantity)                        AS total_needed,
            COALESCE(SUM(pp.found_qty), 0)          AS total_found
        FROM projects p
        JOIN set_parts sp ON sp.set_num = p.set_num
        JOIN colors    c  ON c.color_id = sp.color_id
        LEFT JOIN part_progress pp
               ON pp.project_id  = p.id
              AND pp.set_part_id = sp.id
        WHERE p.group_id = :group_id
          {spare_filter}
        GROUP BY sp.part_num, sp.color_id, sp.is_spare
        ORDER BY sp.part_name, c.name
    """)
    rows = db.execute(sql, {"group_id": group_id}).mappings().all()
    return {
        "group_id": group_id,
        "parts": [dict(r) for r in rows],
    }


# ---------------------------------------------------------------------------
# Serve React frontend (must be last)
# ---------------------------------------------------------------------------

FRONTEND_DIST = os.path.realpath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
if os.path.isdir(FRONTEND_DIST):
    # Serve hashed static assets (JS/CSS) normally
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    # Root-level PWA files (sw.js, manifest.webmanifest, workbox-*.js, icons)
    # must be served as-is; everything else falls back to index.html so
    # React Router works on reload.
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path:
            file_path = os.path.realpath(os.path.join(FRONTEND_DIST, full_path))
            if file_path.startswith(FRONTEND_DIST + os.sep) and os.path.isfile(file_path):
                return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
