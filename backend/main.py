import asyncio
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

import rebrickable
from database import (
    Color, Group, PartProgress, Project, RemovedPartNotification,
    SessionLocal, SetModel, SetPart, Setting, engine, get_db, init_db,
)

CACHE_MAX_AGE_DAYS = 7

logger = logging.getLogger("bricklist")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


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


async def _refresh_set_in_background(set_num: str, api_key: str) -> None:
    if set_num in _refreshing_sets:
        return
    _refreshing_sets.add(set_num)
    try:
        db = SessionLocal()
        try:
            await _fetch_and_cache_set(set_num, api_key, db)
        finally:
            db.close()
    except Exception:
        logger.exception("Background refresh of set %s failed", set_num)
    finally:
        _refreshing_sets.discard(set_num)


async def ensure_set_cached(set_num: str, db: Session) -> SetModel:
    """Return the cached set, fetching it only if it has never been cached.

    A stale cache is served immediately and refreshed in the background so
    opening a project never blocks on (or fails because of) Rebrickable.
    """
    set_num = normalize_set_num(set_num)
    db_set = db.get(SetModel, set_num)
    if db_set is None:
        api_key = get_api_key(db)
        return await _fetch_and_cache_set(set_num, api_key, db)

    if is_stale(db_set.cached_at) and set_num not in _refreshing_sets:
        setting = db.get(Setting, "rebrickable_api_key")
        api_key = setting.value if setting else ""
        if api_key:
            task = asyncio.create_task(_refresh_set_in_background(set_num, api_key))
            _background_tasks.add(task)
            task.add_done_callback(_background_tasks.discard)
    return db_set


async def _fetch_and_cache_set(set_num: str, api_key: str, db: Session) -> SetModel:
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

    all_parts: list[tuple[dict, str, str | None]] = [
        (p, '', None) for p in parts_data
    ]
    for mf, mf_parts in zip(minifigs, minifig_parts_lists):
        for p in mf_parts:
            scaled = dict(p)
            scaled["quantity"] = p["quantity"] * mf["quantity"]
            all_parts.append((scaled, mf["fig_num"], mf["name"]))

    db_set = db.get(SetModel, set_num)
    if db_set:
        db_set.name = set_data["name"]
        db_set.year = set_data.get("year")
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
            sp.part_cat_name = categories.get(cat_id) if cat_id else None
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
                part_cat_name=categories.get(cat_id) if cat_id else None,
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
    api_key = get_api_key(db)
    db_set = await _fetch_and_cache_set(set_num, api_key, db)
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

FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(FRONTEND_DIST):
    # Serve hashed static assets (JS/CSS) normally
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    # SPA catch-all: any non-API path serves index.html so React Router works on reload
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
