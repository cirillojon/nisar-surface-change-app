"""The global coverage heatmap: building the grid and serving it."""
import base64
import gzip
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_coverage_map as build  # noqa: E402

from app import coverage_map  # noqa: E402

# A 2x2° square straddling four 1° cells' centers (lon 10-12, lat 40-42).
_SQUARE = "10,40 12,40 12,42 10,42 10,40"


def _gcov(track, direction, frame, stamp, mode="4005_DHDH_A"):
    return f"NISAR_L2_PR_GCOV_030_{track}_{direction}_{frame}_{mode}_{stamp}_{stamp}_P05023_N_F_J_001"


def test_pass_of_dates_single_and_pair_products():
    assert build.pass_of(_gcov("004", "A", "018", "20261029T111130"), "GCOV") == (
        "004", "A", (date(2026, 10, 29),),
    )
    gunw = ("NISAR_L2_PR_GUNW_032_139_D_091_033_4000_SH_20261009T203740_20261009T203744_"
            "20261021T203740_20261021T203744_P05023_N_P_J_001")
    # A pair keeps both dates and is counted on its later one.
    assert build.pass_of(gunw, "GUNW") == ("139", "D", (date(2026, 10, 9), date(2026, 10, 21)))
    assert build.pass_of("not_a_nisar_name", "GCOV") is None


def test_cells_of_footprint_and_antimeridian():
    cells = build.cells_of(build.parse_coords(_SQUARE))
    rows_cols = sorted(divmod(c, build.COLS) for c in cells)
    # Centers 10.5/11.5°E and 40.5/41.5°N: rows 48-49 (from 90°N), columns 190-191.
    assert rows_cols == [(48, 190), (48, 191), (49, 190), (49, 191)]

    across = build.cells_of(build.parse_coords("179,0 -179,0 -179,1 179,1 179,0"))
    assert sorted(c % build.COLS for c in across) == [0, 359]

    tiny = build.cells_of(build.parse_coords("10.1,40.1 10.2,40.1 10.2,40.2 10.1,40.1"))
    assert len(tiny) == 1


def test_aggregate_counts_each_pass_once():
    rows = [
        # One pass: two frames on the same track and day, overlapping.
        (_gcov("004", "A", "018", "20261003T111130"), _SQUARE),
        (_gcov("004", "A", "019", "20261003T111150"), "11,41 13,41 13,43 11,43 11,41"),
        # The same acquisition in another mode (and a validated copy).
        (_gcov("004", "A", "018", "20261003T111130", mode="2005_DVDV_A"), _SQUARE),
        # A descending pass later in the month.
        (_gcov("100", "D", "050", "20261020T010101"), _SQUARE),
        # Next month.
        (_gcov("004", "A", "018", "20261115T111130"), _SQUARE),
    ]
    months, arrays, stats = build.aggregate({"GCOV": rows}, date(2026, 11, 20))
    assert months == ["2026-10", "2026-11"]
    assert stats["GCOV"]["passes"] == 3  # (004,A,Oct 3), (100,D,Oct 20), (004,A,Nov 15)
    passes, asc, last = arrays["GCOV_passes"], arrays["GCOV_asc"], arrays["GCOV_last"]
    # Cell at 41.5°N 11.5°E is under both overlapping frames: still one pass on Oct 3.
    assert passes[0, 48, 191] == 2
    assert asc[0, 48, 191] == 1
    assert last[0, 48, 191] == 20
    assert passes[1, 48, 191] == 1
    # Only the second frame reaches 42.5°N 12.5°E.
    assert passes[0, 47, 192] == 1 and last[0, 47, 192] == 3


@pytest.fixture()
def coverage_file(tmp_path, monkeypatch):
    rows = [
        (_gcov("004", "A", "018", "20261003T111130"), _SQUARE),
        (_gcov("100", "D", "050", "20261020T010101"), _SQUARE),
        (_gcov("004", "A", "018", "20261115T111130"), _SQUARE),
    ]
    months, arrays, stats = build.aggregate({"GCOV": rows}, date(2026, 11, 20))
    meta = {"generated_at": "2026-11-20T12:00:00Z", "source": "test", "cell_deg": 1,
            "months": months, "products": stats}
    path = tmp_path / "coverage_map.npz"
    np.savez_compressed(path, meta=np.array(json.dumps(meta)), **arrays)
    monkeypatch.setattr(coverage_map, "DATA_PATH", path)
    return path


def _decode(result):
    raw = np.frombuffer(base64.b64decode(result["values"]), dtype="<u2").reshape(result["height"], result["width"])
    return np.where(raw == result["nodata"], np.nan, raw * result["scale"])


@pytest.mark.usefixtures("coverage_file")
def test_grid_metrics():
    month = coverage_map.grid("GCOV", "passes", "2026-10", "month")
    assert (month["start"], month["end"]) == ("2026-10-01", "2026-10-31")
    grid = _decode(month)
    assert grid[48, 190] == 2 and np.isnan(grid[0, 0])

    total = _decode(coverage_map.grid("GCOV", "passes", "2026-11", "cumulative"))
    assert total[48, 190] == 3

    # The latest month ends on the day the counts were made.
    revisit = coverage_map.grid("GCOV", "days_per_pass", "2026-11", "month")
    assert revisit["end"] == "2026-11-20"
    assert _decode(revisit)[48, 190] == pytest.approx(20.0)

    assert _decode(coverage_map.grid("GCOV", "ascending_pct", "2026-10"))[48, 190] == 50
    # Oct 31 - Oct 20, and Nov 20 - Nov 15.
    assert _decode(coverage_map.grid("GCOV", "days_since", "2026-10"))[48, 190] == 11
    assert _decode(coverage_map.grid("GCOV", "days_since", "2026-11"))[48, 190] == 5


@pytest.mark.usefixtures("coverage_file")
def test_grid_endpoint(client):
    resp = client.get("/api/nisar/coverage-map/grid?product=GCOV&metric=passes&window=cumulative",
                      headers={"Accept-Encoding": "gzip"})
    assert resp.status_code == 200
    assert resp.headers["Content-Encoding"] == "gzip"
    body = json.loads(gzip.decompress(resp.data))
    assert body["month"] == "2026-11" and body["stats"]["max"] == 3

    info = client.get("/api/nisar/coverage-map").get_json()
    assert info["months"] == ["2026-10", "2026-11"]
    assert [m["id"] for m in info["metrics"]] == list(coverage_map.METRICS)
    assert [p["id"] for p in info["products"]] == ["GCOV"]

    for query in ("metric=nope", "product=XYZ", "month=2020-01", "window=year"):
        assert client.get(f"/api/nisar/coverage-map/grid?{query}").status_code == 400


def test_missing_file_is_503(client, monkeypatch, tmp_path):
    monkeypatch.setattr(coverage_map, "DATA_PATH", tmp_path / "missing.npz")
    assert client.get("/api/nisar/coverage-map").status_code == 503
    assert client.get("/api/nisar/coverage-map/grid").status_code == 503
