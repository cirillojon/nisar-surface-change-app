"""Watch my area: anyone can ask NISAR Watch to keep an eye on a box they drew.

NISAR Watch (``pipeline/``) checks curated places and news-event areas in a
GitHub Action and commits what it finds. A person's own area must not end up
in a public repository, so user watches live only on this server, under
``<DATA_DIR>/watches/<id>/``:

* ``watch.json``  – the area, every pass checked (with per-pass box numbers),
  the detectors' latest candidates and a log of what happened when;
* ``status.json`` – whether a check is queued or running (shared by workers);
* ``scenes/auto/<id>/<date>.webp|.hh.png`` – the same images the gallery uses.

The id is a random token and the only key: whoever has the link can read,
subscribe to (Atom feed) or stop the watch. Nothing lists watches.

A check reuses the pipeline unchanged: ``pipeline.ingest`` renders new GCOV
passes over the box, ``pipeline.detect`` runs the step, trend and patch
detectors, which keep or reject each change with a reason and wait for the
following pass before keeping one. There is no scheduler of its own: a watch
is re-checked when it is opened or its feed is fetched and the last check is
older than ``REFRESH_HOURS`` (feed readers poll, so subscribed watches stay
current), or by ``flask watch run`` from cron.

Everything here is informational: "worth an expert's look", never a warning.
"""
from __future__ import annotations

import json
import logging
import math
import os
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

MIN_HALF_KM = 1.0
MAX_HALF_KM = 15.0          # a 30 km box: big enough for a town, small enough to render
MAX_PER_CHECK = 12          # new passes per check; older ones are picked up later
REFRESH_HOURS = 12.0        # NISAR repeats every 12 days, so twice a day is plenty
STALE_SECONDS = 45 * 60     # a "running" status older than this was abandoned
MAX_LOG = 200
MAX_CONCURRENT = 2
MAX_NAME = 80
ID_BYTES = 12               # 16 url-safe characters

DISCLAIMER = ("Informational, not a warning. NISAR Watch flags radar changes that may be worth an "
              "expert's look; it cannot tell what caused them, and it misses change between passes.")

METRIC_LABELS = {
    "hh_db": ("radar brightness (HH)", "dB"),
    "hv_db": ("vegetation echo (HV)", "dB"),
    "water_pct": ("open water", "%"),
}

_slots = threading.BoundedSemaphore(MAX_CONCURRENT)
_running: set[str] = set()
_running_lock = threading.Lock()


class WatchError(Exception):
    status = 400


class WatchUnavailable(WatchError):
    status = 503


# ─── storage ─────────────────────────────────────────────────────────

def watches_dir() -> Path:
    return Path(os.getcwd()) / os.getenv("DATA_DIR", "app-data") / "watches"


def valid_id(wid: str) -> bool:
    return isinstance(wid, str) and len(wid) == 16 and all(c.isalnum() or c in "-_" for c in wid)


def _folder(wid: str) -> Path:
    return watches_dir() / wid


def _write(path: Path, data: dict) -> None:
    """Atomic replace (retried: Windows refuses while a reader has the file open)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".{threading.get_ident()}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    for attempt in range(40):
        try:
            tmp.replace(path)
            return
        except PermissionError:
            if attempt == 39:
                raise
            time.sleep(0.025)


def _read(path: Path) -> dict | None:
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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _max_watches() -> int:
    try:
        return int(os.getenv("WATCH_MAX", "500"))
    except ValueError:
        return 500


# ─── the area ────────────────────────────────────────────────────────

def area_from_bbox(bbox) -> dict:
    """``[minLon, minLat, maxLon, maxLat]`` → the square window the pipeline reads."""
    try:
        w, s, e, n = (float(v) for v in bbox)
    except (TypeError, ValueError):
        raise WatchError("bbox must be [minLon, minLat, maxLon, maxLat]") from None
    if not all(math.isfinite(v) for v in (w, s, e, n)):
        raise WatchError("bbox must be finite numbers")
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        raise WatchError("bbox must be [minLon, minLat, maxLon, maxLat] with min < max")
    lat, lon = (s + n) / 2, (w + e) / 2
    width_km = (e - w) * 111.32 * math.cos(math.radians(lat))
    height_km = (n - s) * 110.57
    half = max(width_km, height_km) / 2
    if half > MAX_HALF_KM * 2:
        raise WatchError(f"That area is too big to watch: draw one under {int(MAX_HALF_KM * 4)} km across (up to {int(MAX_HALF_KM * 2)} km is watched whole).")
    clipped = half > MAX_HALF_KM
    half = min(max(half, MIN_HALF_KM), MAX_HALF_KM)
    return {"lon": round(lon, 5), "lat": round(lat, 5), "half_km": round(half, 2), "clipped": clipped}


def _target(w: dict) -> dict:
    a = w["area"]
    return {"slug": w["id"], "name": w["name"], "kind": "Watch", "theme": "ground", "origin": "user",
            "lon": a["lon"], "lat": a["lat"], "half_km": a["half_km"],
            "note": "Watched for change on every NISAR pass at a visitor's request."}


def create(bbox, name: str | None = None) -> dict:
    """A new watch for ``bbox``; its first check starts in the background."""
    area = area_from_bbox(bbox)
    folder = watches_dir()
    if folder.is_dir() and sum(1 for _ in folder.iterdir()) >= _max_watches():
        raise WatchUnavailable("This server is watching as many areas as it can. Please try again later.")
    if not _token_available():
        raise WatchUnavailable("Watching needs a NASA Earthdata Login: set EARTHDATA_TOKEN in the backend's .env")
    wid = secrets.token_urlsafe(ID_BYTES)
    clean = " ".join(str(name or "").split())[:MAX_NAME] or f"Area at {area['lat']:.3f}°, {area['lon']:.3f}°"
    w = {
        "id": wid, "name": clean, "created_at": _now(), "area": area,
        "bbox": [float(v) for v in bbox],
        "last_checked": None, "frame": None, "passes": [], "candidates": [],
        "log": [{"at": _now(), "kind": "created", "title": f"Started watching {clean}"}],
        "state": {},
    }
    _write(_folder(wid) / "watch.json", w)
    return public(w, start_check(wid))


def delete(wid: str) -> bool:
    folder = _folder(wid)
    if not valid_id(wid) or not (folder / "watch.json").is_file():
        return False
    for path in sorted(folder.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        path.unlink() if path.is_file() else path.rmdir()
    folder.rmdir()
    return True


def load(wid: str) -> dict | None:
    if not valid_id(wid):
        return None
    return _read(_folder(wid) / "watch.json")


def _status(wid: str) -> dict:
    s = _read(_folder(wid) / "status.json") or {"state": "idle"}
    if s.get("state") in ("queued", "running") and time.time() - s.get("updated_at", 0) > STALE_SECONDS:
        s = {"state": "idle"}
    return s


def _set_status(wid: str, **fields) -> None:
    _write(_folder(wid) / "status.json", {"updated_at": time.time(), **fields})


# ─── checking ────────────────────────────────────────────────────────

def _token_available() -> bool:
    from app.nisar_render import earthdata_token

    if earthdata_token():
        return True
    import requests

    return bool(requests.utils.get_netrc_auth("https://urs.earthdata.nasa.gov"))


def due(w: dict, now: float | None = None) -> bool:
    if not w.get("last_checked"):
        return True
    last = datetime.fromisoformat(w["last_checked"]).timestamp()
    return (now if now is not None else time.time()) - last > REFRESH_HOURS * 3600


def start_check(wid: str) -> dict:
    """Queue a check of ``wid`` unless one is already queued or running."""
    with _running_lock:
        if wid in _running:
            return _status(wid)
        current = _status(wid)
        if current.get("state") in ("queued", "running"):
            return current  # running in another worker process
        _running.add(wid)
    _set_status(wid, state="queued")
    threading.Thread(target=_run, args=(wid,), daemon=True, name=f"watch-{wid}").start()
    return {"state": "queued"}


def refresh_if_due(wid: str, w: dict) -> dict:
    """Status, after starting a check when the last one is old."""
    if due(w) and _token_available():
        return start_check(wid)
    return _status(wid)


def _run(wid: str) -> None:
    try:
        with _slots:
            _set_status(wid, state="running")
            check(wid)
        _set_status(wid, state="idle")
    except Exception as exc:  # noqa: BLE001 - recorded for the page, then logged
        logger.exception("watch %s check failed", wid)
        _set_status(wid, state="error", error=str(exc)[:200])
    finally:
        with _running_lock:
            _running.discard(wid)


def _key(c: dict) -> tuple:
    return (c["kind"], c["metric"], c["start"], c["end"])


def check(wid: str, *, search=None, render=None, today: str | None = None) -> dict:
    """Render new passes over the watch and re-run the detectors; returns the watch."""
    from pipeline import detect, ingest
    from pipeline.render import load_hh_layer

    w = load(wid)
    if w is None:
        raise WatchError("watch not found")
    folder = _folder(wid)
    scenes = folder / "scenes"
    state = {"targets": {wid: w.get("state") or {}}}
    places = {wid: {"passes": w.get("passes") or []}}
    kwargs = {"search": search} | ({"render": render} if render else {})
    report = ingest.ingest([_target(w)], state, places, max_total=MAX_PER_CHECK, max_per_target=MAX_PER_CHECK,
                           workers=1, scenes_dir=scenes, **kwargs)
    r = report.get(wid, {})
    if r.get("error"):
        raise WatchError(r["error"])
    place = places[wid]
    layers = []
    for p in place.get("passes") or []:
        f = scenes / p["hh"]
        if f.is_file():
            layers.append((p["date"], load_hh_layer(f)))
    candidates = detect.detect_place(place, layers)

    at = _now()
    log = list(w.get("log") or [])
    rendered = r.get("rendered") or []
    if rendered:
        log.append({"at": at, "kind": "passes",
                    "title": f"{len(rendered)} new NISAR {'pass' if len(rendered) == 1 else 'passes'} checked",
                    "summary": ", ".join(sorted(rendered))})
    before = {_key(c): c["status"] for c in w.get("candidates") or []}
    for c in candidates:
        if c["status"] in ("accepted", "pending") and before.get(_key(c)) != c["status"]:
            log.append({"at": at, "kind": "change" if c["status"] == "accepted" else "pending",
                        "title": headline(c), "summary": explain(c), "candidate": _key(c)})

    w.update({
        "last_checked": at, "frame": state["targets"][wid].get("frame"),
        "passes": place.get("passes") or [], "candidates": candidates,
        "on_frame": r.get("on_frame", 0), "skipped": (r.get("skipped") or [])[-20:],
        "state": state["targets"][wid], "log": log[-MAX_LOG:],
    })
    _write(folder / "watch.json", w)
    return w


def run_due(*, limit: int | None = None) -> list[str]:
    """Check every watch that is due (for cron: ``flask watch run``). Returns the ids checked."""
    folder = watches_dir()
    done = []
    if not folder.is_dir():
        return done
    for sub in sorted(folder.iterdir()):
        w = _read(sub / "watch.json")
        if not w or not due(w) or _status(sub.name).get("state") in ("queued", "running"):
            continue
        try:
            _set_status(sub.name, state="running")
            check(sub.name)
            _set_status(sub.name, state="idle")
        except Exception as exc:  # noqa: BLE001
            logger.exception("watch %s check failed", sub.name)
            _set_status(sub.name, state="error", error=str(exc)[:200])
        done.append(sub.name)
        if limit and len(done) >= limit:
            break
    return done


# ─── words ───────────────────────────────────────────────────────────

def _fmt(v, unit: str) -> str:
    sign = "+" if v > 0 else ""
    return f"{sign}{v:g} {unit}" if unit != "%" else f"{sign}{v:g} points"


def headline(c: dict) -> str:
    label, unit = METRIC_LABELS.get(c["metric"], (c["metric"], c.get("unit") or ""))
    if c["kind"] == "patch":
        return (f"A {c.get('area_km2', '?')} km² patch turned {c.get('direction_db', 'different')} "
                f"between {c['start']} and {c['end']}")
    if c["kind"] == "trend":
        return f"Steady change in {label}: {_fmt(c.get('rate_per_month', 0), unit)} a month"
    return f"Sudden change in {label}: {_fmt(c.get('change', 0), unit)} between {c['start']} and {c['end']}"


def explain(c: dict) -> str:
    """What the detector saw, with its numbers, and what it means for the status."""
    unit = METRIC_LABELS.get(c["metric"], ("", c.get("unit") or ""))[1]
    if c["kind"] == "step":
        body = (f"From {c.get('before')} to {c.get('after')} {unit} over {c.get('days_apart')} days, "
                f"{c['score']:g}× the usual pass-to-pass scatter (±{c.get('noise')} {unit}).")
    elif c["kind"] == "trend":
        body = (f"{_fmt(c.get('total', 0), unit)} in total over {c.get('passes')} passes; the straight line "
                f"explains {round((c.get('r2') or 0) * 100)}% of the variation and the pace is "
                f"{c['score']:g} standard errors from zero.")
    else:
        usual = c.get("usual_patch_px")
        where = "at the centre" if c.get("direction") == "centre" else             f"{c.get('offset_km')} km {c.get('direction')} of the centre"
        body = (f"About {c.get('mean_change_db')} dB on average, {where}; the usual changed patch between "
                f"passes here is {usual} pixel{'' if usual == 1 else 's'}, this one {c.get('patch_px')}.")
    if c["status"] == "accepted":
        held = f" It held on the next pass ({c['held_on']})." if c.get("held_on") else ""
        return body + held + " Worth an expert's look."
    if c["status"] == "pending":
        return body + " Waiting for the next pass to see whether it holds."
    return body + f" Not flagged: {c.get('reason')}."


def public(w: dict, status: dict | None = None) -> dict:
    """The watch as the API returns it (no internal cursor)."""
    out = {k: v for k, v in w.items() if k != "state"}
    for p in out.get("passes") or []:
        p["image_url"] = f"/api/watches/{w['id']}/files/{p['image']}"
        p["hh_url"] = f"/api/watches/{w['id']}/files/{p['hh']}"
    out["candidates"] = [{**c, "headline": headline(c), "explanation": explain(c)} for c in w.get("candidates") or []]
    out["status"] = status or {"state": "idle"}
    out["disclaimer"] = DISCLAIMER
    out["refresh_hours"] = REFRESH_HOURS
    out["feed_url"] = f"/api/watches/{w['id']}/feed.atom"
    return out


def file_path(wid: str, rel: str) -> Path | None:
    """A watch's image, or ``None`` if ``rel`` escapes its folder."""
    if not valid_id(wid):
        return None
    root = (_folder(wid) / "scenes").resolve()
    path = (root / rel).resolve()
    if root not in path.parents or not path.is_file() or path.suffix not in (".webp", ".png"):
        return None
    return path


def atom(w: dict, page_url: str, feed_url: str) -> str:
    """An Atom feed of the watch's log, newest first."""
    from xml.sax.saxutils import escape

    entries = []
    for i, e in reversed(list(enumerate(w.get("log") or []))):
        summary = e.get("summary") or ""
        if e["kind"] in ("change", "pending"):
            summary = f"{summary} {DISCLAIMER}".strip()
        entries.append(
            "<entry>"
            f"<id>urn:nisar-watch:{escape(w['id'])}:{i}</id>"
            f"<title>{escape(e['title'])}</title>"
            f"<updated>{escape(e['at'])}</updated>"
            f'<link href="{escape(page_url)}"/>'
            f"<summary>{escape(summary)}</summary>"
            "</entry>"
        )
    updated = (w.get("log") or [{}])[-1].get("at") or w["created_at"]
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<feed xmlns="http://www.w3.org/2005/Atom">'
        f"<id>urn:nisar-watch:{escape(w['id'])}</id>"
        f"<title>NISAR Watch: {escape(w['name'])}</title>"
        f"<subtitle>{escape(DISCLAIMER)}</subtitle>"
        f"<updated>{escape(updated)}</updated>"
        f'<link rel="self" href="{escape(feed_url)}"/>'
        f'<link href="{escape(page_url)}"/>'
        + "".join(entries)
        + "</feed>"
    )
