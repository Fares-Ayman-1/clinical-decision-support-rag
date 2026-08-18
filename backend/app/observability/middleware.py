"""Request-scoped middleware — SPEC.md NFR-3.3, NFR-7.1, NFR-7.2, FR-7.6.

RequestContextMiddleware assigns a request_id, binds it for logging, and
emits one app line plus one metrics line per request.

RateLimitMiddleware implements NFR-3.3 (rate limiting on /api/query).
Hand-rolled rather than adding slowapi: requirements.txt is deliberately
pinned and this is a fixed-window counter in ~40 lines, in keeping with
decision A13 (explicit code over frameworks for the mechanics being
judged). Its limitations are stated in the class docstring rather than
left for someone to discover.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.observability.logging import (
    app_logger,
    metrics_logger,
    new_request_id,
    reset_request_id,
    set_request_id,
)


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Binds a request_id for the life of the request and records timing.

    The id is echoed as `X-Request-ID` so a user reporting a problem can
    quote it, and an operator can grep one identifier across both log
    streams. An inbound X-Request-ID is honoured so a front proxy or the
    frontend can correlate too.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("X-Request-ID") or new_request_id()
        token = set_request_id(request_id)
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers["X-Request-ID"] = request_id
            return response
        finally:
            duration_ms = (time.perf_counter() - started) * 1000
            # Path only — never the query string or body, which can carry
            # patient text (NFR-4.1/4.2).
            app_logger.info(
                "request completed",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status": status,
                    "duration_ms": round(duration_ms, 1),
                },
            )
            # SAF-10.3: scalars only on this stream.
            metrics_logger.info(
                "http_request",
                extra={
                    "request_id": request_id,
                    "path": request.url.path,
                    "status": status,
                    "duration_ms": round(duration_ms, 1),
                },
            )
            reset_request_id(token)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window rate limit on the configured paths — NFR-3.3.

    Deliberate limitations, stated rather than hidden:

    - **In-process.** Counters live in this worker's memory, so N workers
      permit N × the limit. NFR-6.2 accepts a single-process backend for
      the MVP; a multi-worker deployment needs a shared store (Redis),
      which is tracked in TODO-PRODUCTION.md rather than pretended away.
    - **Keyed on client IP**, taken from X-Forwarded-For's first hop when
      present. Behind a proxy that does not set it, all clients collapse
      to one key. There is no auth in the MVP (SPEC.md PART F), so IP is
      the only key available.
    - **Protects the expensive path only.** /api/query costs 4+ LLM calls;
      /api/health and /api/evidence are cheap reads and are left alone so
      monitoring and the evidence inspector are never throttled.

    Returns the SPEC.md F.6 error shape with `Retry-After`, matching the
    RATE_LIMITED contract the frontend already handles.
    """

    def __init__(self, app, *, limit: int, window_seconds: int, paths: tuple[str, ...]):
        super().__init__(app)
        self._limit = limit
        self._window = window_seconds
        self._paths = paths
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _client_key(self, request: Request) -> str:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    async def dispatch(self, request: Request, call_next) -> Response:
        if not any(request.url.path.startswith(p) for p in self._paths):
            return await call_next(request)

        key = self._client_key(request)
        now = time.monotonic()
        hits = self._hits[key]

        # Sliding window: drop timestamps that fell out of it. Cheaper and
        # fairer than a fixed window, which lets 2x the limit through at a
        # boundary.
        cutoff = now - self._window
        while hits and hits[0] < cutoff:
            hits.popleft()

        if len(hits) >= self._limit:
            retry_after = max(1, int(hits[0] + self._window - now) + 1)
            app_logger.warning(
                "rate limit exceeded",
                extra={"path": request.url.path, "limit": self._limit,
                       "window_seconds": self._window, "retry_after": retry_after},
            )
            metrics_logger.info(
                "rate_limited",
                extra={"path": request.url.path, "retry_after": retry_after},
            )
            return JSONResponse(
                status_code=429,
                headers={"Retry-After": str(retry_after)},
                content={"error": {
                    "code": "RATE_LIMITED",
                    "message": (
                        f"Too many requests. This endpoint allows {self._limit} requests "
                        f"per {self._window} seconds. Please retry shortly."
                    ),
                    "request_id": request.headers.get("X-Request-ID", ""),
                }},
            )

        hits.append(now)
        # Bound memory: without this, one key per distinct client IP
        # accumulates forever on a long-running process.
        if len(self._hits) > 10_000:
            for stale_key in [k for k, v in self._hits.items() if not v or v[-1] < cutoff]:
                del self._hits[stale_key]

        return await call_next(request)
