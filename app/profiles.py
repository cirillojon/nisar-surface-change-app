"""Height change along a line drawn on the map, over NISAR's full record.

For a line (up to ``MAX_LENGTH_KM``) the backend:

1. samples points every ~200 m and looks up terrain height (Copernicus
   GLO-90 DEM, ``app/dem.py``);
2. picks the NISAR GUNW track/frame that covers the line with the most
   interferograms, and takes *all* of its pairs as one or more chains of
   consecutive pairs (the full available record);
3. reads only the HDF5 chunks along the line (unwrapped phase, NASA's
   ionospheric phase screen, unwrapped-region labels, and the tropospheric
   phase screens at the levels bracketing the line's heights), as a median
   of the 3 x 3 pixels (~240 m) around each point;
4. converts each pair to line-of-sight (LOS) motion in mm (+ = toward the
   satellite), references it to the line's median, and applies the
   ionosphere-screen correction. Scatter for four correction alternatives is
   reported as a sensitivity diagnostic; it does not select the result;
5. rebuilds each point's displacement at every date. Separate chains are
   aligned by a straight-line fit per point (labelled as an assumption).

This takes minutes for a new line, so it runs as a background job; status
and results are files under ``<DATA_DIR>/profiles/<id>/`` (shared by all
server workers). Results are cached: the same line is instant next time.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import threading
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pyproj

from app import dem, nisar
from app.nisar_render import earthdata_token, open_remote

logger = logging.getLogger(__name__)

VERSION = "v4"  # v4: fixed correction choice; alternatives remain sensitivity diagnostics
PRODUCT = "GUNW"
MAX_LENGTH_KM = 100.0
MIN_LENGTH_KM = 1.0
MAX_VERTICES = 50
MAX_POINTS = 500
SPACING_KM = 0.2
# Points must be inside the frame's footprints for it to qualify.
MIN_FRAME_COVERAGE = 0.95
WORKERS = 4
MAX_JOBS = 2
# A point whose history scatters this many times more than the line's
# typical point is hidden: the radar lost track there (e.g. new lava or
# fresh debris replaced the surface, or water).
UNRELIABLE_FACTOR = 3.0
# Points whose median coherence (echo similarity between passes, 0-1) is
# below this are hidden too: the radar can't follow surfaces that were
# replaced or keep changing.
MIN_COHERENCE = 0.3
# A "running" job not updated for this long is assumed dead (e.g. restart).
STALE_SECONDS = 600

GUNW_GRID = "science/LSAR/GUNW/grids/frequencyA"
UNW = GUNW_GRID + "/unwrappedInterferogram"
RADAR_GRID = "science/LSAR/GUNW/metadata/radarGrid"

CORRECTIONS = {
    "none": (),
    "ionosphere": ("iono",),
    "troposphere": ("tropo",),
    "ionosphere + troposphere": ("iono", "tropo"),
}
DEFAULT_CORRECTION = "ionosphere"

_jobs = threading.BoundedSemaphore(MAX_JOBS)
_running: set[str] = set()
_running_lock = threading.Lock()


class ProfileError(Exception):
    status = 422


class ProfileUnavailable(ProfileError):
    status = 503


# ─── Line geometry ───────────────────────────────────────────────────

def _km(lon1, lat1, lon2, lat2):
    mid = math.radians((lat1 + lat2) / 2)
    return math.hypot((lon2 - lon1) * 111.32 * math.cos(mid), (lat2 - lat1) * 110.57)


def validate_line(line) -> list[list[float]]:
    """``[[lon, lat], ...]``: 2-50 vertices, 1-100 km long."""
    if not isinstance(line, list) or not 2 <= len(line) <= MAX_VERTICES:
        raise ValueError(f"line must be a list of 2 to {MAX_VERTICES} [lon, lat] points")
    out = []
    for p in line:
        if (not isinstance(p, (list, tuple)) or len(p) != 2
                or not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in p)):
            raise ValueError("each point must be [lon, lat]")
        lon, lat = float(p[0]), float(p[1])
        if not (-180 <= lon <= 180 and -85 <= lat <= 85):
            raise ValueError("points must be within lon -180..180, lat -85..85")
        out.append([round(lon, 5), round(lat, 5)])
    length = sum(_km(*a, *b) for a, b in zip(out, out[1:]))
    if length < MIN_LENGTH_KM:
        raise ValueError(f"line must be at least {MIN_LENGTH_KM:g} km long")
    if length > MAX_LENGTH_KM:
        raise ValueError(f"line must be at most {MAX_LENGTH_KM:g} km long (this one is {length:.0f} km)")
    return out


def sample_line(line):
    """Points along the line: (lon, lat, distance_km) arrays, ~SPACING_KM apart."""
    seg = [_km(*a, *b) for a, b in zip(line, line[1:])]
    total = sum(seg)
    n = min(MAX_POINTS, max(2, math.ceil(total / SPACING_KM) + 1))
    targets = np.linspace(0, total, n)
    lons, lats = [], []
    start, k = 0.0, 0
    for d in targets:
        while k < len(seg) - 1 and d > start + seg[k]:
            start += seg[k]
            k += 1
        f = 0.0 if seg[k] == 0 else min(1.0, (d - start) / seg[k])
        (lo1, la1), (lo2, la2) = line[k], line[k + 1]
        lons.append(lo1 + (lo2 - lo1) * f)
        lats.append(la1 + (la2 - la1) * f)
    return np.array(lons), np.array(lats), targets


def profile_id(line) -> str:
    return hashlib.sha1(f"{VERSION}|{json.dumps(line)}".encode()).hexdigest()[:20]


# ─── Choosing the frame and the pairs ────────────────────────────────

def _frame(title):
    return "_".join(title.split("_")[5:8])


def _dates(title):
    p = title.split("_")
    iso = lambda s: f"{s[:4]}-{s[4:6]}-{s[6:8]}"  # noqa: E731
    return iso(p[11]), iso(p[13])


def _inside(lon, lat, poly):
    """Even-odd test; ``poly`` is CMR's [[lat, lon], ...]."""
    hit = np.zeros(np.shape(lon), dtype=bool)
    for (la1, lo1), (la2, lo2) in zip(poly, poly[1:] + poly[:1]):
        crosses = (la1 > lat) != (la2 > lat)
        with np.errstate(divide="ignore", invalid="ignore"):
            x = lo1 + (lat - la1) * (lo2 - lo1) / (la2 - la1)
        hit ^= crosses & (lon < x)
    return hit


def chains(granules):
    """All pairs as non-overlapping chains of consecutive pairs, oldest first."""
    best = {}
    for g in granules:
        key = _dates(g["title"])
        rank = (g.get("quality") == "validated", g["title"])
        if key not in best or rank > best[key][0]:
            best[key] = (rank, g)
    remaining = {k: v[1] for k, v in best.items()}
    found = []
    while remaining:
        starting = {}
        for (ref, sec), g in remaining.items():
            starting.setdefault(ref, []).append((sec, g))
        memo = {}

        def longest(day):
            if day not in memo:
                options = [[g] + longest(sec) for sec, g in starting.get(day, [])]
                memo[day] = max(options, key=len, default=[])
            return memo[day]

        chain = max((longest(d) for d in sorted(starting)), key=len, default=[])
        if len(chain) < 2:
            break
        found.append(chain)
        lo, hi = _dates(chain[0]["title"])[0], _dates(chain[-1]["title"])[1]
        remaining = {k: g for k, g in remaining.items() if k[1] <= lo or k[0] >= hi}
    return sorted(found, key=lambda c: _dates(c[0]["title"])[0])


def pick_frame(granules, lon, lat):
    """``(frame, chains)`` covering the points with the most pairs, or ``(None, [])``."""
    by_frame = {}
    for g in granules:
        if g.get("footprint") and g.get("data_url"):
            by_frame.setdefault(_frame(g["title"]), []).append(g)
    best = (None, [], -1)
    for frame, rows in by_frame.items():
        covered = np.zeros(lon.shape, dtype=bool)
        for g in rows:
            covered |= _inside(lon, lat, g["footprint"])
        if covered.mean() < MIN_FRAME_COVERAGE:
            continue
        cs = chains(rows)
        n = sum(len(c) for c in cs)
        if n > best[2]:
            best = (frame, cs, n)
    return best[0], best[1]


# ─── Reading points from one pair (runs in worker processes) ─────────

def _read_points(ds, rows, cols, pad=1, level=None):
    """Median of the (2*pad+1)^2 pixels around each point, reading only the chunks touched."""
    out = np.full(rows.shape, np.nan)
    ny, nx = ds.shape[-2:]
    cy, cx = (ds.chunks or (ny, nx))[-2:]
    keys = (rows // cy) * (nx // cx + 1) + cols // cx
    for key in np.unique(keys):
        sel = np.nonzero(keys == key)[0]
        r0 = max(0, rows[sel].min() - pad)
        r1 = min(ny, rows[sel].max() + pad + 1)
        c0 = max(0, cols[sel].min() - pad)
        c1 = min(nx, cols[sel].max() + pad + 1)
        win = ds[level, r0:r1, c0:c1] if level is not None else ds[r0:r1, c0:c1]
        win = np.asarray(win, dtype=float)
        for i in sel:
            r, c = rows[i] - r0, cols[i] - c0
            patch = win[max(0, r - pad):r + pad + 1, max(0, c - pad):c + pad + 1]
            out[i] = np.nanmedian(patch) if np.isfinite(patch).any() else np.nan
    return out


def _grid_index(group, lon, lat, epsg):
    x, y = group["xCoordinates"][()], group["yCoordinates"][()]
    gx, gy = pyproj.Transformer.from_crs(4326, epsg, always_xy=True).transform(lon, lat)
    cols = np.floor((gx - x[0]) / (x[1] - x[0]) + 0.5).astype(int)
    rows = np.floor((gy - y[0]) / (y[1] - y[0]) + 0.5).astype(int)
    inside = (cols >= 0) & (cols < x.size) & (rows >= 0) & (rows < y.size)
    return np.clip(rows, 0, y.size - 1), np.clip(cols, 0, x.size - 1), inside


def read_pair(granule, lon, lat, heights, with_geometry=False):
    """One pair at the points: raw / ionosphere / troposphere phase (rad), region labels."""
    h5, fobj = open_remote(granule["data_url"], timeout=60)
    with h5:
        unw = h5[UNW]
        pol = "HH" if "HH" in unw else next(k for k in unw if isinstance(unw[k], type(unw)))
        epsg = int(unw["projection"][()])
        rows, cols, inside = _grid_index(unw, lon, lat, epsg)
        grp = unw[pol]
        out = {
            "raw": _read_points(grp["unwrappedPhase"], rows, cols),
            "iono": _read_points(grp["ionospherePhaseScreen"], rows, cols),
            # Region label of the centre pixel (no median for labels).
            "cc": _read_points(grp["connectedComponents"], rows, cols, pad=0),
            "coh": _read_points(grp["coherenceMagnitude"], rows, cols),
            "wavelength": 299_792_458.0 / float(h5[GUNW_GRID + "/centerFrequency"][()]),
        }
        for k in ("raw", "iono", "cc", "coh"):
            out[k][~inside] = np.nan

        # Troposphere: wet + hydrostatic at the levels around the points' heights.
        rg = h5[RADAR_GRID]
        levels = rg["heightAboveEllipsoid"][()]
        hmin, hmax = np.nanmin(heights), np.nanmax(heights)
        k0 = max(0, int(np.searchsorted(levels, hmin)) - 1)
        k1 = min(levels.size - 1, int(np.searchsorted(levels, hmax)))
        k1 = max(k1, k0 + 1)
        trows, tcols, _ = _grid_index(rg, lon, lat, epsg)
        cube = np.stack([
            _read_points(rg["wetTroposphericPhaseScreen"], trows, tcols, pad=0, level=k)
            + _read_points(rg["hydrostaticTroposphericPhaseScreen"], trows, tcols, pad=0, level=k)
            for k in range(k0, k1 + 1)
        ])
        lv = levels[k0:k1 + 1]
        h = np.clip(np.nan_to_num(heights, nan=lv[0]), lv[0], lv[-1])
        j = np.clip(np.searchsorted(lv, h) - 1, 0, len(lv) - 2)
        w = (h - lv[j]) / (lv[j + 1] - lv[j])
        idx = np.arange(len(h))
        out["tropo"] = cube[j, idx] + (cube[j + 1, idx] - cube[j, idx]) * w

        if with_geometry:
            mid = int(np.argmin(np.abs(levels - np.nanmedian(heights))))
            out["incidence_deg"] = _read_points(rg["incidenceAngle"], trows, tcols, pad=0, level=mid)
            ident = h5["science/LSAR/identification"]
            out["pass_direction"] = ident["orbitPassDirection"][()].decode()
            out["look_direction"] = ident["lookDirection"][()].decode()
    out["mb_read"] = round(fobj.bytes_read / 1e6, 1)
    return out


def _read_pair_job(args):
    granule, lon, lat, heights, with_geometry = args
    try:
        return granule["title"], read_pair(granule, lon, lat, heights, with_geometry), None
    except Exception as exc:  # noqa: BLE001 — one bad pair shouldn't sink the job
        return granule["title"], None, str(exc)


# ─── Turning pairs into a displacement history ───────────────────────

def displacement_history(pairs_by_chain, corrections):
    """Aligned LOS displacement (mm) at every date for each point.

    ``pairs_by_chain``: per chain, a list of per-pair dicts with ``raw``,
    ``iono``, ``tropo`` (mm), ``valid`` and ``ref``/``sec`` dates. Each
    point's record is cut into pieces wherever a pair is missing for it
    (a new chain, or a pair that didn't unwrap there); the pieces are
    aligned by a straight-line fit with one offset per piece.
    Returns dates, the (dates x points) displacement, velocity (mm/yr), the
    median scatter about the line (mm) and each point's scatter.
    """
    n_pts = len(pairs_by_chain[0][0]["raw"])
    # Zero each pair on the same points (measured in every pair) so the
    # reference doesn't jump when a few points drop out; fall back to each
    # pair's own valid points if too few are always measured.
    always = np.logical_and.reduce([p["valid"] for c in pairs_by_chain for p in c])
    stable = always.sum() >= max(3, 0.1 * n_pts)
    dates, rows, pieces = [], [], []
    piece = np.zeros(n_pts, dtype=int)
    next_piece = 1
    for chain in pairs_by_chain:
        piece[:] = np.arange(next_piece, next_piece + n_pts)  # every point starts a piece
        next_piece += n_pts
        cum = np.zeros(n_pts)
        dates.append(chain[0]["ref"])
        rows.append(cum.copy())
        pieces.append(piece.copy())
        for p in chain:
            step = p["raw"] - sum(p[c] for c in corrections)
            ok = p["valid"]
            ref = always if stable else ok
            if ref.sum() >= 3:
                step = step - np.median(step[ref])
            # A point this pair didn't measure starts a new piece at its end date.
            gap = ~ok
            piece[gap] = np.arange(next_piece, next_piece + gap.sum())
            next_piece += int(gap.sum())
            cum = np.where(ok, cum + step, 0.0)
            dates.append(p["sec"])
            rows.append(cum.copy())
            pieces.append(piece.copy())
    Y = np.array(rows)                                  # (dates, points)
    P = np.array(pieces)
    t0 = date.fromisoformat(dates[0])
    t = np.array([(date.fromisoformat(d) - t0).days / 365.25 for d in dates])

    vel = np.full(n_pts, np.nan)
    scatter = np.full(n_pts, np.nan)
    aligned = np.full(Y.shape, np.nan)
    for i in range(n_pts):
        ids, counts = np.unique(P[:, i], return_counts=True)
        keep = ids[counts >= 2]            # a one-date piece carries no motion
        use = np.isin(P[:, i], keep)
        if use.sum() < 4 or use.sum() - len(keep) < 2:
            continue
        X = np.column_stack([t[use]] + [(P[use, i] == k).astype(float) for k in keep])
        beta, *_ = np.linalg.lstsq(X, Y[use, i], rcond=None)
        resid = Y[use, i] - X @ beta
        dof = max(1, use.sum() - X.shape[1])
        vel[i] = beta[0]
        scatter[i] = math.sqrt(float((resid ** 2).sum()) / dof)
        off = dict(zip(keep, beta[1:]))
        first = off[P[use, i][0]]
        aligned[use, i] = Y[use, i] - np.array([off[k] for k in P[use, i]]) + first
    med = float(np.nanmedian(scatter)) if np.isfinite(scatter).any() else float("nan")
    return dates, aligned, vel, med, scatter


def choose_correction(scatter_mm: dict[str, float]) -> str:
    """Use a fixed ionosphere-screen correction, not the smoothest-looking result."""
    if not np.isfinite(scatter_mm.get(DEFAULT_CORRECTION, np.nan)):
        raise ProfileError("NISAR couldn't measure motion along this line (not unwrapped)")
    return DEFAULT_CORRECTION


def phase_to_los_mm(phase, wavelength: float):
    """Convert GUNW phase to LOS mm using this app's +toward convention."""
    return -np.asarray(phase) * wavelength / (4 * np.pi) * 1000.0


# ─── Jobs ────────────────────────────────────────────────────────────

# Results shipped with the app (e.g. the guided tour's line), used when the
# line hasn't been computed on this server yet.
SEED_DIR = Path(__file__).resolve().parent / "data" / "profiles"


def profiles_dir() -> Path:
    return Path(os.getcwd()) / os.getenv("DATA_DIR", "app-data") / "profiles"


def _write(path: Path, data: dict):
    """Atomic replace. Windows refuses while a reader has the file open, so retry."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".{threading.get_ident()}.tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    for attempt in range(40):
        try:
            tmp.replace(path)
            return
        except PermissionError:
            if attempt == 39:
                raise
            time.sleep(0.025)


def _read(path: Path) -> dict | None:
    """JSON file, retrying briefly if a writer has it locked; ``None`` if missing."""
    for attempt in range(40):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (PermissionError, json.JSONDecodeError):
            if attempt == 39:
                raise
            time.sleep(0.025)
    return None


def _status(pid: str, **fields):
    _write(profiles_dir() / pid / "status.json",
           {"id": pid, "updated_at": time.time(), **fields})


def get(pid: str) -> dict | None:
    """Status (and result when done) of a profile job, or ``None``."""
    if not pid.isalnum() or len(pid) != 20:
        return None
    folder = profiles_dir() / pid
    result = _read(folder / "result.json") or _read(SEED_DIR / f"{pid}.json")
    if result is not None:
        return {"id": pid, "state": "done", "result": result}
    return _read(folder / "status.json")


def start(line) -> dict:
    """Start (or find) the job for ``line``; returns its status."""
    line = validate_line(line)
    pid = profile_id(line)
    current = get(pid)
    if current and current["state"] == "done":
        return {"id": pid, "state": "done"}
    with _running_lock:
        if pid in _running:
            return current or {"id": pid, "state": "running"}
        fresh = current and current["state"] in ("queued", "running") and \
            time.time() - current.get("updated_at", 0) < STALE_SECONDS
        if fresh:
            return current  # running in another worker process
        if not earthdata_token() and not _netrc():
            raise ProfileUnavailable(
                "Profiles need a NASA Earthdata Login: set EARTHDATA_TOKEN in the backend's .env"
            )
        _running.add(pid)
    _status(pid, state="queued", line=line, progress={"stage": "Waiting for a free slot"})
    threading.Thread(target=_run, args=(pid, line), daemon=True, name=f"profile-{pid}").start()
    return {"id": pid, "state": "queued"}


def _netrc():
    import requests

    return bool(requests.utils.get_netrc_auth("https://urs.earthdata.nasa.gov"))


def _run(pid, line):
    try:
        with _jobs:
            result = compute(line, progress=lambda **p: _status(pid, state="running", line=line, progress=p))
        _write(profiles_dir() / pid / "result.json", result)
        _status(pid, state="done", line=line)
    except ProfileError as exc:
        _status(pid, state="error", line=line, error=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.exception("profile %s failed", pid)
        _status(pid, state="error", line=line, error=f"Profile failed: {exc}")
    finally:
        with _running_lock:
            _running.discard(pid)


def compute(line, progress=lambda **p: None, workers=WORKERS) -> dict:
    lon, lat, dist = sample_line(line)
    progress(stage="Looking up terrain heights")
    heights = dem.heights(lon, lat)

    progress(stage="Finding NISAR interferograms along the line")
    pad = 0.02
    bbox = [float(lon.min() - pad), float(lat.min() - pad), float(lon.max() + pad), float(lat.max() + pad)]
    granules = nisar.search_all_granules(PRODUCT, bbox=bbox)
    frame, found = pick_frame(granules, lon, lat)
    if not frame:
        raise ProfileError(
            "No single NISAR track/frame covers this whole line with interferograms yet. "
            "Try a shorter line, or one further from the edge of NISAR's coverage."
        )
    flat = [g for c in found for g in c]
    total = len(flat)

    results, errors = {}, {}
    progress(stage="Reading NISAR data", done=0, total=total, frame=frame)
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futs = [pool.submit(_read_pair_job, (g, lon, lat, heights, i == 0)) for i, g in enumerate(flat)]
        for n, fut in enumerate(as_completed(futs), 1):
            title, data, err = fut.result()
            if data is None:
                errors[title] = err
            else:
                results[title] = data
            progress(stage="Reading NISAR data", done=n, total=total, frame=frame)
    if not results:
        raise ProfileError(f"Could not read NISAR data: {next(iter(errors.values()), 'unknown error')}")

    geometry = results.get(flat[0]["title"]) or {}
    pairs_by_chain = []
    for chain in found:
        seg = []
        for g in chain:
            r = results.get(g["title"])
            if r is None:
                if seg:  # a missing pair splits the chain
                    pairs_by_chain.append(seg)
                seg = []
                continue
            cc = r["cc"]
            labels = cc[np.isfinite(cc) & (cc > 0)].astype(int)
            main = np.bincount(labels).argmax() if labels.size else -1
            valid = np.isfinite(r["raw"]) & np.isfinite(r["iono"]) & np.isfinite(r["tropo"]) & (cc == main)
            ref, sec = _dates(g["title"])
            seg.append({
                "ref": ref, "sec": sec, "valid": valid,
                "raw": np.where(valid, phase_to_los_mm(r["raw"], r["wavelength"]), 0.0),
                "iono": np.where(valid, phase_to_los_mm(r["iono"], r["wavelength"]), 0.0),
                "tropo": np.where(valid, phase_to_los_mm(r["tropo"], r["wavelength"]), 0.0),
                "granule_id": g["title"],
                "quality": g.get("quality"),
                "collection": g.get("collection"),
            })
        if seg:
            pairs_by_chain.append(seg)
    pairs_by_chain = [c for c in pairs_by_chain if len(c) >= 2]
    if not pairs_by_chain:
        raise ProfileError("Not enough unbroken NISAR pairs along this line yet")

    with np.errstate(all="ignore"):
        coherence = np.nanmedian(np.stack([r["coh"] for r in results.values()]), axis=0)

    progress(stage="Building the displacement history", done=total, total=total, frame=frame)
    trials = {name: displacement_history(pairs_by_chain, corr) for name, corr in CORRECTIONS.items()}
    scatters = {k: v[3] for k, v in trials.items()}
    chosen = choose_correction(scatters)
    dates, disp, vel, scatter, point_scatter = trials[chosen]
    # Hide points where the radar lost track (scatter far above typical).
    with np.errstate(invalid="ignore"):
        unreliable = (np.isfinite(point_scatter) & (point_scatter > UNRELIABLE_FACTOR * scatter)) | (
            np.nan_to_num(coherence, nan=0.0) < MIN_COHERENCE
        )
    disp = np.where(unreliable[None, :], np.nan, disp)
    vel = np.where(unreliable, np.nan, vel)

    inc = geometry.get("incidence_deg")
    cos_inc = np.cos(np.radians(inc)) if inc is not None else np.full(lon.shape, np.nan)
    r1 = lambda a, nd=1: [None if not np.isfinite(v) else round(float(v), nd) for v in a]  # noqa: E731
    used = sum(len(c) for c in pairs_by_chain)
    pair_provenance = [
        {
            "granule_id": pair["granule_id"],
            "reference_date": pair["ref"],
            "secondary_date": pair["sec"],
            "quality": pair.get("quality"),
            "collection": pair.get("collection"),
        }
        for chain in pairs_by_chain for pair in chain
    ]
    collections = {p["collection"] for p in pair_provenance if p["collection"]}
    provenance_warnings = []
    if len(collections) > 1:
        provenance_warnings.append(
            "This time series uses multiple NISAR processing collections; "
            "review collection provenance before interpreting small changes."
        )
    return {
        "id": profile_id(line),
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "line": line,
        "length_km": round(float(dist[-1]), 2),
        "frame": frame,
        "pass_direction": geometry.get("pass_direction"),
        "look_direction": geometry.get("look_direction"),
        "first_date": dates[0], "last_date": dates[-1],
        "pairs_total": total, "pairs_used": used, "chains": len(pairs_by_chain),
        "pairs_failed": len(errors),
        "pair_provenance": pair_provenance,
        "provenance_warnings": provenance_warnings,
        "corrections": chosen,
        "scatter_mm": {k: (round(v, 1) if np.isfinite(v) else None) for k, v in scatters.items()},
        "noise_mm": round(scatter, 1),
        "points": {
            "dist_km": r1(dist, 3), "lon": r1(lon, 5), "lat": r1(lat, 5),
            "elevation_m": r1(heights, 0),
            "incidence_deg": r1(inc if inc is not None else np.full(lon.shape, np.nan), 1),
            "velocity_mm_yr": r1(vel),
            "measured_pct": round(float(np.isfinite(vel).mean()) * 100, 1),
            "hidden": int(unreliable.sum()),
            "coherence": r1(coherence, 2),
        },
        "dates": dates,
        # LOS mm (+ toward the satellite) per date x point; vertical assumes
        # purely vertical motion (LOS / cos(incidence)).
        "los_mm": [r1(row) for row in disp],
        "vertical_mm": [r1(row / cos_inc) for row in disp],
    }
