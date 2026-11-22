"""Open water over the footprint every pass saw.

``extract_nisar.py`` reads each pass over a site's box. Passes do not always
image the same part of the box: at Sylhet six of twelve passes image 83% of
it. A share of open water computed over *each pass's own* pixels then mixes
a change of area with a change of water. This module recomputes the share
over the pixels that **every** pass in the series imaged (the shared
footprint), so the values on a chart are comparable:

* ``water_pct``: open-water share of the shared footprint (what is charted);
* ``water_visible_pct``: the share of the pixels that pass imaged (kept for
  provenance; it is what earlier versions charted as ``water_pct``).

A pixel is *unobserved* if the pass did not image it, *observed, not water*
if HH >= -18 dB, and *observed water* if HH < -18 dB. Unobserved pixels are
never counted as dry or wet: they are left out of the shared footprint. If
the shared footprint is under ``MIN_SHARED_FRACTION`` of the box, no
comparable value is written (``status: "insufficient"``) rather than
replacing it with something else.

Two sources of pixels:

* **exact**: per-pass class masks (``<date>.mask.png``: 0 unobserved,
  1 observed not water, 2 observed water) written by ``extract_nisar.py``
  from the HDF5 granules.
* **image**: when the granules can't be re-read (no Earthdata Login), the
  committed scene images. Their alpha channel *is* the exact valid mask
  (WebP stores alpha losslessly); their red channel is HH on a fixed
  stretch, but lossy compression moves some pixels across the -18 dB
  threshold. So each pass's threshold is calibrated to reproduce that
  pass's exact share over its own pixels (computed from the HDF5 by
  ``extract_nisar.py``); only the split between the shared footprint and
  the rest is estimated. A pass whose own pixels *are* the shared
  footprint gets its exact value back. ``--validate`` measures the error of
  the estimate by simulating the same compression on the gallery's lossless
  HH layers (real NISAR texture).

Usage (repo root, venv active)::

    python scripts/shared_footprint.py                 # every GCOV site, from the images
    python scripts/shared_footprint.py --site sylhet-haor-floods
    python scripts/shared_footprint.py --validate      # error of the image method

Then ``flask nisar load --force``.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app.nisar_render import STRETCH_DB, WATER_HH_DB, encode_webp, gcov_rgb  # noqa: E402

OUT_PATH = ROOT / "app" / "data" / "nisar_observations.json"
SCENES_DIR = ROOT / "app" / "data" / "scenes"
LANDCHANGE_PATH = ROOT / "app" / "data" / "landchange.json"

UNOBSERVED, DRY, WATER = 0, 1, 2
# Below this share of the box seen by every pass, no comparable value is given.
MIN_SHARED_FRACTION = 0.5
# 99th percentile of the image method's error in --validate (percentage points),
# rounded up. Applies only to passes that imaged more than the shared footprint.
IMAGE_UNCERTAINTY_PP = 0.6
FOOTPRINT_NAME = "footprint.png"
GCOV_METHOD = (
    "GCOV frequency B HHHH / HVHV layers. Positive linear power is converted with 10 log10; "
    "grid spacing and bandwidth vary with acquisition mode. hh_db / hv_db: median backscatter of the "
    "pixels each pass imaged in the bbox. water_visible_pct: share of the pixels that pass "
    f"imaged with HH < {WATER_HH_DB} dB. water_pct: the same share over the pixels every "
    "pass in the series imaged (site 'footprint'; scripts/shared_footprint.py), so passes "
    "are compared over the same ground. Image: R = HH, G = HV, B = HH/HV, fixed "
    f"stretches (dB) {json.dumps(STRETCH_DB)}."
)


# ─── masks ───────────────────────────────────────────────────────────

def classes(valid: np.ndarray, water: np.ndarray) -> np.ndarray:
    """0 unobserved, 1 observed not water, 2 observed water."""
    out = np.full(valid.shape, UNOBSERVED, dtype=np.uint8)
    out[valid] = DRY
    out[valid & water] = WATER
    return out


def write_mask(path: Path, mask: np.ndarray):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(mask.astype(np.uint8), "L").save(path, optimize=True)


def read_mask(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path))


def shared_of(valids: list[np.ndarray]) -> np.ndarray:
    if not valids:
        raise ValueError("no passes")
    shapes = {v.shape for v in valids}
    if len(shapes) != 1:
        raise ValueError(f"passes are on different grids: {sorted(shapes)}")
    return np.logical_and.reduce(valids)


# ─── image method ────────────────────────────────────────────────────

WATER_RED = ((WATER_HH_DB - STRETCH_DB["hh"][0]) / (STRETCH_DB["hh"][1] - STRETCH_DB["hh"][0])) ** 0.8 * 255


def calibrated_share(red: np.ndarray, valid: np.ndarray, shared: np.ndarray, target_pct: float) -> float:
    """Share of ``shared`` that is water, with the threshold set so that the
    share of ``valid`` is exactly ``target_pct``.

    The ``target_pct`` darkest valid pixels are water. Pixels tied at the
    threshold count fractionally, so the result is exact when
    ``shared == valid`` and doesn't depend on pixel order.
    """
    values = red[valid].astype(float)
    n = values.size
    k = min(max(target_pct, 0.0), 100.0) / 100 * n
    ordered = np.sort(values)
    t = ordered[min(int(np.floor(k)), n - 1)]
    below, tied = int((values < t).sum()), int((values == t).sum())
    frac = 0.0 if not tied else min(max((k - below) / tied, 0.0), 1.0)
    inside = red[shared].astype(float)
    return float(((inside < t).sum() + frac * (inside == t).sum()) / inside.size * 100)


def _decode(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGBA"))


# ─── applying ────────────────────────────────────────────────────────

def _visible(scene: dict) -> float:
    values = scene["values"]
    return values["water_visible_pct"] if "water_visible_pct" in values else values["water_pct"]


def footprint_image(shared: np.ndarray) -> Image.Image:
    """Transparent over the shared footprint; hatched where some pass saw nothing."""
    h, w = shared.shape
    yy, xx = np.mgrid[:h, :w]
    stripe = (xx + yy) % 10 < 4
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    out = ~shared
    rgba[out & stripe] = (15, 23, 42, 170)
    rgba[out & ~stripe] = (15, 23, 42, 90)
    return Image.fromarray(rgba, "RGBA")


def apply(entry: dict, slug: str, valids: list[np.ndarray], shares, *, method: str,
          scenes_dir: Path = SCENES_DIR) -> dict:
    """Write the shared-footprint values into a site entry of nisar_observations.json.

    ``shares(shared) -> list[float]``: each pass's water share of ``shared``.
    """
    scenes = entry["scenes"]
    shared = shared_of(valids)
    fraction = float(shared.mean())
    for scene in scenes:
        scene["values"]["water_visible_pct"] = round(_visible(scene), 1)
        scene["values"].pop("water_pct", None)
    footprint = {
        "passes": len(scenes),
        "pct_of_box": round(fraction * 100, 1),
        "min_pct": round(MIN_SHARED_FRACTION * 100),
        "method": method,
        "image": None,
    }
    image_path = scenes_dir / slug / FOOTPRINT_NAME
    if fraction < MIN_SHARED_FRACTION:
        footprint["status"] = "insufficient"
        if image_path.exists():
            image_path.unlink()
        entry["footprint"] = footprint
        return footprint
    footprint["status"] = "ok"
    larger = [s["date"] for s, v in zip(scenes, valids) if (v & ~shared).any()]
    for scene, share in zip(scenes, shares(shared)):
        scene["values"]["water_pct"] = round(share, 1)
    if method == "image":
        footprint["estimated"] = larger
        footprint["uncertainty_pp"] = IMAGE_UNCERTAINTY_PP
    if fraction < 0.9995:
        footprint_image(shared).save(image_path, optimize=True)
        footprint["image"] = f"{slug}/{FOOTPRINT_NAME}"
    elif image_path.exists():
        image_path.unlink()
    entry["footprint"] = footprint
    return footprint


def apply_from_masks(entry: dict, slug: str, scenes_dir: Path = SCENES_DIR) -> dict:
    masks = [read_mask(scenes_dir / s["mask"]) for s in entry["scenes"]]
    valids = [m != UNOBSERVED for m in masks]

    def shares(shared):
        return [float((m[shared] == WATER).mean() * 100) for m in masks]

    return apply(entry, slug, valids, shares, method="exact", scenes_dir=scenes_dir)


def apply_from_images(entry: dict, slug: str, scenes_dir: Path = SCENES_DIR) -> dict:
    images = [_decode(scenes_dir / s["image"]) for s in entry["scenes"]]
    valids = [im[..., 3] > 127 for im in images]
    targets = [_visible(s) for s in entry["scenes"]]

    def shares(shared):
        return [calibrated_share(im[..., 0], v, shared, t) for im, v, t in zip(images, valids, targets)]

    return apply(entry, slug, valids, shares, method="image", scenes_dir=scenes_dir)


def has_water(entry: dict) -> bool:
    return entry.get("product") == "GCOV" and all(
        "water_pct" in s["values"] or "water_visible_pct" in s["values"] for s in entry.get("scenes", [])
    ) and bool(entry.get("scenes"))


def apply_site(entry: dict, slug: str, scenes_dir: Path = SCENES_DIR) -> dict:
    """Exact masks when every pass has one, else the images."""
    if all(s.get("mask") and (scenes_dir / s["mask"]).is_file() for s in entry["scenes"]):
        return apply_from_masks(entry, slug, scenes_dir)
    return apply_from_images(entry, slug, scenes_dir)


# ─── validation of the image method ──────────────────────────────────

def _regions(shape):
    h, w = shape
    yy, xx = np.mgrid[:h, :w]
    return [xx < w * 0.83, xx > w * 0.17, yy < h * 0.83, (xx + yy) < (w + h) * 0.8,
            (xx - yy + h) > (w + h) * 0.2, (xx > w * 0.3) & (yy > h * 0.3)]


def validate(landchange_path: Path = LANDCHANGE_PATH, scenes_dir: Path = SCENES_DIR,
             slugs: list[str] | None = None, min_water_pct: float = 2.0) -> dict:
    """Error of ``calibrated_share`` against exact truth.

    Truth is the gallery's lossless 8-bit HH layer (real NISAR texture,
    -30..+5 dB). It is drawn with the sites' colour stretch (HV from the
    pass's colour image), encoded with the sites' WebP settings, decoded,
    and the calibrated estimate over sub-areas is compared with the exact
    share of the truth over the same sub-areas.
    """
    gallery = json.loads(landchange_path.read_text(encoding="utf-8"))["sites"]
    errors, raw = [], []
    for place in gallery:
        if slugs and place["slug"] not in slugs:
            continue
        for p in place.get("passes", []):
            if "HV" not in (p.get("polarizations") or "") or not p.get("hh"):
                continue
            q = np.asarray(Image.open(scenes_dir / p["hh"]))
            valid = q < 255
            if valid.mean() < 0.6:
                continue
            hh_db = q.astype(float) / 254 * 35 - 30
            colour = np.asarray(Image.open(scenes_dir / p["image"]).convert("RGB").resize(q.shape[::-1], Image.NEAREST))
            lo, hi = STRETCH_DB["hv"]
            hv_db = (colour[..., 1] / 255) ** (1 / 0.8) * (hi - lo) + lo
            rgb = gcov_rgb(10 ** (hh_db / 10), 10 ** (hv_db / 10))
            red = _decode_bytes(encode_webp(rgb, valid))[..., 0]
            truth = (hh_db < WATER_HH_DB) & valid
            total = truth.sum() / valid.sum() * 100
            if total < min_water_pct:
                continue
            raw.append(float(((red < WATER_RED) & valid).sum() / valid.sum() * 100 - total))
            for region in _regions(valid.shape):
                shared = region & valid
                if shared.sum() < 0.4 * valid.sum():
                    continue
                exact = (truth & shared).sum() / shared.sum() * 100
                errors.append(calibrated_share(red, valid, shared, total) - exact)
    e = np.abs(np.array(errors))
    return {
        "cases": len(errors),
        "mean_error_pp": round(float(np.mean(errors)), 3) if errors else None,
        "p95_abs_error_pp": round(float(np.percentile(e, 95)), 3) if errors else None,
        "p99_abs_error_pp": round(float(np.percentile(e, 99)), 3) if errors else None,
        "max_abs_error_pp": round(float(e.max()), 3) if errors else None,
        "uncalibrated_bias_range_pp": [round(min(raw), 2), round(max(raw), 2)] if raw else None,
    }


def _decode_bytes(data: bytes) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(data)).convert("RGBA"))


# ─── main ────────────────────────────────────────────────────────────

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--site", action="append", help="Only this slug (repeatable).")
    parser.add_argument("--validate", action="store_true", help="Measure the image method's error and exit.")
    args = parser.parse_args(argv)

    if args.validate:
        print(json.dumps(validate(), indent=2))
        return

    data = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    data.setdefault("method", {})["GCOV"] = GCOV_METHOD
    for slug, entry in data["sites"].items():
        if args.site and slug not in args.site:
            continue
        if not has_water(entry):
            continue
        fp = apply_site(entry, slug)
        print(f"{slug}: shared footprint {fp['pct_of_box']}% of the box over {fp['passes']} passes "
              f"({fp['method']}, {fp['status']})")
        for s in entry["scenes"]:
            v = s["values"]
            print(f"  {s['date']}  seen {s['valid_pct']:5.1f}%  visible {v['water_visible_pct']:5.1f}%"
                  f"  shared {v.get('water_pct', float('nan')):5.1f}%")
    OUT_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
