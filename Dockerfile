# Backend image for Fly.io (see fly.toml and docs/DEPLOYMENT.md).
# The frontend is built and hosted separately (Vercel).
FROM python:3.11.13-slim

WORKDIR /app

# gcc/python3-dev: fallback for any dep without a wheel.
# sqlite3: WAL tuning in bin/start. util-linux: flock for the boot lock.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    sqlite3 \
    curl \
    util-linux \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first to leverage Docker layer cache
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App source. app/data/ (sites, observations, scene images) ships in the
# image and is loaded into SQLite on every boot.
COPY app/ ./app/
COPY bin/ ./bin/
COPY app.py ./

ENV FLASK_APP=app.py \
    FLASK_PORT=8880 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Strip CRLF from Windows checkouts, otherwise `#!/usr/bin/env bash\r`
# makes the container exit with `env: 'bash\r': No such file or directory`.
RUN sed -i 's/\r$//' /app/bin/start

# Persistent data dir: SQLite DB + SME2/DEM/profile caches (Fly volume)
RUN mkdir -p /app/app-data && chmod +x /app/bin/start

# Drop privileges
RUN useradd --create-home --shell /bin/bash app && chown -R app:app /app
USER app

EXPOSE 8880

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS "http://localhost:${FLASK_PORT}/api/health" || exit 1

ENTRYPOINT ["/app/bin/start"]
CMD ["prod"]
