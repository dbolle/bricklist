# BrickList

A self-hosted web app for sorting mixed piles of LEGO® bricks back into sets. Create a project for each set you're rebuilding, then tap through the parts list as you find pieces — BrickList tracks your progress so it almost feels like the bricks sort themselves.

## Features

- **Set search** — look up any LEGO set via the [Rebrickable](https://rebrickable.com) API
- **Sorting projects** — one project per set, with per-part found/needed counts, +/− buttons, and direct count entry
- **Minifigure parts** — minifig components are included in the parts list and can be toggled on/off
- **Group, sort, and filter** — group parts by color or category, sort by status/name/quantity, filter to needed or found
- **Groups** — combine multiple projects (e.g. one storage bin holding several sets) into an aggregated sorting view
- **Offline-friendly caching** — set inventories are cached in SQLite for 7 days; if a refresh removes a part you'd already found, you get a notification to pull it back out of the bag
- **Mobile-first UI** — designed for a phone or tablet sitting next to the brick pile

## Quick start

```bash
docker compose up --build
```

Open http://localhost:8000, go to **Settings**, and paste in a free [Rebrickable API key](https://rebrickable.com/api/). That's it — the SQLite database lives in the `bricklist_data` Docker volume, so your projects and progress survive container rebuilds.

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

## Architecture

- **Backend** — Python 3.12, FastAPI, SQLAlchemy 2, SQLite. All routes in `backend/main.py`, ORM models in `backend/database.py`, Rebrickable client in `backend/rebrickable.py`. Schema migrations run inline at startup via `PRAGMA table_info` checks.
- **Frontend** — React 18, Vite, TailwindCSS, React Router. Pages in `frontend/src/pages/`, with `ProjectPage` as the core sorting UI (optimistic updates).
- **Data** — set inventories are shared across projects (`set_parts`); per-project progress lives in `part_progress`. Rebrickable data is cached and refreshed after 7 days or on demand from Settings.

LEGO® is a trademark of the LEGO Group, which does not sponsor, authorize, or endorse this project.
