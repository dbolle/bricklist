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

## Architecture

This is a single-container Docker app. The Dockerfile is a two-stage build: Node 20 builds the React frontend into `frontend/dist/`, then Python 3.12 serves both the FastAPI backend and the built static files from the same process on port 8000.

**Request flow:**
- `/api/*` — handled by FastAPI routes in `backend/main.py`
- `/assets/*` — served as static files from `frontend/dist/assets/`
- Everything else — returns `frontend/dist/index.html` (SPA catch-all for React Router)

**Data flow for a project:**
1. User searches for a set → `GET /api/rebrickable/search` proxies to Rebrickable API
2. User creates a project → set parts are fetched from Rebrickable and cached in SQLite (`sets`, `set_parts`, `colors` tables)
3. Cache is considered stale after 7 days; refreshing re-fetches and upserts parts, generating `removed_part_notifications` for any previously-found parts that disappeared
4. User taps a part card → `PATCH /api/projects/{id}/parts/{set_part_id}` upserts a `part_progress` row

**Key relationships:**
- A `Project` belongs to one Lego set (`SetModel`) and optionally one `Group`
- `SetPart` rows are shared across all projects for the same set — progress is tracked per-project in `PartProgress`
- `Group` aggregates parts across multiple projects via a raw SQL query in `GET /api/groups/{id}/parts`

**Frontend pages:**
- `HomePage` — lists all projects and groups
- `SearchPage` — search Rebrickable and create a new project
- `ProjectPage` — the main sorting UI; loads parts + progress, tap to increment found count (optimistic updates)
- `GroupPage` — aggregated part view across all projects in a group
- `SettingsPage` — save the Rebrickable API key

All API calls go through the thin `frontend/src/api.js` wrapper. The Vite dev server proxies `/api` to `localhost:8000`, so the backend must be running separately when using `npm run dev`.

**Database schema migrations** are handled inline in `database.py:init_db()` using `PRAGMA table_info` checks — there is no migration framework.
