"""Build the 3D globe's place names and borders from Natural Earth.

The globe draws names as screen-facing text (always upright and readable,
however the Earth is turned), so it needs them as points rather than the
raster label tiles the 2D map uses. This script reads Natural Earth's
public-domain data and writes a compact JSON file the globe loads with
itself:

* ``places``: ``[name, lon, lat, min_zoom, kind]`` for oceans and seas,
  countries, states and provinces, and about 7,300 towns and cities.
  ``min_zoom`` is the web-map zoom at which Natural Earth starts naming the
  place; the globe compares it with each name's distance from the camera.
  ``kind`` is one of ``ocean``, ``country``, ``state``, ``capital``, ``city``.
* ``borders``: country borders on land, as lists of ``[lon, lat]``.

Writes ``frontend/src/components/globe/places.json``. Usage (repo root)::

    python scripts/build_globe_places.py
    python scripts/build_globe_places.py --from-dir path/to/geojson   # already downloaded

Natural Earth: https://www.naturalearthdata.com (public domain).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import requests

SOURCE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson"
LAYERS = {
    "cities": "ne_10m_populated_places_simple",
    "countries": "ne_110m_admin_0_countries",
    "seas": "ne_110m_geography_marine_polys",
    "states": "ne_50m_admin_1_states_provinces_lakes",
    "borders": "ne_50m_admin_0_boundary_lines_land",
}
OUT = Path(__file__).resolve().parent.parent / "frontend" / "src" / "components" / "globe" / "places.json"


def load(name: str, from_dir: Path | None) -> dict:
    if from_dir:
        return json.loads((from_dir / f"{name}.geojson").read_text(encoding="utf-8"))
    resp = requests.get(f"{SOURCE}/{name}.geojson", timeout=120)
    resp.raise_for_status()
    return resp.json()


def r(v: float) -> float:
    return round(float(v), 2)


def ring_centre(coords: list) -> tuple[float, float]:
    """The area-weighted centre of a polygon's outer ring (good enough for a sea's name)."""
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(coords, coords[1:]):
        f = x0 * y1 - x1 * y0
        a += f
        cx += (x0 + x1) * f
        cy += (y0 + y1) * f
    if abs(a) < 1e-9:
        xs, ys = zip(*coords)
        return sum(xs) / len(xs), sum(ys) / len(ys)
    return cx / (3 * a), cy / (3 * a)


def largest_ring(geom: dict) -> list:
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    def size(poly):
        xs, ys = zip(*poly[0])
        return (max(xs) - min(xs)) * (max(ys) - min(ys))
    return max(polys, key=size)[0]


def seas(data: dict) -> list:
    out = []
    for f in data["features"]:
        p = f["properties"]
        name = (p.get("name_en") or p.get("name") or "").strip()
        if not name:
            continue
        lon, lat = ring_centre(largest_ring(f["geometry"]))
        out.append([name.title() if name.isupper() else name, r(lon), r(lat), float(p.get("min_label") or 1), "ocean"])
    return out


def countries(data: dict) -> list:
    return [
        [p["NAME"], r(p["LABEL_X"]), r(p["LABEL_Y"]), float(p.get("MIN_LABEL") or 3), "country"]
        for p in (f["properties"] for f in data["features"])
        if p.get("NAME") and p.get("LABEL_X") is not None
    ]


def states(data: dict) -> list:
    return [
        [p["name"], r(p["longitude"]), r(p["latitude"]), max(float(p.get("min_label") or 5), 4.0), "state"]
        for p in (f["properties"] for f in data["features"])
        if p.get("name") and p.get("latitude") is not None
    ]


def cities(data: dict) -> list:
    rows = []
    feats = sorted(data["features"], key=lambda f: -(f["properties"].get("pop_max") or 0))
    for f in feats:
        p = f["properties"]
        kind = "capital" if p.get("adm0cap") else "city"
        rows.append([p["name"], r(p["longitude"]), r(p["latitude"]), float(p.get("min_zoom") or 8), kind])
    return rows


def borders(data: dict) -> list:
    out = []
    for f in data["features"]:
        g = f["geometry"]
        lines = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
        for line in lines:
            pts = []
            for lon, lat in line:
                pt = [round(lon, 2), round(lat, 2)]
                if not pts or pts[-1] != pt:
                    pts.append(pt)
            if len(pts) >= 2:
                out.append(pts)
    return out


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--from-dir", type=Path, help="read the GeoJSON files from here instead of downloading")
    args = parser.parse_args(argv)
    data = {key: load(name, args.from_dir) for key, name in LAYERS.items()}
    out = {
        "source": "Natural Earth (public domain), naturalearthdata.com",
        "places": seas(data["seas"]) + countries(data["countries"]) + states(data["states"]) + cities(data["cities"]),
        "borders": borders(data["borders"]),
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(out['places'])} names and {len(out['borders'])} border lines -> {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
