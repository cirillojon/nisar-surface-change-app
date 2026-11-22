"""Height profiles along a line: geometry, pair chains, displacement history, job API."""
import time

import numpy as np
import pytest

from app import profiles


def _title(ref, sec, frame="034_A_020"):
    r, s = ref.replace("-", ""), sec.replace("-", "")
    track, ad, fr = frame.split("_")
    return (f"NISAR_L2_PR_GUNW_006_{track}_{ad}_{fr}_007_4000_SH_"
            f"{r}T130824_{r}T130859_{s}T130825_{s}T130900_P05023_N_F_J_001")


def _granule(ref, sec, frame="034_A_020", footprint=None):
    return {
        "title": _title(ref, sec, frame),
        "quality": "provisional",
        "data_url": "https://example.test/x.h5",
        "footprint": footprint or [[35, -121], [35, -119], [37, -119], [37, -121]],
    }


# ─── Geometry ────────────────────────────────────────────────────────

@pytest.mark.parametrize("line, message", [
    ([[0, 0]], "2 to 50"),
    ("nope", "2 to 50"),
    ([[0, 0], ["a", 1]], "[lon, lat]"),
    ([[0, 0], [True, 1]], "[lon, lat]"),
    ([[0, 0], [200, 0]], "within"),
    ([[0, 0], [0.001, 0]], "at least 1 km"),
    ([[0, 0], [2, 0]], "at most 100 km"),
])
def test_validate_line_rejects_bad_lines(line, message):
    with pytest.raises(ValueError, match=message):
        profiles.validate_line(line)


def test_sample_line_spaces_points_along_every_vertex():
    line = profiles.validate_line([[-120.0, 36.0], [-119.9, 36.0], [-119.9, 36.1]])
    lon, lat, dist = profiles.sample_line(line)
    assert (lon[0], lat[0]) == (-120.0, 36.0)
    assert lon[-1] == pytest.approx(-119.9) and lat[-1] == pytest.approx(36.1)
    assert dist[-1] == pytest.approx(9.0 + 11.06, abs=0.1)
    assert np.diff(dist).max() <= profiles.SPACING_KM + 1e-9
    # Passes through the corner.
    assert np.min(np.hypot(lon + 119.9, lat - 36.0)) < 0.002


def test_profile_id_depends_on_the_line():
    a = profiles.profile_id([[0, 0], [0.1, 0]])
    assert a == profiles.profile_id([[0, 0], [0.1, 0]])
    assert a != profiles.profile_id([[0, 0], [0.1, 0.01]])
    assert len(a) == 20 and a.isalnum()


def test_line_profile_uses_fixed_ionosphere_correction_not_minimum_scatter():
    assert profiles.choose_correction({
        "none": 1.0, "ionosphere": 8.0, "troposphere": 5.0,
        "ionosphere + troposphere": 2.0,
    }) == "ionosphere"
    with pytest.raises(profiles.ProfileError, match="not unwrapped"):
        profiles.choose_correction({"ionosphere": float("nan")})


def test_phase_conversion_preserves_documented_los_sign():
    result = profiles.phase_to_los_mm(np.array([1.0, -1.0]), 0.24)
    assert result[0] < 0  # negative is away; positive is toward
    assert result[1] > 0


# ─── Pairs and frames ────────────────────────────────────────────────

def test_chains_cover_the_full_record_without_overlap():
    gs = [_granule(a, b) for a, b in [
        ("2025-11-01", "2025-11-13"), ("2025-11-13", "2025-11-25"), ("2025-11-25", "2025-12-07"),
        # A gap, then a second run.
        ("2026-01-06", "2026-01-18"), ("2026-01-18", "2026-01-30"),
        # Overlaps the first run: not used.
        ("2025-11-13", "2025-12-07"),
    ]]
    cs = profiles.chains(gs)
    assert [len(c) for c in cs] == [3, 2]
    assert profiles._dates(cs[0][0]["title"]) == ("2025-11-01", "2025-11-13")
    assert profiles._dates(cs[1][-1]["title"]) == ("2026-01-18", "2026-01-30")


def test_pick_frame_needs_full_coverage_and_prefers_more_pairs():
    lon, lat = np.array([-120.5, -120.0]), np.array([36.0, 36.0])
    small = [[35, -120.2], [35, -119], [37, -119], [37, -120.2]]  # misses one point
    gs = [
        _granule("2025-11-01", "2025-11-13", "001_A_001"),
        _granule("2025-11-13", "2025-11-25", "001_A_001"),
        _granule("2025-11-01", "2025-11-13", "002_A_002", small),
        _granule("2025-11-13", "2025-11-25", "002_A_002", small),
        _granule("2025-11-25", "2025-12-07", "002_A_002", small),
    ]
    frame, cs = profiles.pick_frame(gs, lon, lat)
    assert frame == "001_A_001"
    assert sum(len(c) for c in cs) == 2
    assert profiles.pick_frame(gs[2:], lon, lat) == (None, [])


# ─── Displacement history ────────────────────────────────────────────

def _pairs(dates, vel_per_point, valid=None, noise=0.0, rng=None):
    """Synthetic chain: points move linearly at vel_per_point (mm/yr)."""
    from datetime import date

    out = []
    for i, (a, b) in enumerate(zip(dates, dates[1:])):
        dt = (date.fromisoformat(b) - date.fromisoformat(a)).days / 365.25
        step = np.asarray(vel_per_point) * dt + 7.0  # + common offset (removed by referencing)
        if noise:
            step = step + rng.normal(0, noise, step.shape)
        v = np.ones(len(step), bool) if valid is None else valid[i]
        out.append({
            "ref": a, "sec": b, "valid": v,
            "raw": np.where(v, step, 0.0), "iono": np.zeros(len(step)), "tropo": np.zeros(len(step)),
        })
    return out


def _dates(start_month, n, year=2025):
    from datetime import date, timedelta

    d0 = date(year, start_month, 1)
    return [(d0 + timedelta(days=12 * k)).isoformat() for k in range(n)]


def test_history_recovers_velocity_and_starts_at_zero():
    vel = np.array([-120.0, 0.0, 60.0])  # mm/yr; relative to the line median (0)
    chain = _pairs(_dates(11, 15), vel)
    dates, disp, v, scatter, _ = profiles.displacement_history([chain], ())
    assert len(dates) == 15
    assert v == pytest.approx(vel, abs=1e-6)
    assert disp[0] == pytest.approx([0, 0, 0])
    assert disp[-1][0] == pytest.approx(-120.0 * (14 * 12) / 365.25, abs=1e-6)
    assert scatter == pytest.approx(0, abs=1e-6)


def test_history_bridges_a_missed_pair_and_separate_chains():
    vel = np.array([-100.0, 0.0, 50.0, 10.0])
    valid = [np.ones(4, bool) for _ in range(9)]
    valid[4] = np.array([True, True, True, False])  # point 3 not unwrapped in pair 4
    first = _pairs(_dates(11, 10), vel, valid)
    second = _pairs(_dates(4, 8, year=2026), vel)  # after a gap
    dates, disp, v, *_ = profiles.displacement_history([first, second], ())
    assert v == pytest.approx(vel, abs=1e-6)
    # Point 3 keeps a full record; the missed pair's end date is aligned by the fit.
    assert np.isfinite(disp[:, 3]).sum() >= len(dates) - 1
    # The second chain continues the trend instead of restarting at zero.
    from datetime import date

    i = dates.index(second[0]["ref"])
    years = (date.fromisoformat(dates[i]) - date.fromisoformat(dates[0])).days / 365.25
    assert disp[i][0] == pytest.approx(-100.0 * years, abs=1e-6)
    assert disp[-1][0] < disp[i][0] < disp[9][0] < 0


def test_history_reports_each_points_scatter():
    rng = np.random.default_rng(1)
    chain = _pairs(_dates(11, 20), np.zeros(30), noise=2.0, rng=rng)
    chain_bad = chain
    for p in chain_bad:  # point 0 is wildly inconsistent (e.g. new lava)
        p["raw"] = p["raw"].copy()
        p["raw"][0] += rng.normal(0, 200)
    *_, median, per_point = profiles.displacement_history([chain_bad], ())
    assert per_point.shape == (30,)
    assert per_point[0] > profiles.UNRELIABLE_FACTOR * median
    assert (per_point[1:] < profiles.UNRELIABLE_FACTOR * median).all()


def test_history_measures_the_scatter_left_by_noise():
    rng = np.random.default_rng(0)
    chain = _pairs(_dates(11, 26), np.zeros(50), noise=5.0, rng=rng)
    *_, scatter, _ = profiles.displacement_history([chain], ())
    assert 4 < scatter < 12  # random-walk errors leave several mm about a line


# ─── Job API ─────────────────────────────────────────────────────────

LINE = [[-119.95, 36.02], [-119.30, 36.22]]


@pytest.fixture()
def jobs(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("EARTHDATA_TOKEN", "test-token")
    calls = []

    def _compute(line, progress=lambda **p: None, workers=4):
        calls.append(line)
        progress(stage="Reading NISAR data", done=1, total=2)
        return {"id": profiles.profile_id(line), "line": line, "noise_mm": 9.9}

    monkeypatch.setattr(profiles, "compute", _compute)
    return calls


def _wait(client, pid, timeout=5):
    end = time.time() + timeout
    while time.time() < end:
        body = client.get(f"/api/nisar/profiles/{pid}").get_json()
        if body["state"] in ("done", "error"):
            return body
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_profile_job_runs_and_is_cached(client, jobs):
    resp = client.post("/api/nisar/profiles", json={"line": LINE})
    assert resp.status_code == 202
    pid = resp.get_json()["id"]
    body = _wait(client, pid)
    assert body["state"] == "done"
    assert body["result"]["noise_mm"] == 9.9
    again = client.post("/api/nisar/profiles", json={"line": LINE})
    assert again.status_code == 200 and again.get_json()["state"] == "done"
    assert len(jobs) == 1


def test_profile_job_reports_errors(client, jobs, monkeypatch):
    def _fail(line, progress=lambda **p: None, workers=4):
        raise profiles.ProfileError("No single NISAR track/frame covers this whole line")

    monkeypatch.setattr(profiles, "compute", _fail)
    pid = client.post("/api/nisar/profiles", json={"line": LINE}).get_json()["id"]
    body = _wait(client, pid)
    assert body["state"] == "error"
    assert "track/frame" in body["error"]


def test_profile_api_validates_input(client, jobs):
    assert client.post("/api/nisar/profiles", json={"line": [[0, 0]]}).status_code == 400
    assert client.post("/api/nisar/profiles", data="nope").status_code == 400
    assert client.get("/api/nisar/profiles/notanid").status_code == 404
    assert client.get("/api/nisar/profiles/0123456789abcdef0123").status_code == 404


def test_profile_needs_earthdata_credentials(client, tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("EARTHDATA_TOKEN", raising=False)
    monkeypatch.setattr(profiles, "_netrc", lambda: False)
    resp = client.post("/api/nisar/profiles", json={"line": LINE})
    assert resp.status_code == 503
    assert "EARTHDATA_TOKEN" in resp.get_json()["error"]

def test_tour_line_ships_with_its_result(client, tmp_path, monkeypatch):
    # The guided tour's line opens instantly, even without Earthdata access.
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("EARTHDATA_TOKEN", raising=False)
    monkeypatch.setattr(profiles, "_netrc", lambda: False)
    tour_line = [[-155.335, 19.392], [-155.235, 19.425]]
    resp = client.post("/api/nisar/profiles", json={"line": tour_line})
    assert resp.status_code == 200 and resp.get_json()["state"] == "done"
    body = client.get(f"/api/nisar/profiles/{resp.get_json()['id']}").get_json()
    result = body["result"]
    assert result["frame"] and len(result["dates"]) > 10
    assert result["points"]["hidden"] > 0  # the resurfaced crater is masked
