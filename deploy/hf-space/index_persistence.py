#!/usr/bin/env python
"""Qdrant index persistence for the HF Space — restore/publish snapshots.

Why this exists: free-tier Space storage is ephemeral, and rebuilding the
index means re-embedding ~7,400 chunks — 139 s under MiniLM but 30–90 min
under Qwen3-0.6B on 2 vCPU, during which every query 503s. A snapshot in a
HF dataset repo turns every restart after the first into a ~1-minute
download+restore instead of an embed-everything build.

Snapshot files are keyed by embedding_version (`medical_chunks-<version>.snapshot`),
so a model swap can never restore a stale vector space: the version string
changes, the filename misses, and the build path runs instead.

Usage (from start.sh):
    python index_persistence.py restore   # exit 0 = collection restored
    python index_persistence.py publish   # exit 0 = snapshot uploaded

Env:
    SNAPSHOT_REPO  dataset repo id (default FatimahEmadEldin/cds-qdrant-snapshots)
    HF_TOKEN       required for publish; restore works tokenless on a public repo
    QDRANT_URL     default http://127.0.0.1:6333
"""

from __future__ import annotations

import os
import pathlib
import sys

import httpx
import yaml

QDRANT = os.environ.get("QDRANT_URL", "http://127.0.0.1:6333")
REPO = os.environ.get("SNAPSHOT_REPO", "FatimahEmadEldin/cds-qdrant-snapshots")
COLLECTION = "medical_chunks"
CONFIG = pathlib.Path("/app/config/embedding.yaml")


def log(msg: str) -> None:
    print(f"[index-persistence] {msg}", flush=True)


def embedding_version() -> str:
    return yaml.safe_load(CONFIG.read_text(encoding="utf-8"))["embedding_version"]


def snapshot_filename() -> str:
    return f"{COLLECTION}-{embedding_version()}.snapshot"


def points_count() -> int:
    try:
        r = httpx.post(f"{QDRANT}/collections/{COLLECTION}/points/count", json={"exact": True}, timeout=30)
        if r.status_code != 200:
            return 0
        return int(r.json()["result"]["count"])
    except Exception:
        return 0


def restore() -> int:
    from huggingface_hub import hf_hub_download
    from huggingface_hub.errors import EntryNotFoundError, RepositoryNotFoundError

    name = snapshot_filename()
    log(f"looking for {name} in {REPO}")
    try:
        local = hf_hub_download(
            repo_id=REPO, repo_type="dataset", filename=name,
            token=os.environ.get("HF_TOKEN") or None,
        )
    except (EntryNotFoundError, RepositoryNotFoundError) as exc:
        log(f"no snapshot available ({type(exc).__name__}) - falling back to a full build")
        return 1
    except Exception as exc:  # network flake etc. — never block startup on this path
        log(f"snapshot download failed ({type(exc).__name__}: {exc}) - falling back to a full build")
        return 1

    size_mb = pathlib.Path(local).stat().st_size / 1e6
    log(f"downloaded {size_mb:.0f} MB, restoring into qdrant")
    # priority=snapshot: the uploaded snapshot's data wins over anything local.
    with open(local, "rb") as f:
        r = httpx.post(
            f"{QDRANT}/collections/{COLLECTION}/snapshots/upload",
            params={"priority": "snapshot"},
            files={"snapshot": (name, f, "application/octet-stream")},
            timeout=600,
        )
    if r.status_code != 200:
        log(f"qdrant restore failed: HTTP {r.status_code} {r.text[:200]}")
        return 1
    pts = points_count()
    log(f"restored: {pts} points")
    return 0 if pts > 0 else 1


def publish() -> int:
    token = os.environ.get("HF_TOKEN", "").strip()
    if not token:
        log("HF_TOKEN not set - skipping snapshot publish (next cold start will rebuild)")
        return 1

    pts = points_count()
    if pts <= 0:
        log("collection empty - nothing to publish")
        return 1

    log(f"creating qdrant snapshot of {pts} points")
    r = httpx.post(f"{QDRANT}/collections/{COLLECTION}/snapshots", timeout=600)
    if r.status_code != 200:
        log(f"snapshot create failed: HTTP {r.status_code} {r.text[:200]}")
        return 1
    remote_name = r.json()["result"]["name"]

    local = pathlib.Path(f"/tmp/{snapshot_filename()}")
    with httpx.stream("GET", f"{QDRANT}/collections/{COLLECTION}/snapshots/{remote_name}", timeout=600) as resp:
        if resp.status_code != 200:
            log(f"snapshot download failed: HTTP {resp.status_code}")
            return 1
        with local.open("wb") as f:
            for chunk in resp.iter_bytes():
                f.write(chunk)
    log(f"snapshot is {local.stat().st_size / 1e6:.0f} MB, uploading to {REPO}")

    from huggingface_hub import HfApi

    api = HfApi(token=token)
    api.create_repo(repo_id=REPO, repo_type="dataset", exist_ok=True)
    api.upload_file(
        repo_id=REPO, repo_type="dataset",
        path_or_fileobj=str(local), path_in_repo=snapshot_filename(),
        commit_message=f"snapshot: {pts} points, embedding_version={embedding_version()}",
    )
    log("published")

    # Housekeeping: the qdrant-side snapshot and the /tmp copy both double the
    # index's disk footprint on a small container — delete once uploaded.
    local.unlink(missing_ok=True)
    httpx.delete(f"{QDRANT}/collections/{COLLECTION}/snapshots/{remote_name}", timeout=60)
    return 0


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "restore":
        sys.exit(restore())
    if mode == "publish":
        sys.exit(publish())
    print("usage: index_persistence.py restore|publish", file=sys.stderr)
    sys.exit(2)
