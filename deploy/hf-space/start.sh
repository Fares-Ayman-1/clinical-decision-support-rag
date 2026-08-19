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
elif python /usr/local/bin/index_persistence.py restore; then
  # Fast path: a snapshot for this exact embedding_version exists in the
  # dataset repo. Download + restore is ~1 minute vs 30-90 min of re-embedding.
  log "index restored from published snapshot"
else
  # BACKGROUNDED, deliberately. Embedding 7,381 chunks with a 0.6B model on
  # 2 vCPU takes far longer than the ~30 minutes Hugging Face allows a Space
  # to bind its port -- a foreground build here left the Space stuck in
  # APP_STARTING until the platform killed it. Backgrounding lets nginx bind
  # :7860 within minutes; until the build lands, /api/health honestly reports
  # the current point count and queries answer with a refusal.
  # Progress: /tmp/index-build.log.
  log "no snapshot; building in the BACKGROUND (watch /tmp/index-build.log)"
  (
    cd /app
    if python /app/scripts/build_mvp_index.py --source-config S1 --recreate         >/tmp/index-build.log 2>&1; then
      echo "[index-build] done: $(count_points | tail -1) points" >&2
      # Publish so every future cold start takes the restore fast path.
      # Needs the HF_TOKEN Space secret; logs-and-skips without it.
      python /usr/local/bin/index_persistence.py publish >&2 || true
    else
      echo "[index-build] FAILED - /api/health will keep reporting 0 points;" >&2
      echo "[index-build] see /tmp/index-build.log" >&2
    fi
  ) &
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

# --- 3b. faqarati Express API ----------------------------------------------
# Schedules/exercises/Einstein endpoints for the faqarati UI. esbuild bundle,
# so the node BINARY is the only runtime dependency. cwd matters: graph.json
# and search_index.json are resolved from the working directory.
log "starting faqarati api on :3000"
(cd /faq && node server-bundle.cjs >/tmp/faqarati.log 2>&1) &
FAQ_PID=$!

# --- 4. nginx (foreground) ------------------------------------------------
log "starting nginx on :7860"
exec nginx -g 'daemon off;'
