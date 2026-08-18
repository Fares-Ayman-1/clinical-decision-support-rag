# syntax=docker/dockerfile:1.7
#
# Referenced by docker-compose.yml's `api` service, which could not build
# without it — `docker compose up` failed with "failed to read dockerfile".
#
# Build context is the REPO ROOT (see compose: context: .), not backend/,
# because the app imports from backend/app and reads config/ and data/ at
# startup.

FROM python:3.13-slim AS runtime

# PYTHONUNBUFFERED so the JSON log lines from app.observability.logging
# reach the container log as they happen rather than sitting in a buffer —
# without it, `docker logs` shows nothing until the buffer flushes, which
# is exactly wrong for the structured logging NFR-7.1 asks for. (Observed
# while running the evaluation harness: redirected stdout stayed empty for
# the whole run.)
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # backend/ on the path so `import app...` resolves, matching how the
    # app is run bare-metal and how tests/conftest.py sets it up.
    PYTHONPATH=/app/backend \
    # Keep model downloads inside the image/volume rather than re-fetching
    # per container start.
    HF_HOME=/app/.cache/huggingface

WORKDIR /app

# curl for the healthcheck below. Build tools are NOT installed: every
# pinned dependency ships a wheel for cp313, and adding gcc would roughly
# double the image for nothing.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

# Dependencies first, as their own layer: requirements.txt changes far less
# often than application code, and this install is slow (torch pulls in via
# sentence-transformers).
# The optional pip_ca secret mirrors the frontend's npm_ca: on a network
# with TLS interception (corporate proxy, or a consumer AV that re-signs
# HTTPS — this repo hit exactly that, PROJECT-STATE.md R12), pip cannot
# verify pypi.org because the interceptor's root CA is not in the image.
# Supplying the CA as a build secret keeps it OUT of the image layers,
# unlike COPYing a cert or, far worse, --trusted-host, which would disable
# verification for a build that installs executable code.
#
#   docker build --secret id=pip_ca,src=/path/to/corp-root.crt ...
#
# required=false so a normal network builds with no extra arguments.
COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    --mount=type=secret,id=pip_ca,required=false \
    if [ -s /run/secrets/pip_ca ]; then export PIP_CERT=/run/secrets/pip_ca; fi; \
    pip install -r requirements.txt

COPY backend/ ./backend/
COPY config/ ./config/

# data/ and config/ are bind-mounted by docker-compose.yml at runtime.
# config/ is also COPYed above so the image is runnable on its own — the
# red-flag and emergency rules are safety-critical inputs (SAF-2.4,
# SAF-6.5) and an image that starts without them would fail at the first
# request rather than at build time.

# Run as a non-root user. The app writes nothing outside the HF cache, so
# this costs nothing and removes root from the container's blast radius.
RUN useradd --create-home --uid 10001 appuser \
  && mkdir -p /app/.cache/huggingface \
  && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Hits the real readiness endpoint, which reports `degraded` when Qdrant or
# the Chunk Store is unavailable. Long start-period: startup loads the
# embedding model AND warms the cross-encoder (app/api/dependencies.py),
# which takes tens of seconds on a cold cache — a shorter window would
# report unhealthy during normal startup.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

# Single worker deliberately. The rate limiter (NFR-3.3) keeps its counters
# in process memory, so N workers would permit N x the configured limit —
# the limitation is documented in RateLimitMiddleware's docstring and
# tracked in TODO-PRODUCTION.md. Scaling out needs a shared store first.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
