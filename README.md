# NISAR Surface Change Explorer

An interactive map that shows Earth's surface changing through the eyes
of **NISAR**, the NASA–ISRO Synthetic Aperture Radar satellite. Built for
the NASA Space Apps 2026 challenge
[_Dancing with the SARs_](https://www.spaceappschallenge.org/2026/challenges/dancing-with-the-sars/).

**Live app:** <https://nisar-surface-change-app.vercel.app>

**Demo video:** [SubjectToChange_NISAR.mp4](SubjectToChange_NISAR.mp4) (30 s)

NISAR values and images come from real granules. Rain and river flow
are public model records shown on the same dates; the app draws no
conclusions from them. Physical explanations are offered as labelled
hypotheses, each with an alternative and a test. See
[Data, methods and sources](docs/DATA_AND_METHODS.md).

## What the workspace is for

It turns NISAR passes into a **finding you can defend and share**: what
changed at a place, when, by how much, how sure the record is, and what
might explain it. Three modes:

| Mode            | For                                                        | You leave with                                         |
| --------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| **Stories**     | A guided look at what NISAR shows at 12 places             | A question, labelled hypotheses, what the record can't show |
| **Investigate** | Your own area or line, and every place with data           | Passes over your area, a series, a height profile      |
| **Findings**    | Keeping and sharing a result                               | A card with evidence and limits, a printable brief, CSV, REST and MCP calls |

Each tab owns the side panel and its tools: drawing and clicking the map
are on **Investigate**.

## What it does

- **Six study sites**, each with up to a year of NISAR passes:

  | Site                     | Change            | Product | What NISAR shows                                       |
  | ------------------------ | ----------------- | ------- | ------------------------------------------------------ |
  | Punjab, India            | Crops & farming   | GCOV    | HV rises Nov–Mar, drops 3.8 dB by late April, peaks in Sep |
  | Mekong Delta, Vietnam    | Crops & farming   | GCOV    | Open water under 0.5% in July, 9.6% in September       |
  | Columbia Basin, WA       | Crops & farming   | GCOV    | HV peaks in August, then falls 2.6 dB                  |
  | Sylhet haors, Bangladesh | Floods & wetlands | GCOV    | Open water 53% in July, 14% in November                |
  | Okavango Delta, Botswana | Floods & wetlands | GCOV    | Open water 11% in early July, 1.7% by late October     |
  | Mexico City              | Land subsidence   | GUNW    | 204 mm away from the satellite in a year               |

- **Twelve stories** (water, food, ground, ice, and the Amazon's forest
  and rivers), each with labelled physical hypotheses: driver,
  mechanism, radar channel, what the record shows, an alternative and a
  test (`app/data/stories.json`).
- **Findings**: any moment as a card with its passes, quality, coverage,
  hypotheses, a citation, a printable brief at `/brief/<story>`, CSV,
  and the REST and MCP calls that rebuild it.
- **Coverage check** for any drawn area: passes per product, each
  frame's revisit and quality, and what they could support.
- **Time-lapse, before/after and charts** per pass, with HH, HV and
  very-dark-pixel layers.
- **Story panel**: the NISAR series, moments computed from it, and one
  related series (rain or river flow) on the same dates.
- **Land-change gallery**: lava, a glacier front, rivers and landslides
  at ~20 m, with change maps between any two dates.
- **Draw area**: every NISAR pass over any rectangle, with SME2 soil
  moisture when `EARTHDATA_TOKEN` is set.
- **Draw line**: ground motion along a line up to 100 km from every GUNW
  pair on the best frame.
- **Guided tour** at Kīlauea on first visit.

## Quick start

Prerequisites: Python 3.11+, Node.js 22+, git.

```bash
# Backend (terminal 1)
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env
bin/start dev                # migrates, loads app/data/, serves http://localhost:8880

# Frontend (terminal 2)
cd frontend
npm install
npm run dev                  # open http://localhost:5173
```

Open http://localhost:5173. The map is at **/workspace**; the docs are
under Get Started, Radar Science, Data & Methods and Developers. On
Windows PowerShell, see *Developers → Run it locally* in the docs.

The **MCP server** is on: the backend serves its read-only tool registry
at `/api/tools` (`ENABLE_MCP=1`, the default; no key needed). Run it with
`pip install -r requirements-mcp.txt` and `python -m mcp_server`; see
*Developers → MCP server* in the docs. The in-app **AI assistant** is
off: set `ENABLE_AI=1` in `.env`, `VITE_ENABLE_AI=true` in
`frontend/.env` and an `ANTHROPIC_API_KEY` to turn it on.

An Earthdata Login is only needed to recompute data or add sites
([how](docs/GUIDE.md#5-the-real-data-pipeline)). Step-by-step setup:
[macOS](docs/GUIDE.md#macos),
[Windows + WSL](docs/GUIDE.md#windows-wsl-recommended-on-windows),
[Windows PowerShell](docs/GUIDE.md#windows-powershell).

## How it fits together

```
NASA CMR + ASF (NISAR HDF5) ──► scripts/extract_nisar.py ──► app/data/nisar_observations.json
                                (offline, needs Earthdata     app/data/scenes/<site>/<date>.webp
                                 Login; reads only the
                                 pixels over each site)                │
                                                                        ▼ flask nisar load
React + Leaflet ◄── /api/sites, /api/scenes ◄── Flask ◄── SQLite (sites, scenes, observations)
               ◄── /api/nisar/granules ◄────── Flask ◄── NASA CMR (live search, no login)
```

## Stack

| Layer    | Tech                                                         |
| -------- | ------------------------------------------------------------ |
| Data     | h5py · numpy · pyproj · Pillow (HTTP range reads of NISAR)   |
| Backend  | Flask 3 · SQLAlchemy 2 · Flask-Migrate · requests (NASA CMR) |
| Frontend | React 19 · Vite 7 · Leaflet / react-leaflet · axios          |
| Database | SQLite by default; Postgres via `DATABASE_URL`               |
| CI       | GitHub Actions (pytest · vitest · lint · build · schema)     |

## API

All endpoints are public and read-only. Errors come back as `{"error": "..."}`.

| Method | Path                       | Notes                                                               |
| ------ | -------------------------- | ------------------------------------------------------------------- |
| GET    | `/api/health`              | DB + loader status                                                  |
| GET    | `/api/change-types`        | Change categories with their product, metrics and image legend      |
| GET    | `/api/sites`               | `?change_type=` `&limit=` (≤500) `&offset=`; includes date coverage |
| GET    | `/api/sites/<id>`          | Site + `observations` (one per metric per date) + `scenes`          |
| GET    | `/api/sites/<id>/chain`    | Site story: NISAR series, moments, related series                  |
| GET    | `/api/area-context`        | `?bbox=&start=&end=`; daily rain at the area's centre (live)       |
| GET    | `/api/scenes/<site>/<f>`   | A scene image (WebP)                                                |
| GET    | `/api/nisar/products`      | Searchable NISAR products                                           |
| GET    | `/api/nisar/granules`      | `?bbox=minLon,minLat,maxLon,maxLat&product=GCOV&start=&end=&limit=` |
| GET    | `/api/nisar/coverage`      | `?bbox=&start=&end=`; granule count per product over the box       |
| GET    | `/api/nisar/browse-bounds` | `?kml=<granule's browse_kml_url>`; map bounds of its browse image   |
| GET    | `/api/nisar/sme2/scene`    | `?granule=<SME2 name>&bbox=`; values + images (needs `EARTHDATA_TOKEN`) |
| GET    | `/api/nisar/sme2/images/<key>/<layer>.webp` | A rendered SME2 image (`backscatter`, `soil_moisture`) |
| POST   | `/api/nisar/profiles`      | `{"line": [[lon, lat], ...]}`; starts a height-profile job          |
| GET    | `/api/nisar/profiles/<id>` | Job state and, when done, the result                                |
| GET    | `/api/landchange`          | The land-change gallery                                             |
| GET    | `/api/stories`             | `?theme=`; themes and every story                                   |
| GET    | `/api/stories/<slug>`      | One story: question, moments, hypotheses, limits, future uses       |
| GET    | `/api/stories/<slug>/series.csv` | A study site's values, one row per pass and metric             |
| GET    | `/api/findings/<slug>`     | `?moment=N`; one moment as a finding card                           |
| GET    | `/api/coverage-check`      | `?bbox=&start=&end=`; passes per product and frame, with verdicts   |
| GET    | `/api/tools`               | Agent tool registry used by the MCP server (on unless `ENABLE_MCP=0`) |
| POST   | `/api/tools/<name>`        | Run one tool with JSON arguments                                    |
| GET    | `/api/openapi.json`        | OpenAPI 3.1 spec                                                    |
| GET    | `/api/assistant/status`    | Whether the AI assistant is configured (only with `ENABLE_AI=1`)    |
| POST   | `/api/assistant/chat`      | Streamed (SSE) assistant reply (only with `ENABLE_AI=1`)            |

## Project layout

```
scripts/extract_nisar.py  Computes real values + images from NISAR granules (offline)
scripts/build_landchange.py   Builds the land-change gallery (offline)
scripts/build_driver_data.py  Fetches the rain and river flow shown beside each site
scripts/shared_footprint.py   Open water over the part of each box every pass imaged
scripts/chain_evidence.py     Prints every number behind the site stories (tables in DATA_AND_METHODS)
app/
  data/               sites.json (hand-edited), nisar_observations.json + scenes/ (generated),
                      landchange.json, drivers.json (generated), stories.json (hand-edited)
  change_types.py     Change categories and metrics (product, units, legends, radar explainer)
  chains.py           Site story per site: moments computed from NISAR, related series
  stories.py          Stories, findings, CSV export and the coverage check (data: data/stories.json)
  tools.py            Shared tool registry: REST /api/tools, the MCP server and the assistant
  drivers.py          Rain and river flow series (public sources, no key)
  sme2.py             Soil-moisture images and values for drawn areas
  profiles.py         Height change along a drawn line (dem.py for terrain)
  loader.py           Mirrors app/data/ into the DB (flask nisar load)
  models.py           Site, Scene, Observation, LoadJob
  nisar.py            NASA CMR search + browse-image bounds (cached, no login)
  openapi.json        OpenAPI 3.1 spec, served at /api/openapi.json
  routes/api.py       health, change types, sites, site stories, land change, scene images
  routes/nisar.py     NISAR catalog search, SME2 scenes, height-profile jobs
  routes/stories.py   Stories, findings, CSV and coverage check
mcp_server/           MCP server (stdio or HTTP), a thin client of /api/tools
frontend/src/
  App.jsx             Router and shell: top bar, Home, docs, the workspace host
  workspace/          WorkspaceApp: the map, the three modes and their state (site, pass, area, line);
                      navigation.js: which view each tab shows, and the workspace's links
  components/         StoryList, StoryPanel, CoverageCheck, FindingsPanel,
                      FindingCard, ChangeMap, PlacesList, SiteDetail, ScenePlayer, ImpactChain,
                      DataExplorer, LandChangePanel, LandPlayer, ProfilePanel, tour/
  platform/           Home, top bar, docs layout and navigation (docs/nav.js), REST reference
  content/docs/       The docs pages (MDX)
  services/api.js     All backend calls
tests/                pytest      frontend/src/test/   vitest
docs/                 GUIDE, DEVELOPMENT, ARCHITECTURE, DATA_AND_METHODS, DEPLOYMENT, TROUBLESHOOTING, NISAR_HERO
assets/nisar/         Editable Blender source of the NISAR 3D model (web models in frontend/public/models/)
```

## Documentation

The same material is in the app under **Docs**. In the repository:

- [`docs/GUIDE.md`](docs/GUIDE.md): **start here.** Setup, a
  NISAR primer, the data pipeline, the codebase tour, and next steps.
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md): day-to-day commands.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): the module map.
- [`docs/DATA_AND_METHODS.md`](docs/DATA_AND_METHODS.md): sources and
  citations, how each value and moment is computed, what each site
  shows, and the limits.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md): Fly.io + Vercel setup and auto-deploys.
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md): common failures.
- [`assets/nisar/README.md`](assets/nisar/README.md): the NISAR 3D model,
  its Blender source and a Three.js loader example.
- [`docs/NISAR_HERO.md`](docs/NISAR_HERO.md): the home page's interactive
  NISAR scene and its fallbacks.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): branch, test and PR conventions.

## Data, sources & credits

- **NISAR data:** NASA/JPL-Caltech and ISRO, distributed by the
  [Alaska Satellite Facility DAAC](https://asf.alaska.edu/), found
  through [NASA CMR](https://cmr.earthdata.nasa.gov/). Collections and
  DOIs: GCOV, GUNW and SME2, validated and provisional (see
  [Data and methods §2](docs/DATA_AND_METHODS.md#2-nisar-measurements)).
  Most granules used are **provisional** (early-mission) products; the
  app labels each pass's quality.
- **Related series** (CC BY 4.0): daily rain from ECMWF's IFS model,
  seasonal normals from ERA5 and GloFAS river discharge, all through
  [Open-Meteo](https://open-meteo.com/). Rain and river flow are model
  output for one grid cell; neither is a gauge reading.
- **Terrain:** [Copernicus GLO-90 DEM](https://registry.opendata.aws/copernicus-dem/)
  (© DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018,
  provided under COPERNICUS by the European Union and ESA).
- **Basemaps:** Esri World Imagery, © OpenStreetMap contributors, and
  NASA GIBS (VIIRS).
- **Background facts:** Punjab's season labels follow the
  [FAO GIEWS crop calendar for India](https://www.fao.org/giews/countrybrief/country.jsp?code=IND);
  each land-change gallery place cites its event source (for example
  the AGU/Eos Landslide Blog) in
  [`app/data/landchange.json`](app/data/landchange.json) and in the app.
- **NISAR spacecraft visualization:** Courtesy of NASA/JPL-Caltech via
  [NASA’s Eyes](https://eyes.nasa.gov/apps/earth/). See the
  [model source and credits](assets/nisar/README.md#source-and-attribution).

Full citations, with DOIs, are in
[`docs/DATA_AND_METHODS.md`](docs/DATA_AND_METHODS.md#10-references).

This is not a NASA or ISRO product, and it does not imply their
endorsement.

## Use of Super Intelligence (SI)

- **Code and writing:** The team used SI tools, including GitHub Copilot,
  to write most of the code and draft much of the app copy and documentation.
  The team reviewed and tested the code.
- **Spacecraft illustration:** The team adapted geometry and textures
  from NASA’s Eyes in Blender and optimized the model for the web. The
  [build records](assets/nisar/README.md) don’t specify whether SI
  assisted with the adaptation.
- **Scientific data:** Measurements, radar imagery and supporting series
  come from the public datasets listed under
  [Data, sources & credits](#data-sources--credits).
- **NASA branding:** SI-generated content excludes NASA logos, flags and
  mission identifiers.

## License

The [Apache License 2.0](LICENSE) covers the project’s original code and
content. Bundled material retains its source terms. See [`NOTICE`](NOTICE)
for attribution.

| Material | License or terms | Where |
| --- | --- | --- |
| NISAR spacecraft model and textures | [NASA media-use guidance](https://www.nasa.gov/nasa-brand-center/images-and-media/) and [asset source notes](assets/nisar/README.md#source-and-attribution) | `assets/nisar/`, `frontend/public/models/nisar/` |
| Basis Universal transcoder (from Three.js 0.187.0) | Apache-2.0 | `frontend/public/decoders/basis/` |
| Three.js, meshoptimizer notices | MIT | `frontend/public/decoders/basis/` |
| BDO Grotesk font | SIL OFL 1.1 | `frontend/public/fonts/` |
| npm and PyPI dependencies | Their own open-source licenses | `frontend/package.json`, `requirements*.txt` |
