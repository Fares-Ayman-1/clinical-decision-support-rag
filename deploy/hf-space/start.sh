#!/usr/bin/env bash
# Space entrypoint: three processes, one public port.
#
#   qdrant   127.0.0.1:6333  (internal — vector store)
#   uvicorn  127.0.0.1:8000  (internal — FastAPI)
#   nginx    0.0.0.0:7860    (public   — static bundle + /api proxy)
#
# Deliberately not supervisord: three processes with one hard ordering
# constraint do not need a supervisor, and `set -e` plus explicit readiness
# gates make a startup failure loud instead of a silent restart loop.
set -euo pipefail

log() { echo "[start] $*" >&2; }

# --- 1. Qdrant ------------------------------------------------------------
# Must precede uvicorn: load_app_resources() builds its QdrantClient during
# FastAPI's lifespan startup, so a not-yet-listening Qdrant is a failed boot.
log "starting qdrant"
cd /qdrant
./qdrant >/tmp/qdrant.log 2>&1 &
QDRANT_PID=$!

ready=0
for i in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:6333/healthz" >/dev/null 2>&1; then
    ready=1
    log "qdrant ready after ${i}s"
    break
  fi
  if ! kill -0 "$QDRANT_PID" 2>/dev/null; then
    log "FATAL: qdrant exited during startup; last log lines:"
    tail -30 /tmp/qdrant.log >&2 || true
    exit 1
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  log "FATAL: qdrant did not become healthy within 90s"
  tail -30 /tmp/qdrant.log >&2 || true
  exit 1
fi

# --- 2. Vector index ------------------------------------------------------
# Built here, not in the Dockerfile: the HF BUILD container OOMKilled (exit
# 137) embedding this corpus, while the Space RUNTIME has 16 GB. Skipped when a
# populated collection already exists, so a warm restart pays nothing.
#
# Point count is read with python + json rather than sed, because escaping a
# regex backreference through this file's own generation was a bug source and
# json parsing cannot silently return a partial match.
count_points() {
  python - <<'PYEOF' 2>/dev/null || echo 0
import json, urllib.request
try:
    with urllib.request.urlopen("http://127.0.0.1:6333/collections/medical_chunks", timeout=10) as r:
        print(json.load(r)["result"].get("points_count") or 0)
except Exception:
    print(0)
PYEOF
}

POINTS="$(count_points | tail -1)"
log "existing index points: ${POINTS}"

if [ "${POINTS}" -gt 0 ]; then
  log "index already present - skipping rebuild"
else
  log "no index found; building now (one-time, several minutes on 2 vCPU)"
  cd /app
  if python /app/scripts/build_mvp_index.py --source-config S1 --recreate; then
    log "index built: $(count_points | tail -1) points"
  else
    # Deliberately NOT fatal. An app that serves /api/health honestly with an
    # empty index is far easier to diagnose than a container that restart-loops
    # with no reachable endpoint at all.
    log "WARNING: index build FAILED - starting with an EMPTY index"
    log "         /api/health will report qdrant points: 0"
  fi
fi

# --- 3. Backend -----------------------------------------------------------
log "starting uvicorn"
cd /app
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 &
UVICORN_PID=$!

# --workers must stay 1: the rate limiter is an in-process sliding window, so N
# workers would each keep their own counter and the effective limit would
# silently become N x RATE_LIMIT_REQUESTS (see TODO-PRODUCTION.md - a shared
# Redis store is the real fix).

for i in $(seq 1 300); do
  if curl -fsS "http://127.0.0.1:8000/api/health" >/dev/null 2>&1; then
    log "backend ready after ${i}s"
    break
  fi
  if ! kill -0 "$UVICORN_PID" 2>/dev/null; then
    log "FATAL: uvicorn exited during startup"
    exit 1
  fi
  sleep 1
done

# --- 4. nginx (foreground) ------------------------------------------------
log "starting nginx on :7860"
exec nginx -g 'daemon off;'
