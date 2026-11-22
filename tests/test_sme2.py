"""SME2 frames: rendering from an HDF5 file, caching, area values, images, prewarm."""
import numpy as np
import pyproj
import pytest

from app import nisar, sme2

TITLE = (
    "NISAR_L3_PR_SME2_033_083_A_007_4005_DHDH_A_"
    "20261017T223600_20261017T223634_P05023_N_F_J_001"
)
# The synthetic frame: CMR footprint bbox of the granule.
FRAME = [104.9, 10.4, 105.2, 10.7]
# An area inside it.
BBOX = [105.0, 10.5, 105.1, 10.6]
BBOX_ARG = ",".join(str(v) for v in BBOX)
GRANULE = {
    "title": TITLE,
    "start": "2026-10-17T22:36:00.000Z",
    "quality": "provisional",
    "bbox": FRAME,
    "data_url": "https://nisar.asf.earthdatacloud.nasa.gov/NISAR/x/x.h5",
}


def _write_sme2(path):
    """A small SME2-shaped file on the real EASE-Grid 2.0 (EPSG:6933) covering FRAME.

    HH -10 dB / HV -20 dB everywhere, except HH -25 dB (open water) north of
    10.575 (the northern quarter of BBOX and beyond). Soil moisture 0.3, with no retrieval west of 105.05.
    """
    import h5py

    to_ease = pyproj.Transformer.from_crs(4326, 6933, always_xy=True)
    x0, y1 = to_ease.transform(FRAME[0], FRAME[3])
    x1, y0 = to_ease.transform(FRAME[2], FRAME[1])
    x = np.arange(x0, x1, 200.0)
    y = np.arange(y1, y0, -200.0)  # rows run north to south
    shape = (y.size, x.size)
    lon, _ = to_ease.transform(x, np.full(x.shape, y[0]), direction="INVERSE")
    _, lat = to_ease.transform(np.full(y.shape, x[0]), y, direction="INVERSE")

    sm = np.full(shape, 0.3, dtype="f4")
    sm[:, lon < 105.05] = -9999.0
    hh = np.full(shape, 0.1, dtype="f4")
    hh[lat > 10.575, :] = 10 ** (-25 / 10)

    with h5py.File(path, "w") as f:
        grids = f.create_group("science/LSAR/SME2/grids")
        for group in (grids, grids.create_group("radarData/frequencyB")):
            group["projection"] = np.uint32(6933)
            group["xCoordinates"] = x
            group["yCoordinates"] = y
        grids["soilMoisture"] = sm
        radar = grids["radarData/frequencyB"]
        radar["sigma0HH"] = hh
        radar["sigma0HV"] = np.full(shape, 0.01, dtype="f4")  # -20 dB
        radar["sigma0HH"].attrs["units"] = "1"


@pytest.fixture()
def sme2_env(tmp_path, monkeypatch):
    """Cache in a temp dir, a known granule, credentials, and a local HDF5 'download'."""
    import h5py

    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(sme2, "has_credentials", lambda: True)
    monkeypatch.setattr(nisar, "granule_by_title", lambda title, product: dict(GRANULE))
    h5_path = tmp_path / "granule.h5"
    _write_sme2(h5_path)
    opened = []

    class _Counter:
        bytes_read = 1_000_000

    def _open(url, token=None, timeout=60):
        opened.append(url)
        return h5py.File(h5_path, "r"), _Counter()

    monkeypatch.setattr(sme2, "open_hdf5", _open)
    return opened


def _scene(client, bbox=BBOX_ARG):
    return client.get(f"/api/nisar/sme2/scene?granule={TITLE}&bbox={bbox}")


def test_scene_renders_the_frame_and_area_values(client, sme2_env):
    resp = _scene(client)
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    assert body["date"] == "2026-10-17"
    assert body["quality"] == "provisional"
    assert body["quality_flags_applied"] is False
    assert "fill/non-finite" in body["quality_flags_note"]
    assert body["frequency"] == "frequencyB"
    # Images cover the whole frame; the map clips them to the area.
    assert body["image_bbox"] == FRAME
    assert set(body["images"]) == {"backscatter", "soil_moisture"}
    values = body["values"]
    assert values["hv_db"] == pytest.approx(-20.0, abs=0.25)
    assert values["soil_moisture"] == pytest.approx(0.3, abs=0.003)
    # The area's northern quarter is the -25 dB "water".
    assert 15 < values["water_pct"] < 35
    assert values["hh_db"] == pytest.approx(-10.0, abs=0.25)
    # Soil moisture only exists east of 105.05: about half the area.
    assert 35 < body["valid_pct"]["soil_moisture"] < 65

    image = client.get(body["images"]["backscatter"])
    assert image.status_code == 200
    assert image.mimetype == "image/webp"
    assert image.data[:4] == b"RIFF"


def test_values_follow_the_area(client, sme2_env):
    west = _scene(client, "104.95,10.45,105.0,10.55").get_json()
    assert "soil_moisture" not in west["values"]  # no retrieval there
    assert west["values"]["water_pct"] == 0.0
    north = _scene(client, "105.0,10.64,105.1,10.69").get_json()
    assert north["values"]["water_pct"] == 100.0
    # An area outside the frame: images still come back, no values.
    away = _scene(client, "0,0,0.5,0.5").get_json()
    assert away["values"] == {}
    assert away["images"]


def test_backscatter_uses_the_gcov_site_colours(sme2_env, tmp_path):
    from PIL import Image

    from app.nisar_render import gcov_rgb

    meta = sme2.ensure_frame(TITLE)
    key = sme2.frame_key(TITLE)
    img = Image.open(tmp_path / "data" / "sme2" / key / "backscatter.webp").convert("RGBA")
    # South of the "water": HH -10 dB, HV -20 dB.
    pixel = np.array(img)[int(img.height * 0.8), img.width // 2]
    expected = gcov_rgb(np.array([0.1]), np.array([0.01]))[0]
    assert pixel[3] == 255
    # WebP is lossy; colours stay within a few levels.
    assert np.abs(pixel[:3].astype(int) - expected.astype(int)).max() <= 6
    assert meta["bbox"] == FRAME


def test_frame_is_rendered_once_for_every_area(client, sme2_env):
    first = _scene(client).get_json()
    again = _scene(client).get_json()
    other = _scene(client, "105.1,10.5,105.15,10.55").get_json()
    assert first == again
    assert other["images"] == first["images"]
    assert len(sme2_env) == 1  # the HDF5 file was read once


def test_scene_needs_earthdata_credentials(client, tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(sme2, "has_credentials", lambda: False)
    resp = _scene(client)
    assert resp.status_code == 503
    assert "EARTHDATA_TOKEN" in resp.get_json()["error"]


def test_unknown_granule_is_404(client, sme2_env, monkeypatch):
    monkeypatch.setattr(nisar, "granule_by_title", lambda title, product: None)
    assert _scene(client).status_code == 404


@pytest.mark.parametrize("query", [
    f"granule=NISAR_L2_PR_GCOV_x&bbox={BBOX_ARG}",       # not an SME2 granule
    f"granule=../../etc/passwd&bbox={BBOX_ARG}",
    f"granule={TITLE}",                                   # no bbox
    f"granule={TITLE}&bbox=0,0,40,10",                    # absurdly large
])
def test_bad_requests_are_400(client, query):
    assert client.get(f"/api/nisar/sme2/scene?{query}").status_code == 400


@pytest.mark.parametrize("path", [
    "/api/nisar/sme2/images/0123456789abcdef01234567/backscatter.webp",  # not rendered
    "/api/nisar/sme2/images/not-a-key/backscatter.webp",
    "/api/nisar/sme2/images/0123456789abcdef01234567/other.webp",
])
def test_missing_or_invalid_images_are_404(client, tmp_path, monkeypatch, path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    assert client.get(path).status_code == 404


def test_prewarm_one_renders_then_skips(sme2_env):
    res = sme2.prewarm_one(dict(GRANULE))
    assert res["status"] == "rendered"
    assert sme2.is_cached(TITLE)
    assert sme2.prewarm_one(dict(GRANULE))["status"] == "cached"
    assert len(sme2_env) == 1


def test_prewarm_one_reports_failures(sme2_env, monkeypatch):
    def _boom(*a, **k):
        raise OSError("HTTP 500 reading x")

    monkeypatch.setattr(sme2, "open_hdf5", _boom)
    res = sme2.prewarm_one(dict(GRANULE))
    assert res["status"] == "failed"
    assert not sme2.is_cached(TITLE)


def test_search_all_granules_pages_through_cmr(monkeypatch):
    from tests.test_nisar import _ENTRY

    calls = []

    class _Resp:
        def __init__(self, n, after):
            self._n, self.headers = n, ({"CMR-Search-After": after} if after else {})

        def raise_for_status(self):
            pass

        def json(self):
            return {"feed": {"entry": [_ENTRY] * self._n}}

    pages = [_Resp(2, "token-1"), _Resp(1, None)]

    def _get(url, params=None, headers=None, timeout=None):
        calls.append((dict(params), dict(headers)))
        return pages[len(calls) - 1]

    monkeypatch.setattr(nisar.requests, "get", _get)
    polygon = [[0, 0], [1, 0], [1, 1], [0, 0]]
    out = nisar.search_all_granules("SME2", polygon=polygon, page_size=2)
    assert len(out) == 3
    assert calls[0][0]["polygon"] == "0,0,1,0,1,1,0,0"
    assert "CMR-Search-After" not in calls[0][1]
    assert calls[1][1]["CMR-Search-After"] == "token-1"


def test_prewarm_cli_dry_run(app, monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    seen = {}

    def _search(product, **where):
        seen.update(where, product=product)
        return [dict(GRANULE)]

    monkeypatch.setattr(nisar, "search_all_granules", _search)
    result = app.test_cli_runner().invoke(
        args=["nisar", "sme2-prewarm", "--region", "washington", "--dry-run"],
    )
    assert result.exit_code == 0, result.output
    assert "Washington State: 1 SME2 granules on 1 frames" in result.output
    assert "1 to render" in result.output
    assert seen["product"] == "SME2"
    assert seen["polygon"][0] == seen["polygon"][-1]  # closed ring


def test_local_sme2_hdf5_import_works_without_earthdata(app, client, tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "cache"))
    monkeypatch.setattr(sme2, "has_credentials", lambda: False)
    local_file = tmp_path / f"{TITLE}.h5"
    _write_sme2(local_file)
    result = app.test_cli_runner().invoke(
        args=["nisar", "sme2-import-local", "--file", str(local_file),
              "--bbox", ",".join(map(str, FRAME))],
    )
    assert result.exit_code == 0, result.output
    scene = _scene(client).get_json()
    assert scene["source"] == "local HDF5"
    assert scene["quality"] == "unknown"
    assert scene["date"] == "2026-10-17"


def test_prewarm_cli_rejects_unknown_region(app):
    result = app.test_cli_runner().invoke(
        args=["nisar", "sme2-prewarm", "--region", "atlantis"],
    )
    assert result.exit_code != 0
    assert "washington" in result.output
