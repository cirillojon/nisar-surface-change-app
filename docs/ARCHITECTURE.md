# Architecture

## Overview

```
  ┌──────────────────────────┐   offline, Earthdata Login (~/.netrc)
  │ scripts/extract_nisar.py │── HTTP range reads ──► ASF DAAC (NISAR HDF5)
  └────────────┬─────────────┘── granule search ───► NASA CMR
               │ writes
               ▼
  app/data/sites.json (hand-edited)
  app/data/nisar_observations.json + app/data/scenes/*.webp (generated, committed)
               │ flask nisar load (bin/start runs it on every boot)
               ▼
  ┌──────────────────────────┐        ┌────────────────────────┐
  │ SQLite (alembic schema)  │◄───────│ Flask API (bin/start)  │──► NASA CMR (live search)
  │ sites, scenes,           │        │ app/routes/api.py      │
  │ observations, load_jobs  │        │ app/routes/nisar.py    │
  └──────────────────────────┘        └───────────┬────────────┘
                                                  │ /api/*
                                      ┌───────────▼────────────┐
                                      │ React + Leaflet SPA    │──► Esri / OSM / GIBS tiles,
                                      │ frontend/              │    ASF browse images
                                      └────────────────────────┘
```

The web app never reads HDF5. All NISAR processing happens in the
offline script, whose small outputs are committed, so the app runs
anywhere without credentials. All API endpoints are public and
read-only.

## Data model

| Model         | One row per                         | Written by                     |
| ------------- | ----------------------------------- | ------------------------------ |
| `Site`        | study site in `sites.json`          | loader                         |
| `Scene`       | NISAR pass over a site (+ image)    | loader (from the generated JSON) |
| `Observation` | metric value per site per date      | loader (`source='nisar'`)      |
| `LoadJob`     | loader run status (`/api/health`)   | loader                         |

Metrics (`hh_db`, `hv_db`, `water_pct`, `los_mm`, `coherence`) and the
change types that chart them are defined in `app/change_types.py`.

## Backend module map

| Module                     | Responsibility                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `app/__init__.py`          | App factory, extension init, CORS, JSON error handlers, request-id middleware.         |
| `app/config.py`            | Static fallback config (mostly env passthrough).                                       |
| `app/models.py`            | SQLAlchemy models (`Site`, `Scene`, `Observation`, `LoadJob`).                         |
| `app/routes/api.py`        | Health, change types, sites, site stories, drawn-area context, the land-change gallery, scene images. |
| `app/routes/nisar.py`      | NISAR catalog search, SME2 scenes and height-profile jobs (`/api/nisar/*`).            |
| `app/routes/stories.py`    | Stories, findings, series CSV and the coverage check (`/api/stories`, `/api/findings`, `/api/coverage-check`). |
| `app/routes/tools.py`      | `/api/openapi.json`; the agent tool registry (`/api/tools`) unless `ENABLE_MCP=0`.     |
| `app/routes/assistant.py`  | AI assistant endpoints (only with `ENABLE_AI=1`).                                      |
| `app/openapi.json`         | OpenAPI 3.1 description of the API, served at `/api/openapi.json`.                     |
| `app/nisar.py`             | NASA CMR client: granule search, browse-image bounds per track/frame, 10-minute cache. |
| `app/nisar_render.py`      | Reads NISAR HDF5 pixels over a box through range requests and renders map images.      |
| `app/sme2.py`              | SME2 soil-moisture images and values for a drawn area (needs `EARTHDATA_TOKEN`).       |
| `app/profiles.py`          | Height change along a drawn line from every GUNW pair on the best frame (background jobs). |
| `app/dem.py`               | Terrain heights from the Copernicus GLO-90 DEM.                                        |
| `app/tools.py`             | Tool registry shared by the MCP server, the assistant and `/api/tools`.                |
| `app/assistant.py`         | The AI assistant's tool-use loop (off unless `ENABLE_AI=1`).                           |
| `app/change_types.py`      | Change categories + metrics (product, units, image legend, radar explainer).           |
| `app/stories.py`           | The workspace's modes: stories (`app/data/stories.json`), findings built from a story's moments, CSV export, the coverage check. |
| `app/chains.py`            | Site story per site: moments computed from the NISAR series and related series; rain for drawn areas. |
| `app/drivers.py`           | Related series (ECMWF IFS rain, ERA5 seasonal normals, GloFAS river flow; INGV earthquakes available): fetchers, the committed snapshot, per-pass windows. |
| `app/loader.py`            | Validates and mirrors `app/data/` into the DB.                                         |
| `app/cli.py`               | `flask nisar …` AppGroup (load, search, status, check-schema).                         |
| `app/logging_config.py`    | Log format; sets request-id on every record.                                           |
| `app/validators.py`        | Lightweight input validators (no pydantic dep).                                        |
| `app/migrations/versions/` | Alembic revisions.                                                                     |
| `scripts/extract_nisar.py` | Offline NISAR pipeline (GCOV backscatter, GUNW displacement, images).                  |
| `scripts/build_driver_data.py` | Fetches each site's related series into `app/data/drivers.json` (no login).        |
| `scripts/build_landchange.py` | Builds the land-change gallery (`app/data/landchange.json` and its images).         |
| `scripts/shared_footprint.py` | The area every pass of a site imaged, used to compare open water like for like.     |
| `scripts/chain_evidence.py` | Prints every number behind the site stories from the committed files; `--write` refreshes the tables in [`DATA_AND_METHODS.md`](DATA_AND_METHODS.md). |

## Site stories

```
app/chains.py (SITE_CHAINS, hand-edited) ──► scripts/build_driver_data.py ──► app/data/drivers.json
                                             (Open-Meteo; no key)             (generated, committed)
                                                                                      │
Site observations (DB) + drivers.json ──► GET /api/sites/<id>/chain
```

A story leads with the site's headline NISAR series. Its moments are
configured as pairs of pass dates, a label, a caption and a statistic
(`change`, `rate`, `peak`, `low` or `value`); `_moment` computes every
number from the NISAR values and refuses dates that aren't passes.
Related series are summed (rain) or averaged (river flow) over the 12
days to each pass, or over a moment's own dates, and shown beside the
NISAR series without any test or verdict. In the UI
(`frontend/src/components/ImpactChain.jsx`) the selected moment is
portalled into `.moment-host` over the map; a site's story opens on its
first moment. The site's other NISAR series (`siteSeries` in
`services/measurements.js`) are charted under the moments on the same
time axis. Drawn areas fetch rain live
through `GET /api/area-context` and have no moments.

## Workspace modes, stories and findings

```
app/data/stories.json (hand-edited) ─┐
site moments (app/chains.py) ────────┤
app/data/landchange.json ────────────┼─► app/stories.py ─► /api/stories, /api/stories/feed, /api/findings, /api/coverage-check
app/data/auto/ (NISAR Watch) ────────┘  (via app/auto.py) └─► app/tools.py ─► /api/tools ─► mcp_server/
```

Auto-detected stories (`app/data/auto/stories.json`, written by the
`pipeline/` package on a daily GitHub Actions schedule, see
[AUTOMATION.md](AUTOMATION.md)) are gallery places with `origin: "auto"`.
`app/auto.py` loads them (cached on the files' mtime) and `stories.py`
merges them into the same content and gallery, so every endpoint, tool
and finding card serves them with no special case beyond their
"Auto-detected, not reviewed" label. A curated story with the same slug
wins. Only `status: "active"` stories are shown.

The workspace has three modes (`?mode=stories|investigate|findings`).
What is on the map (a study site, a gallery place, a drawn area or line)
is one selection shared by all three. A tab shows its own view of that
selection, or its list when it has none (`src/workspace/navigation.js`):

- A panel's back link ("← All stories") clears the selection and returns
  to the list and the whole-world map. "Hide panel" only hides. The top
  bar's Workspace link, clicked from inside the workspace, returns to
  the default: the Stories list with nothing selected.
- Time, layer and opacity for whatever is on the map are in the dock
  under it (`ScenePlayer` for a study site, `LandPlayer` for a gallery
  place). The dock stays mounted across tabs, so a time-lapse keeps its
  date and layer, and nothing in the side panel changes while it plays.

The tabs:

- **Stories** (`StoryList`, `StoryPanel`): the curated stories plus
  NISAR Watch's auto-detected ones, each a study site or gallery place,
  shown by theme or as **Latest** (`?list=latest`: newest first by the
  period shown, filtered by theme, origin and dates, from
  `/api/stories/feed`). An auto story's panel shows what was measured and
  that no person reviewed it, instead of hypotheses. Each is listed with one of the place's own NISAR passes
  as a thumbnail. `stories.json` holds the question, hypotheses
  (linked to the moments they address), limits and what the record
  points toward. The evidence is not repeated in the panel: a site's
  moments (`chains.py`) are charted beside the map, and a gallery
  place's notes (`LandChangePanel`, `embedded`) sit under the
  question. The site's notes and catalog search are nested at the end.
- **Investigate** (`PlacesList`, `CoverageCheck`): every place with data
  in one list (study sites, then before & after places), plus the draw
  tools and click-to-search, which exist only on this tab. While
  drawing, a bar over the map says what to do next and has Undo, Finish
  line and Cancel (the rules are in `src/services/drawing.js`). A drawn
  box lists the passes over it.
- **Findings** (`FindingsPanel`, `FindingCard`): a finding is rebuilt from
  the data on every request (`build_finding`), so links, printed briefs
  (`/brief/<slug>`) and MCP calls agree. Saved findings are references
  (`{slug, moment}`) in the viewer's localStorage.

## Boot model

`bin/start` is the single entrypoint. Modes:

- `dev`: `flask run` with debug
- `prod`: `gunicorn`, plus an optional in-process loader loop
- `migrate`: `flask db upgrade` only (under flock)
- `loader`: one-shot loader run (TTL-aware; `--loop`, `--force`)
- `worker`: alias of `loader --loop`

`dev` and `prod` run migrations and load `app/data/` before serving.
The web process itself **does not mutate the schema**. The
`AUTO_UPGRADE_ON_BOOT=1` escape hatch exists for one-off local hacking
only.

## Frontend module map

The app has three parts under one header: Home, the docs, and the map
workspace at `/workspace`. The platform header owns global navigation,
search, theme selection and (when `VITE_ENABLE_AI=true`) the assistant.
MCP docs and the tool reference show unless `VITE_ENABLE_MCP=false`.
The workspace has a separate inset toolbar for its
selection title and map actions. Shared typography and button styling
live in `frontend/src/index.css`; `frontend/src/platform/platform.css`
adds platform layout and button variants. Use the bundled BDO Grotesk
regular (400) and medium (500) weights, shared action colours and
control sizing rather than introducing separate fonts or button styles.

| Path                                 | Responsibility                                                     |
| ------------------------------------ | ------------------------------------------------------------------ |
| `src/main.jsx`                       | React mount inside ErrorBoundary.                                  |
| `src/App.jsx`                        | Router and shell: top bar, Home, docs routes, search, the workspace host. |
| `src/platform/WorkspaceHost.jsx`     | Mounts the workspace on first visit and keeps it mounted, so the map survives a trip to the docs. |
| `src/workspace/WorkspaceApp.jsx`     | The map workspace, its three modes and state (site, pass, place, drawn area or line, open finding); synced to `?mode=&site=&date=&place=&finding=`. |
| `src/components/Story*.jsx`, `FindingCard.jsx`, `FindingsPanel.jsx`, `CoverageCheck.jsx` | The Stories and Findings panels, and the passes over a drawn area. |
| `src/services/findings.js`           | Saved findings in localStorage (guarded; starts empty if storage is blocked). |
| `src/platform/BriefPage.jsx`         | `/brief/<slug>?moment=N`: a finding laid out for print or PDF.      |
| `src/platform/docs/nav.js`           | The docs' tabs and sidebars: the single source for navigation.     |
| `src/platform/docs/`                 | Docs layout, page loader and the components MDX pages can use.     |
| `src/content/docs/<tab>/<slug>.mdx`  | The docs pages. Some embed the files in `docs/` so they stay in sync. |
| `src/platform/api/`                  | "Try it" request panels and the MCP tool reference.                |
| `src/platform/assistant/`            | The assistant drawer (only with `VITE_ENABLE_AI=true`).            |
| `src/services/api.js`                | axios client + cache + dedupe; `assetUrl()` for scene images.      |
| `src/workspace/navigation.js`        | The navigation model: which view each tab shows for a selection, and the workspace's query parameters. |
| `src/components/ChangeMap.jsx`       | Leaflet map: basemaps, a marker for every place, scene overlay, footprints, drawing and its bar. |
| `src/services/drawing.js`            | Line-drawing rules: two points to finish, the length limit, a repeated click adds nothing. |
| `src/components/PlacesList.jsx`, `PlaceThumb.jsx` | Investigate's list of every place with data, each pictured by one of its own passes. |
| `src/components/SitePending.jsx`     | A picked site while its passes load, or why they didn't, with a retry. |
| `src/components/SiteDetail.jsx`      | Site notes, radar explainer, catalog search; charts if no story.   |
| `src/components/ScenePlayer.jsx`     | Time-lapse controls, legend, before/after, docked under the map.   |
| `src/components/LayerSelect.jsx`, `src/services/layers.js` | The shared **Layer** menu: colour, HH, HV, very dark pixels, change map, soil moisture, drawn in the browser. |
| `src/components/TimeSeriesChart.jsx` | Dependency-free multi-series SVG chart; click selects a date.      |
| `src/components/LandChangePanel.jsx`, `LandPlayer.jsx`, `src/services/landchange.js` | The land-change gallery: the place in words (panel), and its passes, layers and change maps computed in the browser (the dock's player). |
| `src/components/AoiPanel.jsx`        | Details of a drawn area.                                           |
| `src/components/GranulePanel.jsx`    | NISAR granule search form + results.                               |
| `src/components/DataExplorer.jsx`    | Time slider / mosaic of every image over an area.                  |
| `src/components/ProfilePanel.jsx`, `SpaceTimeChart.jsx` | Height profile along a drawn line.              |
| `src/components/ImpactChain.jsx`     | The NISAR story panel: the NISAR series, moments, one related series and the site's other NISAR series on one time axis. |
| `src/components/tour/`               | First-visit welcome dialog and the guided tour.                    |
| `src/services/chain.js`              | Chain helpers: readouts, time ticks, the drawn-area chain.         |
| `src/services/usePlayback.js`        | Timelapse playback that advances only onto loaded frames; `pauseAllPlayback()`. |
| `src/services/imageCache.js`         | Image preload/decode cache; the map swaps overlays once they're ready. |
| `src/components/ErrorBoundary.jsx`   | Catches render errors, shows a fallback.                           |

## Environment variables

See [`.env.example`](../.env.example) (backend) and
[`frontend/.env.example`](../frontend/.env.example) (frontend) for the
authoritative list with comments.
