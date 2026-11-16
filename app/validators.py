"""Lightweight request-payload validators.

Kept dependency-free so we don't pull in pydantic/marshmallow for a small
surface area. Each helper raises ValueError with a user-safe message on
invalid input; callers translate to a 400 JSON response.
"""
import math
import re
from datetime import date

# Generic external IDs: ASCII alphanumerics + dash/underscore/dot/colon.
_ID_RE = re.compile(r"^[A-Za-z0-9_\-\.:]{1,80}$")

MAX_BULK_IDS = 500


def validate_choice(value, field, choices):
    if not isinstance(value, str) or value not in choices:
        raise ValueError(f"{field} must be one of: {', '.join(sorted(choices))}")
    return value


def validate_float(value, field, min_value, max_value):
    # bool is an int subclass; reject it explicitly.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be a number")
    v = float(value)
    if not math.isfinite(v) or v < min_value or v > max_value:
        raise ValueError(f"{field} must be between {min_value} and {max_value}")
    return v


def validate_optional_date(value, field):
    """``None``/``""`` → ``None``; otherwise an ISO ``YYYY-MM-DD`` string."""
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a YYYY-MM-DD string")
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        raise ValueError(f"{field} must be a YYYY-MM-DD string") from None


def validate_bbox(value, field="bbox"):
    """``[min_lon, min_lat, max_lon, max_lat]`` list, or a comma string of the same."""
    if isinstance(value, str):
        value = value.split(",")
        try:
            value = [float(v) for v in value]
        except ValueError:
            raise ValueError(f"{field} must be min_lon,min_lat,max_lon,max_lat") from None
    if not isinstance(value, list) or len(value) != 4:
        raise ValueError(f"{field} must be [min_lon, min_lat, max_lon, max_lat]")
    min_lon = validate_float(value[0], f"{field} min_lon", -180, 180)
    min_lat = validate_float(value[1], f"{field} min_lat", -90, 90)
    max_lon = validate_float(value[2], f"{field} max_lon", -180, 180)
    max_lat = validate_float(value[3], f"{field} max_lat", -90, 90)
    if min_lon >= max_lon or min_lat >= max_lat:
        raise ValueError(f"{field} min values must be less than max values")
    return [min_lon, min_lat, max_lon, max_lat]


def validate_id(value, field):
    if value is None or not isinstance(value, str):
        raise ValueError(f"{field} is required")
    v = value.strip()
    if not v:
        raise ValueError(f"{field} is required")
    if not _ID_RE.match(v):
        raise ValueError(f"{field} has invalid format")
    return v


def validate_id_list(value, field):
    """Validate a list of positive integer IDs (e.g. for bulk delete).

    Always capped at ``MAX_BULK_IDS`` so a malicious client can't OOM
    the worker by POSTing a million-element array.
    """
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    if len(value) > MAX_BULK_IDS:
        raise ValueError(f"{field} exceeds {MAX_BULK_IDS} entries")
    out = []
    for i, item in enumerate(value):
        if not isinstance(item, int) or item <= 0:
            raise ValueError(f"{field}[{i}] must be a positive integer")
        out.append(item)
    return out
