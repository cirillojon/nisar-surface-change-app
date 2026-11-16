# Data, methods and sources

This document shows where every number in the NISAR Surface Change
Explorer comes from and how it is computed. It is written so that
someone outside the team can check the work.

The app puts NISAR first. Everything else on screen is one of three
kinds:

| Kind | What it means | Where it appears |
| --- | --- | --- |
| **Measured** | A value computed from NISAR granules, or a statistic computed from those values. | The NISAR chart, the moment tiles and the pop-up over the map. [Sections 2](#2-nisar-measurements) and [3](#3-moments). |
| **Shown alongside** | Public data on the same dates: rain and river flow. Nothing is tested and no link is claimed. | The "Same dates" lane. [Section 4](#4-related-series-rain-and-river-flow). |
| **Background** | A sentence from outside our data, with its source. | Only in "Site notes & data sources". [Section 7](#7-background-statements-and-their-sources). |

A _pass_ is one date on which NISAR imaged a site.

## 1. What the app says, and what it doesn't

- **It says what NISAR measured.** Each value comes from a named granule
  and is recomputed by a script anyone can run.
- **It sums up stretches of the record** as "moments": a change between
  two passes, a fitted pace, or a single reading. The site's
  configuration sets the dates and a one-line caption; every number is
  computed from the NISAR values, and a test checks that each caption
  still describes the data.
- **It does not say why something changed.** The app gives no causes,
  no correlations and no verdicts. Rain and river flow are drawn
  on the same time axis, labelled "Shown for comparison. Lining up in
  time doesn't show that one affects the other."
- **It offers hypotheses, labelled as such.** Each story
  (`app/data/stories.json`) gives physical explanations the data
  raises, every one in the same shape: a driver, the mechanism, the
  radar channel that responds, what in the record fits it, what else
  would fit the same data, and a **test** that would tell them apart.
  They are labelled as hypotheses wherever they appear (workspace, REST,
  MCP, printed briefs). A hypothesis is offered only for the moments it
  was written for, and a moment that may be an artifact (Sylhet's
  mode check, Mexico City's mid-April step) is explained as one.
  `tests/test_stories.py` requires every field, rejects causal wording
  ("caused", "due to", "proves"), checks the numbers in the text against
  the committed data, and checks that a story names only the
  polarizations its place has.
- **A story's background is background.** Each story's one-line
  description of the place, and the mechanism in each hypothesis, are
  general knowledge, not our data. Only the "fits" line reports the
  record.
- **It does not give advice.** We are not qualified to recommend action
  on groundwater, farming or markets, and the data could not support it.
- **Drawn rectangles are data only.** For an area you draw, the app
  shows the NISAR passes and rain at the centre of the box side by
  side, and says that nothing is tested.
- **The record is short.** Each site has 10 to 29 passes from one year,
  most of them provisional.

## 2. NISAR measurements

### Source

NISAR is the NASA–ISRO L-band radar satellite. We use these products,
distributed by NASA's Alaska Satellite Facility (ASF) data centre and
found through NASA's Common Metadata Repository (CMR):

| Product | What it holds | Collections used (DOI) |
| --- | --- | --- |
| GCOV | Radar brightness (backscatter) per pixel | `NISAR_L2_GCOV_V1`, validated ([10.5067/NIL2GCOV-V1](https://doi.org/10.5067/NIL2GCOV-V1)); `NISAR_L2_GCOV_PROVISIONAL_V1` ([10.5067/NIL2GCOV-P1](https://doi.org/10.5067/NIL2GCOV-P1)) |
| GUNW | Ground motion between two dates (unwrapped interferogram) | `NISAR_L2_GUNW_V1`, validated ([10.5067/NIL2GUNW-V1](https://doi.org/10.5067/NIL2GUNW-V1)); `NISAR_L2_GUNW_PROVISIONAL_V1` ([10.5067/NIL1GUNW-P1](https://doi.org/10.5067/NIL1GUNW-P1)) |
| SME2 | Soil moisture (drawn areas only) | `NISAR_L3_SME2_PROVISIONAL_V1` ([10.5067/NIL3SME2-P1](https://doi.org/10.5067/NIL3SME2-P1)) |

The DOIs are the ones registered for each collection in CMR.

### How we get the values

1. [`scripts/extract_nisar.py`](../scripts/extract_nisar.py) searches CMR
   for granules over each site in
   [`app/data/sites.json`](../app/data/sites.json).
2. It keeps one track and frame per site, so every date is seen from the
   same angle. Where a date has both a validated and a provisional
   granule, it uses the validated one.
3. It reads only the pixels over the site's box from each file. This
   step needs a free NASA Earthdata Login.
4. It writes the values to
   [`app/data/nisar_observations.json`](../app/data/nisar_observations.json),
   with the source granule's name beside each value, and one image per
   date to `app/data/scenes/`. Both are committed, so the app runs
   without a login.

### How each value is computed

| Value | Computation | Known limit |
| --- | --- | --- |
| HH and HV backscatter (dB) | Median over the valid pixels in the site's box, from GCOV frequency B (5 MHz, 80 m) gamma-naught. | One number for the whole box. Punjab's box includes the city of Ludhiana. |
| Open water (%) | Share of pixels with HH below −18 dB, over the part of the box that every pass of the site imaged (the shared footprint; `scripts/shared_footprint.py`). | A single threshold. It misses wind-roughened water and water under vegetation, so it understates flooding in the Okavango. |
| Line-of-sight displacement (mm) | The longest unbroken chain of interferogram pairs on one frame. For each pair: unwrapped phase minus the ionosphere phase screen, converted to mm, taken relative to a stable reference point, then summed over the chain. Both points use the median of a ±0.01° box. | Motion along the radar's line of sight, not vertical. Relative to the reference point. No correction for the atmosphere, which adds noise to every step. |

A GCOV date is skipped when under 60% of the box has valid pixels, and
pixels within 8 pixels of the edge of the valid area are discarded. Most
granules are provisional, early-mission products; the first table in
[Section 5](#5-the-numbers) gives the count per site, and how many
passes saw less than 95% of the box.

## 3. Moments

A moment is a short summary of one stretch of a site's NISAR record. It
is configured in [`app/chains.py`](../app/chains.py) (`SITE_CHAINS`) as
a pair of pass dates, a label, a one-line caption and one of four
statistics, all computed in `_moment`:

| Statistic | Computation | Example shown |
| --- | --- | --- |
| `change` | Value on the last pass minus value on the first. Open water changes in percentage points. When the range is just two passes, the gap between them is shown, since a missed pass can stretch it. | "+18.4 pts, 34.9 → 53.3%"; "−3.8 dB, −15.7 → −19.6 dB · 36 days apart" |
| `rate` | Least-squares straight line through every pass in the range; the slope per day × 30.44, with its standard error. | "−20.0 mm/month, ±1.2 · 16 passes" |
| `peak` / `low` | Highest or lowest value in the range, and its date. | "0.3%, highest of 4 passes" |
| `value` | The reading on one pass. | "12.1%, 7 Jul 2026" |

- **Dates are pass dates.** The code refuses a moment whose start or end
  is not a NISAR pass, so a moment can't describe days with no data.
- **Season labels** ("Wheat season", "Rainy months") name the calendar
  months only. Punjab's follow the [FAO GIEWS crop calendar for
  India](https://www.fao.org/giews/countrybrief/country.jsp?code=IND);
  Mexico City's "drier" and "rainy" months are the ones with less and
  more rain in the related series ([Section 5](#5-the-numbers)).
- **Captions describe the series, not a cause.** For example, "HV
  climbs through the winter, with a dip in late February and early
  March", not "the wheat grows".
  `test_committed_captions_describe_the_data` in
  [`tests/test_chains.py`](../tests/test_chains.py) checks each caption's
  claim against the committed values: that the April drop is the largest
  between two passes, that the winter rise has a dip, that the Okavango's
  open water never rises after 8 July, and so on.
- **"Open water" only where it is water.** The open-water measure is the
  share of the box with a very low radar return. Smooth bare ground can
  return as little, so at the farm sites (Punjab, Columbia Basin) the
  tiles call it "Very dark pixels" and say it is the open-water measure
  used at flood sites.
- **The tile and the map agree.** Picking a tile moves the map to the
  pass the tile is about, and scrubbing the timeline into a moment's
  dates opens that moment over the map.

### Per-pass coverage

Each pass records the share of the box with usable pixels. On the NISAR
chart, passes that saw less than 95% of the box are drawn hollow, and
the ⓘ note gives the selected pass's coverage. Open water is computed
over the shared footprint, so a pass that imaged less of the box does
not change the area being compared (Section 5). At Sylhet, half the
passes saw 83% of the box, and passes alternate between two
acquisition modes; the "Mode check" moment points at one such pair,
because some of that site's zigzag follows the mode rather than the
water.

## 4. Related series: rain and river flow

These are the series in the "Same dates" lane. One is shown at a time,
smaller than the NISAR chart, and it can be switched off. Both sources
are public and need no key.

| Series | Source and request | What it is | What it is not |
| --- | --- | --- | --- |
| Daily rain | Open-Meteo archive API, `daily=precipitation_sum`, `models=ecmwf_ifs`, `timezone=UTC` | ECMWF's operational weather model (IFS) at 9 km, as archived by Open-Meteo from 2017, with no delay. | Not a rain gauge, and not a reanalysis. One grid cell stands in for the site. |
| Seasonal normal (Punjab) | Same API, `models=era5` for the season and for every baseline year | ERA5 reanalysis, 0.25°. The normal is the mean of the season's total over 2001–2025. | Not comparable with the daily bars, which come from a different model. |
| River flow | Open-Meteo flood API, `daily=river_discharge` | GloFAS version 4 modelled discharge at 0.05° (about 5 km). Open-Meteo lists its consolidated record as ending in July 2022 and joins forecast runs after that, so our 2025–26 values come from the forecast side. | Not a gauge reading. The level can be well off; only the shape should be read. |

**Why two rain datasets.** ERA5 is the standard record for comparing a
season with past decades, but it runs about five days behind, so the
newest pass would have no rain value. The 9 km model has no delay but
only starts in 2017. We name the model in every request. The two differ:
over the same days, the 9 km model gave 575 mm at Punjab against ERA5's
523 mm, 1,698 against 2,237 mm at Sylhet, and 951 against 765 mm at
Mexico City. Read rain amounts as approximate.

**Readouts.** Beside the lane, rain is the total over the 12 days ending
on the selected pass (NISAR's repeat cycle) and river flow is the
average over those days. A moment tile's related value covers the
moment's own dates instead: the total rain, or the average flow, from
its first pass to its last. A single-pass moment uses the 12 days to
that pass.

**The exact request.** For example, Sylhet's daily rain is:

```
https://archive-api.open-meteo.com/v1/archive?latitude=24.9&longitude=91.3&start_date=2026-05-21&end_date=2026-11-11&daily=precipitation_sum&timezone=UTC&models=ecmwf_ifs
```

**What is stored.**
[`scripts/build_driver_data.py`](../scripts/build_driver_data.py) fetches
every series and writes
[`app/data/drivers.json`](../app/data/drivers.json), including the grid
cell each source returned. The app reads that file, so what you see does
not change unless someone reruns the script. Drawn areas fetch daily rain
live for the centre of the box.

## 5. The numbers

These tables are produced from the committed data files by
[`scripts/chain_evidence.py`](../scripts/chain_evidence.py). Rerun it
with `--write` after the data changes. The same values are returned by
`GET /api/sites/<id>/chain`.

<!-- evidence:start -->
_Generated by `scripts/chain_evidence.py` from NISAR values dated 2026-11-14 and related data dated 2026-11-15._

**NISAR record per site**

| Site | Product | Track/frame | Passes | First to last | Granule quality | Passes under 95% of the box | Charted |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Punjab rice–wheat belt, India | GCOV | `156_A_017` | 26 | 2025-11-21 to 2026-11-04 | 24 provisional, 2 validated | 1 (lowest 90%) | HV backscatter (dB): −20.2 dB to −15.5 dB |
| Mekong Delta (An Giang), Vietnam | GCOV | `083_A_007` | 11 | 2026-06-19 to 2026-10-29 | 10 provisional, 1 validated | 0 | Open water (%): 0.0% to 9.6% |
| Sylhet haor basin, Bangladesh | GCOV | `091_D_076` | 12 | 2026-06-20 to 2026-11-11 | 10 provisional, 2 validated | 6 (lowest 83%) | Open water (%): 13.7% to 53.3% |
| Okavango Delta, Botswana | GCOV | `172_A_168` | 10 | 2026-06-26 to 2026-10-24 | 9 provisional, 1 validated | 0 | Open water (%): 1.7% to 11.0% |
| Columbia Basin (Quincy–Moses Lake), Washington | GCOV | `071_D_065` | 11 | 2026-06-19 to 2026-10-29 | 10 provisional, 1 validated | 0 | HV backscatter (dB): −20.9 dB to −18.4 dB |
| Mexico City | GUNW | `019_A_011` | 29 | 2025-10-30 to 2026-10-13 | 28 provisional | 0 | Line-of-sight displacement (mm): −204 mm in 11 months |

**Moments: every number shown in the tiles**

| Site | Moment | Passes in range | n | Statistic | Shown | Detail | Related, same dates |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Punjab rice–wheat belt, India | Nov–Mar (Wheat season) | 2025-11-21 to 2026-03-21 | 10 | change | **+3.1 dB** | −18.9 → −15.7 dB |  |
| Punjab rice–wheat belt, India | April (Wheat harvest) | 2026-03-21 to 2026-04-26 | 2 | change | **−3.8 dB** | −15.7 → −19.6 dB · 36 days apart |  |
| Punjab rice–wheat belt, India | Early July (Rice planting) | 2026-07-07 | 1 | value of the open-water measure | **12.1%** | Very dark pixels, 7 Jul 2026 | Rain 56 mm (12 days to the pass) |
| Punjab rice–wheat belt, India | Jul–Sep (Rice season) | 2026-07-19 to 2026-09-29 | 6 | change | **+4.0 dB** | −19.5 → −15.5 dB | Rain 243 mm (total) |
| Punjab rice–wheat belt, India | Oct–Nov (Rice harvest) | 2026-09-29 to 2026-11-04 | 4 | change | **−1.7 dB** | −15.5 → −17.2 dB |  |
| Mekong Delta (An Giang), Vietnam | Jun–Jul | 2026-06-19 to 2026-07-25 | 4 | peak | **0.3%** | Highest of 4 passes, 19 Jun |  |
| Mekong Delta (An Giang), Vietnam | Aug–Sep | 2026-07-25 to 2026-09-11 | 4 | change | **+9.5 pts** | 0.1 → 9.6% |  |
| Mekong Delta (An Giang), Vietnam | Sep–Oct | 2026-09-11 to 2026-10-29 | 5 | change | **−1.5 pts** | 9.6 → 8.1% |  |
| Sylhet haor basin, Bangladesh | Late Jun–mid Jul | 2026-06-20 to 2026-07-14 | 3 | change | **+18.4 pts** | 34.9 → 53.3% | Rain 521 mm (total) |
| Sylhet haor basin, Bangladesh | Mid Jul–Nov | 2026-07-14 to 2026-11-11 | 10 | change | **−39.6 pts** | 53.3 → 13.7% | Rain 1,192 mm (total) |
| Sylhet haor basin, Bangladesh | Mode check | 2026-09-12 to 2026-09-24 | 2 | change | **−14.6 pts** | 37.7 → 23.1% · 12 days apart |  |
| Okavango Delta, Botswana | Early July | 2026-07-08 | 1 | value | **11.0%** | 8 Jul 2026 | Okavango inflow 293 m³/s (12 days to the pass) |
| Okavango Delta, Botswana | Jul–Oct | 2026-07-08 to 2026-10-24 | 9 | change | **−9.3 pts** | 11.0 → 1.7% | Rain 10 mm (total) |
| Columbia Basin (Quincy–Moses Lake), Washington | Jun–Aug | 2026-06-19 to 2026-08-18 | 5 | change | **+1.1 dB** | −19.5 → −18.4 dB | Rain 12 mm (total) |
| Columbia Basin (Quincy–Moses Lake), Washington | Late Aug–Oct | 2026-08-18 to 2026-10-29 | 7 | change | **−2.6 dB** | −18.4 → −20.9 dB | Rain 24 mm (total) |
| Columbia Basin (Quincy–Moses Lake), Washington | Late October | 2026-10-29 | 1 | value of the open-water measure | **11.6%** | Very dark pixels, 29 Oct 2026 |  |
| Mexico City | Nov–Apr (Drier months) | 2025-10-30 to 2026-04-28 | 16 | rate | **−20.0 mm/month** | ±1.2 · 16 passes | Rain 129 mm (total) |
| Mexico City | Mid April | 2026-04-04 to 2026-04-16 | 2 | change | **−32 mm** | −100 → −132 mm · 12 days apart |  |
| Mexico City | May–Oct (Rainy months) | 2026-05-10 to 2026-10-13 | 13 | rate | **−14.1 mm/month** | ±0.8 · 13 passes | Rain 818 mm (total) |

Worked example: Mexico City, “Nov–Apr”.

| Pass date | Days since first | Line-of-sight displacement (mm) |
| --- | --- | --- |
| 2025-10-30 | 0 | 0.0 |
| 2025-11-11 | 12 | −4.8 |
| 2025-11-23 | 24 | −17.0 |
| 2025-12-05 | 36 | −45.3 |
| 2025-12-17 | 48 | −37.0 |
| 2025-12-29 | 60 | −39.1 |
| 2026-01-10 | 72 | −39.8 |
| 2026-01-22 | 84 | −56.1 |
| 2026-02-03 | 96 | −59.2 |
| 2026-02-15 | 108 | −62.7 |
| 2026-02-27 | 120 | −79.3 |
| 2026-03-11 | 132 | −84.4 |
| 2026-03-23 | 144 | −94.8 |
| 2026-04-04 | 156 | −99.9 |
| 2026-04-16 | 168 | −131.5 |
| 2026-04-28 | 180 | −117.6 |

Least-squares slope = −0.6585 mm/day × 30.44 days = −20.0 mm/month, shown as “−20.0 mm/month” with standard error ±1.2 · 16 passes.

**Displacement record: fit and noise**

| Site | Displacement | Straight-line fit | R² of the fit | Mean change between passes | Standard deviation of those changes |
| --- | --- | --- | --- | --- | --- |
| Mexico City | −204.0 mm over 348 days | −205 mm/year | 0.98 | −7.3 mm | 9.9 mm |

**Related series: what was asked for and what came back**

| Site | Related series | Source | Point asked for | Grid cell returned | Daily values |
| --- | --- | --- | --- | --- | --- |
| Punjab rice–wheat belt, India | Rain (Ludhiana) | ECMWF IFS (9 km) via Open-Meteo | 30.900°N, 75.850°E | 30.896°N, 75.834°E | 379 days, 2025-10-22 to 2026-11-04 |
| Mekong Delta (An Giang), Vietnam | Mekong flow (near Tan Chau) | GloFAS v4 via Open-Meteo | 10.800°N, 105.240°E | 10.825°N, 105.225°E | 163 days, 2026-05-20 to 2026-10-29 |
| Mekong Delta (An Giang), Vietnam | Rain (An Giang) | ECMWF IFS (9 km) via Open-Meteo | 10.500°N, 105.200°E | 10.510°N, 105.225°E | 163 days, 2026-05-20 to 2026-10-29 |
| Sylhet haor basin, Bangladesh | Rain (Sylhet basin) | ECMWF IFS (9 km) via Open-Meteo | 24.900°N, 91.300°E | 24.921°N, 91.258°E | 175 days, 2026-05-21 to 2026-11-11 |
| Sylhet haor basin, Bangladesh | Surma flow (at Sunamganj) | GloFAS v4 via Open-Meteo | 25.070°N, 91.400°E | 25.075°N, 91.375°E | 175 days, 2026-05-21 to 2026-11-11 |
| Okavango Delta, Botswana | Okavango inflow (at Mohembo) | GloFAS v4 via Open-Meteo | 18.280°S, 21.790°E | 18.275°S, 21.775°E | 301 days, 2025-12-28 to 2026-10-24 |
| Okavango Delta, Botswana | Rain (over the delta) | ECMWF IFS (9 km) via Open-Meteo | 19.300°S, 22.900°E | 19.297°S, 22.901°E | 151 days, 2026-05-27 to 2026-10-24 |
| Columbia Basin (Quincy–Moses Lake), Washington | Rain (centre of the box) | ECMWF IFS (9 km) via Open-Meteo | 47.100°N, 119.550°W | 47.065°N, 119.561°W | 163 days, 2026-05-20 to 2026-10-29 |
| Mexico City | Rain (eastern Mexico City) | ECMWF IFS (9 km) via Open-Meteo | 19.420°N, 99.030°W | 19.438°N, 99.018°W | 379 days, 2025-09-30 to 2026-10-13 |

**Seasonal normals**

| Site | Season | Rain | Normal | Share of normal | Rank | Source |
| --- | --- | --- | --- | --- | --- | --- |
| Punjab rice–wheat belt, India | June–August 2026 | 221.5 mm | 446.4 mm (2001–2025 mean) | 50% | 1 of 26 (1 = driest) | ERA5, cell 31.000°N, 75.750°E |

**Open water: the shared footprint**

| Site | Shared footprint (of the box) | Passes | Status | Computed from |
| --- | --- | --- | --- | --- |
| Columbia Basin (Quincy–Moses Lake), Washington | 96.7% | 11 | ok | scene images, calibrated (±0.6 pts on 10 passes) |
| Mekong Delta (An Giang), Vietnam | 100.0% | 11 | ok | scene images, calibrated (±0.6 pts on 0 passes) |
| Okavango Delta, Botswana | 99.4% | 10 | ok | scene images, calibrated (±0.6 pts on 9 passes) |
| Punjab rice–wheat belt, India | 90.3% | 26 | ok | scene images, calibrated (±0.6 pts on 25 passes) |
| Sylhet haor basin, Bangladesh | 83.1% | 12 | ok | scene images, calibrated (±0.6 pts on 12 passes) |

Per pass: Sylhet haor basin, Bangladesh.

| Pass | Acquisition mode | Box imaged | Open water, pixels this pass imaged | Open water, shared footprint (charted) |
| --- | --- | --- | --- | --- |
| 2026-06-20 | `2005_QPDH` | 83.3% | 34.9% | **34.9%** |
| 2026-07-02 | `4005_DHDH` | 100.0% | 49.2% | **50.6%** |
| 2026-07-14 | `2005_QPDH` | 83.3% | 53.3% | **53.3%** |
| 2026-07-26 | `4005_DHDH` | 100.0% | 38.5% | **39.7%** |
| 2026-08-19 | `4005_DHDH` | 100.0% | 32.2% | **34.0%** |
| 2026-08-31 | `2005_QPDH` | 83.3% | 24.0% | **24.0%** |
| 2026-09-12 | `4005_DHDH` | 100.0% | 36.3% | **37.7%** |
| 2026-09-24 | `2005_QPDH` | 83.3% | 23.1% | **23.1%** |
| 2026-10-06 | `4005_DHDH` | 100.0% | 35.1% | **37.6%** |
| 2026-10-18 | `2005_QPDH` | 83.3% | 17.2% | **17.2%** |
| 2026-10-30 | `4005_DHDH` | 100.0% | 14.7% | **15.0%** |
| 2026-11-11 | `2005_QPDH` | 83.3% | 13.7% | **13.7%** |
<!-- evidence:end -->

## 6. Site by site

What each site's NISAR record shows, what the app sums up, and what it
leaves unsaid. The numbers are in [Section 5](#5-the-numbers).

### Punjab rice–wheat belt, India

- **NISAR shows** HV backscatter climbing from −18.9 dB in November to
  −15.7 dB on 21 March, the record's largest drop between two passes
  (−3.8 dB) by 26 April, a rise to the highest values in September and a
  fall into November. The winter rise is not steady: HV dips in late
  February and early March. Very dark pixels (the open-water measure)
  reached 12.1% on one pass, 7 July, and were under 1% on every other.
  That is also the only pass that saw less than the full box (90%), and
  the April drop spans 36 days because passes are missing in between.
- **Season labels** follow FAO's crop calendar for India: wheat is
  harvested from March to May, rice sown from June to August and
  harvested from September.
- **Alongside:** rain at Ludhiana; June–August 2026 brought 50% of the
  2001–2025 normal in ERA5, the driest of 26 years.
- **Not claimed:** why the canopy changed, or any effect of the dry
  monsoon.

### Mekong Delta (An Giang), Vietnam

- **NISAR shows** open water under 0.5% from 19 June to 25 July, 9.6% by
  11 September and 8.1% on 29 October.
- **Alongside:** Mekong flow near Tan Chau and local rain.
- **Not claimed:** where the water came from. The modelled river peak
  (57,147 m³/s) looks high for this reach, so only its shape should be
  read.

### Sylhet haor basin, Bangladesh

- **NISAR shows** open water rising from 34.9% on 20 June to 53.3% on
  14 July and falling to 13.7% by 11 November, with ups and downs.
- **Coverage and mode.** Six of the 12 passes saw 83% of the box, so
  every value is computed over that shared 83%. Passes alternate
  between two acquisition modes, and from mid-August to early October
  the readings alternate with them.
- **Alongside:** rain over the basin and Surma river flow.
- **Not claimed:** that rain or the river filled the wetlands.

### Okavango Delta, Botswana

- **NISAR shows** open water at its highest on 8 July (11.0%), then
  falling or holding at every pass to 1.7% by 24 October.
- **Alongside:** modelled inflow at Mohembo, and local rain (10 mm from
  8 July to 24 October in the 9 km model).
- **Not claimed:** where the flood came from. Open water is a low-HH
  threshold, and water under papyrus or grass brightens the radar
  instead, so the share may understate the flooded area.

### Columbia Basin (Quincy–Moses Lake), Washington

- **NISAR shows** HV backscatter rising from −19.5 dB on 19 June to its
  highest value, −18.4 dB, on 18 August, then falling at every pass to
  the record's lowest, −20.9 dB, on 29 October. In the images, the bright
  circular fields darken over the same weeks.
- **Very dark pixels.** The share of pixels with HH below −18 dB, the
  open-water measure at flood sites, climbs from 0.6% on 30 August to
  11.6% on 29 October. Comparing the scene images for the two dates (red
  value below 40, the image equivalent of −18 dB) shows the new dark
  pixels in field-shaped patches across the farmland, while the only
  pixels dark on both dates are the river channel. We don't know why
  those fields went dark, and the app doesn't say.
- **Alongside:** rain at the centre of the box (36 mm from 19 June to
  29 October).
- **Not claimed:** what the fields grow or why their signal fell. The
  record starts in June 2026, so it has no spring.

### Mexico City

- **NISAR shows** the ground at Nezahualcóyotl moving 204 mm away from
  the satellite between 30 October 2025 and 13 October 2026, relative to
  the reference point at Ciudad Universitaria. A straight line through
  the passes fits at −20.0 ± 1.2 mm a month from November to April and
  −14.1 ± 0.8 mm a month from May to October. The largest single step,
  −32 mm to 16 April, was followed by a step back of +14 mm.
- **Alongside:** rain, 129 mm in the first period and 818 mm in the
  second.
- **Not claimed:** why the pace differs between the two periods. With
  one year we can't tell a seasonal effect from other changes.
  Movement is along the radar's line of sight, not straight down.

## 7. Background statements and their sources

These are the only statements in the app that don't come from our data.
They appear in "Site notes & data sources"
([`app/data/sites.json`](../app/data/sites.json)) and say where they
come from.

| Statement | Site | Source | Status |
| --- | --- | --- | --- |
| Wheat is harvested from March to May; rice is sown June to August and harvested from September. | Punjab | FAO GIEWS country brief, India (crop calendar), February 2026 | Read. |
| Published studies attribute the city's sinking to groundwater extraction. | Mexico City | Chaussard et al. (2021) | Abstract read in part. It treats the subsidence as a result of groundwater extraction and finds rates "mostly constant" since at least 1950. |
| Water under vegetation brightens L-band HH rather than darkening it. | Okavango | General radar physics ("double bounce"); not tied to one paper | **No specific source yet.** Stated as a limit of the measurement. |

## 8. Limits

- **One year, mostly provisional.** Each site has 10 to 29 passes from
  2025–26, and all but a few granules are provisional, early-mission
  products.
- **One number per box.** Each value is a median or a share over the
  whole box, which mixes fields, towns and water.
- **Coverage varies by pass** at some sites; see the hollow points.
- **Open water is one threshold** (HH below −18 dB). It misses
  wind-roughened water and water under vegetation.
- **Displacement is relative** to one reference point and along the
  line of sight, with no atmospheric correction; single steps are noisy
  (Section 5).
- **Related series are models.** Rain and river flow are model output
  for one grid cell, and two rain models disagree by 10% to 30%.
- **Site selection.** Sites were kept because their NISAR series showed
  a clear change; others were dropped
  ([Guide](GUIDE.md#sites-we-tried-and-dropped)).

## 9. Check it yourself

From the repository root, with the Python environment active:

| Command | What it does | Needs |
| --- | --- | --- |
| `python scripts/chain_evidence.py` | Prints the tables in Section 5 from the committed files. | Nothing |
| `python scripts/build_driver_data.py` | Re-fetches every rain and river series. | Network |
| `pytest tests/test_chains.py` | Fails if a moment's dates or caption no longer match the data. | Nothing |
| `curl localhost:8880/api/sites/<id>/chain` | Returns everything the story panel shows, as JSON. | The app running |
| `python scripts/extract_nisar.py --site <slug>` | Recomputes a site's NISAR values from the granules. | Earthdata Login |

## 10. References

**NISAR**

- NASA/JPL/NISAR (2026). _NISAR Provisional Geocoded Polarimetric
  Covariance Product (Version 1)_. NASA Alaska Satellite Facility
  Distributed Active Archive Center.
  <https://doi.org/10.5067/NIL2GCOV-P1>. The other collections are
  listed with their DOIs in [Section 2](#2-nisar-measurements).

**Rain and river flow**

- Zippenfenig, P. (2023). _Open-Meteo.com Weather API_ [Computer
  software]. Zenodo. <https://doi.org/10.5281/ZENODO.7970649>. API data
  are offered under CC BY 4.0.
- ECMWF. Integrated Forecasting System (IFS) forecasts, open data under
  a CC BY licence, as archived by Open-Meteo.
  <https://www.ecmwf.int/en/forecasts/datasets/open-data>
- Hersbach, H., et al. (2023). _ERA5 hourly data on single levels from
  1940 to present_ [Data set]. ECMWF.
  <https://doi.org/10.24381/cds.adbb2d47>
- Hersbach, H., et al. (2020). The ERA5 global reanalysis. _Quarterly
  Journal of the Royal Meteorological Society_, 146(730), 1999–2049.
  <https://doi.org/10.1002/qj.3803>
- Zsoter, E. (2019). _River discharge historical data from the Global
  Flood Awareness System_. ECMWF.
  <https://doi.org/10.24381/cds.a4fdd6b9>. See also
  <https://www.globalfloods.eu>.

**Background**

- FAO Global Information and Early Warning System (2026). _GIEWS
  Country Brief: India_, 13 February 2026 (crop calendar).
  <https://www.fao.org/giews/countrybrief/country.jsp?code=IND>
- Chaussard, E., Havazli, E., Fattahi, H., Cabral-Cano, E., &
  Solano-Rojas, D. (2021). Over a century of sinking in Mexico City: No
  hope for significant elevation and storage capacity recovery. _Journal
  of Geophysical Research: Solid Earth_, 126(4), e2020JB020648.
  <https://doi.org/10.1029/2020JB020648>

Each DOI above was checked against its registry record (CMR, Crossref
or DataCite) on 14 November 2026.

## 11. Corrections

- **15 November 2026, prices removed.** Earlier versions charted crop
  and oil prices beside the NISAR series and over drawn areas. Radar
  from a small area says nothing about commodity prices, so the price
  series, their sources and the panel that showed them were removed.
- **15 November 2026, gallery event claims and the cadence wording
  checked.** The land-change gallery's event descriptions were checked
  against their sources, and wording that outran the data was changed:
  - *Petermann Glacier.* The list of places checked said an ice island
    calved there in August 2026. No source for that could be found, so
    the entry now says only why there is nothing to show: NISAR's images
    end just short of 77.7° N (NASA's catalogue held GCOV granules
    reaching 77.6° N and none reaching 77.7° N on 15 November 2026), and
    Petermann is at 81° N.
  - *Etna.* The 26 June 2026 lava flow is known here only from a
    secondary report that quotes INGV's statement, so the text now says
    a flow "was reported" and the source label says what it is.
  - *Budhi Gandaki.* The 11 October 2026 event is described as the Eos
    Landslide Blog describes it: a rock slope failed and ran down the
    valley as a debris flow. The NISAR patch is still graded "likely".
  - *Rio Branco.* A statement that HV fell "about half as much" as HH
    was removed. HH is read from the 8-bit dB layer; HV exists only in
    the lossy colour images, so the app now says only that HV fell less
    than HH on the passes that have both.
  - *Headlines.* Gallery headlines that named a process ("glacier
    calving", "Floodwater spreads", "Sandbars surface") now describe
    what the images show.
  - *Cadence.* The home page said values are "measured every 12 days".
    NISAR's orbit repeats every 12 days, but every study site here has
    at least one 24-day gap (Punjab also has a 36-day one), so the page
    now says the passes are 12 or more days apart.
  - *Height profiles.* The summary of a line now flags a largest drop
    or rise that has no measured neighbour (a lone sample inside a
    gap), which the tour's line at Kīlauea has.
- **14 November 2026, story hypotheses checked against the data.** The
  first version of the stories was reviewed against the committed data
  and the sources it cites, and corrected:
  - *Mexico City.* A hypothesis said the pace is faster in the dry
    season because more water is pumped. Chaussard et al. (2021), which
    the app already cites, found "no direct relationships" between
    subsidence rates and pumping or water levels. The change of pace is
    now offered first as a possible effect of uncorrected water vapour.
    The mid-April step was also attributed to a possible
    phase-unwrapping error; at 24 cm that would be about 120 mm, not
    32 mm, so that was removed.
  - *Rio Branco.* The story said the forest "looks steady in every
    pass". Scene-median HH falls from −5.5 dB to −7.3 dB between June
    and October, over the forested pixels too. The story now reports
    that.
  - *Jakobshavn.* The text described HV, which was not collected there
    (all eleven passes are HH only), and a summer melt signal that the
    record does not clearly show.
  - *Polarizations and pixels.* Text describing "HH and HV" change maps
    now says HH, which is what the change map uses, and "20 m pixels"
    was removed where the images are 53 to 67 m.
  - *Moments and hypotheses.* Sylhet's coverage-check drop was offered
    with a drainage hypothesis, and Punjab's autumn fall with one about
    the crop growing. A finding now shows only hypotheses written for
    its moment.
  - *Titles.* Titles that stated a cause ("A flood that arrives in the
    dry season", "End of the irrigation season") now describe the
    record.
- **14 November 2026, HH-only passes drawn consistently.** In the "HH
  brightness" layer, passes collected in HH only were drawn on a −25 to
  0 dB stretch and dual-polarization passes on −20 to 0 dB, so frames
  flickered between acquisition modes under a legend that said −20 to
  0 dB. Both now use −20 to 0 dB, and a gallery place with any HH-only
  pass opens in HH.
- **14 November 2026, conclusions removed.** Earlier versions graded each
  "possible cause → NISAR" link by correlation ("Moves together", "No
  clear link") and added
  interpretation ("The haors fill with rain", "What to watch"). With one
  year of passes, mostly in one season, those labels said more than the
  data could. The app now shows the NISAR values, statistics computed
  from them, and related data on the same dates, with no verdicts.
- **14 November 2026, Mexico City's pace.** The app said the sinking
  "stayed steady through wet and dry months", based on a weak
  correlation between rain and each 12-day step. Fitting a line to each
  period instead gives −20.0 ± 1.2 mm a month from November to April
  and −14.1 ± 0.8 from May to October. The app now shows both paces and
  does not say why they differ.
- **14 November 2026, Campi Flegrei removed.** Its nine passes had a
  step-to-step noise (14.1 mm) larger than the mean step (3.0 mm), so
  the record could not show a clear change.
- **14 November 2026, rain source.** The app labelled daily rain "ERA5".
  It is ECMWF's 9 km model, which Open-Meteo serves by default for dates
  from 2017. The label is corrected and every request now names its
  model. The values, and so every correlation, are unchanged.
- **14 November 2026, Punjab's monsoon.** The app said June–August 2026
  brought "69% of normal" rain. That compared a 2026 total from the 9 km
  model with a baseline that mixed two models. With ERA5 on both sides
  the figure is 50% of the 2001–2025 normal (221.5 mm against 446.4 mm).

Earlier project notes or slides that quote "69% of normal", or "ERA5"
for the daily rain, carry the same two errors.
