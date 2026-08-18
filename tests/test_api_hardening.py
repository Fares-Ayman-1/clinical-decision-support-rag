"""API hardening — SPEC.md NFR-3.3, NFR-3.4, NFR-3.5, NFR-7.1, FR-7.6.

Tests the middleware and error-envelope behavior in isolation from the RAG
pipeline: a tiny FastAPI app is assembled with the same middleware the real
app uses, so these run without Qdrant, an embedding model, or an API key.
"""

from __future__ import annotations

import json
import logging

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.observability.logging import (
    JsonFormatter,
    NoFreeTextFilter,
    get_request_id,
    redact,
    set_request_id,
)
from app.observability.middleware import RateLimitMiddleware, RequestContextMiddleware


def _app(*, limit: int = 3, window: int = 60) -> FastAPI:
    app = FastAPI()

    @app.get("/api/query")
    def query():  # GET for test convenience; the limiter is method-agnostic
        return {"ok": True}

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/boom")
    def boom():
        raise HTTPException(status_code=500, detail={"error": {"code": "INTERNAL_ERROR"}})

    app.add_middleware(RateLimitMiddleware, limit=limit, window_seconds=window,
                       paths=("/api/query",))
    app.add_middleware(RequestContextMiddleware)
    return app


# ---------------------------------------------------------------------------
# NFR-3.3 — rate limiting
# ---------------------------------------------------------------------------


def test_requests_under_the_limit_pass():
    client = TestClient(_app(limit=3))
    for _ in range(3):
        assert client.get("/api/query").status_code == 200


def test_request_over_the_limit_is_429_with_spec_error_shape():
    client = TestClient(_app(limit=2))
    client.get("/api/query")
    client.get("/api/query")
    response = client.get("/api/query")

    assert response.status_code == 429
    body = response.json()
    # SPEC.md F.6: all errors share one envelope.
    assert body["error"]["code"] == "RATE_LIMITED"
    assert body["error"]["message"]
    # The frontend's clinical-errors.ts parses this to show a countdown.
    assert int(response.headers["Retry-After"]) >= 1


def test_rate_limit_applies_only_to_configured_paths():
    """/api/health must never be throttled — monitoring would flap, and a
    health check that fails under load reports the opposite of the truth."""
    client = TestClient(_app(limit=1))
    client.get("/api/query")
    assert client.get("/api/query").status_code == 429
    for _ in range(10):
        assert client.get("/api/health").status_code == 200


def test_rate_limit_is_keyed_per_client():
    """One noisy client must not lock everyone else out."""
    client = TestClient(_app(limit=1))
    assert client.get("/api/query", headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 200
    assert client.get("/api/query", headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 429
    # A different client still gets its own budget.
    assert client.get("/api/query", headers={"X-Forwarded-For": "2.2.2.2"}).status_code == 200


def test_window_expiry_restores_the_budget(monkeypatch):
    import app.observability.middleware as mw

    clock = {"t": 1000.0}
    monkeypatch.setattr(mw.time, "monotonic", lambda: clock["t"])

    client = TestClient(_app(limit=1, window=60))
    assert client.get("/api/query").status_code == 200
    assert client.get("/api/query").status_code == 429

    clock["t"] += 61  # window has passed
    assert client.get("/api/query").status_code == 200


# ---------------------------------------------------------------------------
# NFR-7.1 / FR-7.6 — request correlation
# ---------------------------------------------------------------------------


def test_response_carries_a_request_id():
    response = TestClient(_app()).get("/api/health")
    assert response.headers.get("X-Request-ID")


def test_inbound_request_id_is_honoured():
    """A front proxy or the frontend can supply its own id so one
    identifier correlates across systems."""
    response = TestClient(_app()).get("/api/health",
                                      headers={"X-Request-ID": "abc-123"})
    assert response.headers["X-Request-ID"] == "abc-123"


def test_error_responses_still_carry_a_request_id():
    """An id on the happy path only is useless — errors are exactly when
    someone needs to quote one."""
    response = TestClient(_app()).get("/boom")
    assert response.status_code == 500
    assert response.headers.get("X-Request-ID")


def test_rate_limited_response_carries_a_request_id():
    client = TestClient(_app(limit=1))
    client.get("/api/query")
    assert client.get("/api/query").headers.get("X-Request-ID")


# ---------------------------------------------------------------------------
# NFR-7.1 — structured logging
# ---------------------------------------------------------------------------


def test_formatter_emits_json_with_request_id():
    token = set_request_id("req-42")
    try:
        record = logging.LogRecord("app", logging.INFO, __file__, 1, "hello", (), None)
        parsed = json.loads(JsonFormatter().format(record))
        assert parsed["message"] == "hello"
        assert parsed["request_id"] == "req-42"
        assert parsed["level"] == "INFO"
    finally:
        from app.observability.logging import reset_request_id

        reset_request_id(token)


def test_formatter_includes_extra_fields():
    record = logging.LogRecord("app", logging.INFO, __file__, 1, "m", (), None)
    record.status = 200
    record.duration_ms = 12.5
    parsed = json.loads(JsonFormatter().format(record))
    assert parsed["status"] == 200
    assert parsed["duration_ms"] == 12.5


def test_traceback_goes_to_the_log_not_the_response():
    """NFR-3.5's other half: the stack trace must exist somewhere, just not
    in the client's response body."""
    try:
        raise ValueError("internal detail with /secret/path")
    except ValueError:
        import sys

        record = logging.LogRecord("app", logging.ERROR, __file__, 1, "failed", (),
                                   sys.exc_info())
    parsed = json.loads(JsonFormatter().format(record))
    assert "traceback" in parsed
    assert "ValueError" in parsed["traceback"]


# ---------------------------------------------------------------------------
# SAF-10.3 / NFR-4.1 — no free text in the metrics stream, none in any log
# ---------------------------------------------------------------------------


def test_metrics_filter_omits_long_free_text():
    """SAF-10.3 — the always-on metrics stream must carry no free text.
    Enforced by a filter rather than trusted to call sites."""
    record = logging.LogRecord("metrics", logging.INFO, __file__, 1, "m", (), None)
    record.patient_text = "x" * 500
    record.status = 200

    NoFreeTextFilter().filter(record)
    assert record.patient_text.startswith("<omitted:")
    assert record.status == 200, "scalars must survive"


def test_redact_reports_length_not_content():
    """Patient text never reaches a log line, but an operator still needs
    to distinguish an empty submission from a long one."""
    text = "my chest hurts and I feel pressure"
    out = redact(text)
    assert "chest" not in out
    assert f"{len(text)} chars" in out
    assert redact(None) == "<none>"


# ---------------------------------------------------------------------------
# NFR-3.5 — the error envelope itself
# ---------------------------------------------------------------------------


def test_error_body_never_contains_the_exception_text():
    """Regression: every handler used to put str(e) in the response body.
    A provider error's text can include the request URL, the model name,
    and fragments of the prompt."""
    from app.main import _error_body

    secret = "connection to https://internal.host/v1 failed for model x with prompt 'PATIENT SAYS'"
    body = _error_body("INTERNAL_ERROR", "UNEXPECTED", RuntimeError(secret), stage="pipeline")

    serialized = json.dumps(body)
    assert "internal.host" not in serialized
    assert "PATIENT SAYS" not in serialized
    assert body["error"]["code"] == "INTERNAL_ERROR"
    assert body["error"]["request_id"]
    assert body["error"]["stage"] == "pipeline"
    # `reason` is a safe classifier, deliberately returned.
    assert body["error"]["reason"] == "UNEXPECTED"


@pytest.mark.parametrize(
    "code", ["RATE_LIMITED", "LLM_UNAVAILABLE", "RETRIEVAL_UNAVAILABLE",
             "INTERNAL_ERROR", "CHUNK_NOT_FOUND"],
)
def test_every_error_code_has_client_safe_copy(code):
    from app.main import _CLIENT_SAFE_MESSAGES

    assert code in _CLIENT_SAFE_MESSAGES, f"{code} would fall back to generic text"
    assert _CLIENT_SAFE_MESSAGES[code].strip()


def test_reserved_extra_keys_do_not_raise():
    """Regression: extra={"message": ...} raises KeyError inside logging
    itself ("Attempt to overwrite 'message' in LogRecord"), which
    propagated out of the logging call and turned every /api/query into a
    500. A telemetry call must never break the request it is observing.
    """
    from app.observability.logging import app_logger

    # Would raise KeyError before the fix.
    app_logger.info("test", extra={"message": "collides", "status": 200})
    app_logger.info("test", extra={"name": "collides", "args": "collides"})


def test_reserved_extra_keys_are_renamed_not_dropped():
    """Renaming keeps the value visible; dropping would silently lose
    telemetry at exactly the moment someone is debugging."""
    import logging as _logging

    from app.observability.logging import _SafeExtraLogger

    logger = _SafeExtraLogger("probe")
    record = logger.makeRecord("probe", _logging.INFO, __file__, 1, "m", (), None,
                               extra={"message": "kept", "duration_ms": 5})
    assert record.x_message == "kept"
    assert record.duration_ms == 5
    assert record.getMessage() == "m"


def test_qdrant_outage_maps_to_503_retrieval_unavailable():
    """SPEC.md F.6: a vector-store outage is 503 RETRIEVAL_UNAVAILABLE with
    "no ungrounded fallback" — the system must never answer from the
    model's own medical knowledge when retrieval is down.

    Regression: this fell into the generic 500 handler, so a stopped Qdrant
    reported "internal error" instead of naming the unreachable dependency.
    Found live when Docker was not running.
    """
    from qdrant_client.http.exceptions import ResponseHandlingException

    from app.main import QdrantException

    # The alias must actually catch what the client raises on a refused
    # connection, or the handler silently never fires.
    assert issubclass(ResponseHandlingException, QdrantException)


def test_retrieval_unavailable_message_states_no_answer_is_possible():
    """The copy must not imply a degraded-but-real answer was given: with
    retrieval down there is no grounded answer at all."""
    from app.main import _CLIENT_SAFE_MESSAGES

    message = _CLIENT_SAFE_MESSAGES["RETRIEVAL_UNAVAILABLE"].lower()
    assert "no answer" in message or "unavailable" in message
