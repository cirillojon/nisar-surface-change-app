"""Flask app factory.

Boot model (kept deliberately simple):

  • The web process is *only* responsible for serving requests.
  • Schema migrations and any background work are owned by ``bin/start``
    (and ``flask db upgrade`` / ``flask nisar load`` underneath).
    Web boot does not mutate the schema or spawn background threads.

Escape hatch: set ``AUTO_UPGRADE_ON_BOOT=1`` to run ``flask db upgrade``
from inside ``create_app()`` for one-off local hacking. Off by default;
not used in CI/prod.
"""
import logging
import os
import re
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from flask import Flask, g, jsonify, request
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy

load_dotenv()

# ─── Extensions ──────────────────────────────────────────────────────
db = SQLAlchemy()
# Autogenerate flags forwarded to alembic via Flask-Migrate's
# ``configure_args``:
#   compare_type           — catch column type changes
#   compare_server_default — catch default value changes
#   render_as_batch        — SQLite-safe ALTERs (no-op on Postgres)
# Without these, ``flask db migrate`` silently misses real model drift.
migrate = Migrate(compare_type=True, compare_server_default=True, render_as_batch=True)
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["120 per minute", "2000 per hour"],
    storage_uri=os.getenv("RATELIMIT_STORAGE_URI", "memory://"),
    headers_enabled=True,
)

# ─── Logging ─────────────────────────────────────────────────────────
from app.logging_config import configure_logging  # noqa: E402
configure_logging()
_flask_env = os.getenv("FLASK_ENV", "").lower()
_werkzeug_level = logging.INFO if _flask_env != "production" else logging.WARNING
logging.getLogger("werkzeug").setLevel(_werkzeug_level)
for _noisy in ("urllib3", "httpx", "httpcore"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

# ASCII-only request id: alphanumerics, dash, underscore; 1-64 chars.
# Intentionally stricter than ``str.isalnum()``, which accepts unicode
# letters/digits and would defeat log correlation.
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# Default data dir for the bundled SQLite database. Override with
# ``DATA_DIR`` env var or ``SQLALCHEMY_DATABASE_URI`` to point elsewhere.
_DEFAULT_DATA_DIR = "app-data"


def create_app():
    app = Flask(__name__)

    # Ensure the data directory exists for the default SQLite path.
    db_dir = os.path.join(os.getcwd(), os.getenv("DATA_DIR", _DEFAULT_DATA_DIR))
    os.makedirs(db_dir, exist_ok=True)

    default_db_path = os.path.join(db_dir, "data.db")
    db_uri = (
        os.getenv("SQLALCHEMY_DATABASE_URI")
        or os.getenv("DATABASE_URL")
        or f"sqlite:///{default_db_path}"
    )
    # Hosted Postgres providers hand out ``postgres://``, which SQLAlchemy 2
    # rejects.
    if db_uri.startswith("postgres://"):
        db_uri = "postgresql://" + db_uri[len("postgres://"):]

    # Flask-SQLAlchemy resolves relative ``sqlite:///`` paths against
    # ``app.instance_path``, not cwd — which surprises everyone. If the
    # caller passed a relative sqlite URI, rewrite it to an absolute
    # path under DATA_DIR so it lands where the user expects.
    if db_uri.startswith("sqlite:///") and not db_uri.startswith("sqlite:////"):
        rel = db_uri[len("sqlite:///"):]
        if rel != ":memory:" and not os.path.isabs(rel):
            abs_path = os.path.abspath(os.path.join(os.getcwd(), rel))
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            db_uri = f"sqlite:///{abs_path}"

    app.config["SQLALCHEMY_DATABASE_URI"] = db_uri
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["RATELIMIT_ENABLED"] = (
        os.getenv("RATELIMIT_ENABLED", "true").lower() not in ("0", "false", "no")
    )

    # Init extensions
    db.init_app(app)
    migrations_dir = os.path.join(os.path.dirname(__file__), "migrations")
    migrate.init_app(app, db, directory=migrations_dir)

    # CORS — strict in production, localhost-only in development.
    # Wildcard origins are NEVER allowed: they make CSRF + token-stealing
    # browser attacks trivially worse, and a misconfigured FLASK_ENV
    # shouldn't be enough to expose the API to every site on the web.
    raw_origins = os.getenv("ALLOWED_ORIGINS", "").strip()
    flask_env = os.getenv("FLASK_ENV", "").lower()
    if raw_origins:
        origins = [o.strip() for o in raw_origins.split(",") if o.strip()]
        if "*" in origins:
            raise RuntimeError(
                "ALLOWED_ORIGINS=* is not permitted. List explicit origins."
            )
        logger.info("CORS allowed origins: %s", origins)
    elif flask_env == "development":
        origins = [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:8880",
            "http://127.0.0.1:8880",
        ]
        logger.warning(
            "FLASK_ENV=development and ALLOWED_ORIGINS unset — "
            "defaulting CORS to localhost dev origins: %s", origins,
        )
    else:
        raise RuntimeError(
            "ALLOWED_ORIGINS must be set in production. "
            "Set ALLOWED_ORIGINS=https://your-frontend.example.com "
            "(comma-separated for multiple)."
        )
    CORS(app, resources={r"/api/*": {"origins": origins}}, supports_credentials=False)

    limiter.init_app(app)

    # Models must be imported before any query runs *or* before
    # alembic env.py reads ``db.metadata``.
    from app import models  # noqa: F401

    if os.getenv("AUTO_UPGRADE_ON_BOOT", "0") == "1":
        with app.app_context():
            try:
                from flask_migrate import upgrade
                logger.info("[boot] AUTO_UPGRADE_ON_BOOT=1 — running flask db upgrade")
                upgrade()
            except Exception:
                logger.exception("[boot] auto-upgrade failed")

    # Blueprints + CLI
    from app.routes.api import api_blueprint
    from app.routes.nisar import nisar_blueprint
    app.register_blueprint(api_blueprint, url_prefix="/api")
    app.register_blueprint(nisar_blueprint, url_prefix="/api/nisar")
    from app.routes.tools import openapi_blueprint
    app.register_blueprint(openapi_blueprint, url_prefix="/api")
    from app.routes.stories import stories_blueprint
    app.register_blueprint(stories_blueprint, url_prefix="/api")
    # The agent tool registry (/api/tools, which the MCP server wraps) is
    # read-only and needs no API key: on unless ENABLE_MCP=0. The AI
    # assistant calls Claude and is off unless ENABLE_AI=1.
    truthy = {"1", "true", "yes", "on"}
    ai_on = os.getenv("ENABLE_AI", "").strip().lower() in truthy
    mcp_on = ai_on or os.getenv("ENABLE_MCP", "1").strip().lower() in truthy
    if mcp_on:
        from app.routes.tools import tools_blueprint
        app.register_blueprint(tools_blueprint, url_prefix="/api")
    if ai_on:
        from app.routes.assistant import assistant_blueprint
        app.register_blueprint(assistant_blueprint, url_prefix="/api/assistant")

    from app.cli import register_cli
    register_cli(app)

    # Keep the API's error envelope JSON — Flask's defaults are HTML.
    @app.errorhandler(400)
    @app.errorhandler(404)
    @app.errorhandler(405)
    def handle_http_error(e):
        return jsonify({"error": e.description or e.name}), e.code

    @app.errorhandler(500)
    def handle_500_error(e):
        logger.exception("Internal server error")
        return jsonify({"error": "Internal server error"}), 500

    @app.errorhandler(429)
    def handle_429(e):
        return jsonify({
            "error": "Rate limit exceeded",
            "detail": getattr(e, "description", "too many requests"),
        }), 429

    # ─── Request tracing ──────────────────────────────────────
    # Honor an inbound ``X-Request-ID`` if (and only if) it looks safe —
    # short, ASCII alphanumeric + dash/underscore. Otherwise mint a fresh
    # UUID4 so a malicious client can't poison logs with control chars or
    # unbounded strings. The id is echoed on the response.
    @app.before_request
    def _attach_request_id():
        incoming = request.headers.get("X-Request-ID", "")
        if incoming and _SAFE_REQUEST_ID.match(incoming):
            g.request_id = incoming
        else:
            g.request_id = uuid.uuid4().hex

    @app.after_request
    def _echo_request_id(response):
        rid = getattr(g, "request_id", None)
        if rid:
            response.headers["X-Request-ID"] = rid
        return response

    app.boot_at = datetime.now(timezone.utc).replace(tzinfo=None)
    return app

