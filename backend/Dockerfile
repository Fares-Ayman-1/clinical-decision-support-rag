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
# requirements-serve.txt, NOT requirements.txt: the serving subset, which
# omits pymupdf/pdfplumber/scikit-learn/scipy/aiosqlite/structlog/pytest.
# That file documents how the omission was verified (importing app.main and
# checking sys.modules, not by reading imports).
#
# --extra-index-url pins torch to the CPU build. Without it pip installs the
# default Linux wheel, which is the CUDA build and drags in ~2.5 GB of
# nvidia-* packages for an application that runs MiniLM and a cross-encoder
# on CPU and never touches a GPU.
COPY requirements-serve.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    --mount=type=secret,id=pip_ca,required=false \
    if [ -s /run/secrets/pip_ca ]; then export PIP_CERT=/run/secrets/pip_ca; fi; \
    pip install --extra-index-url https://download.pytorch.org/whl/cpu \
                -r requirements-serve.txt

COPY backend/ ./backend/
COPY config/ ./config/

# The two files the app opens at startup (app/api/dependencies.py:
# CHUNK_STORE_PATH and MVP_SOURCE_CHUNKS_PATH). docker-compose.yml
# bind-mounts data/ locally, but a PaaS has no bind mounts, so an image
# without these cannot serve a single request. .dockerignore excludes the
# rest of data/ and re-includes exactly these two.
#
# config/ likewise ships in the image rather than relying on the mount: the
# red-flag and emergency rules are safety-critical inputs (SAF-2.4, SAF-6.5)
# and load_rules() raises on missing provenance, so a config-less image
# fails at boot instead of at a patient's first question.
COPY data/chunk_store/medical_chunks.jsonl ./data/chunk_store/
COPY data/chunks/benchmark/1.0_S1.jsonl ./data/chunks/benchmark/

# Run as a non-root user. The app writes nothing outside the HF cache, so
# this costs nothing and removes root from the container's blast radius.
RUN useradd --create-home --uid 10001 appuser \
  && mkdir -p /app/.cache/huggingface \
  && chown -R appuser:appuser /app
USER appuser

# Bake both models into the image. They are ~180 MB together and otherwise
# download from HuggingFace on first use (~80 s cold, per .env.example).
# A PaaS filesystem is ephemeral, so without this every restart re-downloads
# them — turning a one-off build cost into a recurring startup cost, and
# making cold starts depend on HF being reachable. Runs AFTER `USER appuser`
# so the files land in an HF_HOME that the runtime user actually owns.
#
# The CA secret is mounted here too, and pointed at through SSL_CERT_FILE /
# REQUESTS_CA_BUNDLE rather than PIP_CERT: huggingface_hub does its own HTTPS
# via requests/certifi, so the pip-specific variable does not apply and this
# step fails with "couldn't connect to huggingface.co" on an intercepted
# network even when pip succeeded moments earlier.
#
# uid=10001 because the mount defaults to root-owned 0400 and this RUN
# executes as appuser, which could not otherwise read it.
RUN --mount=type=secret,id=pip_ca,required=false,uid=10001 \
    if [ -s /run/secrets/pip_ca ]; then \
      export SSL_CERT_FILE=/run/secrets/pip_ca \
             REQUESTS_CA_BUNDLE=/run/secrets/pip_ca \
             CURL_CA_BUNDLE=/run/secrets/pip_ca; \
    fi; \
    python -c "\
from sentence_transformers import SentenceTransformer, CrossEncoder; \
SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2'); \
CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')"

# Documentation only — the real port is $PORT at runtime (see CMD).
EXPOSE 8000

# Hits the real readiness endpoint, which reports `degraded` when Qdrant or
# the Chunk Store is unavailable. Long start-period: startup still loads the
# embedding model and warms the cross-encoder even with the weights baked in.
# Most PaaS platforms ignore this and use their own configured health path;
# it is kept so `docker compose` reports honest health locally.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/api/health" || exit 1

# Shell form, deliberately: a PaaS assigns the port at runtime via $PORT, and
# the exec form would pass the literal string "${PORT}" to uvicorn. `exec` so
# uvicorn replaces the shell as PID 1 and receives SIGTERM on shutdown —
# without it the shell holds PID 1, swallows the signal, and every deploy
# ends in a 10-second SIGKILL instead of a clean drain.
#
# Single worker deliberately. The rate limiter (NFR-3.3) keeps its counters
# in process memory, so N workers would permit N x the configured limit —
# the limitation is documented in RateLimitMiddleware's docstring and
# tracked in TODO-PRODUCTION.md. Scaling out needs a shared store first.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
