"""Change detectors: the rules we used by hand to pick stories, written down and tested.

Three detectors, each returning *candidates* (accepted or rejected, with the
reason), never prose:

* ``step``  – the largest change between two passes of a one-number-per-pass
  series, measured against that series' own pass-to-pass noise. Rejected
  when the passes were taken in different acquisition modes (Sylhet), when
  it is a one-pass spike (Punjab's 7 July), or when it doesn't hold on the
  next pass.
* ``trend`` – a least-squares pace through the series (Mexico City), kept
  only when the line explains the data (R²) and the pace is many standard
  errors from zero (Campi Flegrei was dropped for noise).
* ``patch`` – a per-pixel change map between two passes, the same computation
  the browser draws (``frontend/src/services/landchange.js``): smoothed HH
  difference with the area-wide shift removed, pixels past 4 dB, water on
  both dates left out. The largest connected patch is compared with the
  place's other pairs, and must still differ on the following pass
  (Langtang, Budhi Gandaki).

A change at the newest pass can't be checked against a following one yet, so
it is returned as ``pending`` and re-checked on the next run.
"""
from __future__ import annotations

import math
from collections import Counter, deque
from datetime import date

import numpy as np

# Per metric: noise floor (a series can't be quieter than this), the smallest
# step and the smallest total change over a trend worth a story.
METRIC_RULES = {
    "hh_db": {"unit": "dB", "noise_floor": 0.3, "min_step": 1.5, "min_total": 1.5},
    "hv_db": {"unit": "dB", "noise_floor": 0.3, "min_step": 1.5, "min_total": 1.5},
    "water_pct": {"unit": "%", "noise_floor": 1.0, "min_step": 5.0, "min_total": 5.0},
    "los_mm": {"unit": "mm", "noise_floor": 5.0, "min_step": 20.0, "min_total": 30.0},
}
MIN_SERIES = 5          # passes before a step can be judged against noise
STEP_Z = 5.0            # robust z-score of the largest step
MIN_TREND = 8           # passes for a pace
TREND_T = 6.0           # |slope| / standard error
TREND_R2 = 0.8
PERSIST = 0.5           # share of a change still there on the next pass

CHANGED_DB = 4.0        # matches CHANGED_DB in the browser's change map
BLUR_RADIUS = 2
WATER_DB = -18.0
MIN_PATCH_PX = 30       # on the half-resolution HH layer
PATCH_Z = 6.0
PATCH_NOISE_FLOOR = 5.0
AREA_WIDE_PCT = 30.0    # more than this changed: season, soil moisture or snow
MIN_PAIRS = 4           # pairs needed to know a place's usual change


def _days(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def _candidate(kind, metric, start, end, *, accepted, reason=None, score=0.0, **values):
    return {"kind": kind, "metric": metric, "start": start, "end": end,
            "status": "accepted" if accepted else ("pending" if reason and reason.startswith("pending") else "rejected"),
            "reason": reason, "score": round(float(score), 2), **values}


# ─── one number per pass ───────────────────────────────────

def _clean(series: list[dict]) -> list[dict]:
    return sorted((p for p in series if p.get("value") is not None and math.isfinite(p["value"])),
                  key=lambda p: p["date"])


def step(series: list[dict], metric: str) -> dict | None:
    """The largest pass-to-pass change, judged against the series' own noise.

    ``series`` is ``[{"date", "value", "mode"?}, ...]``.
    """
    rules = METRIC_RULES[metric]
    pts = _clean(series)
    if len(pts) < MIN_SERIES:
        return None
    v = np.array([p["value"] for p in pts], float)
    d = np.diff(v)
    i = int(np.argmax(np.abs(d)))
    rest = np.delete(d, i)
    noise = max(1.4826 * float(np.median(np.abs(rest - np.median(rest)))), rules["noise_floor"])
    z = abs(d[i] - float(np.median(rest))) / noise
    a, b = pts[i], pts[i + 1]
    values = {"before": round(float(v[i]), 2), "after": round(float(v[i + 1]), 2),
              "change": round(float(d[i]), 2), "unit": rules["unit"], "passes": len(pts),
              "days_apart": _days(a["date"], b["date"]), "noise": round(noise, 2)}

    def out(accepted, reason=None):
        return _candidate("step", metric, a["date"], b["date"], accepted=accepted, reason=reason,
                          score=z, **values)

    if abs(d[i]) < rules["min_step"]:
        return out(False, f"largest step {abs(d[i]):.2f} {rules['unit']} is under {rules['min_step']:g}")
    if z < STEP_Z:
        return out(False, f"within the series' own noise (z = {z:.1f})")
    if a.get("mode") and b.get("mode") and a["mode"] != b["mode"]:
        return out(False, f"the passes were taken in different acquisition modes ({a['mode']}, {b['mode']})")
    if i > 0 and abs(v[i + 1] - v[i - 1]) < PERSIST * abs(d[i]):
        return out(False, f"a one-pass spike on {a['date']}: the passes either side agree")
    if i + 2 >= len(v):
        return out(False, "pending: waiting for the next pass to check the change holds")
    held = v[i + 2] - v[i]
    if np.sign(held) != np.sign(d[i]) or abs(held) < PERSIST * abs(d[i]):
        return out(False, f"did not hold on the next pass ({pts[i + 2]['date']})")
    values["held_on"] = pts[i + 2]["date"]
    values["held_value"] = round(float(v[i + 2]), 2)
    return out(True)


def trend(series: list[dict], metric: str) -> dict | None:
    """A straight-line pace through the series, kept only when the line fits."""
    rules = METRIC_RULES[metric]
    pts = _clean(series)
    modes = Counter(p.get("mode") for p in pts if p.get("mode"))
    mixed = len(modes) > 1
    if mixed:
        # Differences between modes can masquerade as a pace: use the commonest one only.
        main = modes.most_common(1)[0][0]
        pts = [p for p in pts if p.get("mode") == main]
    if len(pts) < MIN_TREND:
        return None
    t = np.array([_days(pts[0]["date"], p["date"]) for p in pts], float)
    v = np.array([p["value"] for p in pts], float)
    A = np.vstack([t, np.ones_like(t)]).T
    (slope, icept), *_ = np.linalg.lstsq(A, v, rcond=None)
    pred = A @ np.array([slope, icept])
    ss_res = float(((v - pred) ** 2).sum())
    ss_tot = float(((v - v.mean()) ** 2).sum()) or 1e-12
    r2 = 1 - ss_res / ss_tot
    se = math.sqrt(ss_res / (len(v) - 2) / float(((t - t.mean()) ** 2).sum())) or 1e-12
    tstat = abs(slope) / se
    total = slope * t[-1]
    values = {"rate_per_month": round(float(slope * 30.44), 2), "se_per_month": round(float(se * 30.44), 2),
              "r2": round(r2, 2), "total": round(float(total), 2), "unit": rules["unit"],
              "passes": len(pts), "first_value": round(float(v[0]), 2), "last_value": round(float(v[-1]), 2),
              "mode": modes.most_common(1)[0][0] if mixed else None}

    def out(accepted, reason=None):
        return _candidate("trend", metric, pts[0]["date"], pts[-1]["date"], accepted=accepted,
                          reason=reason, score=tstat, **values)

    if abs(total) < rules["min_total"]:
        return out(False, f"total change {abs(total):.2f} {rules['unit']} is under {rules['min_total']:g}")
    if r2 < TREND_R2:
        return out(False, f"a straight line explains too little of the series (R² = {r2:.2f})")
    if tstat < TREND_T:
        return out(False, f"pace within {tstat:.1f} standard errors of zero")
    return out(True)


# ─── per-pixel change ──────────────────────────────────────

def box_blur(x: np.ndarray, r: int = BLUR_RADIUS) -> np.ndarray:
    """NaN-aware box mean, as ``boxBlur`` in the browser."""
    for axis in (0, 1):
        vals = np.nan_to_num(x)
        cnt = np.isfinite(x).astype(float)
        pad = [(r + 1, r) if a == axis else (0, 0) for a in (0, 1)]
        cs_v = np.cumsum(np.pad(vals, pad), axis=axis)
        cs_n = np.cumsum(np.pad(cnt, pad), axis=axis)
        n = x.shape[axis]
        hi = [slice(None), slice(None)]
        lo = [slice(None), slice(None)]
        hi[axis] = slice(2 * r + 1, 2 * r + 1 + n)
        lo[axis] = slice(0, n)
        s = cs_v[tuple(hi)] - cs_v[tuple(lo)]
        c = cs_n[tuple(hi)] - cs_n[tuple(lo)]
        x = np.where(c > 0, s / np.maximum(c, 1), np.nan)
    return x


def change_map(before: np.ndarray, after: np.ndarray):
    """Smoothed dB difference with the area-wide shift removed, and the land mask.

    Mirrors ``changeMap`` in ``frontend/src/services/landchange.js``.
    """
    d = box_blur(after) - box_blur(before)
    ok = np.isfinite(before) & np.isfinite(after) & np.isfinite(d)
    if not ok.any():
        return d, ok, 0.0
    shift = float(np.median(d[ok]))
    d = np.where(ok, d - shift, np.nan)
    land = ok & ~((before < WATER_DB) & (after < WATER_DB))
    return d, land, shift


def largest_patch(mask: np.ndarray) -> np.ndarray:
    """Boolean mask of the largest 4-connected patch in ``mask``."""
    seen = np.zeros(mask.shape, bool)
    best: list[tuple[int, int]] = []
    h, w = mask.shape
    for y0, x0 in zip(*np.nonzero(mask)):
        if seen[y0, x0]:
            continue
        seen[y0, x0] = True
        comp, queue = [], deque([(y0, x0)])
        while queue:
            y, x = queue.popleft()
            comp.append((y, x))
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not seen[yy, xx]:
                    seen[yy, xx] = True
                    queue.append((yy, xx))
        if len(comp) > len(best):
            best = comp
    out = np.zeros(mask.shape, bool)
    if best:
        ys, xs = zip(*best)
        out[list(ys), list(xs)] = True
    return out


def _pair(before, after):
    d, land, shift = change_map(before, after)
    changed = land & (np.abs(np.nan_to_num(d)) > CHANGED_DB)
    patch = largest_patch(changed)
    return {"d": d, "land": land, "shift": shift, "changed": changed, "patch": patch,
            "changed_pct": 100 * changed.sum() / max(int(land.sum()), 1), "size": int(patch.sum())}


_COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]


def _where(patch: np.ndarray, layer_px_m: float) -> dict:
    """Offset of a patch's centre from the window centre, in km and as a direction."""
    ys, xs = np.nonzero(patch)
    h, w = patch.shape
    dx = (xs.mean() - (w - 1) / 2) * layer_px_m / 1000
    dy = ((h - 1) / 2 - ys.mean()) * layer_px_m / 1000
    km = math.hypot(dx, dy)
    heading = _COMPASS[int(((math.degrees(math.atan2(dx, dy)) + 360) % 360 + 22.5) // 45) % 8]
    return {"offset_km": round(km, 1), "direction": heading if km >= 0.5 else "centre",
            "row": round(float(ys.mean()) / h, 3), "col": round(float(xs.mean()) / w, 3)}


def patches(layers: list[tuple[str, np.ndarray]], pixel_m: float) -> list[dict]:
    """A candidate for every pass pair whose largest changed patch stands out.

    ``layers`` is ``[(date, hh_db_half_res), ...]`` (the ``.hh.png`` layers,
    which are at half the image resolution), oldest first. ``pixel_m`` is the
    image pixel size, so a layer pixel is ``2 * pixel_m``.
    """
    layers = sorted(layers, key=lambda x: x[0])
    layer_m = 2 * pixel_m
    pairs = []
    for (da, a), (db, b) in zip(layers, layers[1:]):
        if a.shape != b.shape:
            continue
        pairs.append((da, db, _pair(a, b)))
    if len(pairs) < MIN_PAIRS:
        return []
    sizes = np.array([p[2]["size"] for p in pairs], float)
    med = float(np.median(sizes))
    spread = 1.4826 * float(np.median(np.abs(sizes - med))) + PATCH_NOISE_FLOOR
    index = {d: i for i, (d, _) in enumerate(layers)}
    out = []
    for da, db, p in pairs:
        z = (p["size"] - med) / spread
        if p["size"] < MIN_PATCH_PX or z < PATCH_Z:
            continue
        sign = float(np.nanmean(p["d"][p["patch"]]))
        values = {"area_km2": round(p["size"] * layer_m ** 2 / 1e6, 2),
                  "patch_px": p["size"], "changed_pct": round(float(p["changed_pct"]), 2),
                  "direction_db": "brighter" if sign > 0 else "darker",
                  "mean_change_db": round(sign, 1), "shift_db": round(p["shift"], 2),
                  "days_apart": _days(da, db), "pairs": len(pairs), "usual_patch_px": round(med),
                  **_where(p["patch"], layer_m)}

        def cand(accepted, reason=None):
            return _candidate("patch", "hh_db", da, db, accepted=accepted, reason=reason, score=z, **values)

        if p["changed_pct"] > AREA_WIDE_PCT:
            out.append(cand(False, f"{p['changed_pct']:.0f}% of the area changed: an area-wide change "
                                   "(season, soil moisture or snow), not a place"))
            continue
        j = index[da] + 2
        if j >= len(layers):
            out.append(cand(False, "pending: waiting for the next pass to check the change holds"))
            continue
        later = layers[j][1]
        if later.shape != layers[index[da]][1].shape:
            out.append(cand(False, "the next pass has a different footprint"))
            continue
        d2, land2, _ = change_map(layers[index[da]][1], later)
        mask = p["patch"] & land2
        same = mask & (np.sign(np.nan_to_num(d2)) == np.sign(sign)) & (np.abs(np.nan_to_num(d2)) > CHANGED_DB / 2)
        kept = same.sum() / max(int(p["patch"].sum()), 1)
        values["held_on"] = layers[j][0]
        values["held_share"] = round(float(kept), 2)
        if kept < PERSIST:
            out.append(cand(False, f"only {kept:.0%} of the patch still differed on {layers[j][0]}: a passing change"))
            continue
        out.append(cand(True))
    return out


def detect_place(place: dict, layers: list[tuple[str, np.ndarray]] | None = None) -> list[dict]:
    """Every candidate for an automatically watched place.

    ``place['passes']`` carry per-pass ``stats`` (``hh_db``, ``hv_db``,
    ``water_pct``) and ``mode``; ``layers`` are the HH layers for ``patches``.
    """
    passes = place.get("passes") or []
    out = []
    for metric in ("hh_db", "hv_db", "water_pct"):
        series = [{"date": p["date"], "value": (p.get("stats") or {}).get(metric), "mode": p.get("mode")}
                  for p in passes]
        for fn in (step, trend):
            c = fn(series, metric)
            if c:
                out.append(c)
    if layers:
        out += patches(layers, place.get("pixel_m") or 20)
    return out


def best(candidates: list[dict]) -> dict | None:
    """The candidate a story should lead with: the most recent accepted change, then the strongest."""
    ok = [c for c in candidates if c["status"] == "accepted"]
    if not ok:
        return None
    rank = {"patch": 2, "step": 1, "trend": 0}
    return max(ok, key=lambda c: (c["end"], rank[c["kind"]], c["score"]))
