# Troubleshooting

## NISAR data

**Drawing a line fails with `No module named 'tifffile'`**
The backend environment is missing the DEM reader. Line profiles need
both `tifffile` and `imagecodecs` to read compressed Copernicus GeoTIFFs.
Using the same Python environment that runs Flask, run
`python -m pip install -r requirements.txt`, then draw the line again;
failed profile jobs can be retried without deleting their cache.
The pinned dependencies require Python 3.11 or newer. If installation
fails on Python 3.10, recreate the virtual environment with a supported
Python version before installing the requirements.

**Site list is empty / `site_count: 0`**
The sites weren't loaded. Run `flask nisar load` (or
`flask nisar load --force` after editing a file in `app/data/`).

**`flask nisar load` fails with `nisar_observations.json: ...`**
The loader validates the data files: an unknown slug, unknown metric,
bad date or missing image under `app/data/scenes/` stops it. Rerun
`python scripts/extract_nisar.py --site <slug>` for the site it names.

**`scripts/extract_nisar.py` fails with `HTTP 401 ... check your Earthdata Login`**
`~/.netrc` is missing, has the wrong format, or the password changed.
It must contain exactly
`machine urs.earthdata.nasa.gov login <user> password <pass>`
and be `chmod 600`. The first download also asks you to approve the
ASF application in your Earthdata profile; log in once at
<https://urs.earthdata.nasa.gov/> if it keeps failing.

**Extractor `skipped: only N% of bbox valid` / `need HH+HV`**
That pass doesn't cover the site, or was acquired single-polarization.
Use `--list-frames` and pin a better track/frame with `"frame"` in
`sites.json`.

**`NASA CMR search is unavailable` (HTTP 502)**
The backend couldn't reach `cmr.earthdata.nasa.gov` within 25 s. CMR
usually answers in under a second, but some searches take 10–15 s.
Click **Search** again. Successful searches are cached for 10 minutes.

**No granules found**
Widen the date range or switch products. GUNW (interferograms) and
GOFF (offsets) are much sparser than GCOV.

**"Download .h5" redirects to urs.earthdata.nasa.gov**
Expected. Downloads require a free NASA Earthdata Login. Browse images
and search don't.

## Backend won't start

**`RuntimeError: ALLOWED_ORIGINS must be set in production`**
Set `ALLOWED_ORIGINS=https://your-frontend.example.com` (comma-separated
for multiple origins). Wildcards are not allowed.

**`env: 'bash\r': No such file or directory`**
Windows CRLF line endings on `bin/start`. Run `sed -i 's/\r$//' bin/start`.

**`bin/start` doesn't run on Windows**
It's a bash script. Use WSL, or run `flask db upgrade` then
`flask run --port 8880 --debug` from PowerShell (see
[DEVELOPMENT.md](DEVELOPMENT.md#windows-without-wsl)).

**`Error: Could not locate a Flask application`**
Run `flask` from the repo root (where `app.py` lives), or set
`FLASK_APP=app.py`.

## CI

**Test summary fails with `ENOENT ... pytest-results.xml`**
Check the earlier steps: pytest creates this report only when it runs.
If dependency installation or the schema check fails, there is no report.
The backend summary and artifact steps skip publishing when it is absent;
the original failing step still fails the job.

**Dependency installation fails with `Requires-Python >=3.12`**
CI uses Python 3.11, matching the documented minimum. Keep dependency pins
compatible with it. In particular, newer `tifffile` and `imagecodecs`
releases require Python 3.12; the pinned versions retain 3.11 support.

## Migrations

**`[check-schema] DRIFT DETECTED:`**
You changed a model without generating a migration. Run
`flask db migrate -m "<change>"`, inspect the file, commit it.

**Drift check sees every table as new in CI**
You're using `sqlite:///:memory:`. Each Flask CLI invocation gets its
own connection and `:memory:` is per-connection. Use a file-backed
SQLite path (`sqlite:////tmp/x.db`) for the schema check.

## CORS

**`Access-Control-Allow-Origin` errors in the browser**
Add the exact origin (scheme + host + port) to `ALLOWED_ORIGINS`. The
backend rejects wildcards.

## Rate limiting

**`429 Rate limit exceeded` during local development**
Set `RATELIMIT_ENABLED=false` in `.env` and restart the backend. Tests
already disable it via the conftest. Note the default `memory://`
storage is per gunicorn worker, so effective prod limits are
`limit × WEB_CONCURRENCY`; use `RATELIMIT_STORAGE_URI=redis://…` for
exact limits.

## Database

**SQLite `database is locked` under concurrent load**
WAL mode + `busy_timeout=5s` are applied at boot by `bin/start`. If
you're hitting it anyway, you're either (a) holding a long write
transaction in a request handler, or (b) you've outgrown SQLite —
switch `SQLALCHEMY_DATABASE_URI` to Postgres.

## Frontend

**Blank page, or `Cannot read properties of undefined (reading 'find')`**
`/api` requests aren't reaching the backend. Start it on port 8880 (or
set `VITE_PROXY_URL` in `frontend/.env`), then restart `npm run dev`.

**A docs page or `/workspace` returns 404 after a refresh in production**
The static host isn't serving `index.html` for client-side routes. Add
the fallback described in [DEPLOYMENT.md](DEPLOYMENT.md#frontend).

**Scene images don't appear on the map in production**
The frontend was built without `VITE_API_BASE_URL`, so it requests
`/api/scenes/...` from the static host. Rebuild with it set (see
[DEPLOYMENT.md](DEPLOYMENT.md)).

**`/api/*` returns HTML in dev**
The Vite proxy isn't pointing at the backend. Check `VITE_PROXY_URL`
in `frontend/.env` (default: `http://localhost:8880`).
