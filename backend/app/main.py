"""FastAPI app — SPEC.md §F. Wires the already-built and end-to-end-tested
pipeline (Phases 6-12) to 3 endpoints: POST /api/query, GET
/api/evidence/{chunk_id}, GET /api/health.

GET /api/eval/report is deliberately not built in this pass (needs a
persisted "latest run" concept that doesn't exist yet — TODO-PRODUCTION.md).

Medical Safety Guardrails (Phase 14) are explicitly NOT wired in
(PROJECT-STATE.md decision D5) — every field this app returns corresponds
to a subsystem that was actually built and tested; nothing is faked to
match SPEC.md's full response shape. `risk` is correctly omitted (the
frontend already treats it as optional); `recommended_action`/`actions`
are still sent with honest generic/all-false values since the frontend's
UI unconditionally renders those sections.

Response shapes match frontend/src/types/api.ts's Zod contract
field-for-field — this backend and that frontend were built independently
and reconciled together (PROJECT-STATE.md decision — see the entry logged
when the mismatch was found and fixed).
"""

from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager
from typing import Union

import anthropic
import openai
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

# Common base of ResponseHandlingException (connection refused/timeout) and
# UnexpectedResponse (Qdrant answered with an error status).
from qdrant_client.http.exceptions import ApiException as QdrantException

from app.api.dependencies import AppResources, load_app_resources
from app.observability.logging import app_logger, configure_logging, get_request_id, redact
from app.observability.middleware import RateLimitMiddleware, RequestContextMiddleware
from app.schemas.evidence import EvidenceDetailOut
from app.schemas.health import (
    ChunkStoreCheck,
    HealthChecks,
    HealthResponse,
    HealthVersions,
    LlmCheck,
    QdrantCheck,
    WarmCheck,
)
from app.schemas.query import (
    AssessmentOut,
    DecisionActionsOut,
    EvidenceOut,
    EvidenceScores,
    PatientStateOut,
    QueryMeta,
    QueryRefusalOut,
    QueryRequest,
    QuerySuccessOut,
    RecommendedActionOut,
    RiskOut,
    RefusalOut,
    SafetyOut,
    StatementOut,
    TraceOut,
    TraceStageOut,
    normalize_severity,
)
from app.services.rag.query_orchestrator import _message_language, run_query
from app.services.retrieval.qdrant_index import collection_name

_resources: AppResources | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _resources
    # Before loading resources, so startup itself is logged in the same
    # structured format as everything else.
    configure_logging(os.environ.get("LOG_LEVEL", "INFO"))
    _resources = load_app_resources()
    app_logger.info(
        "startup complete",
        extra={
            "chunks": len(_resources.chunk_store),
            "reranker": _resources.reranker.__class__.__name__,
            "llm_model": _resources.llm_model,
        },
    )
    yield
    _resources = None


app = FastAPI(title="AI Clinical Decision Support Lite", lifespan=lifespan)

# NFR-3.4 — CORS restricted to the frontend origin, read from the
# environment rather than hardcoded. Comma-separated so a deployment can
# allow a preview origin alongside production without a code change.
# Deliberately NOT defaulting to "*": a wildcard here would let any page on
# the internet submit a patient's symptoms to this backend.
_origins = [
    o.strip() for o in os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID", "Retry-After"],
)

# NFR-3.3 — rate limiting on /api/query only. It costs 4+ LLM calls per
# request; /api/health and /api/evidence are cheap reads and are left
# unthrottled so monitoring and the evidence inspector never trip it.
app.add_middleware(
    RateLimitMiddleware,
    limit=int(os.environ.get("RATE_LIMIT_REQUESTS", "20")),
    window_seconds=int(os.environ.get("RATE_LIMIT_WINDOW_SECONDS", "60")),
    paths=("/api/query",),
)

# Outermost so every request — including one rejected by the rate limiter —
# gets a request_id and a log line. Starlette applies middleware in reverse
# registration order, so this must be registered LAST to run FIRST.
app.add_middleware(RequestContextMiddleware)


def _resources_or_503() -> AppResources:
    if _resources is None:
        raise HTTPException(status_code=503, detail=_error_body("RETRIEVAL_UNAVAILABLE", "RESOURCES_NOT_LOADED"))
    return _resources


# NFR-3.5 — errors MUST NOT leak prompts, stack traces, or internal paths.
# Client-facing text is a fixed string chosen per error code; the exception's
# own detail goes to the log, correlated by request_id. Previously every
# handler put str(e) straight into the response body, which for a provider
# error can include the request URL, model name, and fragments of the prompt.
_CLIENT_SAFE_MESSAGES = {
    "RATE_LIMITED": (
        "The clinical service is temporarily rate limited. Please retry shortly."
    ),
    "LLM_UNAVAILABLE": (
        "The language service is currently unreachable, so no answer can be generated. "
        "Retrieval is unaffected — please retry shortly."
    ),
    "RETRIEVAL_UNAVAILABLE": (
        "The evidence index is currently unavailable. No answer can be generated without it."
    ),
    "INTERNAL_ERROR": (
        "The assessment could not be completed due to an internal error. "
        "Quote the request_id below if you report this."
    ),
    "CHUNK_NOT_FOUND": "No evidence record exists for that identifier.",
}


def _error_body(code: str, reason: str, error: Exception | None = None,
                stage: str | None = None) -> dict:
    """Build the SPEC.md §F.6 error envelope, log the real cause, and
    return only client-safe text.

    `reason` is a short, non-sensitive classifier that IS safe to return —
    it tells a caller what kind of failure occurred without exposing how
    the system is built.
    """
    request_id = get_request_id() or str(uuid.uuid4())
    if error is not None:
        # exc_info records the traceback on the LOG side only (FR-7.6).
        app_logger.error(
            "request failed",
            exc_info=error,
            extra={"request_id": request_id, "error_code": code,
                   "reason": reason, "stage": stage},
        )
    body = {
        "error": {
            "code": code,
            "message": _CLIENT_SAFE_MESSAGES.get(code, "The request could not be completed."),
            "request_id": request_id,
            "reason": reason,
        }
    }
    if stage:
        body["error"]["stage"] = stage
    return body


def _refusal_message_with_escalation(result) -> str:
    """SAF-6.2 applied to the refusal path.

    A red-flag urgency floor MUST survive every later stage, and a refusal
    is a later stage. Without this, someone describing crushing chest pain
    in words the corpus cannot answer would receive a bare "insufficient
    evidence" reply with no escalation at all — the worst possible
    combination of a correct refusal and a missed emergency.

    The escalation is prepended to the refusal MESSAGE rather than sent as
    a separate risk block because QueryRefusalOut's contract (mirrored by
    the frontend's strict Zod schema) carries no risk field. Putting it in
    the message means the user sees it regardless of how the client
    renders refusals — the safer choice when the two options are "always
    visible in text" versus "visible only if the client adds support".
    """
    message = result.refusal_message or ""
    decision = getattr(result, "decision", None)
    if decision is None or decision.emergency is None:
        return message
    return f"{decision.emergency.lead_text} {decision.emergency.instruction}\n\n{message}"


def _confidence_band(value: float) -> str:
    """Map the Risk Engine's derived confidence to the frontend's band.
    Bands rather than raw decimals are what the UI shows — a "0.62" in a
    medical interface implies a precision this system does not have
    (decision A17); the raw value travels alongside for the trace panel."""
    if value >= 0.70:
        return "strong"
    if value >= 0.45:
        return "moderate"
    return "weak"


def _build_risk_out(result, cited_chunk_ids: set[str]) -> RiskOut | None:
    """Risk Engine output -> API shape.

    `evidence_ids` must reference only SELECTED (cited) evidence, not every
    retrieved candidate. A risk block pointing at an unselected candidate
    would claim support from evidence the answer never actually used —
    the frontend enforces this as a cross-field rule, and it is the right
    rule: risk is an assertion, and assertions cite what backs them.

    Returns None when nothing cited backs the assessment: an empty
    evidence_ids list is invalid, and inventing an id would be worse.
    Omitting the block is the honest option.
    """
    if result.risk is None or result.pack is None or not result.pack.evidence:
        return None

    evidence_ids = [
        i + 1 for i, item in enumerate(result.pack.evidence) if item.chunk_id in cited_chunk_ids
    ]
    if not evidence_ids:
        return None

    return RiskOut(
        level=result.risk.urgency.value,
        confidence_band=_confidence_band(result.risk.confidence),
        confidence_value=result.risk.confidence,
        reasoning_factors=list(result.risk.reasons),
        red_flag_rules=[m.rule_id for m in result.red_flags.matches] if result.red_flags else [],
        evidence_ids=evidence_ids,
    )


_ACTION_TYPE_BY_URGENCY = {
    "CRITICAL": "emergency",
    "HIGH": "urgent_care",
    "MODERATE": "evaluation",
    "LOW": "guidance",
}


# Fixed recommended-action copy, language-keyed so an Arabic question is
# never answered with an English recommendation line (the emergency and
# low-risk strings arrive already localized from the Decision Engine —
# these are the three composed here at the API boundary).
_RECOMMENDED_ACTION_COPY = {
    "default_guidance": {
        "en": (
            "Review the evidence-grounded assessment below. If symptoms are severe or "
            "rapidly worsening, seek professional medical evaluation."
        ),
        "ar": (
            "راجع التقييم المستند إلى الأدلة أدناه. إذا كانت الأعراض شديدة أو تتفاقم "
            "بسرعة، فاطلب تقييمًا طبيًا متخصصًا."
        ),
    },
    "weak_support_followup": {
        "en": (
            " The available evidence is limited, so this is not a clean bill of health —"
            " please share more detail, or speak to a healthcare professional if you are"
            " concerned."
        ),
        "ar": (
            " الأدلة المتاحة محدودة، لذا هذا ليس تأكيدًا لسلامتك — يُرجى مشاركة مزيد من "
            "التفاصيل، أو التحدث مع مختص رعاية صحية إذا كنت قلقًا."
        ),
    },
    "moderate_evaluation": {
        "en": (
            "Based on the available evidence, you should be assessed by a healthcare "
            "professional. If symptoms worsen, seek care sooner."
        ),
        "ar": (
            "بناءً على الأدلة المتاحة، ينبغي أن يقيّم حالتك مختص رعاية صحية. إذا "
            "ساءت الأعراض، فاطلب الرعاية في وقت أقرب."
        ),
    },
}


def _build_recommended_action(result, lang: str = "en") -> RecommendedActionOut:
    """SAF-6.3 — a CRITICAL response leads with the emergency instruction.
    The emergency text comes from config/emergency.yaml via the Decision
    Engine, never from the LLM (SAF-6.5)."""
    decision = result.decision
    if decision is None or result.risk is None:
        return RecommendedActionOut(
            type="guidance",
            message=_RECOMMENDED_ACTION_COPY["default_guidance"].get(
                lang, _RECOMMENDED_ACTION_COPY["default_guidance"]["en"]
            ),
        )

    urgency = result.risk.urgency.value
    if decision.emergency is not None:
        # Lead text first — SAF-6.3's "MUST lead with" is about ordering
        # within the message the user reads, not merely including it.
        message = f"{decision.emergency.lead_text} {decision.emergency.instruction}"
    elif decision.fixed_low_risk_copy is not None:
        # SAF-8.2/8.3 — fixed copy, and never rendered as "you are healthy".
        message = decision.fixed_low_risk_copy
        if decision.show_followup_question:
            # SAF-8.4 — weak support at LOW risk gets a follow-up, not
            # reassurance.
            message += _RECOMMENDED_ACTION_COPY["weak_support_followup"].get(
                lang, _RECOMMENDED_ACTION_COPY["weak_support_followup"]["en"]
            )
    else:
        message = _RECOMMENDED_ACTION_COPY["moderate_evaluation"].get(
            lang, _RECOMMENDED_ACTION_COPY["moderate_evaluation"]["en"]
        )

    return RecommendedActionOut(type=_ACTION_TYPE_BY_URGENCY.get(urgency, "guidance"), message=message)


def _build_actions_out(result) -> DecisionActionsOut:
    decision = result.decision
    if decision is None:
        return DecisionActionsOut()
    return DecisionActionsOut(
        # SAF-6.6/6.7 — these SHOW a control; they never act. Confirmation
        # happens in the UI, and no field here can trigger a side effect.
        show_call_emergency=decision.recommend_emergency_care,
        show_find_facility=decision.recommend_emergency_care or decision.recommend_urgent_care,
        show_alert_contacts=decision.show_emergency_banner,
        # SAF-6.4 — wellness content must not appear on HIGH/CRITICAL.
        show_wellness=not decision.suppress_wellness_content,
    )


def _extract_retry_after_seconds(error: Exception) -> str | None:
    """A real Retry-After header value (seconds-from-now, as a string) —
    RFC 7231 semantics: either an integer delay in seconds, or an HTTP-date.
    OpenRouter's own X-RateLimit-Reset header is an epoch-MILLISECOND
    timestamp, not a delay — passing it straight through as Retry-After
    would tell the client to wait ~56,000 years (found by testing the
    real response against a real exhausted quota, not assumed correct).
    Converted here to an actual seconds-from-now delay before it ever
    reaches the frontend's retryAfterSeconds() parser
    (frontend/src/lib/clinical-errors.ts)."""
    response = getattr(error, "response", None)
    if response is None:
        return None

    retry_after = response.headers.get("Retry-After")
    if retry_after:
        return retry_after  # already RFC-7231-shaped; pass through as-is

    reset_header = response.headers.get("X-RateLimit-Reset")
    if not reset_header:
        return None
    try:
        reset_epoch_ms = float(reset_header)
    except ValueError:
        return None

    import time

    delay_seconds = max(0, round(reset_epoch_ms / 1000 - time.time()))
    return str(delay_seconds)


def _build_evidence_out(result, chunk_store) -> tuple[list[EvidenceOut], set[str]]:
    cited_chunk_ids: set[str] = set()
    if result.resolved_answer:
        for stmt in result.resolved_answer.statements:
            for c in stmt.citations:
                cited_chunk_ids.add(c.chunk_id)

    # The SAF-7.3 prescribing short-circuit returns before retrieval runs,
    # so there is genuinely no Evidence Pack. An empty evidence list is the
    # honest representation of "no retrieval happened" — QueryRefusalOut
    # permits it (unlike QuerySuccessOut, which requires >= 1).
    if result.pack is None:
        return [], cited_chunk_ids

    evidence_out: list[EvidenceOut] = []
    for i, item in enumerate(result.pack.evidence):
        record = chunk_store.get(item.chunk_id)
        if record is None:
            # A chunk_id in the Evidence Pack but absent from the Chunk
            # Store would be a data-integrity bug (same defensive skip as
            # retrieve_and_rerank.py / evidence_pack.py) — omit rather
            # than return a partially-empty evidence record.
            continue
        excerpt = next(
            (e.quote for e in (result.resolved_answer.excerpts if result.resolved_answer else []) if e.evidence_id == item.evidence_id),
            None,
        )
        evidence_out.append(EvidenceOut(
            index=i + 1,
            chunk_id=record.chunk_id,
            document_title=record.document_title,
            organization=record.organization,
            section_path=record.section_path,
            page_start=record.page_start,
            page_end=record.page_end,
            evidence_grade=record.evidence_grade,
            excerpt=excerpt,
            source_url=record.source_url,
            scores=EvidenceScores(dense=item.dense_score, bm25=item.bm25_score, rrf=item.rrf_score or 0.0, rerank=item.rerank_score),
            selected=item.chunk_id in cited_chunk_ids,
        ))
    return evidence_out, cited_chunk_ids


def _build_trace_out(result) -> TraceOut | None:
    if not result.trace:
        return None
    return TraceOut(stages=[TraceStageOut(**s) for s in result.trace["stages"]])


@app.post("/api/query", response_model=Union[QuerySuccessOut, QueryRefusalOut])
def post_query(request: QueryRequest) -> QuerySuccessOut | QueryRefusalOut:
    res = _resources_or_503()

    # NFR-4.1/4.2 — the patient's message is never logged, only its length.
    # A log line is durable storage, and this is health data.
    app_logger.info(
        "query received",
        # NOT "message": that is a reserved LogRecord attribute and passing
        # it via extra= raises KeyError inside logging itself.
        extra={"patient_message": redact(request.message),
               "include_trace": request.options.include_trace},
    )

    # Fold the profile into the message so every stage sees it (see
    # PatientContext.as_preamble for why this is textual rather than a new
    # parameter threaded through the pipeline).
    effective_message = request.message + (
        request.patient_context.as_preamble() if request.patient_context else ""
    )

    try:
        result = run_query(
            res.qdrant_client, None, res.embedding_provider, res.bm25_index,
            res.chunk_store, res.reranker, res.llm_provider, effective_message,
            include_trace=request.options.include_trace,
        )
    except (openai.RateLimitError, anthropic.RateLimitError) as e:
        # The upstream LLM provider's own rate limit (e.g. OpenRouter free
        # tier: 50 req/day — PROJECT-STATE.md R14). Surfaced as a real 429
        # with the RATE_LIMITED code the frontend already has dedicated,
        # friendlier handling for (frontend/src/lib/clinical-errors.ts) —
        # not swallowed into a generic 500 INTERNAL_ERROR, which is what
        # this looked like before this fix (found by testing the real UI
        # against a real exhausted quota, not assumed).
        headers = {"Retry-After": _extract_retry_after_seconds(e)}
        raise HTTPException(
            status_code=429,
            detail=_error_body("RATE_LIMITED", "UPSTREAM_LLM_RATE_LIMIT", e, stage="generation"),
            headers={k: v for k, v in headers.items() if v is not None} or None,
        ) from e
    except (openai.APIConnectionError, openai.APITimeoutError, anthropic.APIConnectionError, anthropic.APITimeoutError) as e:
        # The LLM is unreachable/timed out, distinct from a rate limit —
        # SPEC.md §F.6 503 LLM_UNAVAILABLE: "evidence returned without
        # prose" is the intended semantics, but this endpoint doesn't have
        # partial evidence to return at the point an LLM call fails (the
        # orchestrator hasn't built a resolved answer yet), so a 503 with
        # no evidence is the honest version of that contract today.
        raise HTTPException(
            status_code=503,
            detail=_error_body("LLM_UNAVAILABLE", "UPSTREAM_LLM_UNREACHABLE", e, stage="generation"),
        ) from e
    except QdrantException as e:
        # SPEC.md §F.6: a vector-store outage is 503 RETRIEVAL_UNAVAILABLE,
        # explicitly "no ungrounded fallback" — the system must never answer
        # from the model's own medical knowledge when retrieval is down.
        # Previously this fell into the generic 500, which told the client
        # "internal error" for what is really a dependency being unreachable
        # (found live: Docker stopped, every query returned an opaque 500).
        raise HTTPException(
            status_code=503,
            detail=_error_body("RETRIEVAL_UNAVAILABLE", "VECTOR_STORE_UNREACHABLE", e,
                               stage="retrieval"),
        ) from e
    except Exception as e:  # noqa: BLE001 — any other unexpected pipeline
        # failure becomes a 500, never a silently-wrong 200 (SPEC.md §F.6).
        raise HTTPException(
            status_code=500,
            detail=_error_body("INTERNAL_ERROR", "UNEXPECTED", e, stage="pipeline"),
        ) from e

    evidence_out, cited_chunk_ids = _build_evidence_out(result, res.chunk_store)
    trace_out = _build_trace_out(result)

    safety = SafetyOut(
        # No Sufficiency Gate runs on the SAF-7.3 short-circuit (it returns
        # before retrieval), so the honest state is OUT_OF_SCOPE: the
        # system declined the request category, not the evidence.
        sufficiency=result.sufficiency.state.value if result.sufficiency else "OUT_OF_SCOPE",
        unsupported_statements_dropped=len(result.resolved_answer.dropped) if result.resolved_answer else 0,
    )

    meta = QueryMeta(
        latency_ms=result.latency_ms, kb_version=res.kb_version,
        embedding_version=res.embedding_version,
    )

    if result.status == "refusal":
        return QueryRefusalOut(
            request_id=result.request_id,
            supported_domain=result.supported_domain, domains=result.domains,
            refusal=RefusalOut(
                reason=result.refusal_reason,
                message=_refusal_message_with_escalation(result),
            ),
            evidence=evidence_out, safety=safety, trace=trace_out, meta=meta,
        )

    statements_out = [
        StatementOut(
            id=i + 1, text=stmt.text,
            citations=[j + 1 for j, e in enumerate(result.pack.evidence) if e.chunk_id in {c.chunk_id for c in stmt.citations}],
        )
        for i, stmt in enumerate(result.resolved_answer.statements)
    ]
    limitations = result.resolved_answer.limitations
    if result.sufficiency.state.value == "PARTIAL" and not limitations:
        # The 04_grounded_generator prompt asks for limitations but has no
        # hard minimum-length constraint (backend/app/prompts/schemas.py
        # GroundedGeneration.limitations) — the frontend's Zod schema
        # requires at least one limitation on a PARTIAL response (a real
        # correctness check, not just plumbing: PARTIAL literally means
        # "thin support", and an answer claiming that with zero stated
        # limitations would be an inconsistency worth catching). Rather
        # than let an LLM omission surface as a rejected/invalid API
        # response, synthesize an honest, generic one from what the
        # Sufficiency Gate itself already computed.
        limitations = [
            f"This assessment is based on limited supporting evidence "
            f"({result.pack.support_count} source{'s' if result.pack.support_count != 1 else ''} found)."
        ]
    assessment = AssessmentOut(
        statements=statements_out,
        limitations=limitations,
        conflicts=[c["description"] for c in result.resolved_answer.conflicts],
        diagnosis_confirmed=False,  # SPEC.md SAF-1.1 — always false
    )

    patient_state_dict = result.patient_state or {}
    patient_state = PatientStateOut(
        symptoms=patient_state_dict.get("symptoms", []),
        severity=normalize_severity(patient_state_dict.get("severity")),
        duration=patient_state_dict.get("duration"),
        missing_information=patient_state_dict.get("missing_information", []),
    )

    return QuerySuccessOut(
        request_id=result.request_id,
        supported_domain=result.supported_domain, domains=result.domains,
        patient_state=patient_state, assessment=assessment,
        risk=_build_risk_out(result, cited_chunk_ids),
        recommended_action=_build_recommended_action(result, lang=_message_language(request.message)),
        actions=_build_actions_out(result),
        evidence=evidence_out, safety=safety, trace=trace_out, meta=meta,
    )


@app.get("/api/evidence/{chunk_id}", response_model=EvidenceDetailOut)
def get_evidence(chunk_id: str) -> EvidenceDetailOut:
    res = _resources_or_503()
    record = res.chunk_store.get(chunk_id)
    if record is None:
        raise HTTPException(status_code=404, detail=_error_body("CHUNK_NOT_FOUND", "UNKNOWN_CHUNK_ID"))
    return EvidenceDetailOut(
        chunk_id=record.chunk_id,
        document_id=record.document_id,
        document_title=record.document_title,
        organization=record.organization,
        publication_year=record.publication_year,
        source_url=record.source_url,
        license=record.license,
        section=record.section,
        subsection=record.subsection,
        section_path=record.section_path,
        section_confidence=record.section_confidence,
        page_start=record.page_start,
        page_end=record.page_end,
        domains=record.domains,
        chunk_type=record.chunk_type,
        evidence_grade=record.evidence_grade,
        recommendation_class=record.recommendation_class,
        text=record.text,
        token_count=record.token_count,
        content_hash=record.content_hash,
        kb_version=record.kb_version,
        chunking_version=record.chunking_version,
        embedding_version=record.embedding_version,
    )


@app.get("/api/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    if _resources is None:
        raise HTTPException(status_code=503, detail=_error_body("RETRIEVAL_UNAVAILABLE", "RESOURCES_NOT_LOADED"))

    try:
        count = _resources.qdrant_client.count(collection_name(None)).count
        qdrant_check = QdrantCheck(ok=True, points=count)
    except Exception:  # noqa: BLE001
        qdrant_check = QdrantCheck(ok=False, points=0)

    # Only `qdrant` and `chunk_store` are measured. The other three report a
    # constant True, which is a weaker claim than the response shape suggests:
    #
    #   embedding_model / reranker  loaded at startup and startup would have
    #                               failed otherwise, so True is *usually*
    #                               right — but _load_reranker() deliberately
    #                               DEGRADES to NullReranker rather than
    #                               failing, so `reranker.ok: true` can mean
    #                               "no reranking is happening".
    #   llm                         never probed at all. Observed reporting
    #                               ok:true while every completion failed with
    #                               Connection refused (a container started
    #                               without OLLAMA_API_KEY, falling back to
    #                               localhost:11434). The deploy looks green
    #                               and the first real query 500s.
    #
    # These feed `all_ok` below, so they can only ever inflate the verdict,
    # never lower it. Making them real checks is tracked in
    # TODO-PRODUCTION.md; the llm one needs a cheap liveness call rather than
    # a full completion, so it is a design question, not a one-liner.
    checks = HealthChecks(
        qdrant=qdrant_check,
        chunk_store=ChunkStoreCheck(ok=len(_resources.chunk_store) > 0, chunks=len(_resources.chunk_store)),
        embedding_model=WarmCheck(ok=True, warm=True),
        reranker=WarmCheck(ok=True, warm=True),
        llm=LlmCheck(ok=True),
    )

    all_ok = all([checks.qdrant.ok, checks.chunk_store.ok, checks.embedding_model.ok, checks.reranker.ok, checks.llm.ok])
    status = "ok" if all_ok else "degraded"

    return HealthResponse(
        status=status, checks=checks,
        versions=HealthVersions(kb=_resources.kb_version, embedding=_resources.embedding_version, prompts="rag-gen-v1"),
    )


# --- Voice input: speech-to-text via Groq ----------------------------------
# POST /api/transcribe accepts a recorded audio blob (webm/opus from the
# browser's MediaRecorder, or m4a/mp3/wav) and returns the transcript text.
# Groq's endpoint is OpenAI-compatible, so this uses the already-pinned httpx
# rather than adding the `groq` SDK as a dependency for one call. The audio
# leaves this server for Groq — same third-party-processing posture as the
# LLM calls, and worth the same governance note for patient-voice audio.

GROQ_STT_MODEL = os.environ.get("GROQ_STT_MODEL", "whisper-large-v3")
GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
# MediaRecorder produces roughly 100-200 KB per 10 s of opus; 15 MB allows
# several minutes of dictation while bounding abuse of a public endpoint.
MAX_AUDIO_BYTES = 15 * 1024 * 1024


@app.post("/api/transcribe")
async def post_transcribe(request: Request):
    """Body: raw audio bytes (Content-Type audio/*). Query param `language`
    optionally pins Whisper's language (e.g. `ar`); left unset, Whisper
    auto-detects — which is what a bilingual Arabic/English UI wants."""
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail={"code": "STT_UNCONFIGURED", "reason": "GROQ_API_KEY is not set"},
        )

    audio = await request.body()
    if not audio:
        raise HTTPException(status_code=400, detail={"code": "EMPTY_AUDIO"})
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail={"code": "AUDIO_TOO_LARGE"})

    content_type = request.headers.get("content-type", "audio/webm")
    # Groq infers the codec from the filename extension in the multipart part.
    ext = {
        "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a",
        "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a",
    }.get(content_type.split(";")[0].strip(), "webm")

    language = request.query_params.get("language", "").strip()
    data = {"model": GROQ_STT_MODEL, "temperature": "0", "response_format": "json"}
    if language:
        data["language"] = language

    import httpx

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                GROQ_STT_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                data=data,
                files={"file": (f"audio.{ext}", audio, content_type)},
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail={"code": "STT_UPSTREAM_UNREACHABLE", "reason": type(e).__name__})

    if resp.status_code != 200:
        # Do not leak the upstream body verbatim (NFR: no error-detail leaks);
        # log it, return a stable code.
        app_logger.warning("groq transcription failed", extra={"status": resp.status_code, "body": resp.text[:300]})
        raise HTTPException(status_code=502, detail={"code": "STT_FAILED", "status": resp.status_code})

    text = (resp.json().get("text") or "").strip()
    return {"text": text, "model": GROQ_STT_MODEL}


# --- Care directory: powers the call-to-action buttons ----------------------
# Curated Egypt hotlines + facilities with Google Maps deep links
# (data/care_directory.json). Static and cached at first request; the
# frontend renders these as working tel:/maps links so "seek care" CTAs go
# somewhere real instead of dead-ending. Demo data — the JSON's _meta says
# so and the API passes that caveat through rather than hiding it.

_CARE_DIRECTORY_CACHE: dict | None = None


@app.get("/api/care-directory")
def get_care_directory(city: str | None = None, specialty: str | None = None):
    global _CARE_DIRECTORY_CACHE
    if _CARE_DIRECTORY_CACHE is None:
        import json as _json
        import pathlib as _pathlib

        path = _pathlib.Path(__file__).resolve().parents[2] / "data" / "care_directory.json"
        try:
            _CARE_DIRECTORY_CACHE = _json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise HTTPException(status_code=503, detail={"code": "DIRECTORY_UNAVAILABLE"})

    payload = dict(_CARE_DIRECTORY_CACHE)
    facilities = payload.get("facilities", [])
    if city:
        facilities = [f for f in facilities if f.get("city", "").lower() == city.lower()]
    if specialty:
        facilities = [f for f in facilities if specialty.lower() in [s.lower() for s in f.get("specialties", [])]]
    payload["facilities"] = facilities
    return payload
