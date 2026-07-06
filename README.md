# BrickList

A self-hosted web app for sorting mixed piles of LEGO® bricks back into sets. Create a project for each set you're rebuilding, then tap through the parts list as you find pieces — BrickList tracks your progress so it almost feels like the bricks sort themselves.

## Features

- **Set search** — look up any LEGO set via the [Rebrickable](https://rebrickable.com) API
- **Sorting projects** — one project per set, with per-part found/needed counts, +/− buttons, and direct count entry
- **Minifigure parts** — minifig components are included in the parts list and can be toggled on/off
- **Group, sort, and filter** — group parts by color or category, sort by status/name/quantity, filter to needed or found
- **Groups** — combine multiple projects (e.g. one storage bin holding several sets) into an aggregated sorting view
- **Find a part** — holding a mystery piece? Search by the part number molded on it (or element ID or name) to see which of your projects still needs it, and log it right from the results
- **Offline-friendly caching** — set inventories are cached in SQLite; stale sets (7+ days) are served instantly and refreshed in the background, so pages never wait on (or fail because of) Rebrickable. If a refresh removes a part you'd already found, you get a notification to pull it back out of the bag
- **Missing-parts export** — download the still-needed pieces for a project or group as a CSV you can import into Rebrickable to buy replacements
- **One-tap backups** — download a consistent snapshot of the database from Settings
- **Mobile-first UI** — designed for a phone or tablet sitting next to the brick pile

## Quick start

```bash
docker compose up --build
```

Open http://localhost:8000, go to **Settings**, and paste in a free [Rebrickable API key](https://rebrickable.com/api/). That's it — the SQLite database lives in a named Docker volume, so your projects and progress survive container rebuilds.

## Backups

Your projects and sorting progress live in a single SQLite file inside a named Docker volume.

- **Automatic** — the app snapshots the database daily into `/data/backups/` inside the volume (newest 7 kept, tunable via `BACKUP_KEEP`). This protects against software problems — a bad upgrade can cost at most a day of sorting.
- **From the UI** — Settings → **Download Backup** streams a consistent snapshot of the database (safe to do while the app is running) to your device.
- **Scheduled/scripted** — copy the file out of the volume (Compose prefixes the volume name with the project, so it's `bricklist_bricklist_data` by default):

  ```bash
  docker run --rm -v bricklist_bricklist_data:/data -v "$PWD":/backup alpine \
    cp /data/bricklist.db /backup/bricklist-backup.db
  ```

To restore, replace `/data/bricklist.db` in the volume with a backup file (with the app stopped) and start the app again.

## Development

The app is a single container in production: a two-stage Docker build compiles the React frontend, then FastAPI serves both the API and the static files on port 8000.

**Frontend** (Vite dev server with hot reload, proxies `/api` to `:8000`):

```bash
cd frontend
npm install
npm run dev
```

**Backend** (requires the frontend proxy target or a built `frontend/dist/`):

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

By default the backend uses `sqlite:////data/bricklist.db`; override with the `DATABASE_URL` environment variable for local development (e.g. `DATABASE_URL=sqlite:///./bricklist.db`).

**Tests** (run in the same Python image production uses; no host Python needed):

```bash
docker build -t bricklist-test -f- . <<'EOF'
FROM python:3.12-slim
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt pytest
EOF
docker run --rm -v "$PWD/backend":/app -w /app bricklist-test python -m pytest tests/ -q
```

## Architecture

- **Backend** — Python 3.12, FastAPI, SQLAlchemy 2, SQLite. All routes in `backend/main.py`, ORM models in `backend/database.py`, Rebrickable client in `backend/rebrickable.py` (rate-limit aware: capped concurrency, 429 retries with backoff). Schema migrations run inline at startup via `PRAGMA table_info` checks. Tests in `backend/tests/`.
- **Frontend** — React 18, Vite, TailwindCSS, React Router. Pages in `frontend/src/pages/`, with `ProjectPage` as the core sorting UI (optimistic updates) and `FindPage` for cross-project part search.
- **Data** — set inventories are shared across projects (`set_parts`); per-project progress lives in `part_progress`. Rebrickable data is cached in SQLite; stale sets refresh in the background, or on demand from Settings.

LEGO® is a trademark of the LEGO Group, which does not sponsor, authorize, or endorse this project.
