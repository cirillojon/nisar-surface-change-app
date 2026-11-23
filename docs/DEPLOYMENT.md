# Deployment

The app is a Flask API plus a static React build. The repo is set up for:

- **Backend:** Fly.io: one machine with a persistent volume, deployed by
  [`.github/workflows/fly-deploy.yml`](../.github/workflows/fly-deploy.yml)
  on every push to `main` that touches the backend.
- **Frontend:** Vercel, deployed by Vercel's GitHub integration on every
  push (production for `main`, preview URLs for other branches and PRs).
- **SME2 cache:** refreshed daily by
  [`.github/workflows/sme2-prewarm.yml`](../.github/workflows/sme2-prewarm.yml).

There is no sign-in; the API is public and read-only.

## First-time setup

### 1. Backend on Fly.io

Install [flyctl](https://fly.io/docs/flyctl/install/) and run `fly auth login`.
From the repo root:

```bash
fly launch --copy-config --no-deploy          # creates the app from fly.toml
fly volumes create app_data --region sjc --size 3
fly secrets set EARTHDATA_TOKEN=<token>       # SME2 display, see below
fly secrets set ALLOWED_ORIGINS=https://<vercel-domain>   # set after step 2
fly deploy
```

`fly.toml` names the app `nisar-surface-change` (URL
`https://nisar-surface-change.fly.dev`). Fly app names are global; if it's
taken, change `app` in `fly.toml` and use the new URL below.

Then let GitHub Actions deploy for you. Create a token with
`fly tokens create deploy -x 999999h` and add it as the repo secret
`FLY_API_TOKEN` (Settings → Secrets and variables → Actions). Until that
secret exists, the deploy and prewarm workflows skip themselves instead of
failing.

### 2. Frontend on Vercel

1. Vercel → **Add New → Project** → import this GitHub repo.
2. **Root Directory:** `frontend`. Framework, build command and output
   (`dist`) come from [`frontend/vercel.json`](../frontend/vercel.json),
   which also rewrites unknown paths to `index.html` so real URLs like
   `/docs/...` and `/workspace` work on reload.
3. **Environment variable:** `VITE_API_BASE_URL` =
   `https://nisar-surface-change.fly.dev`. It's baked in at build time and
   used for API calls and scene images, so redeploy after changing it.
4. Deploy, then put the production domain into the backend's CORS list
   (comma-separated for several):

   ```bash
   fly secrets set ALLOWED_ORIGINS=https://<project>.vercel.app
   ```

Vercel preview deployments get their own URLs, which aren't in
`ALLOWED_ORIGINS`, so previews render the UI but their API calls fail
CORS. Add a preview's URL to the list if you need it to work.

## Future (staging) backend

Pushes to the `future` branch deploy to a separate Fly app,
`nisar-surface-change-app-future` ([`fly.future.toml`](../fly.future.toml)),
through [`fly-deploy-future.yml`](../.github/workflows/fly-deploy-future.yml).
It has its own volume, secrets and `FLY_API_TOKEN_FUTURE`, so it never
touches the production app. One-time setup:

```bash
fly apps create nisar-surface-change-app-future
fly volumes create app_data -a nisar-surface-change-app-future --region sjc --size 3
fly secrets set -a nisar-surface-change-app-future EARTHDATA_TOKEN=<token> \
  ALLOWED_ORIGINS=https://<future-frontend-domain>
fly tokens create deploy -a nisar-surface-change-app-future -x 999999h
```

Add the last command's output as the repo secret `FLY_API_TOKEN_FUTURE`.
Until it exists the workflow skips itself. For the frontend, give the
`future` branch its own Vercel domain and set `VITE_API_BASE_URL` to
`https://nisar-surface-change-app-future.fly.dev` for that environment.

## How deploys work

Push to `main`:

- [`ci.yml`](../.github/workflows/ci.yml) runs backend tests with a
  schema-drift check, then frontend lint, tests and build.
- `fly-deploy.yml` (only when `app/`, `bin/`, `requirements.txt`,
  `Dockerfile`, `fly.toml` or `.dockerignore` change) runs the backend
  tests again as a gate, runs `flyctl deploy`, and waits up to 10 minutes
  for `/api/health` to return `"status": "ok"`. It can also be run by hand
  from the Actions tab.
- Vercel builds and publishes `frontend/`.

[`nisar-watch.yml`](../.github/workflows/nisar-watch.yml) runs daily and
opens a PR from `data/auto` into `future` (or `main` once `future` is
merged into it; [AUTOMATION.md §6](AUTOMATION.md#6-setup)) with new passes and auto-detected stories
([AUTOMATION.md](AUTOMATION.md)). It needs the `EARTHDATA_TOKEN`
repository secret (separate from the Fly secret of the same name). A
person merges the PR; it deploys through `fly-deploy.yml` once it reaches
`main`, like any other change to `app/`. Auto-merge is off unless
`NISAR_WATCH_AUTO_MERGE` is `true`.

On the machine, `bin/start prod` runs migrations, loads `app/data/` into
SQLite (`app-data/data.db`), then starts gunicorn. The data files are part
of the image, so a deploy always serves the NISAR values and images it
shipped with. A single machine with a volume can't do a rolling deploy (a
Fly volume mounts on one machine at a time), so each deploy has a ~10-30 s
cutover.

The volume at `/app/app-data` holds the SQLite DB and the SME2, DEM and
profile render caches, so cached renders survive deploys.

## SME2 (soil moisture)

The live SME2 display needs `EARTHDATA_TOKEN` (a user token from
https://urs.earthdata.nasa.gov → Generate Token) because the backend reads
SME2 HDF5 files itself. Each granule is rendered once over its whole frame
(~10 s, ~25 MB downloaded), which is why `fly.toml` sets
`GUNICORN_TIMEOUT=90` and the machine has 2 GB of memory. Rendered frames
are cached in `app-data/sme2/` (~0.8 MB per granule). It can be deleted
at any time; frames re-render on demand. Tokens expire after 60 days;
replace it with `fly secrets set EARTHDATA_TOKEN=...`.

`sme2-prewarm.yml` runs daily and renders new passes over a region, so the
map shows them instantly; cached granules are skipped. NASA publishes SME2
a few weeks after acquisition. Run it by hand from the Actions tab to
choose another region, or on the machine:

```bash
fly ssh console -C "su app -s /bin/bash -c 'cd /app && flask nisar sme2-prewarm --region washington-box --workers 2'"
```

`washington-box` is the state's bounding box (so a rectangle drawn around
Washington, which takes in edges of OR, ID and BC, is fully prepared);
`washington` is the state outline only. The box (Nov 2025 - Oct 2026) is
469 granules: ~12 GB downloaded, ~50 min with 2 workers, ~400 MB stored,
then ~90 new granules a month. Add regions to `app/data/regions.json`.

## Other hosts

Nothing is Fly- or Vercel-specific. On any server with Python 3.11+:

```bash
pip install -r requirements.txt
export FLASK_ENV=production
export ALLOWED_ORIGINS=https://<your-frontend-host>   # required in production
bin/start prod                                         # gunicorn on $FLASK_PORT (8880)
```

Or build the `Dockerfile` and mount a volume at `/app/app-data`. For the
frontend, run `VITE_API_BASE_URL=https://<backend-host> npm run build` in
`frontend/` and upload `dist/` to any static host. Serve `index.html` for
unknown paths: Netlify `_redirects` with `/* /index.html 200`; on
S3/CloudFront, answer 404 with `/index.html` and status 200.

Check the backend with `curl https://<backend-host>/api/health`.

## Backups

The SQLite DB is rebuilt from `app/data/` on every boot, and the render
caches regenerate on demand, so there is nothing to back up.
