"""Global NISAR coverage heatmaps from ``app/data/coverage_map.npz``.

``scripts/build_coverage_map.py`` counts, per 1° cell and month, the passes
of each product over the cell, how many were ascending, and the day of the
latest one. This module turns those counts into one map at a time: a
product, a metric, a month, and whether to look at that month alone or at
everything up to it.

Metrics (``METRICS``):

* ``passes``: passes (pairs, for GUNW and GOFF) over the cell in the window;
* ``days_per_pass``: the window's length divided by its passes, a mean
  revisit interval (empty where there were none);
* ``days_since``: days from the latest pass up to the window's end, looking
  back through every earlier month (empty where there was never one);
* ``ascending_pct``: share of the window's passes on ascending orbits
  (0: only descending, 100: only ascending).

Cells are counted where a footprint covers their center, so a 1° cell is
either imaged by a pass or not; small differences at frame edges are not
resolved.
"""
from __future__ import annotations

import base64
import calendar
import json
import threading
from datetime import date, datetime
from pathlib import Path

import numpy as np

from app.nisar import PRODUCTS

DATA_PATH = Path(__file__).resolve().parent / "data" / "coverage_map.npz"
NODATA = 65535
WINDOWS = ("month", "cumulative")

METRICS = {
    "passes": {
        "label": "Passes",
        "unit": "passes",
        "scale": 1,
        "description": "How many passes imaged the cell in the period.",
    },
    "days_per_pass": {
        "label": "Days per pass",
        "unit": "days",
        "scale": 0.1,
        "description": "The period's length divided by its passes: the average time between looks.",
    },
    "days_since": {
        "label": "Days since last pass",
        "unit": "days",
        "scale": 1,
        "description": "Days from the latest pass to the end of the period (any earlier month counts).",
    },
    "ascending_pct": {
        "label": "Ascending share",
        "unit": "%",
        "scale": 1,
        "description": "Share of the period's passes on ascending (south-to-north) orbits.",
    },
}

_lock = threading.Lock()
_loaded: dict = {}


class CoverageMapUnavailable(Exception):
    """The coverage file hasn't been built."""


def _data():
    """The npz's metadata and arrays, reloaded when the file changes."""
    try:
        mtime = DATA_PATH.stat().st_mtime
    except OSError as exc:
        raise CoverageMapUnavailable(
            "the coverage map hasn't been built (scripts/build_coverage_map.py)"
        ) from exc
    with _lock:
        if _loaded.get("mtime") != mtime:
            with np.load(DATA_PATH) as npz:
                arrays = {key: npz[key] for key in npz.files if key != "meta"}
                meta = json.loads(str(npz["meta"]))
            _loaded.clear()
            _loaded.update(mtime=mtime, meta=meta, arrays=arrays, vmax={})
        return _loaded


def info() -> dict:
    """What can be mapped: products, metrics, months, and where the counts came from."""
    data = _data()
    meta = data["meta"]
    # Lists, not objects, so clients keep this order (JSON objects are sorted on the way out).
    products = [
        {"id": pid, "label": PRODUCTS.get(pid, {}).get("label", pid), **stats}
        for pid, stats in meta["products"].items()
    ]
    return {
        "generated_at": meta["generated_at"],
        "source": meta["source"],
        "cell_deg": meta["cell_deg"],
        "months": meta["months"],
        "windows": list(WINDOWS),
        "products": products,
        "metrics": [
            {"id": key, **{k: v for k, v in m.items() if k != "scale"}} for key, m in METRICS.items()
        ],
    }


def _window(meta: dict, month_index: int, window: str) -> tuple[date, date, int]:
    """First and last day of the window, and its first month's index.

    The last month ends on the day the counts were made, not at month end.
    """
    months = meta["months"]
    built = datetime.strptime(meta["generated_at"][:10], "%Y-%m-%d").date()
    y, m = (int(v) for v in months[month_index].split("-"))
    end = date(y, m, calendar.monthrange(y, m)[1])
    if end > built:
        end = built
    first_index = 0 if window == "cumulative" else month_index
    fy, fm = (int(v) for v in months[first_index].split("-"))
    return date(fy, fm, 1), end, first_index


def _compute(data: dict, product: str, metric: str, month_index: int, window: str):
    """Float grid (NaN where empty) and the window's start and end."""
    meta, arrays = data["meta"], data["arrays"]
    start, end, first = _window(meta, month_index, window)
    passes = arrays[f"{product}_passes"][first:month_index + 1].sum(axis=0, dtype=np.float64)
    if metric == "passes":
        values = np.where(passes > 0, passes, np.nan)
    elif metric == "days_per_pass":
        days = (end - start).days + 1
        with np.errstate(divide="ignore"):
            values = np.where(passes > 0, days / passes, np.nan)
    elif metric == "ascending_pct":
        asc = arrays[f"{product}_asc"][first:month_index + 1].sum(axis=0, dtype=np.float64)
        with np.errstate(divide="ignore", invalid="ignore"):
            values = np.where(passes > 0, 100 * asc / passes, np.nan)
    else:  # days_since: the latest pass in this or any earlier month
        last = arrays[f"{product}_last"]
        values = np.full(last.shape[1:], np.nan)
        for mi in range(month_index, -1, -1):
            todo = np.isnan(values) & (last[mi] > 0)
            if not todo.any():
                continue
            y, m = (int(v) for v in meta["months"][mi].split("-"))
            ordinal = np.array([date(y, m, 1).toordinal() - 1], dtype=np.float64)
            values[todo] = end.toordinal() - (ordinal + last[mi][todo])
    return values, start, end


def _color_max(data: dict, product: str, metric: str, window: str) -> float:
    """Top of the color scale: the 98th percentile over every month, so months compare."""
    key = (product, metric, window)
    cached = data["vmax"].get(key)
    if cached is not None:
        return cached
    if metric == "ascending_pct":
        top = 100.0
    else:
        samples = []
        for mi in range(len(data["meta"]["months"])):
            values, _, _ = _compute(data, product, metric, mi, window)
            samples.append(values[np.isfinite(values)])
        merged = np.concatenate(samples) if samples else np.array([])
        top = float(np.percentile(merged, 98)) if merged.size else 1.0
    data["vmax"][key] = top = max(top, 1.0)
    return top


def grid(product: str, metric: str, month: str | None = None, window: str = "month") -> dict:
    """One heatmap: the metric per cell, packed as base64 little-endian uint16.

    ``values`` holds ``height`` rows of ``width`` cells, north row first and
    west column first; a cell's value is ``raw * scale``, or empty where
    ``raw == nodata``. ``month`` defaults to the latest.
    """
    data = _data()
    meta = data["meta"]
    if product not in meta["products"]:
        raise ValueError(f"product must be one of: {', '.join(meta['products'])}")
    if metric not in METRICS:
        raise ValueError(f"metric must be one of: {', '.join(METRICS)}")
    if window not in WINDOWS:
        raise ValueError(f"window must be one of: {', '.join(WINDOWS)}")
    months = meta["months"]
    month = month or months[-1]
    if month not in months:
        raise ValueError(f"month must be YYYY-MM between {months[0]} and {months[-1]}")
    month_index = months.index(month)

    values, start, end = _compute(data, product, metric, month_index, window)
    scale = METRICS[metric]["scale"]
    finite = np.isfinite(values)
    raw = np.full(values.shape, NODATA, dtype="<u2")
    raw[finite] = np.clip(np.rint(values[finite] / scale), 0, NODATA - 1)
    height, width = values.shape
    unit = meta["products"][product].get("unit", "passes") if metric == "passes" else METRICS[metric]["unit"]
    return {
        "product": product,
        "metric": metric,
        "label": METRICS[metric]["label"],
        "unit": unit,
        "month": month,
        "window": window,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "cell_deg": meta["cell_deg"],
        "width": width,
        "height": height,
        "bbox": [-180, -90, 180, 90],
        "scale": scale,
        "nodata": NODATA,
        "encoding": "base64 uint16 little-endian, row-major, north row first",
        "values": base64.b64encode(raw.tobytes()).decode("ascii"),
        "stats": {
            "cells": int(finite.sum()),
            "min": round(float(values[finite].min()), 1) if finite.any() else None,
            "max": round(float(values[finite].max()), 1) if finite.any() else None,
        },
        "color_max": round(_color_max(data, product, metric, window), 1),
        "generated_at": meta["generated_at"],
    }
