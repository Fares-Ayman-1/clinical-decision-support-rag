"""Query orchestrator — composes Phases 6-12 into one pipeline call for
the API layer. SPEC.md §F.1 POST /api/query.

Pipeline: red-flag precheck -> prescribing check -> symptom extraction ->
domain classification -> query rewrite -> multi-query retrieval+rerank ->
Evidence Pack -> Sufficiency Gate -> (refusal | grounded generation ->
citation resolution -> dose scan) -> risk assessment -> decision actions.

Ordering is a safety property, not a style choice:

- The red-flag precheck runs FIRST (SAF-6.1) so a possible emergency is
  never delayed behind retrieval and 4+ sequential LLM calls. Its urgency
  floor survives every later stage, including refusals.
- The prescribing check short-circuits BEFORE the pipeline (SAF-7.3) —
  a prescription request gets a referral, and spending a full pipeline
  run to build an answer that must then be suppressed serves nobody.
- The dose scan runs LAST, on generated output (SAF-7.2), because that is
  the only point where the text a user would actually see exists.

Every field returned corresponds to a subsystem that actually exists and
was tested — trace stages are real, never fabricated to satisfy the
frontend's fixed 13-stage design.
"""

from __future__ import annotations

import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from qdrant_client import QdrantClient

from app.llm.provider import LLMProvider, SchemaViolationError, TransientProviderError
from app.prompts.domain_classifier import classify_domains
from app.prompts.grounded_generator import generate_grounded_answer
from app.prompts.query_rewriter import rewrite_query
from app.prompts.symptom_extractor import extract_patient_state
from app.schemas.query import strip_profile_preamble
from app.services.rag.chunk_store import ChunkStore
from app.services.rag.citation_resolver import ResolvedAnswer, resolve_and_validate
from app.services.rag.evidence_pack import EvidencePack, build_evidence_pack
from app.services.rag.retrieve_and_rerank import PipelineResult
from app.services.rag.sufficiency_gate import SufficiencyResult, SufficiencyState, evaluate_sufficiency
from app.services.decisions.decision_engine import DecisionActions, decide_actions
from app.services.reranking.reranker import Reranker
from app.services.risk.risk_engine import RiskAssessment, assess_risk
from app.services.safety.prescribing_guard import (
    PRESCRIBING_REFERRAL_MESSAGES,
    DOSE_BLOCKED_MESSAGES,
    DoseScanResult,
    detect_prescription_request,
    scan_for_dose_patterns,
)
from app.services.safety.red_flags import RedFlagResult, Urgency, check_red_flags
from app.services.retrieval.bm25_index import BM25Index
from app.services.retrieval.embedding_provider import SentenceTransformerProvider
from app.services.retrieval.hybrid_search import RetrievalRun, hybrid_search_multi_query

RERANK_INPUT_SIZE = 25
FINAL_TOP_K = 5

# SufficiencyState is the gate's internal vocabulary; the API's refusal
# `reason` is a separate, narrower contract (SPEC.md §F / RefusalOut's
# Literal). They overlap on OUT_OF_SCOPE but NOT on INSUFFICIENT, which
# the API calls INSUFFICIENT_EVIDENCE — so the state's raw .value is not
# a valid reason code and must be mapped, never passed through.
REFUSAL_REASON_CODES = {
    SufficiencyState.INSUFFICIENT: "INSUFFICIENT_EVIDENCE",
    SufficiencyState.OUT_OF_SCOPE: "OUT_OF_SCOPE",
}

# Language-keyed: refusals are fixed strings, so the generator's
# answer-in-the-question's-language rule never touches them — without
# this, an Arabic question gets an English refusal (observed live).
REFUSAL_MESSAGES = {
    SufficiencyState.INSUFFICIENT: {
        "en": (
            "I do not have sufficient evidence in the approved medical knowledge base to answer this "
            "reliably. If your symptoms are severe, rapidly worsening, or you are concerned about an "
            "emergency, seek professional medical evaluation."
        ),
        "ar": (
            "لا تتوفر لديّ أدلة كافية في قاعدة المعرفة الطبية المعتمدة للإجابة على هذا السؤال "
            "بموثوقية. إذا كانت أعراضك شديدة أو تتفاقم بسرعة أو كنت قلقًا من حالة طارئة، "
            "فاطلب تقييمًا طبيًا متخصصًا."
        ),
    },
    SufficiencyState.OUT_OF_SCOPE: {
        "en": (
            "This question is outside the medical topics covered by this system's knowledge base. "
            "Please consult a healthcare professional or an appropriate resource for this question."
        ),
        "ar": (
            "هذا السؤال خارج نطاق المواضيع الطبية التي تغطيها قاعدة معرفة هذا النظام. "
            "يُرجى استشارة مختص رعاية صحية أو الرجوع إلى مصدر مناسب لهذا السؤال."
        ),
    },
}

_ARABIC_CHARS = re.compile("[؀-ۿݐ-ݿࢠ-ࣿ]")


def _message_language(text: str) -> str:
    """'ar' when the question is written mostly in Arabic script, else 'en'.
    Mirrors the grounded generator's script detection but only needs the
    one distinction the fixed refusal strings actually have translations
    for — anything non-Arabic falls back to English rather than guessing."""
    text = strip_profile_preamble(text)
    letters = [ch for ch in text if ch.isalpha()]
    if not letters:
        return "en"
    arabic = sum(1 for ch in letters if _ARABIC_CHARS.match(ch))
    return "ar" if arabic / len(letters) > 0.5 else "en"


# Front-matter chunks — copyright pages, forewords, tables of contents —
# repeat the document title ("...chronic primary low back pain...") with
# zero clinical content, so they outrank real guidance on exactly the
# queries the document exists to answer (observed live: the WHO LBP
# guideline's page-1 copyright chunks took 2 of 5 evidence slots for
# "back pain", dragging the rerank top score toward tau_low). Filtered
# here at candidate hydration — after dense+BM25, before rerank — so both
# retrieval arms are covered without touching the built index.
_FRONT_MATTER_SECTION = re.compile(
    "^(?:©|copyright|acknowledg|contents|table of contents|foreword|preface)",
    re.IGNORECASE,
)
_FRONT_MATTER_TEXT = re.compile(
    r"\bISBN\b|Creative Commons|CC BY-NC-SA|Suggested citation\.|"
    r"WHO logo|Errors and omissions excepted|General disclaimers\.",
)


def _is_front_matter(section_path: str | None, text: str | None) -> bool:
    if _FRONT_MATTER_SECTION.match((section_path or "").strip()):
        return True
    return bool(_FRONT_MATTER_TEXT.search((text or "")[:400]))


@dataclass(frozen=True)
class TraceStage:
    name: str
    latency_ms: float
    output: dict


class TraceRecorder:
    """Collects real per-stage timing/output as the pipeline runs. Only
    stages that actually execute are recorded — there is no placeholder
    entry for red_flag_check/risk/decision, since those subsystems don't
    exist (PROJECT-STATE.md decision D5; Phase 15 not started)."""

    def __init__(self):
        self.stages: list[TraceStage] = []
        self._stage_start: float | None = None

    def start(self) -> None:
        self._stage_start = time.perf_counter()

    def record(self, name: str, output: dict, latency_ms: float | None = None) -> None:
        """Records a stage. Latency defaults to elapsed-since-last-record,
        which is correct for sequential stages.

        Pass `latency_ms` explicitly for a stage that ran CONCURRENTLY with
        others: the elapsed-time default would otherwise attribute the
        whole overlapping window to whichever stage recorded last, making
        a parallelized pipeline look slower per-stage than it is and the
        stage times sum to more than the total.
        """
        assert self._stage_start is not None, "start() must be called before record()"
        if latency_ms is None:
            latency_ms = (time.perf_counter() - self._stage_start) * 1000
        self.stages.append(TraceStage(name=name, latency_ms=latency_ms, output=output))
        self._stage_start = time.perf_counter()

    def as_dict(self) -> dict:
        return {"stages": [{"name": s.name, "latency_ms": s.latency_ms, "output": s.output} for s in self.stages]}


@dataclass(frozen=True)
class OrchestratorResult:
    request_id: str
    status: str  # "success" | "refusal"
    supported_domain: bool
    domains: list[str]
    patient_state: dict | None
    resolved_answer: ResolvedAnswer | None
    refusal_reason: str | None
    refusal_message: str | None
    pack: EvidencePack | None
    sufficiency: SufficiencyResult | None
    retrieval: RetrievalRun | None
    latency_ms: float
    trace: dict = field(default_factory=dict)
    # Safety layer (Phase 14/15). red_flags is always populated — the
    # precheck runs on every request before anything else. risk/decision
    # are populated once urgency is assessable.
    red_flags: RedFlagResult | None = None
    risk: RiskAssessment | None = None
    decision: DecisionActions | None = None
    dose_block: DoseScanResult | None = None


def _select_rerank_query(patient_message: str, english_variants: list[str]) -> str:
    """English questions keep the original — the sufficiency-gate thresholds
    were fitted on exactly that population. A mostly-non-Latin question falls
    back to its first English rewrite so the English-only cross-encoder scores
    a pair it can actually judge. Threshold: <50% of alphabetic characters are
    ASCII (an Arabic/Chinese/Russian question fails that decisively; an English
    question with a stray unicode symbol passes it)."""
    if not english_variants:
        return patient_message
    letters = [c for c in patient_message if c.isalpha()]
    if not letters:
        return patient_message
    latin = sum(1 for c in letters if c.isascii())
    if latin / len(letters) >= 0.5:
        return patient_message
    return english_variants[0]


def run_query(
    client: QdrantClient,
    config_id: str | None,
    embedding_provider: SentenceTransformerProvider,
    bm25: BM25Index,
    chunk_store: ChunkStore,
    reranker: Reranker,
    llm: LLMProvider,
    patient_message: str,
    include_trace: bool = False,
) -> OrchestratorResult:
    t0 = time.perf_counter()
    request_id = str(uuid.uuid4())
    trace = TraceRecorder()
    trace.start()

    # Fixed refusal strings must come back in the question's language —
    # the generator's language rule only covers LLM-written answers.
    msg_lang = _message_language(patient_message)

    # SAF-6.1 — BEFORE anything expensive. A possible emergency must not
    # wait on retrieval plus four sequential LLM calls.
    red_flags = check_red_flags(patient_message)
    trace.record("red_flag_check", {
        "triggered": red_flags.triggered,
        "urgency_floor": red_flags.urgency_floor.value,
        "rules_version": red_flags.rules_version,
        "matches": [
            {"rule_id": m.rule_id, "label": m.label, "matched_text": list(m.matched_text),
             "source_chunk_id": m.source.chunk_id}
            for m in red_flags.matches
        ],
    })

    # SAF-7.3 — a prescription request returns a referral, not a partial
    # answer. Short-circuits before the pipeline: there is no version of
    # this answer the system is permitted to give, so building one first
    # would only risk leaking it.
    if detect_prescription_request(patient_message):
        trace.record("prescribing_check", {"prescription_request_detected": True, "action": "referral"})
        risk = assess_risk(patient_message, red_flags, "OUT_OF_SCOPE", 0)
        decision = decide_actions(risk.urgency, "OUT_OF_SCOPE", 0, is_refusal=True, lang=msg_lang)
        return OrchestratorResult(
            request_id=request_id, status="refusal",
            supported_domain=False, domains=[], patient_state=None,
            resolved_answer=None, refusal_reason="PRESCRIBING_REQUEST",
            refusal_message=PRESCRIBING_REFERRAL_MESSAGES[msg_lang],
            pack=None, sufficiency=None, retrieval=None,
            latency_ms=(time.perf_counter() - t0) * 1000,
            trace=trace.as_dict() if include_trace else {},
            red_flags=red_flags, risk=risk, decision=decision,
        )

    # query_rewrite takes only the raw patient message, so it has no
    # dependency on extraction or domain classification and can run
    # concurrently with that chain. Measured: extraction 6.6s ->
    # domain_predict 2.7s is a real dependency chain (classification
    # consumes the extracted state), while rewrite is 5.5s of independent
    # work — overlapping it removes ~5.5s of the ~30s total. The two
    # branches issue separate HTTP calls to the LLM provider, which is
    # thread-safe (the OpenAI SDK client is), so a thread pool is
    # sufficient and avoids making this whole function async.
    def _timed_rewrite():
        """Times itself, since a concurrent stage's duration cannot be
        derived from the recorder's sequential elapsed-time default."""
        started = time.perf_counter()
        result = rewrite_query(llm, patient_message)
        return result, (time.perf_counter() - started) * 1000

    with ThreadPoolExecutor(max_workers=2) as pool:
        rewrite_future = pool.submit(_timed_rewrite)
        rewrite_started = time.perf_counter()

        patient_state = extract_patient_state(llm, patient_message)
        trace.record("extraction", {"symptoms": patient_state.symptoms, "missing_information": patient_state.missing_information})

        domain_classification = classify_domains(llm, patient_state)
        predicted_domains = domain_classification.domains
        trace.record("domain_predict", {"domains": predicted_domains, "reasoning": domain_classification.reasoning})

        try:
            rewrite_result, rewrite_ms = rewrite_future.result()
            queries = [patient_message] + rewrite_result.variants
            trace.record("query_rewrite", {"variants": rewrite_result.variants}, latency_ms=rewrite_ms)
        except TransientProviderError:
            # A transport failure is not a rewrite problem. Degrading here
            # would let an outage masquerade as a successful-but-narrower
            # query — precisely the corruption an evaluation harness must
            # be able to see. Re-raise so the caller records a failure.
            raise
        except SchemaViolationError as e:
            # A rewrite failure must not abort the whole query — fall back
            # to the original message alone rather than propagate.
            queries = [patient_message]
            trace.record(
                "query_rewrite", {"variants": [], "fallback_reason": str(e)},
                latency_ms=(time.perf_counter() - rewrite_started) * 1000,
            )
        except Exception as e:  # noqa: BLE001 — same degradation, wider net.
            # Running in a worker thread means any provider-level error
            # (timeout, connection reset) surfaces here rather than at the
            # call site. Retrieval works fine on the original query alone,
            # so degrading beats failing the whole request.
            queries = [patient_message]
            trace.record(
                "query_rewrite", {"variants": [], "fallback_reason": f"{type(e).__name__}: {e}"},
                latency_ms=(time.perf_counter() - rewrite_started) * 1000,
            )

    retrieval = hybrid_search_multi_query(
        client, config_id, embedding_provider, bm25, queries, request_id,
        top_k=RERANK_INPUT_SIZE, predicted_domains=predicted_domains,
    )
    trace.record(
        "retrieval",
        {
            "query_variants_used": len(queries),
            "candidates": len(retrieval.results),
            "suppressed_duplicates": retrieval.suppressed_duplicate_count,
        },
    )

    candidates = []
    front_matter_dropped = 0
    for r in retrieval.results:
        record = chunk_store.get(r.chunk_id)
        if record is None:
            continue
        if _is_front_matter(record.section_path, record.text):
            front_matter_dropped += 1
            continue
        candidates.append((r.chunk_id, record.text))
    if front_matter_dropped:
        trace.record("candidate_filter", {"front_matter_dropped": front_matter_dropped}, latency_ms=0.0)
    # Written when the cross-encoder was ms-marco-MiniLM, which is
    # ENGLISH-ONLY: scoring a non-English question against English chunks
    # produced uniformly deep negative logits, which the sufficiency gate
    # (thresholds fitted on English logit distributions) read as INSUFFICIENT
    # — so every Arabic question was auto-refused even when Qwen's
    # multilingual dense arm had retrieved the right chunks. The workaround:
    # when the question is mostly non-Latin script and an English rewrite
    # exists, rerank against the rewrite, leaving the English path
    # byte-identical so the fitted thresholds stay valid.
    #
    # The default reranker is now BAAI/bge-reranker-v2-m3, which IS
    # multilingual, so this substitution is no longer strictly necessary. It
    # is kept because it is harmless (the English path is unchanged) and
    # because RERANKER_MODEL is env-configurable — a deployment that pins
    # ms-marco again still needs it. Revisit once the thresholds are
    # recalibrated for bge (TODO-PRODUCTION.md), since scoring the original
    # non-English question directly is the better behaviour when the model
    # can actually handle it.
    rerank_query = _select_rerank_query(patient_message, queries[1:])
    if rerank_query is patient_message:
        rerank_run = reranker.rerank(rerank_query, candidates, top_k=FINAL_TOP_K)
    else:
        # Translated path: an LLM paraphrase reranks systematically a few
        # points below a native phrasing, and tau_low was fitted on native
        # originals — measured live, the same ankle-pain question scored
        # -3.40 asked in English but -6.95 through its first Arabic rewrite,
        # straddling tau_low = -3.93. Scoring every English variant and
        # keeping the best-scoring run judges the question by its strongest
        # faithful phrasing instead of by luck of variant ordering. Costs
        # ~1s per extra variant (25 pairs each), non-English queries only.
        # The original non-Latin question is scored too, not only its
        # English rewrites: the deployed cross-encoder (mmarco-mMiniLMv2)
        # is multilingual, and a rewrite is a paraphrase that reranks a
        # few points below native phrasing — for a terse Arabic query
        # ("الم الظهر") every paraphrase can land under tau_low while the
        # native pairing clears it. Max over one more run can only raise
        # the top score; the English path stays byte-identical.
        variant_runs = [reranker.rerank(v, candidates, top_k=FINAL_TOP_K) for v in [patient_message, *queries[1:]]]
        def _top(run):
            return max((r.rerank_score for r in run.results if r.rerank_score is not None), default=float("-inf"))
        rerank_run = max(variant_runs, key=_top)
    trace.record("rerank", {"rerank_used": rerank_run.rerank_used, "fallback_reason": rerank_run.fallback_reason, "top_k": len(rerank_run.results), "reranked_against_rewrite": rerank_query is not patient_message, "variants_scored": 1 if rerank_query is patient_message else len(queries)})

    # PipelineResult ties retrieval+rerank together in the shape
    # build_evidence_pack expects, reusing its assembly logic rather than
    # duplicating it — this orchestrator runs multi-query retrieval
    # (hybrid_search_multi_query) directly instead of calling
    # retrieve_and_rerank.retrieve_and_rerank() (which only does
    # single-query retrieval), so the PipelineResult is built here instead.
    pipeline_result = PipelineResult(
        query_id=request_id, retrieval=retrieval, rerank=rerank_run,
        total_latency_ms=(time.perf_counter() - t0) * 1000,
    )
    pack = build_evidence_pack(pipeline_result, chunk_store, rewritten_queries=queries[1:])

    sufficiency = evaluate_sufficiency(pack)
    trace.record("sufficiency", {"state": sufficiency.state.value, "signal_used": sufficiency.signal_used, "top_score": sufficiency.top_score, "tau_high": sufficiency.tau_high, "tau_low": sufficiency.tau_low})
    supported_domain = bool(predicted_domains)

    def _trace_out() -> dict:
        return trace.as_dict() if include_trace else {}

    def _safety_outcome(is_refusal: bool) -> tuple[RiskAssessment, DecisionActions]:
        """Risk + decision for whichever exit path is taken. Centralized so
        no return path can silently omit them and drop the red-flag floor
        (SAF-6.2) — a refusal on a CRITICAL red flag must still escalate."""
        risk = assess_risk(
            patient_message, red_flags, sufficiency.state.value,
            pack.support_count, tuple(predicted_domains),
        )
        decision = decide_actions(
            risk.urgency, sufficiency.state.value, pack.support_count, is_refusal=is_refusal,
            lang=msg_lang,
        )
        trace.record("risk", {
            "urgency": risk.urgency.value, "assessed_urgency": risk.assessed_urgency.value,
            "floor_applied": risk.floor_applied, "confidence": risk.confidence,
            "factors": [f.code for f in risk.factors],
        })
        trace.record("decision", {
            "recommend_emergency_care": decision.recommend_emergency_care,
            "recommend_urgent_care": decision.recommend_urgent_care,
            "suppress_wellness_content": decision.suppress_wellness_content,
            "show_followup_question": decision.show_followup_question,
        })
        return risk, decision

    if sufficiency.state in (SufficiencyState.INSUFFICIENT, SufficiencyState.OUT_OF_SCOPE):
        risk, decision = _safety_outcome(is_refusal=True)
        latency_ms = (time.perf_counter() - t0) * 1000
        return OrchestratorResult(
            request_id=request_id, status="refusal", supported_domain=supported_domain,
            domains=predicted_domains, patient_state=patient_state.model_dump(),
            resolved_answer=None, refusal_reason=REFUSAL_REASON_CODES[sufficiency.state],
            refusal_message=REFUSAL_MESSAGES[sufficiency.state][msg_lang], pack=pack,
            sufficiency=sufficiency, retrieval=retrieval, latency_ms=latency_ms,
            trace=_trace_out(), red_flags=red_flags, risk=risk, decision=decision,
        )

    try:
        generation = generate_grounded_answer(llm, patient_message, pack)
        trace.record("generation", {"statements": len(generation.statements), "insufficient_evidence": generation.insufficient_evidence})
    except SchemaViolationError as e:
        trace.record("generation", {"failed": True, "reason": str(e)})
        risk, decision = _safety_outcome(is_refusal=True)
        latency_ms = (time.perf_counter() - t0) * 1000
        return OrchestratorResult(
            request_id=request_id, status="refusal", supported_domain=supported_domain,
            domains=predicted_domains, patient_state=patient_state.model_dump(),
            resolved_answer=None, refusal_reason="INSUFFICIENT_EVIDENCE",
            refusal_message=REFUSAL_MESSAGES[SufficiencyState.INSUFFICIENT][msg_lang], pack=pack,
            sufficiency=sufficiency, retrieval=retrieval, latency_ms=latency_ms,
            trace=_trace_out(), red_flags=red_flags, risk=risk, decision=decision,
        )

    resolved = resolve_and_validate(generation, pack, chunk_store)
    trace.record("validation", {"dropped": len(resolved.dropped), "statements_kept": len(resolved.statements), "excerpts_kept": len(resolved.excerpts)})

    if resolved.fell_back_to_refusal:
        risk, decision = _safety_outcome(is_refusal=True)
        latency_ms = (time.perf_counter() - t0) * 1000
        return OrchestratorResult(
            request_id=request_id, status="refusal", supported_domain=supported_domain,
            domains=predicted_domains, patient_state=patient_state.model_dump(),
            resolved_answer=resolved, refusal_reason="INSUFFICIENT_EVIDENCE",
            refusal_message=REFUSAL_MESSAGES[SufficiencyState.INSUFFICIENT][msg_lang], pack=pack,
            sufficiency=sufficiency, retrieval=retrieval, latency_ms=latency_ms,
            trace=_trace_out(), red_flags=red_flags, risk=risk, decision=decision,
        )

    # SAF-7.2 — scan the text a user would actually see. This runs on the
    # RESOLVED output (post-validation), because that is the final content;
    # scanning the raw generation would miss nothing but could block on
    # text that validation was about to drop anyway.
    scan_targets = {f"statement[{i + 1}]": s.text for i, s in enumerate(resolved.statements)}
    # ResolvedExcerpt's field is `quote`, not `text` — the verbatim span
    # the Citation Resolver validated against the source chunk.
    scan_targets.update({f"excerpt[{i + 1}]": e.quote for i, e in enumerate(resolved.excerpts)})
    # EvidenceItem carries chunk_id, not document_id; resolve the real
    # document through the Chunk Store so a block can name which source
    # document the dosing text came from.
    source_docs = set()
    for item in pack.evidence:
        record = chunk_store.get(item.chunk_id)
        if record is not None:
            source_docs.add(record.document_id)
    dose_scan = scan_for_dose_patterns(scan_targets, source_documents=tuple(sorted(source_docs)))
    trace.record("dose_scan", {
        "blocked": dose_scan.blocked,
        "matches": [{"kind": m.kind, "location": m.location} for m in dose_scan.matches],
    })

    if dose_scan.blocked:
        # SAF-7.1/7.4 — enforcement in code. The answer is suppressed
        # entirely rather than redacted: partially-scrubbed dosing text is
        # more dangerous than none, since a user may reconstruct or
        # misread what remains.
        risk, decision = _safety_outcome(is_refusal=True)
        latency_ms = (time.perf_counter() - t0) * 1000
        return OrchestratorResult(
            request_id=request_id, status="refusal", supported_domain=supported_domain,
            domains=predicted_domains, patient_state=patient_state.model_dump(),
            resolved_answer=None, refusal_reason="PRESCRIBING_REQUEST",
            refusal_message=DOSE_BLOCKED_MESSAGES[msg_lang], pack=pack,
            sufficiency=sufficiency, retrieval=retrieval, latency_ms=latency_ms,
            trace=_trace_out(), red_flags=red_flags, risk=risk, decision=decision,
            dose_block=dose_scan,
        )

    risk, decision = _safety_outcome(is_refusal=False)
    latency_ms = (time.perf_counter() - t0) * 1000
    return OrchestratorResult(
        request_id=request_id, status="success", supported_domain=supported_domain,
        domains=predicted_domains, patient_state=patient_state.model_dump(),
        resolved_answer=resolved, refusal_reason=None, refusal_message=None, pack=pack,
        sufficiency=sufficiency, retrieval=retrieval, latency_ms=latency_ms,
        trace=_trace_out(), red_flags=red_flags, risk=risk, decision=decision,
        dose_block=dose_scan,
    )
