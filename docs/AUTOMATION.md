# NISAR Watch: stories that find themselves

The curated stories (`app/data/stories.json`) were chosen by hand from the
NISAR passes published up to mid-November 2026. NISAR keeps imaging, and
NASA keeps every granule. **NISAR Watch** is a daily job that checks new
passes for lasting change and publishes what it measures as
**auto-detected stories**, so the app keeps up without anyone redoing the
research.

```
 GitHub Actions (daily, 06:00 UTC)             .github/workflows/nisar-watch.yml
   │
   ├─ 1. targets   watchlist.json + events (NASA EONET, USGS, GDACS)   pipeline/targets.py, feeds.py
   ├─ 2. ingest    new GCOV passes from NASA CMR → small WebP images
   │               + per-pass box statistics                            pipeline/ingest.py, render.py
   ├─ 3. detect    step / trend / patch detectors, each with a
   │               persistence check                                    pipeline/detect.py
   ├─ 4. publish   templated, numbers-only stories                      pipeline/publish.py
   ├─ 5. test      tests/test_pipeline.py, test_stories.py, test_landchange.py
   └─ 6. PR        data/auto branch → PR into the base branch (`future`
                   until it is merged into main, then main); a person merges
                   it → main → fly-deploy.yml → live in the Latest feed
```

Git stays the database: everything the job learns is a JSON file or an
image under `app/data/`, reviewed (or at least visible) in a pull request
and served by the same code as the curated gallery.

| File | What it holds |
| --- | --- |
| `app/data/watchlist.json` | The places checked on every run. Edited by people. |
| `app/data/auto/places.json` | Every watched place's passes, images and box statistics (same shape as `landchange.json`). |
| `app/data/auto/stories.json` | Auto-detected stories, including retracted ones. |
| `app/data/auto/state.json` | Granules already processed or skipped, events seen, and each target's latest candidates. |
| `app/data/scenes/auto/<slug>/` | One small RGB and one HH WebP per pass. |

## 1. What an auto-detected story says

An auto story is written from a template and contains **only numbers the
job measured**: dates, areas, decibels, percentages, paces. It has no
hypotheses and says nothing about causes. It is labeled **"Auto-detected,
not reviewed"** in the workspace, the REST API, the MCP tools and the
evidence card, and every one says that no person has checked it.

If the place was added because of a reported event (an earthquake, an
eruption, a flood), the story names it with a link to its source under
"Reported nearby", and adds: "Shown for context; the radar record alone
doesn't show what drove any change." An event story is published only
when the change spans the event's date.

`tests/test_pipeline.py` checks every committed auto story the same way
`tests/test_stories.py` checks the curated ones: no causal wording, every
required field, its images on disk, and its numbers recomputed from the
committed data.

## 2. Targets

**The watch list** (`app/data/watchlist.json`) holds places tried for the
gallery where nothing was visible yet, and places that change often
(active volcanoes, new islands, lakes and reclamation). Each entry:

```json
{"slug": "mayon", "name": "Mayon", "region": "Albay, Philippines", "kind": "Volcano",
 "lon": 123.685, "lat": 13.257, "half_km": 6, "note": "Why it is watched."}
```

Optional: `theme` (else from `kind`), `frame` (pin a `track_A|D_frame`),
`start` (first pass date). Slugs get an `auto-` prefix so they never
collide with curated places. Curated places are **not** on the list: they
are refreshed by the reviewed workflow in Section 6.

**Events.** Each run polls three public feeds for the last 30 days:

| Feed | What is used |
| --- | --- |
| [NASA EONET](https://eonet.gsfc.nasa.gov/docs/v3) | Volcanoes, floods, landslides, severe storms (point events) |
| [USGS significant earthquakes](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) | M ≥ 6.0, depth ≤ 70 km |
| [GDACS](https://www.gdacs.org/) | Floods, volcanoes, earthquakes, wildfires |

Each new event becomes a temporary target: a window sized by kind
(Earthquake 15 km, Volcano 6 km, Flood 20 km, Landslide 5 km, Wildfire
10 km half-width), passes from 48 days before the event, kept for 60 days.
At most 5 new events are added per run and 20 are kept at once, newest
first. Events overlapping a watched place are merged into it. A feed that
is down is reported in the run summary and the others still count.

## 3. Ingest

For each target the job searches NASA CMR for GCOV granules, pins one
track and frame (the one with the most passes), skips granules already
processed, and takes the newest 12 per target and 150 per run. Each pass
is cut to the window, rendered as a 300-pixel RGB and HH WebP (25–40 KB
each, with the gallery's stretch), and summarized as box statistics:
median HH and HV in dB and the share of open water (HH below −18 dB).
Granules that can never be used (outside the frame, a single
polarization) are remembered and never fetched again.

## 4. Detectors

Three detectors run on each place's record. Each produces a candidate
that is **accepted**, **pending** (waiting for the next pass) or
**rejected** with a reason; the run summary lists every reason.

| Detector | Finds | Accepted when |
| --- | --- | --- |
| **step** | The largest pass-to-pass change in median HH, HV or open water | It is at least 1.5 dB (5 points of water), at least 5 robust standard deviations above the series' other steps, both passes are in the same mode, it isn't a one-pass spike, and at least half of it is still there on the next pass. Needs 5 passes. |
| **trend** | A steady pace | A straight line explains the series (R² ≥ 0.8), the pace is at least 6 standard errors from zero, and the total change is at least 1.5 dB (5 points). Needs 8 passes. |
| **patch** | A compact patch that changed between two passes | At least 30 half-resolution pixels changed by 4 dB or more (after removing the shift of the whole window), the patch is at least 6 robust standard deviations (with a 5-pixel floor) larger than the place's usual largest patch between two passes, less than 30% of the window changed (else it is season, soil moisture or snow), and at least half of the patch still differs on the next pass. Needs 4 pairs. |

The story leads with the most recent accepted change, a patch before a
step before a trend. An older change never replaces a newer one, and a
story's earlier leads are kept in its `history`.

These thresholds were set by replaying the detectors on the curated
gallery's committed passes (`tests/test_pipeline.py`). They re-find the
changes the team picked by hand (the Langtang and Budhi Gandaki
landslides, Bang Pakong's flooding) and reject Etna's 9–21 September
change, which had gone by the next pass.

## 5. Publishing, retracting and promoting

**New and updated stories** are written to `app/data/auto/stories.json`
and committed to the `data/auto` branch, rebuilt from the base branch on
every run. The PR body is the run summary: targets, passes rendered, candidates
and their reasons, new and updated stories, feed errors.

**Retract** a story that is wrong (snow, a processing artifact, a known
non-event): set `"status": "retracted"` and a `"retracted_reason"` on it
in `app/data/auto/stories.json`. It disappears from the app and is never
rewritten by the job.

**Promote** a story a person has checked: copy the place into
`app/data/landchange.json` and write a curated story in
`app/data/stories.json` with the same slug (hypotheses, sources, caveats).
The curated story wins wherever both exist; then set the auto story's
status to `"superseded"`.

## 6. Setup

1. **Earthdata token.** At <https://urs.earthdata.nasa.gov> → Generate
   Token. Add it as the repository secret `EARTHDATA_TOKEN`. Tokens last
   60 days; the job warns 10 days before expiry and fails once it has
   expired (`python -m pipeline check-token`).
2. **Let Actions open PRs.** Settings → Actions → General → Workflow
   permissions → *Allow GitHub Actions to create and approve pull
   requests*.
3. **Base branch: nothing to set.** Each run picks the branch it builds
   on and opens its PR against (the run's notice says which and why):
   - `future` while it has commits not yet in the default branch (`main`);
   - `main` once `future` has been merged into it, or deleted.

   So merging `future` into `main` switches the data PRs to `main` with
   no change to the workflows. Merge `future` with a **merge commit**: a
   squash or rebase merge leaves `future`'s own commits outside `main`,
   so it would still count as unmerged (delete the branch afterwards, or
   set the variable). To pin a branch, set the repository variable
   `NISAR_WATCH_BASE` (Settings → Secrets and variables → Actions →
   Variables). The scheduled run only starts from `main`, so the
   workflow files must be on `main`.
4. **Optional: `NISAR_WATCH_TOKEN`.** GitHub doesn't run workflows for a
   PR opened with the job's built-in `GITHUB_TOKEN`, so the data PRs get
   no CI checks without it; they are still opened, and CI runs once a
   person pushes to the branch or merges. To have CI run on them: create
   a fine-grained personal access token (GitHub → Settings → Developer
   settings → Fine-grained tokens) for this repository only, with
   *Contents: Read and write* and *Pull requests: Read and write*, and add
   it as the repository secret `NISAR_WATCH_TOKEN` (Settings → Secrets and
   variables → Actions → New repository secret). It is not needed on Fly.
5. **Optional: auto-merge.** Off by default: every data PR waits for a
   person. To have it merge when CI passes, set the repository variable
   `NISAR_WATCH_AUTO_MERGE` to `true`, set `NISAR_WATCH_TOKEN`, turn on
   *Allow auto-merge*, and require the CI checks on the base branch (without
   required checks, auto-merge merges at once).
6. The workflow skips with a notice while `EARTHDATA_TOKEN` is missing.

Run it by hand from Actions → NISAR Watch → Run workflow, with an
optional target, a dry run, no event feeds, or a pass budget.

**The curated refresh** (`.github/workflows/nisar-curated-refresh.yml`,
run by hand) re-renders the curated gallery and, optionally, the study
sites with every pass published so far, runs the whole test suite, and
opens a **draft** PR with the results. It never merges itself: new passes
can make a hand-written caption untrue, and the failing tests show which.

**The coverage map refresh** (`.github/workflows/coverage-map-refresh.yml`,
weekly and by hand) rebuilds the workspace's coverage heatmap counts
(`scripts/build_coverage_map.py`, no secrets) and opens a PR when they
changed.

## 7. Running it locally

You can run the whole loop on your machine with no Fly deploy and no
GitHub Actions. The pipeline writes the same files the daily job commits,
and the dev server shows them as soon as they change.

**1. Start the app** (see [DEVELOPMENT.md](DEVELOPMENT.md) for first-time setup):

```bash
# Terminal 1: backend. .env (copied from .env.example) sets FLASK_ENV=development.
bin/start dev                         # http://localhost:8880

# Terminal 2: frontend
cd frontend && npm run dev            # http://localhost:5173
```

Open <http://localhost:5173/workspace?mode=stories&list=latest>. The
**Latest** list shows the curated stories, newest first. No auto-detected
story is listed yet.

**2. Give the pipeline a token.** Put `EARTHDATA_TOKEN=...` in `.env` (the
pipeline reads it through the app's `load_dotenv`), or export it in a
third terminal. Make a token at <https://urs.earthdata.nasa.gov> under
*Generate Token*.

```bash
source .venv/bin/activate
python -m pipeline check-token        # set, and days until it expires
```

**3. Look before writing anything:**

```bash
python -m pipeline targets --no-events   # the watch list only (no network)
python -m pipeline targets               # plus places near recent events (EONET, USGS, GDACS)
python -m pipeline run --dry-run --no-events   # CMR search only: what would be rendered
```

**4. Run it for one place**, keeping it small:

```bash
python -m pipeline run --target auto-mayon --no-events --max-passes 20
```

This renders each new pass under `app/data/scenes/auto/<slug>/`, updates
`app/data/auto/{places,stories,state}.json`, and prints the same Markdown
summary the job puts on its PR. It lists every candidate and why it was
published or held back (pending, spike, area-wide…). A second run skips
passes it already has.

**5. See the result.** There's no need to restart either server: the
backend rereads `app/data/auto/*.json` when they change. Reload the page.

- **Stories → Latest**: set *Found by* to *NISAR Watch (not reviewed)*. Open
  a story to see its badge and the *What was measured* panel.
- **Investigate**: the watched place is in the gallery with its new passes.
- **API**:
  ```bash
  curl 'localhost:8880/api/stories/feed?origin=auto'
  curl 'localhost:8880/api/stories?origin=auto&since=2026-01-01'
  ```

Many places have no story at first: a change has to stand out from the
place's own noise and still be there on the next pass. To get more
candidates, add more targets (`--target` is repeatable) or drop
`--no-events`.

**6. Iterate on the detectors without downloading again.** After editing
`pipeline/detect.py` or `pipeline/publish.py`:

```bash
python -m pipeline detect             # detection and publishing on the passes already on disk (no network)
pytest tests/test_pipeline.py tests/test_stories.py
```

**7. Check what the job would commit, then reset:**

```bash
git status --short app/data/auto app/data/scenes/auto
git checkout app/data/auto && git clean -fd app/data/scenes/auto
```

**Without a token** you can still run `pytest tests/test_pipeline.py`. It
replays the detectors on the committed gallery and checks that they
re-find Langtang, Budhi Gandaki and Bang Pakong, and reject Etna's passing
change. You can also run `python -m pipeline targets --no-events`, and use
the Latest list with the curated stories.

**To run the real workflow before merging**, push the branch and start
*NISAR Watch* from the Actions tab (`workflow_dispatch`, with *dry run*
first). It needs the `EARTHDATA_TOKEN` secret (§6).

## 8. Costs and limits

- **Repository growth.** About 50–80 KB per pass (two images). At a
  12-day repeat on one frame, 14 watched places and up to 20 event places
  add roughly 5–10 MB a month. Event places with no story are pruned when
  they expire. If this grows too large, move `app/data/scenes/auto/` to
  object storage and keep only the JSON in git.
- **Runner time.** Rendering a pass streams part of one GCOV granule over
  HTTPS. The first runs work through each place's backlog, 12 passes per
  place and 150 per run; after that a day brings only a few new passes.
  The job has a 3-hour limit.
- **A box-level detector is not an analyst.** It can be fooled by wet
  snow, freezing, wind on water, a change of look angle the mode check
  misses, or farming. That is why every story says it is not reviewed,
  and why retraction is one field.
- **Feeds report events, not effects.** An event near a place says
  nothing about whether it changed the surface.
- **`detected_at` is the date the job first wrote the story.** If a data
  PR waits unmerged, the next run rebuilds it with that run's date.

## 9. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| An issue "NISAR Watch is failing" | Open the linked run. Most often the token expired (renew `EARTHDATA_TOKEN`) or CMR was down (the next run retries). |
| Every target errors | CMR or Earthdata is down, or the token is invalid. The run exits non-zero. |
| "Check the stories" fails | A story's text no longer matches its numbers: fix the template in `pipeline/publish.py`, or retract the story. |
| The PR doesn't run CI | `NISAR_WATCH_TOKEN` isn't set; push an empty commit to the branch or close and reopen the PR. |
| A place is never published | `python -m pipeline detect` and the PR summary show each candidate's reason (pending, spike, area-wide, passing change…). |

## 10. Watch my area

Anyone can ask the server to watch an area they drew: **Investigate → draw an
area → Watch this area**. It opens `/watch/<id>`, a private link that this
browser remembers (`/watch` lists them).

- **Same detectors, different home.** A check runs `pipeline.ingest` and
  `pipeline.detect` exactly as above on one box (up to 30 km across; up to
  60 km is clipped to its central 30 km). Results are not committed: a
  person's area never reaches the repository. They live on the backend under
  `DATA_DIR/watches/<id>/` (`app/watch.py`).
- **No scheduler.** A watch is re-checked when its page or its Atom feed
  (`/api/watches/<id>/feed.atom`) is opened and the last check is over 12 hours
  old. Feed readers poll, so subscribed watches stay current. For cron, run
  `flask watch run`.
- **The link is the key.** Whoever has it can read, subscribe to or stop the
  watch. Nothing lists watches.
- **Wording.** Flagged changes are "worth an expert's look", never a warning.
  Pending ones wait for the next pass, and rejected ones are listed with the
  detector's reason.
- **Setup.** `EARTHDATA_TOKEN` (required), `PUBLIC_APP_URL` (the frontend, for
  feed links) and `WATCH_MAX` (default 500) in the backend's environment. The
  Docker image includes `pipeline/` for this.
