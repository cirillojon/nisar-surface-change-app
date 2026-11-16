import json
from datetime import date, timedelta

import pytest
import requests

from app import chains, db, drivers
from app.loader import NISAR_DATA_PATH
from app.models import Observation, Scene, Site, acquisition_mode


def _daily(start, values):
    return {"start": start, "values": values}


@pytest.fixture
def haor_site(app):
    site = Site(
        slug="sylhet-haor-floods", name="Sylhet haor basin", change_type="flood_wetland",
        latitude=24.9, longitude=91.3,
        min_lon=91.0, min_lat=24.6, max_lon=91.6, max_lat=25.2, product="GCOV",
    )
    db.session.add(site)
    db.session.flush()
    first = date(2026, 6, 20)
    for i, water in enumerate([35.0, 49.0, 53.0, 38.0, 24.0, 17.0, 14.0]):
        day = first + timedelta(days=12 * i)
        db.session.add(Scene(site_id=site.id, acquired_on=day, quality="provisional"))
        db.session.add(Observation(
            site_id=site.id, observed_on=day, metric="water_pct", value=water, unit="%",
        ))
    db.session.commit()
    return site


TEST_STORY = {
    "radar_metric": "water_pct",
    "drivers": [
        {"id": "rain", "kind": "rain", "label": "Rain", "place": "basin", "lat": 24.9, "lon": 91.3},
        {"id": "river", "kind": "river", "label": "River", "place": "gauge", "lat": 25.0, "lon": 91.4},
    ],
    "moments": [
        {"id": "fill", "title": "Fill", "start": "2026-06-20", "end": "2026-07-14",
         "stat": "change", "caption": "Grows.", "related": "rain"},
        {"id": "top", "title": "Top", "start": "2026-06-20", "end": "2026-08-31",
         "stat": "peak", "caption": "Highest.", "related": "river"},
        {"id": "last", "title": "Last", "start": "2026-08-31", "end": "2026-08-31",
         "stat": "value", "caption": "Latest.", "related": "rain"},
    ],
}


def test_site_story_computes_each_moment_from_the_passes(client, haor_site, monkeypatch):
    rain = [1.0] * 84
    river = [100.0] * 72 + [900.0] * 12
    monkeypatch.setitem(chains.SITE_CHAINS, "sylhet-haor-floods", TEST_STORY)
    monkeypatch.setattr(drivers, "snapshot", lambda: {"sylhet-haor-floods": {
        "rain": _daily("2026-06-09", rain),
        "river": _daily("2026-06-09", river),
    }})

    body = client.get(f"/api/sites/{haor_site.id}/chain").get_json()

    assert client.get(f"/api/sites/{haor_site.id}").get_json()["story_metric"] == "water_pct"
    assert body["available"] is True
    assert body["radar"]["points"][2] == {
        "date": "2026-07-14", "value": 53.0, "coverage": None, "quality": "provisional", "mode": None,
    }
    assert body["radar"]["layer"] == "water" and fill_layer(body) == "water"
    assert "market" not in body
    fill, top, last = body["moments"]
    assert (fill["value"], fill["display"], fill["detail"]) == (18.0, "+18.0 pts", "35.0 → 53.0%")
    # Rain over the moment's own dates: 20 Jun to 14 Jul inclusive.
    assert fill["related"] == {
        "id": "rain", "label": "Rain", "value": 25.0, "display": "25 mm", "span": "total",
    }
    assert (top["value"], top["focus"], top["detail"]) == (53.0, "2026-07-14", "Highest of 7 passes, 14 Jul")
    assert top["related"]["span"] == "average"
    assert (last["display"], last["passes"]) == ("14.0%", 1)
    assert last["related"]["span"] == "12 days to the pass"
    assert last["related"]["value"] == 12.0

    rain_driver, river_driver = body["drivers"]
    assert rain_driver["per_pass"][2] == {"date": "2026-07-14", "value": 12.0}
    assert "evidence" not in rain_driver and "claim" not in rain_driver
    assert river_driver["unit"] == "m³/s"


def fill_layer(body):
    return body["moments"][0]["layer"]


def test_open_water_story_without_enough_shared_coverage_is_unavailable_with_a_reason():
    site = {"slug": "sylhet-haor-floods", "observations": [
        {"metric": "water_visible_pct", "observed_on": "2026-07-01", "value": 10.0},
        {"metric": "water_visible_pct", "observed_on": "2026-07-13", "value": 20.0},
    ], "footprint": {"status": "insufficient", "pct_of_box": 31.0, "min_pct": 50}}
    chain = chains.get_site_chain(site, snapshot={})
    assert chain["available"] is False
    assert "31.0% of the box" in chain["reason"]


def test_rate_moment_is_a_fitted_pace_with_its_error():
    # 10 mm away from the satellite every 12 days, exactly.
    observations = [
        {"metric": "los_mm", "observed_on": (date(2026, 1, 1) + timedelta(days=12 * i)).isoformat(),
         "value": -10.0 * i}
        for i in range(8)
    ]
    story = {**chains.SITE_CHAINS["mexico-city-subsidence"], "moments": [{
        "id": "all", "title": "All", "start": "2026-01-01", "end": "2026-03-26",
        "stat": "rate", "caption": "Pace.",
    }]}
    site = {"slug": "mexico-city-subsidence", "product": "GUNW", "observations": observations}

    with pytest.MonkeyPatch.context() as mp:
        mp.setitem(chains.SITE_CHAINS, "mexico-city-subsidence", story)
        chain = chains.get_site_chain(site, snapshot={})

    pace, = chain["moments"]
    assert pace["value"] == pytest.approx(-10 / 12 * 30.44, abs=0.01)
    assert pace["display"] == "−25.4 mm/month"
    assert pace["uncertainty"] == 0
    assert pace["fit"] == {"start": 0.0, "end": -70.0}
    assert chain["radar"]["summary"] == "−70 mm in 3 months"
    assert chain["drivers"] == [] and chain["footprint"] is None
    assert pace["layer"] is None


def test_moment_dates_must_be_pass_dates():
    observations = [
        {"metric": "water_pct", "observed_on": "2026-07-01", "value": 1.0},
        {"metric": "water_pct", "observed_on": "2026-07-13", "value": 2.0},
    ]
    story = {**TEST_STORY, "moments": [{**TEST_STORY["moments"][0], "related": None}]}
    with pytest.MonkeyPatch.context() as mp:
        mp.setitem(chains.SITE_CHAINS, "sylhet-haor-floods", story)
        with pytest.raises(ValueError, match="must be NISAR pass dates"):
            chains.get_site_chain(
                {"slug": "sylhet-haor-floods", "observations": observations}, snapshot={},
            )


def test_site_without_a_chain_is_reported_unavailable(client, seeded_site):
    assert client.get(f"/api/sites/{seeded_site.id}/chain").get_json() == {
        "site_slug": "test-subsidence", "available": False,
    }
    assert client.get("/api/sites/99999/chain").status_code == 404


def _committed(slug):
    """The story for a site from the committed data files, plus its raw scenes."""
    scenes = json.loads(NISAR_DATA_PATH.read_text(encoding="utf-8"))["sites"][slug]["scenes"]
    record = json.loads(NISAR_DATA_PATH.read_text(encoding="utf-8"))["sites"][slug]
    site = {"slug": slug, "footprint": record.get("footprint"), "scenes": [
        {"date": s["date"], "valid_pct": s.get("valid_pct"), "quality": s.get("quality"),
         "mode": acquisition_mode(s.get("granule_id"))}
        for s in scenes
    ], "observations": [
        {"metric": metric, "observed_on": scene["date"], "value": value}
        for scene in scenes for metric, value in scene["values"].items()
    ]}
    return chains.get_site_chain(site), scenes


@pytest.mark.parametrize("slug", sorted(chains.SITE_CHAINS))
def test_committed_data_covers_every_story(slug):
    """Fails when a moment's dates or the driver snapshot stop matching the passes.

    After re-extracting NISAR data, rerun scripts/build_driver_data.py and
    move any moment whose dates are no longer passes.
    """
    chain, scenes = _committed(slug)

    assert len(chain["moments"]) == len(chains.SITE_CHAINS[slug]["moments"])
    configured = chains.SITE_CHAINS[slug]["drivers"]
    assert [d["id"] for d in chain["drivers"]] == [d["id"] for d in configured]
    for driver in chain["drivers"]:
        assert len(driver["per_pass"]) == len(scenes), "driver snapshot doesn't cover every pass"
    for moment in chain["moments"]:
        if chains.SITE_CHAINS[slug]["moments"][chain["moments"].index(moment)].get("related"):
            assert moment["related"] is not None, f"{moment['id']}: no related data for its dates"


def _range(moment):
    return moment["start"], moment["end"]


def _values(scenes, metric, start="0", end="9"):
    return [(s["date"], s["values"][metric]) for s in scenes if start <= s["date"] <= end]


def test_committed_captions_describe_the_data():
    """Each caption's claim, checked against the committed NISAR values."""
    punjab, scenes = _committed("punjab-crop-cycles")
    moments = {m["id"]: m for m in punjab["moments"]}
    hv = _values(scenes, "hv_db")
    steps = [(b[0], b[1] - a[1]) for a, b in zip(hv, hv[1:])]
    assert min(steps, key=lambda s: s[1])[0] == moments["april-drop"]["end"]
    assert max(hv, key=lambda p: p[1])[0] == moments["monsoon-rise"]["end"]
    winter = [v for _, v in _values(scenes, "hv_db", *_range(moments["winter-rise"]))]
    assert winter[-1] > winter[0] and any(b < a for a, b in zip(winter, winter[1:]))
    autumn = [v for _, v in _values(scenes, "hv_db", *_range(moments["autumn-fall"]))]
    assert all(b < a for a, b in zip(autumn, autumn[1:]))
    july = moments["july-water"]
    water = dict(_values(scenes, "water_pct"))
    assert [d for d, v in water.items() if v > 1] == [july["end"]]
    partial = [s["date"] for s in scenes if s["valid_pct"] < 95]
    assert partial == [july["end"]] and july["detail"].startswith("Very dark pixels")
    assert moments["april-drop"]["detail"].endswith("36 days apart")

    mekong, scenes = _committed("mekong-delta-rice")
    dry, _, stays = mekong["moments"]
    assert all(v < 1 for _, v in _values(scenes, "water_pct", dry["start"], dry["end"]))
    late = _values(scenes, "water_pct", *_range(stays))
    low = min(late, key=lambda p: p[1])
    assert low[0].startswith("2026-10-0") and low[1] < late[-1][1] < late[0][1]

    sylhet, scenes = _committed("sylhet-haor-floods")
    fill, _, mode_check = sylhet["moments"]
    assert 45 <= float(fill["detail"].split("→")[1].strip(" %")) <= 55     # "about half"
    assert sylhet["footprint"]["pct_of_box"] == 83.1
    mode = {p["date"]: p["mode"] for p in sylhet["radar"]["points"]}
    assert mode[mode_check["start"]] != mode[mode_check["end"]] and mode_check["value"] < 0
    # "From mid-August to early October the readings alternate high and low with the mode."
    run = _values(scenes, "water_pct", "2026-08-19", "2026-10-06")
    for (a, x), (b, y) in zip(run, run[1:]):
        assert mode[a] != mode[b]
        assert (y < x) == (mode[b] == "2005_QPDH")

    okavango, scenes = _committed("okavango-flood-pulse")
    high, shrink = okavango["moments"]
    water = _values(scenes, "water_pct")
    assert max(water, key=lambda p: p[1])[0] == high["end"]
    falling = [v for _, v in _values(scenes, "water_pct", shrink["start"], shrink["end"])]
    assert all(b <= a for a, b in zip(falling, falling[1:]))

    columbia, scenes = _committed("columbia-basin-crops")
    rise, fall, dark = columbia["moments"]
    hv = _values(scenes, "hv_db")
    assert max(hv, key=lambda p: p[1])[0] == rise["end"]
    falling = [v for _, v in _values(scenes, "hv_db", fall["start"], fall["end"])]
    assert all(b < a for a, b in zip(falling, falling[1:])) and min(v for _, v in hv) == falling[-1]
    assert max(v for _, v in _values(scenes, "water_pct")) == dark["value"]
    assert dark["detail"] == "Very dark pixels, 29 Oct 2026"

    mexico, scenes = _committed("mexico-city-subsidence")
    step = next(m for m in mexico["moments"] if m["id"] == "single-step")
    los = _values(scenes, "los_mm")
    moves = [(b[0], b[1] - a[1]) for a, b in zip(los, los[1:])]
    biggest = max(range(len(moves)), key=lambda i: abs(moves[i][1]))
    assert moves[biggest][0] == step["end"]
    assert 0 < moves[biggest + 1][1] < abs(moves[biggest][1])
    drier, rainier = (m for m in mexico["moments"] if m["stat"] == "rate")
    assert drier["related"]["value"] < rainier["related"]["value"]


def test_before_pass_needs_the_whole_window():
    series = _daily("2026-01-01", [1.0] * 11 + [None] + [2.0] * 12)
    assert drivers.before_pass(series, date(2026, 1, 12), "sum") is None  # gap in window
    assert drivers.before_pass(series, date(2026, 1, 11), "sum") is None  # starts before the series
    assert drivers.before_pass(series, date(2026, 1, 24), "sum") == 24.0
    assert drivers.before_pass(series, date(2026, 1, 24), "mean") == 2.0


class _Response:
    def __init__(self, text="", status_code=200, payload=None):
        self.text, self.status_code, self.payload = text, status_code, payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")

    def json(self):
        return self.payload


class _Session:
    def __init__(self, response):
        self.response = response

    def get(self, url, **kwargs):
        return self.response


class _RainSession:
    """Answers every request with 1 mm a day and records what was asked."""

    def __init__(self):
        self.models = []

    def get(self, url, params=None, **kwargs):
        self.models.append(params.get("models"))
        start = date.fromisoformat(params["start_date"])
        days = (date.fromisoformat(params["end_date"]) - start).days + 1
        return _Response(payload={
            "latitude": 31.0,
            "longitude": 75.75,
            "daily": {
                "time": [(start + timedelta(days=i)).isoformat() for i in range(days)],
                "precipitation_sum": [1.0] * days,
            },
        })


def test_rain_requests_name_one_model_per_purpose():
    session = _RainSession()

    drivers.fetch_rain(30.9, 75.85, date(2026, 6, 1), date(2026, 6, 3), session=session)
    season = drivers.seasonal_normal(
        30.9, 75.85, {"label": "June–August", "start": "06-01", "end": "08-31"}, 2026,
        baseline=(2024, 2025), session=session,
    )

    # Daily bars: the 9 km model. The normal: one reanalysis on both sides.
    assert session.models == ["ecmwf_ifs", "era5", "era5"]
    assert (season["total"], season["normal"], season["pct_of_normal"]) == (92.0, 92.0, 100)
    assert (season["source"], season["baseline"], season["years"]) == ("ERA5", "2024–2025", 3)


def test_fetch_quakes_counts_events_per_day():
    text = "\n".join([
        "#EventID|Time|Latitude|Longitude|Depth/Km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType",
        "3|2026-07-31T10:00:00|40.8|14.1|2.0|A||||Md|4.7|--|Campi Flegrei|earthquake",
        "2|2026-07-31T02:00:00|40.8|14.1|2.0|A||||Md|1.2|--|Campi Flegrei|earthquake",
        "1|2026-07-29T23:59:00|40.8|14.1|2.0|A||||Md|2.0|--|Campi Flegrei|earthquake",
    ])
    box, start, end = [14.0, 40.7, 14.2, 40.9], date(2026, 7, 29), date(2026, 7, 31)

    quakes = drivers.fetch_quakes(box, start, end, session=_Session(_Response(text)))
    assert quakes["values"] == [1, 0, 2]
    assert quakes["largest"][0] == {"date": "2026-07-31", "magnitude": 4.7}

    quiet = drivers.fetch_quakes(box, start, end, session=_Session(_Response(status_code=204)))
    assert quiet["values"] == [0, 0, 0]


AREA = {"bbox": "-117.5,46.5,-117.0,47.0", "start": "2026-08-01", "end": "2026-08-03"}


def test_area_context_returns_rain_for_the_area_centre(client, monkeypatch):
    asked = {}

    def fake_rain(lat, lon, start, end, session=None):
        asked.update(lat=lat, lon=lon, start=start, end=end)
        return {"start": "2026-08-01", "values": [0.0, 4.5, 1.5]}

    drivers.clear_cache()
    monkeypatch.setattr(drivers, "fetch_rain", fake_rain)

    response = client.get("/api/area-context", query_string=AREA)

    assert response.status_code == 200
    assert asked == {"lat": 46.75, "lon": -117.25, "start": date(2026, 8, 1), "end": date(2026, 8, 3)}
    rain, = response.json["drivers"]
    assert rain["kind"] == "rain" and rain["aggregate"] == "sum"
    assert rain["series"][1] == {"date": "2026-08-02", "value": 4.5}
    assert rain["summary"] == "6 mm over the searched dates"


def test_area_context_reports_source_failures_and_bad_requests(client, monkeypatch):
    def failing(*args, **kwargs):
        raise requests.ConnectionError("down")

    drivers.clear_cache()
    monkeypatch.setattr(drivers, "fetch_rain", failing)
    response = client.get("/api/area-context", query_string=AREA)
    assert response.status_code == 502
    assert response.json == {"error": "Rainfall data is temporarily unavailable."}

    assert client.get("/api/area-context", query_string={"bbox": AREA["bbox"]}).status_code == 400
    future = {**AREA, "start": "2999-01-01", "end": "2999-02-01"}
    assert client.get("/api/area-context", query_string=future).status_code == 400
