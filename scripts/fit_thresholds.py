#!/usr/bin/env python
"""Fit the Sufficiency Gate's tau_high/tau_low — PLAN.md Phase 13.

The gate decides whether the system answers, hedges, or refuses. Until now
its thresholds were placeholders guessed before any real cross-encoder
score existed (PROJECT-STATE.md) — so every refusal decision the system
made was arbitrary rather than calibrated. This script replaces the guess
with measured values.

Method
------
Retrieve real evidence packs for two labeled populations:

  in-domain  (dev)            -> the system SHOULD answer
  out-of-domain (out_of_domain) -> the system SHOULD refuse

Both are scored through the live pipeline (same retriever, same reranker,
same evidence-pack builder the server uses), so the fitted thresholds
apply to the deployed configuration rather than to a reimplementation of
it. Then sweep candidate thresholds over the observed score range and pick
by an explicit objective.

Objective, and why it is not accuracy
-------------------------------------
tau_low separates "answer at all" from "refuse". The two errors are not
symmetric in a medical context:

  false answer  — an out-of-domain question gets a confident-looking
                  evidence-backed reply. The corpus does not cover it, so
                  the answer is grounded in whatever the retriever
                  scraped up. This is the harmful error.
  false refusal — an in-domain question gets refused. Annoying, visibly
                  wrong to a judge, but safe.

So tau_low maximizes correct-refusal rate subject to a false-refusal
ceiling (SPEC.md's targets: correct refusal >= 90%, false refusal <= 10%),
rather than maximizing raw accuracy. When several thresholds tie on that
objective, the LOWEST is chosen — it refuses least while still meeting the
constraint, and a tie means the extra strictness buys nothing measurable.

tau_high separates SUFFICIENT from PARTIAL. There is no label for "should
have been confident", so this is NOT fitted against a ground truth — it is
set to a percentile of the in-domain score distribution, which is an
explicit, defensible policy choice ("the top X% of in-domain retrievals
are treated as strong") rather than a fake measurement. This distinction
is stated in the output so nobody reads the two numbers as equally earned.

Usage
-----
    python scripts/fit_thresholds.py                    # fit, print report
    python scripts/fit_thresholds.py --write            # also patch the module
    python scripts/fit_thresholds.py --max-false-refusal 0.10
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(REPO_ROOT / ".env")

from qdrant_client import QdrantClient  # noqa: E402

from app.api.dependencies import (  # noqa: E402
    CHUNK_STORE_PATH,
    MVP_SOURCE_CHUNKS_PATH,
    QDRANT_URL,
    _load_reranker,
)
from app.services.rag.chunk_store import load_chunk_store  # noqa: E402
from app.services.rag.evidence_pack import build_evidence_pack  # noqa: E402
from app.services.rag.retrieve_and_rerank import retrieve_and_rerank  # noqa: E402
from app.services.retrieval.bm25_index import build_bm25_index  # noqa: E402
from app.services.retrieval.embedding_provider import (  # noqa: E402
    SentenceTransformerProvider,
    load_embedding_config,
)
from app.services.retrieval.qdrant_index import load_chunks  # noqa: E402

EVAL_DIR = REPO_ROOT / "data" / "evaluation"
GATE_MODULE = REPO_ROOT / "backend" / "app" / "services" / "rag" / "sufficiency_gate.py"

# Percentile of the in-domain top-score distribution above which a
# retrieval is treated as SUFFICIENT rather than PARTIAL. A policy choice,
# not a fitted value — see module docstring.
TAU_HIGH_PERCENTILE = 60


def _load_split(name: str) -> list[dict]:
    path = EVAL_DIR / f"{name}.jsonl"
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def _collect_scores(queries, client, provider, bm25, chunk_store, reranker) -> list[float]:
    """Top signal score per query, straight from the live pipeline."""
    scores = []
    for q in queries:
        result = retrieve_and_rerank(
            client, None, provider, bm25, chunk_store, reranker,
            q["query"], q["query_id"],
        )
        pack = build_evidence_pack(result, chunk_store)
        # Mirror the gate's own signal selection exactly, so a fitted
        # threshold is always on the same scale the gate will compare
        # against at serving time.
        score = pack.top_rerank_score if pack.top_rerank_score is not None else pack.top_rrf_score
        scores.append(score)
    return scores


def _percentile(sorted_values: list[float], pct: float) -> float:
    if not sorted_values:
        return 0.0
    k = (len(sorted_values) - 1) * (pct / 100.0)
    lo, hi = int(k), min(int(k) + 1, len(sorted_values) - 1)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (k - lo)


def fit_tau_low(in_domain: list[float], ood: list[float], max_false_refusal: float):
    """Sweep every threshold the data can distinguish; return the one that
    refuses the most out-of-domain queries while keeping the false-refusal
    rate at or below the ceiling."""
    candidates = sorted(set(in_domain + ood))
    # Midpoints between observed scores — a threshold exactly ON an
    # observed value is decided by a >= comparison and is fragile to
    # floating-point noise; a midpoint is not.
    sweep = [candidates[0] - 1e-6]
    for a, b in zip(candidates, candidates[1:]):
        sweep.append((a + b) / 2)
    sweep.append(candidates[-1] + 1e-6)

    rows = []
    for tau in sweep:
        correct_refusal = sum(1 for s in ood if s < tau) / len(ood)
        false_refusal = sum(1 for s in in_domain if s < tau) / len(in_domain)
        rows.append((tau, correct_refusal, false_refusal))

    feasible = [r for r in rows if r[2] <= max_false_refusal]
    if not feasible:
        return None, rows
    # Maximize correct refusal; on a tie take the lowest threshold (it
    # refuses least for the same measured benefit).
    best = max(feasible, key=lambda r: (r[1], -r[0]))
    return best, rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--max-false-refusal", type=float, default=0.10,
                    help="Ceiling on false-refusal rate for in-domain queries (SPEC.md target: 0.10)")
    ap.add_argument("--tau-high-percentile", type=float, default=TAU_HIGH_PERCENTILE)
    ap.add_argument("--write", action="store_true",
                    help="Patch the fitted values into sufficiency_gate.py")
    args = ap.parse_args()

    chunks = load_chunks(MVP_SOURCE_CHUNKS_PATH)
    chunk_store = load_chunk_store(CHUNK_STORE_PATH)
    provider = SentenceTransformerProvider(load_embedding_config())
    bm25 = build_bm25_index(chunks)
    client = QdrantClient(url=QDRANT_URL)
    reranker = _load_reranker()

    signal = "rerank" if reranker.__class__.__name__ != "NullReranker" else "rrf"
    print(f"Reranker: {reranker.__class__.__name__}  ->  fitting the '{signal}' signal thresholds\n")

    dev = _load_split("dev")
    ood = _load_split("out_of_domain")
    print(f"Scoring {len(dev)} in-domain (dev) queries...")
    in_scores = _collect_scores(dev, client, provider, bm25, chunk_store, reranker)
    print(f"Scoring {len(ood)} out-of-domain queries...")
    ood_scores = _collect_scores(ood, client, provider, bm25, chunk_store, reranker)

    in_sorted, ood_sorted = sorted(in_scores), sorted(ood_scores)
    print("\nScore distributions (top score per query):")
    print(f"  in-domain     n={len(in_sorted):<3} min={in_sorted[0]:+.3f}  "
          f"median={_percentile(in_sorted, 50):+.3f}  max={in_sorted[-1]:+.3f}")
    print(f"  out-of-domain n={len(ood_sorted):<3} min={ood_sorted[0]:+.3f}  "
          f"median={_percentile(ood_sorted, 50):+.3f}  max={ood_sorted[-1]:+.3f}")

    overlap = in_sorted[0] < ood_sorted[-1]
    print(f"\n  Distributions overlap: {overlap}"
          + ("  <- no threshold can separate them perfectly" if overlap else "  <- cleanly separable"))

    best, rows = fit_tau_low(in_scores, ood_scores, args.max_false_refusal)
    print(f"\nSweeping tau_low ({len(rows)} candidate thresholds), "
          f"objective = max correct-refusal s.t. false-refusal <= {args.max_false_refusal:.0%}")
    if best is None:
        print("\n  NO FEASIBLE THRESHOLD. Every candidate exceeds the false-refusal ceiling.")
        print("  Raise --max-false-refusal, or treat this as evidence the signal does not")
        print("  separate these populations on this corpus. Not writing anything.")
        return 1

    tau_low, correct_refusal, false_refusal = best
    tau_high = _percentile(in_sorted, args.tau_high_percentile)

    print(f"\n  tau_low  = {tau_low:+.4f}   FITTED against labels")
    print(f"             correct refusal (out_of_domain): {correct_refusal:.0%}  [SPEC target >= 90%]")
    print(f"             false refusal   (dev in-domain): {false_refusal:.0%}  [SPEC target <= 10%]")
    print(f"\n  tau_high = {tau_high:+.4f}   POLICY, not fitted "
          f"(p{args.tau_high_percentile:g} of in-domain scores)")
    print("             No label exists for 'should have been confident', so this")
    print("             is a stated policy choice, not a measured optimum.")

    if correct_refusal < 0.90:
        print(f"\n  WARNING: correct-refusal {correct_refusal:.0%} is below SPEC.md's 90% target.")
        print("  The ceiling on false refusals binds before that target is reachable —")
        print("  report this honestly rather than loosening the ceiling to hit the number.")

    if args.write:
        _write_thresholds(signal, tau_low, tau_high)
        print(f"\n  Wrote {signal} thresholds into {GATE_MODULE.relative_to(REPO_ROOT)}")
    else:
        print("\n  (dry run — pass --write to patch sufficiency_gate.py)")
    return 0


def _write_thresholds(signal: str, tau_low: float, tau_high: float) -> None:
    text = GATE_MODULE.read_text(encoding="utf-8")
    suffix = signal.upper()
    # The rerank constants dropped their PROVISIONAL_ prefix once fitted;
    # the RRF ones keep it because they never were. Accept either spelling
    # so this script keeps working across that rename in both directions.
    for base, value in (("TAU_HIGH", tau_high), ("TAU_LOW", tau_low)):
        name = f"{base}_{suffix}"
        candidates = (name, f"PROVISIONAL_{name}")
        old_line = next(
            (ln for ln in text.splitlines() if any(ln.startswith(f"{c} =") for c in candidates)),
            None,
        )
        if old_line is None:
            raise RuntimeError(f"Could not find {' or '.join(candidates)} in {GATE_MODULE}")
        existing_name = old_line.split(" =")[0]
        text = text.replace(old_line, f"{existing_name} = {value:.4f}")
    GATE_MODULE.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
