"""Stories, findings, CSV export and the coverage check (app/stories.py)."""
import csv
import io
import json
from datetime import date

import pytest

from app import stories
from app.stories import STORIES_PATH

CONTENT = json.loads(STORIES_PATH.read_text(encoding="utf-8"))
SITE_STORIES = [s["slug"] for s in CONTENT["stories"] if s["source"] == "site"]
LAND_STORIES = [s["slug"] for s in CONTENT["stories"] if s["source"] == "landchange"]
HYPOTHESIS_FIELDS = {"id", "driver", "mechanism", "channel", "consistent_with", "alternative", "test"}
# Words that state a cause as fact. Hypotheses must stay hypotheses.
CAUSAL = (" caused ", " causes ", " proves ", " because of ", " due to ")


@pytest.fixture
def loaded(app):
    from app import loader

    loader.load(force=True)
    return app


# ── content rules ─────────────────────────────────────────

def test_every_story_has_five_chapters_and_complete_hypotheses():
    themes = {t["id"] for t in CONTENT["themes"]}
    for story in CONTENT["stories"]:
        assert story["theme"] in themes, story["slug"]
        for key in ("title", "question", "place", "channel", "cant_see", "next"):
            assert story.get(key), (story["slug"], key)
        assert {"application", "who", "needs"} <= set(story["next"])
        assert story["hypotheses"], story["slug"]
        for h in story["hypotheses"]:
            missing = HYPOTHESIS_FIELDS - {k for k, v in h.items() if v}
            assert not missing, (story["slug"], h.get("id"), missing)


def test_hypotheses_never_state_a_cause_as_fact():
    for story in CONTENT["stories"]:
        for h in story["hypotheses"]:
            text = f" {h['mechanism']} {h['consistent_with']} ".lower()
            assert not any(w in text for w in CAUSAL), (story["slug"], h["id"])


def test_stories_cover_land_ice_and_forest():
    themes = {s["theme"] for s in CONTENT["stories"]}
    assert {"water", "food", "ground", "ice", "forest"} <= themes


def test_story_slugs_exist_in_their_sources():
    sites = {s["slug"] for s in json.loads((STORIES_PATH.parent / "sites.json").read_text(encoding="utf-8"))["sites"]}
    land = {s["slug"] for s in json.loads((STORIES_PATH.parent / "landchange.json").read_text(encoding="utf-8"))["sites"]}
    assert set(SITE_STORIES) <= sites
    assert set(LAND_STORIES) <= land


# ── API ───────────────────────────────────────────────────

def test_list_stories(client):
    body = client.get("/api/stories").get_json()
    assert body["count"] == len(CONTENT["stories"])
    water = client.get("/api/stories?theme=water").get_json()
    assert water["stories"] and all(s["theme"] == "water" for s in water["stories"])


def test_each_story_is_listed_with_its_place_and_one_of_its_own_passes(client, loaded):
    """The list's small picture is a real pass of that place, never a stand-in."""
    scenes = STORIES_PATH.parent / "scenes"
    land = {s["slug"]: s for s in stories.landchange()["sites"]}
    sites = {s["slug"]: s for s in client.get("/api/sites").get_json()["sites"]}
    for s in client.get("/api/stories").get_json()["stories"]:
        assert s["name"], s["slug"]
        prefix = "/api/scenes/"
        assert s["thumb_url"].startswith(prefix), s["slug"]
        assert (scenes / s["thumb_url"][len(prefix):]).is_file(), s["slug"]
        if s["source"] == "site":
            assert s["name"] == sites[s["slug"]]["name"]
            assert s["thumb_date"] == sites[s["slug"]]["last_date"]
            assert s["thumb_url"] == sites[s["slug"]]["thumb_url"]
        else:
            assert s["name"] == land[s["slug"]]["name"]
            assert s["thumb_date"] == land[s["slug"]]["suggested"][1]
            assert s["thumb_date"] in s["thumb_url"]


@pytest.mark.parametrize("slug", SITE_STORIES)
def test_site_story_has_moments_that_hypotheses_point_to(client, loaded, slug):
    r = client.get(f"/api/stories/{slug}")
    assert r.status_code == 200
    story = r.get_json()
    moments = story["saw"]["moments"]
    assert moments, slug
    assert 0 <= story["hero_moment"] < len(moments)
    lead = moments[story["hero_moment"]]
    if lead["stat"] == "change":
        assert [reading["date"] for reading in lead["readings"]] == [lead["start"], lead["end"]]
        assert all(reading["display"] for reading in lead["readings"])
    for h in story["hypotheses"]:
        assert h.get("moments"), (slug, h["id"])
        assert all(0 <= i < len(moments) for i in h["moments"]), (slug, h["id"])


@pytest.mark.parametrize("slug", LAND_STORIES)
def test_land_story_and_finding(client, slug):
    story = client.get(f"/api/stories/{slug}").get_json()
    assert story["saw"]["look_for"]
    gallery_site = next(site for site in stories.landchange()["sites"] if site["slug"] == slug)
    passes = {p["date"] for p in gallery_site["passes"]}
    for hypothesis in story["hypotheses"]:
        before, after = hypothesis.get("imagery_pair", story["saw"]["suggested"])
        assert before < after and {before, after} <= passes, (slug, hypothesis["id"])
    f = client.get(f"/api/findings/{slug}").get_json()
    assert f["claim"]["measured"] is False
    assert f["evidence"]["passes"]
    assert "csv" not in f["links"]


def test_unknown_story_is_404(client):
    assert client.get("/api/stories/nowhere").status_code == 404
    assert client.get("/api/findings/nowhere").status_code == 404


def test_finding_is_reproducible_and_honest(client, loaded):
    f = client.get("/api/findings/okavango-flood-pulse?moment=1").get_json()
    assert f["id"] == "okavango-flood-pulse/1"
    assert f["claim"]["measured"] is True
    assert f["claim"]["start"] <= f["claim"]["end"]
    passes = f["evidence"]["passes"]
    assert passes and all(f["claim"]["start"] <= p["date"] <= f["claim"]["end"] for p in passes)
    assert all(p["granule_id"] for p in passes)
    assert f["confidence"]["passes"] == len(passes)
    assert any("provisional" in n for n in f["confidence"]["notes"])
    assert [h["id"] for h in f["hypotheses"]] == ["dry-season-loss"]
    assert f["hypothesis_label"].startswith("Hypothesis")
    assert f["links"]["workspace"] == "/workspace?mode=stories&finding=okavango-flood-pulse:1"
    assert f["links"]["mcp"] == {"tool": "build_finding", "arguments": {"story": "okavango-flood-pulse", "moment": 1}}
    assert "ASF DAAC" in f["citation"]


def test_finding_defaults_to_the_key_moment_and_rejects_bad_ones(client, loaded):
    hero = next(s for s in CONTENT["stories"] if s["slug"] == "punjab-crop-cycles")["hero_moment"]
    assert client.get("/api/findings/punjab-crop-cycles").get_json()["moment"] == hero
    assert client.get("/api/findings/punjab-crop-cycles?moment=99").status_code == 400
    assert client.get("/api/findings/punjab-crop-cycles?moment=x").status_code == 400


@pytest.mark.parametrize("slug", SITE_STORIES)
def test_a_finding_offers_only_hypotheses_written_for_its_moment(client, loaded, slug):
    """A hypothesis about one stretch of the record must not explain another."""
    story = client.get(f"/api/stories/{slug}").get_json()
    for m in story["saw"]["moments"]:
        f = client.get(f"/api/findings/{slug}?moment={m['index']}").get_json()
        assert f["hypotheses"], (slug, m["index"], "every moment needs a hypothesis")
        assert all(m["index"] in h["moments"] for h in f["hypotheses"]), (slug, m["index"])


def test_artifact_moments_are_not_explained_by_a_physical_driver(client, loaded):
    # Sylhet's "Mode check" moment exists to flag a zigzag that lines up with the acquisition mode.
    f = client.get("/api/findings/sylhet-haor-floods?moment=2").get_json()
    assert f["claim"]["title"] == "Mode check"
    assert [h["id"] for h in f["hypotheses"]] == ["acquisition-mode"]
    assert f["confidence"]["modes"] == ["2005_QPDH", "4005_DHDH"]
    assert any("acquisition modes" in n for n in f["confidence"]["notes"])
    # Punjab's autumn fall is not explained by a hypothesis about the crop growing.
    f = client.get("/api/findings/punjab-crop-cycles?moment=4").get_json()
    assert [h["id"] for h in f["hypotheses"]] == ["rice-growth-harvest"]
    assert "harvest" in f["hypotheses"][0]["driver"].lower()


def test_open_water_findings_name_the_shared_footprint_and_keep_each_pass_value(client, loaded):
    f = client.get("/api/findings/sylhet-haor-floods?moment=2").get_json()
    assert f["evidence"]["footprint"]["pct_of_box"] == 83.1
    assert any("83.1% of the box every pass imaged" in n for n in f["confidence"]["notes"])
    first, second = f["evidence"]["passes"]
    assert (first["value"], first["visible_value"]) == (37.7, 36.3)     # full pass, shared area
    assert (second["value"], second["visible_value"]) == (23.1, 23.1)   # partial pass: its own area
    assert second["mode"] == "2005_QPDH"
    # A moment about HV is not described in terms of open water.
    f = client.get("/api/findings/punjab-crop-cycles?moment=0").get_json()
    assert f["evidence"]["footprint"] is None
    assert not any("Open water" in n for n in f["confidence"]["notes"])
    # A moment on another metric reports that metric, not the headline one.
    f = client.get("/api/findings/punjab-crop-cycles?moment=2").get_json()
    assert (f["claim"]["metric"], f["claim"]["label"]) == ("water_pct", "Very dark pixels")
    assert f["evidence"]["passes"][0]["value"] == 12.1


def test_series_csv(client, loaded):
    r = client.get("/api/stories/sylhet-haor-floods/series.csv")
    assert r.status_code == 200
    assert r.mimetype == "text/csv"
    assert "nisar-sylhet-haor-floods.csv" in r.headers["Content-Disposition"]
    rows = list(csv.DictReader(io.StringIO(r.get_data(as_text=True))))
    assert rows and list(rows[0]) == stories.CSV_COLUMNS
    assert {r["metric"] for r in rows} >= {"water_pct", "water_visible_pct"}
    shared = next(r for r in rows if r["metric"] == "water_pct" and r["date"] == "2026-09-12")
    assert shared["value"] == "37.7" and shared["acquisition_mode"] == "4005_DHDH"
    assert "shared footprint: 83.1% of the box" in shared["basis"] and "estimated" in shared["basis"]
    own = next(r for r in rows if r["metric"] == "water_visible_pct" and r["date"] == "2026-09-12")
    assert own["value"] == "36.3" and own["basis"] == "pixels this pass imaged in the box"
    assert client.get("/api/stories/jakobshavn/series.csv").status_code == 404


# ── coverage check ────────────────────────────────────────

def _granule(day, frame="172_A_168", quality="provisional"):
    return {"title": f"NISAR_L2_PR_GCOV_001_{frame}_2005_DHDH_A_{day.replace('-', '')}T000000_X",
            "start": f"{day}T04:17:17Z", "quality": quality}


def test_coverage_check_counts_frames_and_revisit(client, monkeypatch):
    days = [f"2026-{m:02d}-{d:02d}" for m, d in [(6, 1), (6, 13), (6, 25), (7, 7), (7, 19), (7, 31),
                                                  (8, 12), (8, 24), (9, 5), (9, 17)]]

    def fake_search(bbox, start, end, product="GCOV", limit=20):
        if product == "GCOV":
            return {"hits": 11, "granules": [_granule(d) for d in days] + [_granule("2026-06-04", "100_A_168")]}
        if product == "GOFF":
            raise stories.nisar.NisarSearchError("CMR is down")
        return {"hits": 0, "granules": []}

    monkeypatch.setattr(stories.nisar, "search_granules", fake_search)
    r = client.get("/api/coverage-check?bbox=22.5,-19.7,23.2,-19.1&start=2026-01-01&end=2026-10-01")
    assert r.status_code == 200
    body = r.get_json()
    gcov = next(p for p in body["products"] if p["product"] == "GCOV")
    assert gcov["best_frame"] == "172_A_168"
    assert gcov["frames"][0] == {"frame": "172_A_168", "pass_dates": 10, "median_revisit_days": 12}
    assert "seasonal series" in gcov["verdict"]
    goff = next(p for p in body["products"] if p["product"] == "GOFF")
    assert goff["error"] == "CMR is down"
    assert body["summary"] == "NISAR has GCOV passes here."


def test_coverage_check_validates_input(client):
    assert client.get("/api/coverage-check").status_code == 400
    assert client.get("/api/coverage-check?bbox=0,0,1,1&start=2020-01-01&end=2026-01-01").status_code == 400


def test_default_window_is_one_year():
    start, end = stories.default_window(None, date(2026, 11, 1))
    assert (end - start).days == 365


# ── the story text against the committed data ─────────────
#
# stories.json is hand-written, so these pin what it asserts to the data the
# app ships. If the data is regenerated and one fails, fix the text.

DATA = STORIES_PATH.parent
OBS = json.loads((DATA / "nisar_observations.json").read_text(encoding="utf-8"))["sites"]
DRIVERS = json.loads((DATA / "drivers.json").read_text(encoding="utf-8"))["sites"]
LAND = {s["slug"]: s for s in json.loads((DATA / "landchange.json").read_text(encoding="utf-8"))["sites"]}
WATER_DB = -18


def _series(slug, metric):
    return {s["date"]: s["values"][metric] for s in OBS[slug]["scenes"] if metric in s["values"]}


def _partial(slug):
    return {s["date"] for s in OBS[slug]["scenes"] if s["valid_pct"] < stories.FULL_COVERAGE}


def _driver_peak(slug, kind):
    from datetime import timedelta

    d = DRIVERS[slug][kind]
    start = date.fromisoformat(d["start"])
    i = max(range(len(d["values"])), key=lambda k: d["values"][k] or 0)
    return start + timedelta(days=i)


def _story(slug):
    return next(s for s in CONTENT["stories"] if s["slug"] == slug)


def test_okavango_text_matches_the_record():
    water, hh, hv = (_series("okavango-flood-pulse", m) for m in ("water_pct", "hh_db", "hv_db"))
    days = sorted(water)
    assert max(water, key=water.get) == "2026-07-08" and days[0] == "2026-06-26"
    after = [water[d] for d in days if d >= "2026-07-08"]
    assert all(b <= a for a, b in zip(after, after[1:]))               # "fell or held at every pass"
    assert (round(after[0], 1), round(after[-1], 1)) == (11.0, 1.7)
    assert hh[days[-1]] - hh["2026-07-08"] > 1 and hv[days[-1]] - hv["2026-07-08"] > 1
    assert _driver_peak("okavango-flood-pulse", "river").month == 2    # "peaked in February"


def _mode(slug):
    return {s["date"]: "_".join(s["granule_id"].split("_")[8:10]) for s in OBS[slug]["scenes"]}


def test_sylhet_text_matches_the_record():
    water, hh = _series("sylhet-haor-floods", "water_pct"), _series("sylhet-haor-floods", "hh_db")
    partial, mode = _partial("sylhet-haor-floods"), _mode("sylhet-haor-floods")
    assert len(partial) == 6 and len(water) == 12
    assert OBS["sylhet-haor-floods"]["footprint"]["pct_of_box"] == 83.1      # "83% of the box"
    # Every partial pass is quad-pol; every full pass is the other mode.
    assert {d for d, m in mode.items() if m == "2005_QPDH"} == partial
    assert (round(water["2026-06-20"], 1), round(water["2026-07-14"], 1)) == (34.9, 53.3)
    assert round(water["2026-07-02"], 1) == 50.6
    full = sorted(d for d in water if d not in partial)
    quad = sorted(partial)
    assert [(d, round(water[d], 1)) for d in (full[0], full[-1])] == [("2026-07-02", 50.6), ("2026-10-30", 15.0)]
    assert [(d, round(water[d], 1)) for d in (quad[1], quad[-1])] == [("2026-07-14", 53.3), ("2026-11-11", 13.7)]
    assert hh[full[-1]] - hh[full[0]] > 4
    run = ["2026-08-19", "2026-08-31", "2026-09-12", "2026-09-24", "2026-10-06"]
    assert [round(water[d], 1) for d in run] == [34.0, 24.0, 37.7, 23.1, 37.6]
    for i in (1, 3):                                                    # "both quad-pol passes ... read lower"
        assert mode[run[i]] == "2005_QPDH" and water[run[i]] < min(water[run[i - 1]], water[run[i + 1]])
    assert max(water, key=water.get) == "2026-07-14"                    # "in July ... reads the highest"
    assert date(2026, 7, 10) <= _driver_peak("sylhet-haor-floods", "river") <= date(2026, 7, 16)


def test_langtang_change_appears_only_between_the_passes_either_side_of_the_event():
    """The story says a streak of strong change appears between 19 and 31 August,
    not in the pairs before or after, starting about half a km from the reported source."""
    np = pytest.importorskip("numpy")
    Image = pytest.importorskip("PIL.Image")
    land = LAND["langtang"]
    assert land["event"]["date"] == "2026-08-26" and land["suggested"] == ["2026-08-19", "2026-08-31"]
    w, s, e, n = land["bbox"]

    def hh(day):
        p = next(x for x in land["passes"] if x["date"] == day)
        a = np.asarray(Image.open(DATA / "scenes" / p["hh"])).astype(float)
        db = -30 + a / 254 * 35
        db[a == 255] = np.nan
        return db

    def strong(a, b, k=7):
        m = (np.abs(np.nan_to_num(hh(b) - hh(a))) > 4).astype(float)
        p = np.pad(m, k // 2)
        dense = sum(p[i:i + m.shape[0], j:j + m.shape[1]] for i in range(k) for j in range(k)) / k / k
        return dense > 0.45

    assert not strong("2026-07-26", "2026-08-19").any()
    assert not strong("2026-08-31", "2026-09-12").any()
    ys, xs = np.nonzero(strong("2026-08-19", "2026-08-31"))
    assert len(xs) > 100
    rows, cols = strong("2026-08-19", "2026-08-31").shape
    km_x = (e - w) * 111.32 * np.cos(np.radians((s + n) / 2)) / cols
    km_y = (n - s) * 110.57 / rows
    sx, sy = (85.5271 - w) / (e - w) * cols, (n - 28.2921) / (n - s) * rows
    assert np.min(np.hypot((xs - sx) * km_x, (ys - sy) * km_y)) < 1.0   # "about half a kilometre"
    assert xs.mean() < sx and ys.mean() < sy                             # "runs northwest"


def test_mekong_text_matches_the_record():
    water, hh, hv = (_series("mekong-delta-rice", m) for m in ("water_pct", "hh_db", "hv_db"))
    early = [d for d in sorted(water) if d <= "2026-07-25"]
    assert all(water[d] < 0.5 for d in early)
    assert max(hh, key=hh.get) in early                                # HH brightest while no water reads
    assert hv[early[-1]] - hv[early[0]] > 1
    assert (round(water["2026-07-25"], 1), round(water["2026-09-11"], 1)) == (0.1, 9.6)
    assert date(2026, 9, 10) <= _driver_peak("mekong-delta-rice", "river") <= date(2026, 9, 20)


def test_punjab_and_columbia_text_matches_the_record():
    water, hv = _series("punjab-crop-cycles", "water_pct"), _series("punjab-crop-cycles", "hv_db")
    assert round(water["2026-07-07"], 1) == 12.1
    assert all(v < 1 for d, v in water.items() if d != "2026-07-07")
    assert min(hv, key=hv.get) == "2026-07-07"
    assert _partial("punjab-crop-cycles") == {"2026-07-07"}

    dark, hv = _series("columbia-basin-crops", "water_pct"), _series("columbia-basin-crops", "hv_db")
    assert [round(dark[d], 1) for d in ("2026-06-19", "2026-08-30", "2026-10-29")] == [6.5, 0.6, 11.6]
    late = [hv[d] for d in sorted(hv) if d >= "2026-08-30"]
    assert all(b < a for a, b in zip(late, late[1:]))                  # "fell at every pass"


def test_mexico_city_text_matches_the_record():
    los = _series("mexico-city-subsidence", "los_mm")
    days = sorted(los)
    assert round(los[days[-1]]) == -204
    i = days.index("2026-04-16")
    assert round(los[days[i]] - los[days[i - 1]]) == -32
    assert round(los[days[i + 1]] - los[days[i]]) == 14


def test_stories_name_only_the_polarizations_a_place_has(client):
    """Jakobshavn has no HV at all; Rio Branco and Etna have it on some passes only."""
    ice = client.get("/api/stories/jakobshavn").get_json()
    assert ice["site"]["channels"]["hv_passes"] == 0
    assert "HH only" in ice["channel"] and "HH only" in ice["site"]["channels"]["label"]
    for h in ice["hypotheses"]:
        assert "HV" not in h["channel"] or "not collected" in h["channel"], h["id"]
    for slug in ("rio-branco", "etna"):
        ch = client.get(f"/api/stories/{slug}").get_json()["site"]["channels"]
        assert 0 < ch["hv_passes"] < ch["passes"], slug
    assert "only some passes" in _story("rio-branco")["channel"]
    # HV there exists only in the lossy colour images: no ratio to HH is claimed.
    forest = _story("rio-branco")["hypotheses"][0]["consistent_with"]
    assert "fell less than HH" in forest and "half" not in forest
    assert LAND["etna"]["passes"][0]["polarizations"] == "HH"            # "the first pass ... is HH only"
    assert LAND["budhi-gandaki"]["status"] == "likely"                  # the story must not call it confirmed
    assert "likely, not confirmed" in _story("budhi-gandaki")["hypotheses"][0]["consistent_with"]


def test_gallery_story_text_matches_the_images():
    np = pytest.importorskip("numpy")
    Image = pytest.importorskip("PIL.Image")

    def hh(slug, day):
        p = next(x for x in LAND[slug]["passes"] if x["date"] == day)
        a = np.asarray(Image.open(DATA / "scenes" / p["hh"]).convert("L")).astype(float)
        db = -30 + a / 254 * 35                                         # 8-bit dB, as in scripts/build_landchange.py
        db[a == 255] = np.nan
        return db

    def medians(slug):
        return {p["date"]: float(np.nanmedian(hh(slug, p["date"]))) for p in LAND[slug]["passes"]}

    def left_dark(slug, a, b):
        """Share of pixels dark (water-like) on date a that aren't on date b."""
        x, y = hh(slug, a), hh(slug, b)
        was = (x < WATER_DB) & ~np.isnan(y)
        return float(((y >= WATER_DB) & was).sum() / was.sum())

    rio = medians("rio-branco")
    assert (round(rio["2026-06-18"], 1), round(rio["2026-10-28"], 1)) == (-5.5, -7.3)
    assert 0.4 < left_dark("rio-branco", "2026-06-18", "2026-10-28") < 0.6          # "half the pixels"
    for other in ("etna", "jamuna"):                                                 # "no such decline"
        m = medians(other)
        days = sorted(m)
        assert m[days[-1]] - m[days[0]] > -0.5, other

    ice = medians("jakobshavn")
    assert max(ice.values()) - min(ice.values()) < 1.5                               # "within about 1.5 dB"

    assert 0.55 < left_dark("jamuna", "2026-06-18", "2026-11-09") < 0.75             # "about two-thirds"
    dark = {p["date"]: float(np.nanmean(hh("jamuna", p["date"]) < WATER_DB)) for p in LAND["jamuna"]["passes"]}
    assert min(dark, key=dark.get) == "2026-08-17"                                   # lowest at the monsoon's height
