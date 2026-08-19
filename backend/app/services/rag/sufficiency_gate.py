"""Sufficiency Gate — ARCHITECTURE.md §11, PLAN.md Phase 13.

Four states, thresholded on a calibrated relevance signal:

| State          | Condition                                              |
|----------------|----------------------------------------------------------|
| SUFFICIENT     | top_score >= tau_high and support_count >= 2            |
| PARTIAL        | top_score >= tau_low, thin/single-source support        |
| INSUFFICIENT   | top_score < tau_low                                      |
| OUT_OF_SCOPE   | no domain match AND INSUFFICIENT                          |

ARCHITECTURE.md specifies top_rerank_score as the signal, since reranker
logits are comparable/thresholdable in a way raw cosine is not. A real
cross-encoder is now active (R12 resolved), so this is the normal path.
This module still falls back to top_rrf_score when no rerank score exists
(reranker failure/timeout), clearly flagged via `signal_used` so nothing
downstream mistakes an RRF-based decision for a calibrated cross-encoder
one. Thresholds are separate per signal for exactly that reason — an RRF
threshold and a rerank-logit threshold are not the same scale and must
never be conflated.

Threshold provenance — the two numbers are NOT equally earned
-------------------------------------------------------------
The RERANK thresholds were fitted by scripts/fit_thresholds.py against the
labeled dev (25 in-domain) and out_of_domain (8) splits. Re-run it after
any change to the reranker, embedding model, or chunking config — a
threshold on a logit scale is meaningless if the model producing the
logits changes.

  tau_low  = -3.93  FITTED. Maximizes correct-refusal subject to a 10%
                    false-refusal ceiling. Measured: 88% correct refusal
                    (SPEC.md target >= 90%), 8% false refusal (target
                    <= 10%). The 90% target is NOT met and the shortfall
                    is real, not a rounding artifact — see below.
  tau_high = +0.73  POLICY, not fitted. No label exists for "should have
                    been confident", so this is the p60 of the in-domain
                    score distribution: a stated choice that the top 40%
                    of in-domain retrievals are treated as strong.

Measured limitation, recorded rather than tuned away: the in-domain and
out-of-domain score distributions genuinely OVERLAP, so no threshold
separates them perfectly. The single out-of-domain query that escapes
refusal is "What medication should I take for my child's ADHD?" (-1.26),
which scores highly because the corpus really does contain pediatric
medication content — the retrieval is good, the coverage is absent. That
is a corpus-scope problem, not a threshold problem, and lowering
tau_low to catch it would falsely refuse legitimate in-domain questions
(the weakest in-domain query scores -4.24, BELOW two out-of-domain ones).
Fixing it properly needs an explicit scope check, not a tighter number.

The RRF thresholds remain UNFITTED placeholders. They are only reachable
on the reranker-failure fallback path, and fitting them would require
deliberately disabling the reranker to collect an RRF-signal population.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from app.services.rag.evidence_pack import EvidencePack

MIN_SUPPORT_FOR_SUFFICIENT = 2

# Cross-encoder logit scale. The DEFAULTS were fitted by
# scripts/fit_thresholds.py against the labeled splits — see the module
# docstring for provenance and for why TAU_HIGH is a policy choice rather
# than a fitted value. Regenerate with:
#   python scripts/fit_thresholds.py --write
#
# Env-overridable because these numbers are married to ONE reranker's logit
# scale (the values below are cross-encoder/ms-marco-MiniLM-L-6-v2's): a
# reranker swap invalidates them completely, and recalibrating must not
# require an image rebuild — set SUFFICIENCY_TAU_{LOW,HIGH}_RERANK on the
# deployment and restart.
#
# !! UNCALIBRATED FOR THE CURRENT DEFAULT RERANKER !!
# The default reranker is now BAAI/bge-reranker-v2-m3 (multilingual), whose
# logit scale differs from ms-marco's — but the numbers below are still
# ms-marco's fitted values, because no labeled fit has been run against bge.
# They are therefore a placeholder, not a calibration.
#
# The gate FAILS OPEN, which is the dangerous direction. Measured against
# bge-reranker-v2-m3 in the built image, for the query "What diet helps with
# high blood pressure?":
#
#   relevant passage   +0.8687
#   related passage    +0.1373
#   irrelevant passage +0.0000   (a femur-fracture passage)
#
# bge outputs are sigmoid-normalised to roughly 0..1; ms-marco emitted raw
# logits spanning roughly -10..+10. So EVERY bge score clears
# tau_low = -3.9325, nothing is ever classified INSUFFICIENT, and the
# irrelevant passage above lands in PARTIAL — the system answers where it
# should refuse.
#
# That inverts the property this gate exists to provide. Until it is
# recalibrated, a deployment running bge should set
# SUFFICIENCY_TAU_{LOW,HIGH}_RERANK to values on the 0..1 scale.
#
# Fix with `python scripts/fit_thresholds.py --write` against the labeled
# splits while bge is the active reranker, then update the defaults below.
# Tracked in TODO-PRODUCTION.md as P0.
import os as _os

# Defaults recalibrated 2026-08-18 for cross-encoder/mmarco-mMiniLMv2-L12-H384-v1
# (multilingual swap): 20-query live-API calibration against the deployed stack
# (12 dev in-domain, 7 unique out-of-domain), tau_low = just under the
# in-domain minimum (-3.52) -> refuses 5/7 OOD with 0/12 false refusals;
# tau_high = in-domain p60. Directionally sound but coarser than the original
# fit_thresholds.py run - re-fit properly when a capable machine is available.
# (The ms-marco-era fitted values were -3.9325 / 0.7285.)
TAU_HIGH_RERANK = float(_os.environ.get("SUFFICIENCY_TAU_HIGH_RERANK", "-0.39"))
TAU_LOW_RERANK = float(_os.environ.get("SUFFICIENCY_TAU_LOW_RERANK", "-3.60"))

# RRF score scale (~0.01-0.06 for top-5 on this corpus). STILL PROVISIONAL —
# only reachable on the reranker-failure fallback path, never fitted.
PROVISIONAL_TAU_HIGH_RRF = 0.045
PROVISIONAL_TAU_LOW_RRF = 0.015


class SufficiencyState(str, Enum):
    SUFFICIENT = "SUFFICIENT"
    PARTIAL = "PARTIAL"
    INSUFFICIENT = "INSUFFICIENT"
    OUT_OF_SCOPE = "OUT_OF_SCOPE"


@dataclass(frozen=True)
class SufficiencyResult:
    state: SufficiencyState
    signal_used: str  # "rerank" | "rrf" — which score the decision was based on
    top_score: float
    support_count: int
    tau_high: float
    tau_low: float


def evaluate_sufficiency(
    pack: EvidencePack,
    tau_high_rerank: float = TAU_HIGH_RERANK,
    tau_low_rerank: float = TAU_LOW_RERANK,
    tau_high_rrf: float = PROVISIONAL_TAU_HIGH_RRF,
    tau_low_rrf: float = PROVISIONAL_TAU_LOW_RRF,
) -> SufficiencyResult:
    if pack.top_rerank_score is not None:
        signal_used = "rerank"
        top_score = pack.top_rerank_score
        tau_high, tau_low = tau_high_rerank, tau_low_rerank
    else:
        signal_used = "rrf"
        top_score = pack.top_rrf_score
        tau_high, tau_low = tau_high_rrf, tau_low_rrf

    # ARCHITECTURE.md's "domain match" is about whether the query has any
    # in-scope clinical domain at all (02_domain_classifier found
    # something) — not about whether the retrieved chunks match it. That
    # scoring is domain boosting's job, already applied upstream inside
    # hybrid_search before this pack was ever built.
    has_domain_match = bool(pack.predicted_domains)

    if top_score < tau_low:
        state = SufficiencyState.OUT_OF_SCOPE if not has_domain_match else SufficiencyState.INSUFFICIENT
    elif top_score >= tau_high and pack.support_count >= MIN_SUPPORT_FOR_SUFFICIENT:
        state = SufficiencyState.SUFFICIENT
    else:
        state = SufficiencyState.PARTIAL

    return SufficiencyResult(
        state=state, signal_used=signal_used, top_score=top_score,
        support_count=pack.support_count, tau_high=tau_high, tau_low=tau_low,
    )
