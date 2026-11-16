"""Pytest fixtures for the backend.

Strategy:
- create_app() is invoked with FLASK_ENV=development so CORS doesn't
  fail-fast on missing ALLOWED_ORIGINS. Tests never go through bin/start,
  so the in-process loader / boot-time auto-load paths aren't exercised.
- The DB is an in-memory SQLite per test.
"""
import os
import pytest


@pytest.fixture(scope="session")
def _env():
    os.environ["FLASK_ENV"] = "development"
    os.environ["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    # Disable Flask-Limiter rate enforcement during tests.
    os.environ["RATELIMIT_ENABLED"] = "False"


@pytest.fixture()
def app(_env, monkeypatch):
    from app import create_app, db, limiter

    flask_app = create_app()
    limiter.enabled = False

    with flask_app.app_context():
        db.drop_all()
        db.create_all()
        yield flask_app
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def seeded_site(app):
    """Insert one Site with two scenes and their observations."""
    from datetime import date

    from app import db
    from app.models import Observation, Scene, Site

    site = Site(
        slug="test-subsidence",
        name="Test Basin",
        change_type="subsidence",
        description="Seeded by tests.",
        latitude=19.4,
        longitude=-99.0,
        min_lon=-99.2, min_lat=19.2, max_lon=-98.8, max_lat=19.6,
        product="GUNW",
        frame="019_A_011",
        reference_lon=-99.15, reference_lat=19.3,
        image_range=50.0,
    )
    db.session.add(site)
    db.session.flush()
    for day, value in ((1, 0.0), (13, -12.5)):
        db.session.add(Scene(
            site_id=site.id, acquired_on=date(2026, 6, day),
            quality="provisional", image=f"test-subsidence/2026-06-{day:02d}.webp",
        ))
        db.session.add(Observation(
            site_id=site.id,
            observed_on=date(2026, 6, day),
            metric="los_mm",
            value=value,
            unit="mm",
        ))
    db.session.commit()
    return site


@pytest.fixture(autouse=True)
def _clear_nisar_cache():
    from app import nisar

    nisar.clear_cache()
    yield
    nisar.clear_cache()
