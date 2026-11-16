# Deployment

The app is a plain Flask API plus a static React build, so any host
that runs Python and serves static files works.

## Backend

On a server with Python 3.11+:

```bash
pip install -r requirements.txt
export FLASK_ENV=production
export ALLOWED_ORIGINS=https://<your-frontend-host>   # required in production
bin/start prod                                         # gunicorn on $FLASK_PORT (8880)
```

`bin/start prod` runs migrations, loads `app/data/` into SQLite
(`app-data/data.db`), then starts gunicorn (`WEB_CONCURRENCY` workers,
default 4). The data files are part of the repo, so a deploy always
serves the NISAR values and images it shipped with. No Earthdata Login
is needed for that.

The live SME2 (soil moisture) display is the exception: the backend
reads SME2 HDF5 files itself, so set `EARTHDATA_TOKEN` (a user token
from https://urs.earthdata.nasa.gov) in the server's environment. Each
SME2 granule is rendered once over its whole frame (~10 s, ~25 MB
downloaded), so raise gunicorn's per-request timeout, e.g.
`GUNICORN_TIMEOUT=90`. Rendered frames are cached on disk in
`app-data/sme2/` (~0.8 MB per granule); keep that directory on
persistent storage. It can be deleted at any time; frames re-render on
demand.

Prepare regions ahead of time so they load instantly, and schedule the
same command (e.g. daily cron) to pick up new passes; NASA publishes SME2
a few weeks after acquisition, and cached granules are skipped:

```bash
flask nisar sme2-prewarm --region washington-box --workers 4
```

`washington-box` is the state's bounding box (so a rectangle drawn around
Washington, which takes in edges of OR, ID and BC, is fully prepared);
`washington` is the state outline only. The box (Nov 2025 - Oct 2026) is
469 granules: ~12 GB downloaded, ~25 min with 4 workers, ~400 MB stored,
then ~90 new granules a month. Add regions to `app/data/regions.json`.

Check it with `curl https://<backend-host>/api/health`.

## Frontend

```bash
cd frontend
VITE_API_BASE_URL=https://<backend-host> npm run build
```

Upload `frontend/dist/` to any static host (GitHub Pages, Netlify,
Cloudflare Pages, S3, …). `VITE_API_BASE_URL` is baked in at build time
and is used for both API calls and scene images.

The frontend uses real URLs (`/docs/...`, `/workspace`), so configure
the static host to serve `index.html` for unknown paths: Netlify
`_redirects` with `/* /index.html 200`; Cloudflare Pages and Vercel do
it for single-page apps; on S3/CloudFront, answer 404 with `/index.html`
and status 200.

## Backups

The only state that isn't in git is the SQLite DB, and it is rebuilt
from `app/data/` on every boot, so there is nothing to back up.
