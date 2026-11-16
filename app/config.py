import os


class Config:
    """Static fallback config. The Flask app factory reads env vars
    directly, so this is mainly here for tests and ad-hoc imports."""

    SQLALCHEMY_DATABASE_URI = os.getenv(
        "SQLALCHEMY_DATABASE_URI",
        os.getenv("DATABASE_URL", "sqlite:///app-data/data.db"),
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "")
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
