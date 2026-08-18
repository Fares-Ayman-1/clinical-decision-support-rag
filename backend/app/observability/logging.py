"""Structured JSON logging — SPEC.md NFR-7.1, FR-7.6.

NFR-7.1 requires structured JSON logging with `request_id` on every line.
FR-7.6 requires every error to be logged with `request_id` and stage.

Two streams, deliberately separated (SPEC.md PART E):

  app     — human/machine-readable operational events. May carry a
            `request_id`, never free-text patient content.
  metrics — the always-on counters stream. SAF-10.3 requires this to
            contain NO free-text content at all, so it is a separate
            logger with its own filter rather than a convention.

The `request_id` is carried in a ContextVar rather than threaded through
every function signature: the orchestrator already passes a request_id
into its own result, but the logging call sites are spread across
retrieval, generation, and safety modules that have no reason to take a
logging parameter. A ContextVar keeps the correlation without contorting
those interfaces.

Patient text is never logged. NFR-4.1 (collect the minimum necessary) and
NFR-4.2 (no durable storage of user health data) both point the same way,
and a log line is durable storage. `redact()` exists for the cases where a
caller genuinely needs to record that a field was present without
recording what was in it.
"""

from __future__ import annotations

import contextvars
import json
import logging
import sys
import uuid
from typing import Any

# Set per request by RequestContextMiddleware; read by the formatter.
_request_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "request_id", default=None
)


def new_request_id() -> str:
    return str(uuid.uuid4())


def set_request_id(request_id: str) -> contextvars.Token:
    return _request_id.set(request_id)


def get_request_id() -> str | None:
    return _request_id.get()


def reset_request_id(token: contextvars.Token) -> None:
    _request_id.reset(token)


class JsonFormatter(logging.Formatter):
    """One JSON object per line, with request_id attached automatically."""

    # Attributes LogRecord always carries; anything else a caller attached
    # via `extra=` is application data worth emitting.
    _RESERVED = frozenset(
        vars(logging.LogRecord("", 0, "", 0, "", (), None)).keys()
    ) | {"asctime", "message", "taskName"}

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        request_id = getattr(record, "request_id", None) or get_request_id()
        if request_id:
            payload["request_id"] = request_id

        for key, value in record.__dict__.items():
            if key not in self._RESERVED and key != "request_id":
                payload[key] = value

        if record.exc_info:
            # The stack trace goes to the LOG, never to an API response
            # (NFR-3.5). Operators need it; clients must not see it.
            payload["exc_type"] = record.exc_info[0].__name__ if record.exc_info[0] else None
            payload["traceback"] = self.formatException(record.exc_info)

        return json.dumps(payload, ensure_ascii=False, default=str)


class NoFreeTextFilter(logging.Filter):
    """SAF-10.3 — the always-on metrics stream MUST contain no free-text
    content. Enforced here rather than trusted to call sites: a metrics
    record may carry only scalars, booleans, and short identifier-like
    strings. Anything longer is dropped with a marker so the omission is
    visible rather than silent.
    """

    MAX_STRING = 64

    def filter(self, record: logging.LogRecord) -> bool:
        for key, value in list(record.__dict__.items()):
            if key in JsonFormatter._RESERVED:
                continue
            if isinstance(value, str) and len(value) > self.MAX_STRING:
                record.__dict__[key] = f"<omitted: {len(value)} chars>"
        return True


def redact(text: str | None) -> str:
    """Record that a field was present without recording its content.

    Used for patient message text, which must never reach a log line
    (NFR-4.1/4.2). Returns a length so a debugging operator can still tell
    an empty submission from a long one.
    """
    if text is None:
        return "<none>"
    return f"<redacted: {len(text)} chars>"


def configure_logging(level: str = "INFO") -> None:
    """Install the JSON formatter on the app and metrics streams.

    Idempotent — safe to call from both FastAPI startup and a script.
    """
    formatter = JsonFormatter()

    root = logging.getLogger()
    root.setLevel(level.upper())
    # Replace any pre-existing handler's formatter rather than adding a
    # second handler, which would double every line under uvicorn.
    if root.handlers:
        for handler in root.handlers:
            handler.setFormatter(formatter)
    else:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(formatter)
        root.addHandler(handler)

    metrics = logging.getLogger("metrics")
    metrics.setLevel(logging.INFO)
    metrics.propagate = False  # keep the two streams genuinely separate
    if not metrics.handlers:
        metrics_handler = logging.StreamHandler(sys.stdout)
        metrics_handler.setFormatter(formatter)
        metrics_handler.addFilter(NoFreeTextFilter())
        metrics.addHandler(metrics_handler)


class _SafeExtraLogger(logging.Logger):
    """Renames `extra=` keys that collide with reserved LogRecord fields.

    Python's logging raises KeyError("Attempt to overwrite 'message' in
    LogRecord") if `extra` contains a reserved name — and because that is
    raised from inside the logging call, it propagates into whatever was
    being logged. A telemetry call bringing down a request it was only
    observing is the wrong failure mode, especially on the error path
    where logging is most needed.

    Found the hard way: `extra={"message": ...}` in the query handler
    turned every /api/query into a 500. Renaming rather than dropping keeps
    the data visible under a `x_`-prefixed key.
    """

    _RESERVED_EXTRA = frozenset(
        vars(logging.LogRecord("", 0, "", 0, "", (), None)).keys()
    ) | {"message", "asctime", "taskName"}

    def makeRecord(self, name, level, fn, lno, msg, args, exc_info,
                   func=None, extra=None, sinfo=None):
        if extra:
            extra = {
                (f"x_{k}" if k in self._RESERVED_EXTRA else k): v
                for k, v in extra.items()
            }
        return super().makeRecord(name, level, fn, lno, msg, args, exc_info,
                                  func, extra, sinfo)


# Must be set before the loggers below are created.
logging.setLoggerClass(_SafeExtraLogger)

app_logger = logging.getLogger("app")
metrics_logger = logging.getLogger("metrics")
