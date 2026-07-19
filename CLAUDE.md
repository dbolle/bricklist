# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Mission
This code exists to create a self hosted stable web tool for a Lego enthusiast to sort mixed piles of Legos into sets.
During any modifications, the database of existing projects and parts must be preserved. A plan should be put in place before any modifications to ensure recoverability.
The vision is to make this as easy to use as possible so that it almost feels like the Legos are sorting themselves. The UI should be built to streamline the process and minimize user friction.


## Commands

### Run the app (production mode)
```bash
docker compose up --build
# App served at http://localhost:8000
```

### Frontend development (hot reload)
```bash
cd frontend
npm install
npm run dev        # Vite dev server at http://localhost:5173, proxies /api to :8000
npm run build      # Output to frontend/dist/
```

### Backend development (without Docker)
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
# Requires DATABASE_URL env var or defaults to sqlite:////data/bricklist.db
```

### Backend tests
Tests live in `backend/tests/` and run inside Docker (the host may have no pip/venv). Build the test image once, then run:
```bash
docker build -t bricklist-test -f- . <<'EOF'
FROM python:3.12-slim
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt pytest
EOF
docker run --rm -v "$PWD/backend":/app -w /app bricklist-test python -m pytest tests/ -q
```
Tests point `DATABASE_URL` at a throwaway SQLite file (see `tests/conftest.py`) — never at the real volume.

### Backing up the live database
The production database lives in the Docker volume `bricklist_bricklist_data` (Compose prefixes the project name). Before any change that touches the schema or requires a container rebuild, back it up:
```bash
docker compose stop
docker run --rm -v bricklist_bricklist_data:/data -v ~/bricklist-backups:/backup alpine \
  sh -c 'cp /data/bricklist.db* /backup/'
```
There is also a `GET /api/backup` endpoint (Settings → Download Backup) that snapshots via `VACUUM INTO` while the app is running, and the app itself writes a daily auto-snapshot to `/data/backups/` inside the volume (`backend/backups.py`, newest `BACKUP_KEEP`=7 kept) — so recent restore points exist even if nobody clicked anything.

## Architecture

This is a single-container Docker app. The Dockerfile is a two-stage build: Node 20 builds the React frontend into `frontend/dist/`, then Python 3.12 serves both the FastAPI backend and the built static files from the same process on port 8000.

**Request flow:**
- `/api/*` — handled by FastAPI routes in `backend/main.py`
- `/assets/*` — served as static files from `frontend/dist/assets/`
- Everything else — returns `frontend/dist/index.html` (SPA catch-all for React Router)

**Data flow for a project:**
1. User searches for a set → `GET /api/rebrickable/search` proxies to Rebrickable API
2. User creates a project → set parts (including per-minifig parts) are fetched and cached in SQLite (`sets`, `set_parts`, `colors` tables). Source preference: BrickScan's local catalog (`GET /api/v1/sets/{id}` + `/parts?include_minifig_parts=true`, ~30ms, no key) with the Rebrickable web API as fallback — the fallback is the only path that needs the API key. This first fetch is synchronous.
3. Cache is considered stale after 7 days. Stale sets are served immediately and refreshed by a deduplicated background task (`main.py:ensure_set_cached`) — page loads never block on Rebrickable. Refreshes upsert parts in place (preserving progress row IDs) and generate `removed_part_notifications` for any previously-found parts that disappeared.
4. User taps a part card → `PATCH /api/projects/{id}/parts/{set_part_id}` upserts a `part_progress` row

**Rebrickable client** (`backend/rebrickable.py`): one shared httpx client per event loop, in-flight requests capped by a semaphore, 429s retried with `Retry-After`/exponential backoff, part-categories list cached in memory for 24h. The free API tier throttles at ~1 req/s — keep request bursts small.

**Key relationships:**
- A `Project` belongs to one Lego set (`SetModel`) and optionally one `Group`
- `SetPart` rows are shared across all projects for the same set — progress is tracked per-project in `PartProgress`
- `Group` aggregates parts across multiple projects via a raw SQL query in `GET /api/groups/{id}/parts`

**Frontend pages:**
- `HomePage` — lists all projects and groups
- `SearchPage` — search Rebrickable and create a new project
- `FindPage` — global part search (`GET /api/search/parts`): match a piece by part number / element ID / name across all projects and log it from the results. Also photo identification: the camera button posts to `POST /api/identify`, which proxies to the separate BrickScan service (`backend/brickscan.py`, `BRICKSCAN_URL`, default host port 8420 via `host.docker.internal` in compose) and feeds the top candidate part number into the search
- `ProjectPage` — the main sorting UI; loads parts + progress, +/− or direct entry per part (optimistic updates), group/sort/filter controls, removed-part notifications
- `BinsPage`/`BinPage` — photo-built inventories of unsorted parts (`bins`/`bin_parts` tables). `POST /api/bins/{id}/match` finds likely sets two-stage: discovery via BrickScan's part→sets catalog index with IDF weighting (`backend/matching.py` — rare parts dominate, which also neutralizes the API's 100-sets-per-part cap), then precise scoring of top candidates against full inventories from the Rebrickable cache (degrades to unverified discovery ranking without an API key)
- `GroupPage` — aggregated part view across all projects in a group
- `SettingsPage` — Rebrickable API key, per-set cache refresh, database backup download

**Progress math:** `total_parts`/`found_parts` in `project_summary` are piece counts (sum of quantities), with found capped per part — never mix them with row counts.

All API calls go through the thin `frontend/src/api.js` wrapper. The Vite dev server proxies `/api` to `localhost:8000`, so the backend must be running separately when using `npm run dev`.

**Database schema migrations** are handled inline in `database.py:init_db()` using `PRAGMA table_info` checks — there is no migration framework.
