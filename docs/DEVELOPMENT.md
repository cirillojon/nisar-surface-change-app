# Development

## Prerequisites

- Python 3.11+
- Node.js 22
- For recomputing NISAR data only: a free
  [Earthdata Login](https://urs.earthdata.nasa.gov/) in `~/.netrc`
- On Windows: either WSL (recommended — `bin/start` is bash) or plain
  PowerShell using the commands in the [Windows](#windows-without-wsl)
  section below.

## First-time setup

```bash
# Backend
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env                 # defaults work
flask db upgrade
flask nisar load                     # load the study sites from app/data/
pip install -r requirements-data.txt # only if you'll run scripts/extract_nisar.py

# Frontend
cd frontend
cp .env.example .env                 # optional; defaults work
npm install
cd ..
```

## Run

```bash
# Terminal 1: backend
bin/start dev                        # http://localhost:8880

# Terminal 2: frontend
cd frontend && npm run dev           # http://localhost:5173
```

The Vite dev server proxies `/api/*` to the backend, so you can use
relative URLs from the frontend.

### Windows without WSL

```powershell
.venv\Scripts\Activate.ps1
flask db upgrade
flask nisar load
flask run --port 8880 --debug        # replaces `bin/start dev`
```

`flask` auto-discovers `app.py` and loads `.env` (via python-dotenv).
You lose the boot lock / SQLite WAL tuning from `bin/start`, which
don't matter for single-user local dev.

## Common commands

| Task                     | Command                                                              |
| ------------------------ | -------------------------------------------------------------------- |
| Run backend tests        | `pytest tests/ -v`                                                   |
| Run a single test        | `pytest tests/test_sites.py::test_name -v`                           |
| Run frontend tests       | `cd frontend && npm test`                                            |
| Lint frontend            | `cd frontend && npm run lint`                                        |
| Build frontend           | `cd frontend && npm run build`                                       |
| Generate a migration     | `flask db migrate -m "<change>"`                                     |
| Apply migrations         | `flask db upgrade`                                                   |
| Schema drift check       | `flask nisar check-schema`                                           |
| Reload site data         | `flask nisar load --force`                                           |
| Recompute NISAR data     | `python scripts/extract_nisar.py [--site <slug>] [--refresh]`        |
| Loader status            | `flask nisar status`                                                 |
| Search NISAR (CLI)       | `flask nisar search --bbox=W,S,E,N --product GCOV`                   |

## Adding a new endpoint

1. Add the column / model to `app/models.py`.
2. `flask db migrate -m "add <thing>"`. Inspect the generated file under
   `app/migrations/versions/`, then `flask db upgrade`.
3. Add the route to `app/routes/api.py` (with `@limiter.limit(...)`,
   and validator calls from `app/validators.py` for any inputs).
4. Add a pytest under `tests/` using the `client` and `seeded_site`
   fixtures from `conftest.py`.
5. Add a service function to `frontend/src/services/api.js` and consume
   it in a component. Add a vitest under `frontend/src/test/`.
6. Run `flask nisar check-schema` and the test suites locally
   before pushing.

## Domain cheat sheet

- **Change types** live in `app/change_types.py`. Each one sets its
  NISAR product (GCOV or GUNW), the metrics its charts show, the image
  legend, and the map colour. `METRICS` defines each metric's label and
  unit.
- **Sites** (`Site`) are defined in `app/data/sites.json`: a point, a
  bbox, a story, and for GUNW a stable `reference` point.
- **Scenes** (`Scene`) are NISAR passes over a site. Each has a date,
  source granule, quality, and an image under `app/data/scenes/`
  (served at `/api/scenes/...`).
- **Observations** (`Observation`) hold one metric value per date. The
  loader writes them with `source="nisar"` from
  `app/data/nisar_observations.json`, which `scripts/extract_nisar.py`
  generates. Each load rewrites them, so edit or regenerate the files,
  not the rows. Rows with another `source` are left alone.
- **NISAR search** (`app/nisar.py`) queries NASA CMR with no login.
  Collection short names are listed in `PRODUCTS`. Results are cached
  in-process for 10 minutes.

See [GUIDE.md](GUIDE.md) for the NISAR primer and the data
pipeline.
