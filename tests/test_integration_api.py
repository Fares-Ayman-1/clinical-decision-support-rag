"""HTTP-layer integration tests — the real app, the real middleware stack,
the real response builders, the real Pydantic contract.

WHY THIS FILE EXISTS
--------------------
Two production 500s in this project were invisible to unit tests and were
found only by hitting the running server by hand:

  1. `extra={"message": ...}` collided with a reserved LogRecord attribute
     and raised KeyError from *inside* the logging call, turning every
     /api/query into a 500.
  2. A refusal returned `SufficiencyState.value` ("INSUFFICIENT") where
     `RefusalOut.reason` requires "INSUFFICIENT_EVIDENCE", so every refusal
     failed response validation with a 500.

Both live in the seam between the orchestrator and the HTTP response —
code that `tests/test_safety.py` and `tests/test_api_hardening.py` never
execute, because one tests pure functions and the other tests middleware
against a toy app. This file closes that gap by driving `app.main.app`
itself through TestClient.

WHAT IS FAKED, AND WHY THAT IS THE RIGHT LINE
---------------------------------------------
Faked: `main._resources` (a fake AppResources) and `main.run_query`.
That removes Qdrant, the embedding model, the cross-encoder, and the LLM —
four network/GPU dependencies that would make this suite unrunnable in CI
and non-deterministic when it did run.

NOT faked: the middleware chain, `_build_evidence_out`, `_build_risk_out`,
`_build_recommended_action`, `_build_actions_out`,
`_refusal_message_with_escalation`, `_error_body`, every exception handler,
and the full Pydantic response validation. Those are the layers that broke.

Also not faked: `check_red_flags`, `assess_risk`, `decide_actions`. They are
pure functions with no I/O, so the OrchestratorResult fixtures below are
built by *running the real safety engines* rather than by hand-asserting
what I think they return. A test built on a hand-written RiskAssessment
would keep passing if the Risk Engine's own behavior changed underneath it.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.services.decisions.decision_engine import decide_actions
from app.services.rag.chunk_store import ChunkRecord, ChunkStore
from app.services.rag.citation_resolver import (
    ResolvedAnswer,
    ResolvedCitation,
    ResolvedExcerpt,
    ResolvedStatement,
    ValidationDrop,
)
from app.services.rag.evidence_pack import EvidenceItem, EvidencePack
from app.services.rag.query_orchestrator import OrchestratorResult
from app.services.rag.sufficiency_gate import SufficiencyResult, SufficiencyState
from app.services.risk.risk_engine import assess_risk
from app.services.safety.red_flags import check_red_flags

# ---------------------------------------------------------------------------
# Fixtures — a minimal but structurally REAL corpus
# ---------------------------------------------------------------------------


def _chunk(chunk_id: str, text: str = "Reduce dietary salt to less than 5 g per day.") -> ChunkRecord:
    """A ChunkRecord with every field populated. Constructed positionally-
    complete on purpose: if someone adds a required field to ChunkRecord,
    this fails loudly here rather than producing a half-empty citation at
    runtime."""
    return ChunkRecord(
        chunk_id=chunk_id,
        document_id="who_hearts",
        document_title="HEARTS Technical Package",
        organization="WHO",
        publication_year=2020,
        source_url="https://iris.who.int/handle/10665/333221",
        license="CC BY-NC-SA 3.0 IGO",
        section="Healthy-lifestyle counselling",
        subsection="Salt",
        section_path="HEARTS > Healthy-lifestyle counselling > Salt",
        section_confidence="high",
        page_start=12,
        page_end=13,
        domains=["cardiovascular"],
        chunk_type="recommendation",
        evidence_grade="strong",
        recommendation_class="I",
        text=text,
        token_count=len(text.split()),
        content_hash="0" * 64,
        kb_version="1.0",
        chunking_version="1.0_S1",
        embedding_version="minilm-l6-v2-1",
    )


class _FakeReranker:
    """Named so the startup log line and any trace assertion see a real
    class name rather than 'Mock'."""


class _FakeQdrant:
    def __init__(self, *, healthy: bool = True):
        self._healthy = healthy

    def count(self, _collection):
        if not self._healthy:
            raise RuntimeError("connection refused")

        class _Count:
            count = 7381

        return _Count()


class _FakeResources:
    """Structural stand-in for AppResources. Only the attributes the HTTP
    layer actually reads are present — anything else it touched would be a
    genuine finding, not a fixture gap."""

    def __init__(self, *, chunks: dict[str, ChunkRecord] | None = None, qdrant_healthy: bool = True):
        records = chunks if chunks is not None else {"c1": _chunk("c1"), "c2": _chunk("c2")}
        self.chunk_store = ChunkStore(records)
        self.qdrant_client = _FakeQdrant(healthy=qdrant_healthy)
        self.embedding_provider = object()
        self.bm25_index = object()
        self.reranker = _FakeReranker()
        self.llm_provider = object()
        self.kb_version = "1.0"
        self.embedding_version = "minilm-l6-v2-1"
        self.llm_model = "gpt-oss:20b"


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """The app object is module-level, so RateLimitMiddleware's `_hits`
    counters persist for the whole pytest session. Without this, tests pass
    individually and fail in a full run once the cumulative /api/query count
    crosses the limit — and the failure lands on whichever test happens to
    be ~21st, which is nowhere near the cause.
    """
    from app import main
    from app.observability.middleware import RateLimitMiddleware

    def _live_limiters():
        """Walk the app's LIVE middleware chain.

        Two traps here, both hit while writing this:

        1. `app.middleware_stack` is None until Starlette builds it lazily
           on the first request, so traversing too early finds nothing and
           this fixture becomes a silent no-op.
        2. Calling `build_middleware_stack()` to force it returns a *new*
           chain with *new* counters — clearing those would leave the
           counters the app actually uses untouched.

        So: build once via a throwaway request if needed, then traverse the
        stack the app is really serving from.
        """
        if main.app.middleware_stack is None:
            main.app.middleware_stack = main.app.build_middleware_stack()

        found, stack = [], [main.app.middleware_stack]
        while stack:
            node = stack.pop()
            if node is None:
                continue
            if isinstance(node, RateLimitMiddleware):
                found.append(node)
            stack.append(getattr(node, "app", None))
        return found

    limiters = _live_limiters()
    assert limiters, "rate limiter not found — this fixture would silently do nothing"

    for limiter in limiters:
        limiter._hits.clear()
    yield
    for limiter in limiters:
        limiter._hits.clear()


def _make_client(fastapi_app) -> TestClient:
    """A client over the REAL app with resources injected.

    `lifespan` is NOT run: it calls load_app_resources(), which opens Qdrant
    and loads two transformer models — and, more importantly, it would
    overwrite the injected `_resources` with the real ones, silently turning
    these into slow tests against live dependencies. Setting the module
    global is what lifespan does anyway, minus the I/O.

    raise_server_exceptions=False so an unhandled exception surfaces as the
    500 a real client would see rather than being re-raised into the test.
    Without it, a regression of the logging-KeyError bug would present as a
    harness error instead of as the 500 it actually is.
    """
    return TestClient(fastapi_app, raise_server_exceptions=False)


@pytest.fixture
def client(monkeypatch):
    from app import main

    monkeypatch.setattr(main, "_resources", _FakeResources())
    return _make_client(main.app)


@pytest.fixture
def stub_query(monkeypatch):
    """Returns a setter that installs a fake run_query for one test."""
    from app import main

    def _install(result_or_exc):
        def _run_query(*_args, **_kwargs):
            if isinstance(result_or_exc, BaseException):
                raise result_or_exc
            return result_or_exc

        monkeypatch.setattr(main, "run_query", _run_query)

    return _install


# ---------------------------------------------------------------------------
# OrchestratorResult builders — real safety engines, real dataclasses
# ---------------------------------------------------------------------------


def _citation(chunk_id: str, evidence_id: str) -> ResolvedCitation:
    record = _chunk(chunk_id)
    return ResolvedCitation(
        evidence_id=evidence_id,
        chunk_id=chunk_id,
        document_id=record.document_id,
        document_title=record.document_title,
        organization=record.organization,
        section_path=record.section_path,
        page_start=record.page_start,
        page_end=record.page_end,
        evidence_grade=record.evidence_grade,
        source_url=record.source_url,
        license=record.license,
    )


def _pack(chunk_ids=("c1", "c2"), *, top_rerank: float | None = 3.2) -> EvidencePack:
    return EvidencePack(
        query_id="q1",
        rewritten_queries=("low salt diet",),
        predicted_domains=("cardiovascular",),
        evidence=[
            EvidenceItem(
                evidence_id=f"E{i + 1}",
                chunk_id=cid,
                text=_chunk(cid).text,
                dense_score=0.81,
                bm25_score=4.2,
                rrf_score=0.031,
                rerank_score=top_rerank,
            )
            for i, cid in enumerate(chunk_ids)
        ],
        top_rerank_score=top_rerank,
        top_rrf_score=0.031,
        support_count=len(chunk_ids),
    )


def _sufficiency(state=SufficiencyState.SUFFICIENT, support=2) -> SufficiencyResult:
    return SufficiencyResult(
        state=state,
        signal_used="rerank",
        top_score=3.2,
        support_count=support,
        tau_high=0.7285,
        tau_low=-3.9325,
    )


def _resolved(*, dropped: int = 0, limitations=None, cited=("c1",)) -> ResolvedAnswer:
    return ResolvedAnswer(
        statements=[
            ResolvedStatement(
                text="Reducing salt intake lowers blood pressure.",
                citations=[_citation(cid, f"E{i + 1}") for i, cid in enumerate(cited)],
            )
        ],
        excerpts=[
            ResolvedExcerpt(
                evidence_id="E1",
                quote="Reduce dietary salt to less than 5 g per day.",
                citation=_citation("c1", "E1"),
            )
        ],
        limitations=limitations if limitations is not None else ["Guidance is general, not personalized."],
        conflicts=[],
        dropped=[
            ValidationDrop(kind="statement", reason="unsupported", content="x") for _ in range(dropped)
        ],
        fell_back_to_refusal=False,
    )


def _success_result(
    message: str = "What diet helps with high blood pressure?",
    *,
    sufficiency_state=SufficiencyState.SUFFICIENT,
    resolved: ResolvedAnswer | None = None,
    trace: dict | None = None,
) -> OrchestratorResult:
    """A success result whose risk/decision come from the REAL engines."""
    red_flags = check_red_flags(message)
    pack = _pack()
    suff = _sufficiency(sufficiency_state)
    risk = assess_risk(message, red_flags, suff.state.value, pack.support_count, ("cardiovascular",))
    decision = decide_actions(risk.urgency, suff.state.value, pack.support_count, is_refusal=False)
    return OrchestratorResult(
        request_id="req-success",
        status="success",
        supported_domain=True,
        domains=["cardiovascular"],
        patient_state={
            "symptoms": ["high blood pressure"],
            "severity": "moderate",
            "duration": "3 months",
            "missing_information": ["current medications"],
        },
        resolved_answer=resolved if resolved is not None else _resolved(),
        refusal_reason=None,
        refusal_message=None,
        pack=pack,
        sufficiency=suff,
        retrieval=None,
        latency_ms=1234.5,
        trace=trace or {},
        red_flags=red_flags,
        risk=risk,
        decision=decision,
    )


def _refusal_result(
    message: str,
    reason: str,
    refusal_message: str,
    *,
    sufficiency_state=SufficiencyState.INSUFFICIENT,
    pack: EvidencePack | None = None,
) -> OrchestratorResult:
    red_flags = check_red_flags(message)
    suff = None if pack is None else _sufficiency(sufficiency_state, pack.support_count)
    state_value = suff.state.value if suff else "OUT_OF_SCOPE"
    support = pack.support_count if pack else 0
    risk = assess_risk(message, red_flags, state_value, support)
    decision = decide_actions(risk.urgency, state_value, support, is_refusal=True)
    return OrchestratorResult(
        request_id="req-refusal",
        status="refusal",
        supported_domain=pack is not None,
        domains=["cardiovascular"] if pack else [],
        patient_state=None,
        resolved_answer=None,
        refusal_reason=reason,
        refusal_message=refusal_message,
        pack=pack,
        sufficiency=suff,
        retrieval=None,
        latency_ms=210.0,
        trace={},
        red_flags=red_flags,
        risk=risk,
        decision=decision,
    )


# ===========================================================================
# 1. The success path end-to-end
# ===========================================================================


def test_success_response_satisfies_the_full_contract(client, stub_query):
    """The whole point: a success must survive Pydantic response validation.
    QuerySuccessOut requires >=1 statement, >=1 citation per statement, and
    >=1 evidence item — a builder bug in any of those is a 500, not a
    partial response."""
    stub_query(_success_result())
    response = client.post("/api/query", json={"message": "What diet helps with high blood pressure?"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "success"
    assert body["request_id"]
    assert body["assessment"]["statements"][0]["citations"] == [1]
    assert body["assessment"]["diagnosis_confirmed"] is False  # SAF-1.1
    assert body["evidence"][0]["chunk_id"] == "c1"
    assert body["meta"]["kb_version"] == "1.0"
    assert body["safety"]["sufficiency"] == "SUFFICIENT"


def test_citation_indexes_point_at_real_evidence_entries(client, stub_query):
    """A statement's `citations` are 1-based indexes into `evidence[]`.
    An off-by-one here would silently attribute a claim to the wrong
    source document — the exact failure this system exists to prevent."""
    stub_query(_success_result(resolved=_resolved(cited=("c2",))))
    body = client.post("/api/query", json={"message": "salt intake"}).json()

    evidence = body["evidence"]
    for statement in body["assessment"]["statements"]:
        assert statement["citations"], "a statement with no citation must never ship"
        for index in statement["citations"]:
            assert 1 <= index <= len(evidence)
            assert evidence[index - 1]["chunk_id"] == "c2"
            assert evidence[index - 1]["selected"] is True


def test_only_cited_evidence_is_marked_selected(client, stub_query):
    stub_query(_success_result(resolved=_resolved(cited=("c1",))))
    evidence = client.post("/api/query", json={"message": "salt"}).json()["evidence"]

    selected = {e["chunk_id"]: e["selected"] for e in evidence}
    assert selected == {"c1": True, "c2": False}


def test_evidence_metadata_comes_from_the_chunk_store(client, stub_query):
    """ARCHITECTURE.md §8 — citation fields resolve through the Chunk Store,
    never through whatever the vector store's payload happened to hold."""
    stub_query(_success_result())
    first = client.post("/api/query", json={"message": "salt"}).json()["evidence"][0]

    assert first["document_title"] == "HEARTS Technical Package"
    assert first["organization"] == "WHO"
    assert first["source_url"].startswith("https://iris.who.int/")
    assert first["page_start"] == 12


def test_partial_sufficiency_always_carries_a_limitation(client, stub_query):
    """The frontend's Zod schema requires >=1 limitation on PARTIAL. The LLM
    prompt has no hard minimum, so main.py synthesizes one. Without that,
    a valid backend response is rejected by the client as malformed."""
    stub_query(
        _success_result(
            sufficiency_state=SufficiencyState.PARTIAL,
            resolved=_resolved(limitations=[]),
        )
    )
    body = client.post("/api/query", json={"message": "salt"}).json()

    assert body["safety"]["sufficiency"] == "PARTIAL"
    assert len(body["assessment"]["limitations"]) >= 1
    assert "limited" in body["assessment"]["limitations"][0].lower()


def test_dropped_statement_count_is_reported(client, stub_query):
    """NFR/observability: a user is entitled to know the system discarded
    ungrounded claims rather than silently shrinking the answer."""
    stub_query(_success_result(resolved=_resolved(dropped=3)))
    body = client.post("/api/query", json={"message": "salt"}).json()

    assert body["safety"]["unsupported_statements_dropped"] == 3


def test_trace_is_omitted_unless_requested(client, stub_query):
    stub_query(_success_result())
    assert client.post("/api/query", json={"message": "salt"}).json()["trace"] is None


def test_trace_is_returned_when_requested(client, stub_query):
    stub_query(
        _success_result(
            trace={"stages": [{"name": "retrieval", "latency_ms": 42.0, "output": {"candidates": 25}}]}
        )
    )
    body = client.post(
        "/api/query",
        json={"message": "salt", "options": {"include_trace": True}},
    ).json()

    assert body["trace"]["stages"][0]["name"] == "retrieval"


# ===========================================================================
# 2. Refusals — the path that returned 500 for the entire project lifetime
# ===========================================================================


@pytest.mark.parametrize(
    "reason",
    ["INSUFFICIENT_EVIDENCE", "OUT_OF_SCOPE", "PRESCRIBING_REQUEST"],
)
def test_every_refusal_reason_code_is_accepted_by_the_contract(client, stub_query, reason):
    """Regression, and the highest-value test in this file.

    The orchestrator passed `SufficiencyState.value` ("INSUFFICIENT") into
    RefusalOut.reason, whose Literal only permits "INSUFFICIENT_EVIDENCE".
    Every refusal was therefore a 500. It went unnoticed because the
    placeholder thresholds in use at the time meant the refusal path never
    executed in practice.

    Parametrizing over all three codes means adding a fourth to the
    orchestrator without adding it to RefusalOut fails here, not in prod.
    """
    stub_query(_refusal_result("some question", reason, "Cannot answer.", pack=_pack()))
    response = client.post("/api/query", json={"message": "some question"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "refusal"
    assert body["refusal"]["reason"] == reason
    assert body["refusal"]["recommend_professional_evaluation"] is True


def test_orchestrator_refusal_codes_match_the_api_contract_exactly():
    """The other half of the regression above, and the part with teeth.

    The bug was the orchestrator passing `SufficiencyState.value`
    ("INSUFFICIENT") where RefusalOut.reason requires
    "INSUFFICIENT_EVIDENCE" — verified to still produce a 500 today if
    reintroduced. Asserting the three valid codes are accepted does not
    catch that; asserting the two vocabularies agree does.

    SufficiencyState and RefusalOut.reason are deliberately *different*
    vocabularies that happen to overlap on OUT_OF_SCOPE, which is exactly
    what made the mismatch easy to miss.
    """
    import typing

    from app.schemas.query import RefusalOut
    from app.services.rag.query_orchestrator import REFUSAL_REASON_CODES

    allowed = set(typing.get_args(RefusalOut.model_fields["reason"].annotation))

    # Every code the orchestrator can emit must be one the contract permits.
    assert set(REFUSAL_REASON_CODES.values()) <= allowed
    # And the mapping must cover every refusing state, or a state added
    # later would raise KeyError on the refusal path instead of refusing.
    for state in (SufficiencyState.INSUFFICIENT, SufficiencyState.OUT_OF_SCOPE):
        assert state in REFUSAL_REASON_CODES
    # The raw enum value is NOT a valid reason code — the precise bug.
    assert SufficiencyState.INSUFFICIENT.value not in allowed


def test_prescribing_short_circuit_returns_no_evidence(client, stub_query):
    """SAF-7.3 short-circuits before retrieval, so there is genuinely no
    Evidence Pack. QueryRefusalOut permits an empty evidence list where
    QuerySuccessOut does not — an empty list here is the honest encoding of
    'no retrieval happened', and inventing evidence would be worse."""
    stub_query(
        _refusal_result(
            "what dose of lisinopril should I take",
            "PRESCRIBING_REQUEST",
            "Please speak to a prescriber.",
            pack=None,
        )
    )
    response = client.post("/api/query", json={"message": "what dose of lisinopril should I take"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["evidence"] == []
    # No gate ran, so the honest state is OUT_OF_SCOPE, not INSUFFICIENT.
    assert body["safety"]["sufficiency"] == "OUT_OF_SCOPE"


def test_red_flag_escalation_survives_a_refusal(client, stub_query):
    """SAF-6.2, the invariant most worth pinning at the HTTP layer.

    Someone describing crushing chest pain in words the corpus cannot
    answer must not receive a bare 'insufficient evidence'. That is the
    worst possible pairing: a correct refusal AND a missed emergency. The
    escalation is prepended to the refusal message because QueryRefusalOut
    carries no risk block.
    """
    message = "I have crushing chest pain spreading to my left arm"
    stub_query(
        _refusal_result(message, "INSUFFICIENT_EVIDENCE", "I do not have sufficient evidence.", pack=_pack())
    )
    body = client.post("/api/query", json={"message": message}).json()

    text = body["refusal"]["message"]
    assert "emergency" in text.lower() or "911" in text or "immediately" in text.lower()
    # The refusal itself must still be present, not replaced by the banner.
    assert "sufficient evidence" in text


def test_low_risk_refusal_has_no_emergency_banner(client, stub_query):
    """The mirror of the test above — an escalation that fires on every
    refusal would be alarm fatigue, and would make the previous test
    vacuous."""
    stub_query(
        _refusal_result("what is the capital of France", "OUT_OF_SCOPE", "Outside scope.", pack=None)
    )
    body = client.post("/api/query", json={"message": "what is the capital of France"}).json()

    assert body["refusal"]["message"] == "Outside scope."


# ===========================================================================
# 3. Risk / decision blocks
# ===========================================================================


def test_risk_block_references_only_cited_evidence(client, stub_query):
    """A risk block pointing at an unselected candidate would claim support
    from evidence the answer never used. The frontend enforces this as a
    cross-field rule; the backend must not emit it in the first place."""
    stub_query(_success_result(resolved=_resolved(cited=("c2",))))
    body = client.post("/api/query", json={"message": "salt"}).json()

    risk = body["risk"]
    assert risk is not None
    selected_indexes = {e["index"] for e in body["evidence"] if e["selected"]}
    assert set(risk["evidence_ids"]) == selected_indexes
    assert risk["level"] in {"LOW", "MODERATE", "HIGH", "CRITICAL"}
    assert risk["confidence_band"] in {"strong", "moderate", "weak"}


def test_risk_block_is_omitted_when_there_is_no_evidence_pack(client, stub_query):
    """RiskOut with an empty `evidence_ids` is invalid, and fabricating an
    id would be worse — a risk claim citing evidence that does not exist is
    precisely the failure this system is built to prevent. Omitting the
    block is the honest option; the frontend already treats `risk` as
    optional.

    Reached via the SAF-7.3 prescribing short-circuit, which returns before
    retrieval and so genuinely has no pack. That is the only way this guard
    fires in production: `resolve_and_validate` drops any citation that
    does not resolve against the pack, so a *success* response can never
    carry a cited chunk absent from its own evidence.
    """
    stub_query(
        _refusal_result(
            "what dose of metformin should I take",
            "PRESCRIBING_REQUEST",
            "Please speak to a prescriber.",
            pack=None,
        )
    )
    response = client.post("/api/query", json={"message": "what dose of metformin should I take"})

    assert response.status_code == 200, response.text
    # QueryRefusalOut has no `risk` field at all — the block is structurally
    # absent rather than present-and-empty.
    assert "risk" not in response.json()


def test_build_risk_out_returns_none_rather_than_empty_evidence_ids():
    """The guard itself, called directly.

    The HTTP test above reaches it through `pack is None`. This covers the
    other arm — a pack exists but nothing in it was cited — which cannot be
    produced through the endpoint (the Citation Resolver drops citations
    that do not resolve, so a success response always cites its own pack).
    Testing it here keeps the guard pinned without asserting a state the
    pipeline cannot actually reach.
    """
    from app.main import _build_risk_out

    result = _success_result()
    assert _build_risk_out(result, cited_chunk_ids=set()) is None
    assert _build_risk_out(result, cited_chunk_ids={"c1"}) is not None


def test_critical_urgency_leads_with_the_emergency_instruction(client, stub_query):
    """SAF-6.3 — 'MUST lead with' is about ordering in the text the user
    reads, not merely inclusion. SAF-6.5 — the wording comes from
    config/emergency.yaml, never from the LLM."""
    message = "I have crushing chest pain spreading to my left arm"
    stub_query(_success_result(message))
    body = client.post("/api/query", json={"message": message}).json()

    action = body["recommended_action"]
    assert action["type"] == "emergency"
    assert body["risk"]["level"] == "CRITICAL"
    assert body["risk"]["red_flag_rules"], "the firing rule must be traceable (SAF-2.4)"


def test_wellness_content_is_suppressed_at_high_urgency(client, stub_query):
    """SAF-6.4 — wellness tips must not appear beside an emergency."""
    stub_query(_success_result("I have crushing chest pain spreading to my left arm"))
    body = client.post("/api/query", json={"message": "chest pain"}).json()

    assert body["actions"]["show_wellness"] is False
    assert body["actions"]["show_call_emergency"] is True


def test_low_risk_query_shows_wellness_and_no_emergency_control(client, stub_query):
    stub_query(_success_result("What diet helps with high blood pressure?"))
    body = client.post("/api/query", json={"message": "What diet helps with high blood pressure?"}).json()

    assert body["actions"]["show_call_emergency"] is False
    assert body["recommended_action"]["type"] != "emergency"


def test_action_flags_are_booleans_only(client, stub_query):
    """SAF-6.6/6.7 — the actions block SHOWS controls; it never acts. If a
    field ever carried a URL, a phone number, or a callback, an autonomous
    side effect would become structurally possible. Keeping the type
    boolean-only is what makes that impossible rather than merely
    discouraged."""
    stub_query(_success_result("I have crushing chest pain spreading to my left arm"))
    actions = client.post("/api/query", json={"message": "chest pain"}).json()["actions"]

    assert set(actions) == {
        "show_call_emergency",
        "show_find_facility",
        "show_alert_contacts",
        "show_wellness",
    }
    assert all(isinstance(v, bool) for v in actions.values())


# ===========================================================================
# 4. Error mapping — SPEC.md §F.6
# ===========================================================================


def test_llm_rate_limit_maps_to_429_not_500(client, stub_query):
    import httpx
    import openai

    request = httpx.Request("POST", "https://ollama.com/v1/chat/completions")
    response = httpx.Response(429, headers={"Retry-After": "30"}, request=request)
    stub_query(openai.RateLimitError("rate limited", response=response, body=None))

    result = client.post("/api/query", json={"message": "salt"})
    assert result.status_code == 429
    assert result.json()["detail"]["error"]["code"] == "RATE_LIMITED"
    assert result.headers["Retry-After"] == "30"


def test_llm_unreachable_maps_to_503(client, stub_query):
    import httpx
    import openai

    stub_query(openai.APIConnectionError(request=httpx.Request("POST", "https://ollama.com/v1/x")))

    result = client.post("/api/query", json={"message": "salt"})
    assert result.status_code == 503
    assert result.json()["detail"]["error"]["code"] == "LLM_UNAVAILABLE"


def test_qdrant_outage_maps_to_503_retrieval_unavailable(client, stub_query):
    """SPEC.md §F.6 — 'no ungrounded fallback'. The system must never fall
    back to the model's own medical knowledge when retrieval is down.

    Found live when Docker was stopped: this fell into the generic 500
    handler and reported 'internal error' for a dependency being down.
    """
    from qdrant_client.http.exceptions import ResponseHandlingException

    stub_query(ResponseHandlingException(RuntimeError("connection refused")))

    result = client.post("/api/query", json={"message": "salt"})
    assert result.status_code == 503
    body = result.json()["detail"]["error"]
    assert body["code"] == "RETRIEVAL_UNAVAILABLE"
    assert body["stage"] == "retrieval"


def test_unexpected_failure_maps_to_500_never_a_silent_200(client, stub_query):
    stub_query(ValueError("something broke in the pipeline"))

    result = client.post("/api/query", json={"message": "salt"})
    assert result.status_code == 500
    assert result.json()["detail"]["error"]["code"] == "INTERNAL_ERROR"


def test_error_bodies_never_leak_internals(client, stub_query):
    """NFR-3.5. A provider exception's text routinely contains the request
    URL, the model name, and fragments of the prompt — which for this
    system means patient health data."""
    secret = "POST https://internal-host:11434/v1 model=gpt-oss:20b prompt='PATIENT SAYS chest pain'"
    stub_query(RuntimeError(secret))

    raw = client.post("/api/query", json={"message": "salt"}).text
    assert "internal-host" not in raw
    assert "PATIENT SAYS" not in raw
    assert "Traceback" not in raw
    assert "gpt-oss" not in raw


def test_every_error_response_carries_a_correlating_request_id(client, stub_query):
    """FR-7.6 — an error is exactly when someone needs an id to quote, and
    the header and the body must agree or the id is useless for grepping."""
    stub_query(ValueError("boom"))
    response = client.post("/api/query", json={"message": "salt"})

    assert response.headers["X-Request-ID"]
    assert response.json()["detail"]["error"]["request_id"]


def test_inbound_request_id_reaches_the_error_body(client, stub_query):
    """The id a proxy supplied must be the one echoed back, otherwise
    cross-system correlation silently breaks at the error boundary."""
    stub_query(ValueError("boom"))
    response = client.post(
        "/api/query",
        json={"message": "salt"},
        headers={"X-Request-ID": "trace-me-123"},
    )

    assert response.headers["X-Request-ID"] == "trace-me-123"
    assert response.json()["detail"]["error"]["request_id"] == "trace-me-123"


# ===========================================================================
# 5. Request validation
# ===========================================================================


@pytest.mark.parametrize(
    "payload",
    [
        {},                                  # message missing
        {"message": ""},                     # below min_length
        {"message": "x" * 2001},             # above max_length
        {"message": 42},                     # wrong type
    ],
)
def test_malformed_requests_are_422_not_500(client, stub_query, payload):
    """A bad request must be rejected at the boundary. Reaching the
    pipeline with a 2001-character message would burn four LLM calls before
    failing."""
    stub_query(_success_result())
    assert client.post("/api/query", json=payload).status_code == 422


def test_maximum_length_message_is_accepted(client, stub_query):
    """Pins the boundary from the other side — an off-by-one in max_length
    would reject a legitimate long description of symptoms."""
    stub_query(_success_result())
    assert client.post("/api/query", json={"message": "x" * 2000}).status_code == 200


# ===========================================================================
# 6. Observability — the bug unit tests could not see
# ===========================================================================


def test_query_endpoint_survives_a_reserved_key_in_its_own_telemetry(client, stub_query, monkeypatch):
    """Regression for the second production 500.

    The handler logged `extra={"message": ...}`. That name is a reserved
    LogRecord attribute, so Python's logging raised KeyError from *inside*
    the logging call, which propagated into the request and made every
    single /api/query a 500.

    Note what this test does and does not assert. Simply calling the
    endpoint proves nothing: `_SafeExtraLogger` now renames colliding keys
    globally, so reverting main.py's call site back to the bad key leaves
    every test green (verified by actually reintroducing it). The bug is
    unreachable by construction, which is the stronger fix — but it means a
    test that merely hits the endpoint is not a regression test for
    anything.

    So this forces the hazard instead: it makes the handler's own logging
    call pass a reserved key, and requires the request to survive. That
    pins the property that actually protects us — a telemetry call must
    never break the request it is only observing — rather than pinning one
    call site's choice of dictionary key.
    """
    from app import main

    original = main.redact

    def _redact_into_reserved_key(text):
        # Sneak a reserved name into the same `extra` dict the handler builds.
        main.app_logger.info("probe", extra={"message": "reserved", "args": "reserved"})
        return original(text)

    monkeypatch.setattr(main, "redact", _redact_into_reserved_key)
    stub_query(_success_result())

    assert client.post("/api/query", json={"message": "salt"}).status_code == 200


def test_patient_text_never_appears_in_any_log_record(client, stub_query, caplog):
    """NFR-4.1/4.2 — a log line is durable storage, and this is health data.
    Asserted across every record the request emits, not just the one the
    handler writes intentionally."""
    import logging

    secret = "I have crushing chest pain and I am terrified"
    stub_query(_success_result(secret))

    with caplog.at_level(logging.DEBUG):
        client.post("/api/query", json={"message": secret})

    for record in caplog.records:
        blob = f"{record.getMessage()} {record.__dict__}"
        assert "terrified" not in blob, f"patient text leaked via {record.name}"
    # And the redacted marker proves the field was recorded as present.
    assert any("redacted" in str(r.__dict__) for r in caplog.records)


def test_request_id_is_present_on_the_success_path_too(client, stub_query):
    stub_query(_success_result())
    assert client.post("/api/query", json={"message": "salt"}).headers["X-Request-ID"]


# ===========================================================================
# 7. Rate limiting against the real app
# ===========================================================================


def test_query_is_rate_limited_but_health_is_not(client, stub_query, monkeypatch):
    """NFR-3.3. /api/query costs 4+ LLM calls; /api/health must never be
    throttled or monitoring reports the opposite of the truth under load.

    tests/test_api_hardening.py covers the limiter against a toy app; this
    verifies it is actually WIRED to the real one, with the real path
    configuration. A middleware that works but was never registered is a
    plausible and completely silent failure.
    """
    from app import main

    stub_query(_success_result())
    limit = int(main.os.environ.get("RATE_LIMIT_REQUESTS", "20"))

    statuses = [
        client.post("/api/query", json={"message": "salt"}).status_code
        for _ in range(limit + 3)
    ]
    assert 429 in statuses, "the limiter is not wired into the real app"
    assert statuses[0] == 200

    for _ in range(5):
        assert client.get("/api/health").status_code == 200


# ===========================================================================
# 8. The other two endpoints
# ===========================================================================


def test_evidence_lookup_returns_the_full_record(client):
    """The evidence inspector's contract — every provenance field a user
    would need to verify a citation against the real published document."""
    body = client.get("/api/evidence/c1").json()

    assert body["chunk_id"] == "c1"
    assert body["document_title"] == "HEARTS Technical Package"
    assert body["source_url"].startswith("https://iris.who.int/")
    assert body["license"]
    assert body["page_start"] == 12
    assert body["text"]
    assert body["content_hash"]


def test_unknown_chunk_id_is_404_with_the_spec_envelope(client):
    response = client.get("/api/evidence/does-not-exist")

    assert response.status_code == 404
    assert response.json()["detail"]["error"]["code"] == "CHUNK_NOT_FOUND"


def test_health_reports_ok_when_dependencies_are_up(client):
    body = client.get("/api/health").json()

    assert body["status"] == "ok"
    assert body["checks"]["qdrant"]["ok"] is True
    assert body["checks"]["chunk_store"]["chunks"] == 2
    assert body["versions"]["kb"] == "1.0"


def test_health_reports_degraded_when_qdrant_is_down(monkeypatch):
    """Degraded, not a 500 — health must still answer when a dependency is
    down, because reporting the outage IS its job. A health check that
    fails when the system is unhealthy tells an operator nothing."""
    from app import main

    monkeypatch.setattr(main, "_resources", _FakeResources(qdrant_healthy=False))
    response = _make_client(main.app).get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["checks"]["qdrant"]["ok"] is False


def test_endpoints_are_503_before_resources_load(monkeypatch):
    """Startup is slow (two transformer models). A request arriving during
    it must get a clean 503, not a 500 from a None dereference."""
    from app import main

    monkeypatch.setattr(main, "_resources", None)
    c = _make_client(main.app)
    for response in (
        c.post("/api/query", json={"message": "salt"}),
        c.get("/api/health"),
        c.get("/api/evidence/c1"),
    ):
        assert response.status_code == 503
        assert response.json()["detail"]["error"]["code"] == "RETRIEVAL_UNAVAILABLE"


# ===========================================================================
# 9. CORS — NFR-3.4
# ===========================================================================


def test_configured_origin_is_allowed(client):
    response = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_unknown_origin_is_not_granted_access(client):
    """Not a wildcard. A '*' here would let any page on the internet submit
    a patient's symptoms to this backend."""
    response = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert response.headers.get("access-control-allow-origin") not in ("*", "https://evil.example")


def test_request_id_header_is_exposed_to_the_browser(client):
    """A response header the frontend cannot read may as well not exist —
    CORS hides everything not named in expose_headers, and the frontend's
    error UI shows this id to the user."""
    response = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    exposed = response.headers.get("access-control-expose-headers", "")
    assert "X-Request-ID" in exposed
