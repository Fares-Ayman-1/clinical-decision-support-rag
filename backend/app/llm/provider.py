"""LLMProvider interface — ARCHITECTURE.md G9 (replaceability), PLAN.md Phase 11.

Every prompt-calling site in this codebase depends on this interface, never
on a specific vendor SDK directly, so swapping providers (e.g. a free
Ollama model during MVP development -> Claude for production) is a config
change (.env: LLM_PROVIDER/LLM_MODEL/LLM_API_KEY), not a code change.
Three concrete implementations share one contract:

- AnthropicProvider — native Anthropic SDK.
- OpenAIProvider — native OpenAI SDK, real OpenAI models.
- OllamaProvider — OpenAI SDK pointed at an Ollama server's /v1 endpoint.
  Covers local models (http://localhost:11434, no credential), Ollama
  Cloud by API key (direct to ollama.com), and Ollama Cloud proxied by a
  signed-in local daemon. This is why OllamaProvider is the one provider
  where LLM_API_KEY is optional — see load_llm_provider().

An `openrouter` provider existed during early MVP development and was
removed 2026-08-17. load_llm_provider() raises on it rather than silently
accepting a dead config; a regression test pins that.

complete_structured() enforces schema validity itself (Pydantic model_validate,
one retry on failure per PLAN.md Phase 11) so callers never see malformed
JSON — a provider either returns a validated instance or raises after the
retry budget is spent, and the caller decides what "no valid output"
means for its own prompt (e.g. the grounded generator refusing rather
than fabricating).

Dev-environment note: this module injects truststore's OS-native TLS
validation at import time. Found necessary in the dev sandbox — local
antivirus HTTPS scanning re-signs outbound traffic with a root cert that
Windows trusts but that fails strict OpenSSL/certifi validation (a
malformed-but-Windows-tolerated cert: X.509 Basic Constraints not marked
critical). truststore validates against the OS trust store instead of the
bundled certifi list — still real certificate validation, not a
verify=False bypass. Harmless on a clean production host (it will simply
use the OS's normal trust store there too).
"""

from __future__ import annotations

import json
import logging
import os
import random
import time
from dataclasses import dataclass
from typing import Callable, Protocol, TypeVar

try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)
R = TypeVar("R")

logger = logging.getLogger(__name__)


class SchemaViolationError(Exception):
    """Raised when a provider's structured output fails Pydantic
    validation after exhausting the retry budget. Callers (prompts) decide
    what this means for their own flow — e.g. the grounded generator
    treats it as INSUFFICIENT rather than fabricating a response."""


class TransientProviderError(Exception):
    """A provider call that failed for reasons unrelated to the prompt —
    connection reset, timeout, rate limit, upstream 5xx — after the retry
    budget was spent.

    Deliberately distinct from SchemaViolationError, which means the model
    answered but the answer was malformed. Callers that degrade gracefully
    on a bad schema (e.g. the query rewriter falling back to the original
    query) must NOT silently swallow this one: it means the run is
    incomplete, not that the model declined. An evaluation harness that
    cannot tell those apart reports metrics over a denominator it did not
    actually measure.
    """


# Application-level retry sits ON TOP of the SDK's own retries, which are
# real but far too fast to help here. openai 1.99.9 uses
# INITIAL_RETRY_DELAY=0.5 / MAX_RETRY_DELAY=8.0 with max_retries=2, so its
# entire budget is spent inside ~2 seconds. Ollama Cloud's free tier burst
# limiter holds far longer than that: an eval run over 25 queries saw the
# SDK exhaust its retries and raise APIConnectionError on 19 consecutive
# queries, while the same endpoint answered normally when retried by hand a
# minute later. These delays are sized to outlast a cooldown of that scale.
_RETRY_BASE_DELAY = 2.0
_RETRY_MAX_DELAY = 60.0
_DEFAULT_MAX_ATTEMPTS = 5


def _retry_delay(attempt: int) -> float:
    """Exponential backoff with full jitter.

    Jitter is not cosmetic here: the orchestrator issues its query-rewrite
    call concurrently with symptom extraction, so two threads throttled by
    the same burst limit would otherwise retry in lockstep and re-trigger
    it immediately.
    """
    delay = min(_RETRY_BASE_DELAY * (2.0**attempt), _RETRY_MAX_DELAY)
    return delay * (0.5 + 0.5 * random.random())


def _call_with_retry(
    fn: Callable[[], R],
    *,
    retryable: tuple[type[BaseException], ...],
    fatal: tuple[type[BaseException], ...],
    max_attempts: int,
    description: str,
) -> R:
    """Retries `fn` on transient transport failures only.

    `fatal` is checked BEFORE `retryable`, and that ordering is
    load-bearing rather than defensive. In the openai SDK,
    APITimeoutError subclasses APIConnectionError, and
    AuthenticationError/BadRequestError subclass APIStatusError alongside
    RateLimitError — so an except-clause in the wrong order would either
    retry a bad API key five times or refuse to retry a timeout.

    Schema violations are deliberately NOT handled here. They are a
    different failure mode needing a different cure: a schema retry must
    re-prompt with the validation error appended (the model needs telling
    what it got wrong), whereas a connection retry must replay the
    identical request after a delay. Conflating them would either spend
    the schema budget on network errors or send a corrective prompt to a
    server that never saw the original request.
    """
    last_error: BaseException | None = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except fatal:
            raise
        except retryable as e:
            last_error = e
            if attempt == max_attempts - 1:
                break
            delay = _retry_delay(attempt)
            logger.warning(
                "%s failed with %s (attempt %d/%d); retrying in %.1fs",
                description, type(e).__name__, attempt + 1, max_attempts, delay,
            )
            time.sleep(delay)
    raise TransientProviderError(
        f"{description} failed after {max_attempts} attempt(s): "
        f"{type(last_error).__name__}: {last_error}"
    ) from last_error


def _complete_structured_impl(
    complete: Callable[[str, str, float], CompletionResult],
    system: str,
    user: str,
    schema: type[T],
    temperature: float,
    max_retries: int,
) -> T:
    """The schema-retry loop, shared by every provider.

    Connection retry lives one level down, inside each provider's
    complete(), so by the time a result reaches here it is a response the
    server actually produced — every failure this loop sees is genuinely
    the model's fault, and re-prompting is the right cure.
    """
    prompt = user + _schema_instruction(schema)
    last_error: Exception | None = None
    for _ in range(max_retries + 1):
        result = complete(system, prompt, temperature)
        try:
            return _parse_structured(result.text, schema)
        except (json.JSONDecodeError, ValidationError) as e:
            last_error = e
            prompt = (
                user + _schema_instruction(schema)
                + f"\n\nYour previous response failed validation: {e}. Return ONLY valid JSON."
            )
    raise SchemaViolationError(
        f"Schema validation failed after {max_retries + 1} attempt(s): {last_error}"
    )


@dataclass(frozen=True)
class CompletionResult:
    text: str
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None


class LLMProvider(Protocol):
    def complete(self, system: str, user: str, temperature: float = 0.1) -> CompletionResult: ...

    def complete_structured(
        self, system: str, user: str, schema: type[T], temperature: float = 0.1
    ) -> T: ...


def _schema_instruction(schema: type[BaseModel]) -> str:
    return (
        "\n\nRespond with ONLY a single JSON object matching this schema, no other text, "
        "no markdown code fences:\n" + json.dumps(schema.model_json_schema(), indent=2)
    )


def _parse_structured(text: str, schema: type[T]) -> T:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        # Strip a markdown code fence if the model added one despite
        # being told not to — models frequently do this regardless of
        # instruction, so stripping defensively is cheaper than a retry.
        cleaned = cleaned.strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()
    data = json.loads(cleaned)
    return schema.model_validate(data)


class AnthropicProvider:
    def __init__(
        self, model: str, api_key: str, timeout_seconds: float = 30.0,
        max_attempts: int = _DEFAULT_MAX_ATTEMPTS,
    ):
        import anthropic

        self._client = anthropic.Anthropic(api_key=api_key, timeout=timeout_seconds)
        self._model = model
        self._max_attempts = max_attempts
        self._retryable = (
            anthropic.APIConnectionError,  # APITimeoutError subclasses this
            anthropic.RateLimitError,
            anthropic.InternalServerError,
        )
        # Retrying these can never help and only multiplies the damage: a
        # bad key stays bad, a malformed request stays malformed.
        self._fatal = (
            anthropic.AuthenticationError,
            anthropic.BadRequestError,
            anthropic.PermissionDeniedError,
            anthropic.NotFoundError,
        )

    def complete(self, system: str, user: str, temperature: float = 0.1) -> CompletionResult:
        def _once() -> CompletionResult:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=4096,
                temperature=temperature,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            text = "".join(block.text for block in response.content if block.type == "text")
            return CompletionResult(
                text=text, model=self._model,
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
            )

        return _call_with_retry(
            _once, retryable=self._retryable, fatal=self._fatal,
            max_attempts=self._max_attempts, description=f"{self._model} completion",
        )

    def complete_structured(
        self, system: str, user: str, schema: type[T], temperature: float = 0.1, max_retries: int = 1
    ) -> T:
        return _complete_structured_impl(
            self.complete, system, user, schema, temperature, max_retries
        )


class _OpenAICompatibleProvider:
    """Shared implementation for OpenAIProvider and OllamaProvider — both
    talk to an OpenAI-shaped chat completions API, differing only in
    base_url and optional extra headers. Any future OpenAI-compatible
    vendor is a subclass with a base_url, not a new implementation."""

    def __init__(self, model: str, api_key: str, base_url: str | None, timeout_seconds: float = 30.0,
                 extra_headers: dict[str, str] | None = None,
                 max_attempts: int = _DEFAULT_MAX_ATTEMPTS):
        from openai import (
            APIConnectionError,
            AuthenticationError,
            BadRequestError,
            InternalServerError,
            NotFoundError,
            OpenAI,
            PermissionDeniedError,
            RateLimitError,
        )

        self._client = OpenAI(api_key=api_key, base_url=base_url, timeout=timeout_seconds)
        self._model = model
        self._extra_headers = extra_headers or {}
        self._max_attempts = max_attempts
        # APITimeoutError subclasses APIConnectionError, so it is covered
        # without being named. RateLimitError is retryable here even though
        # this endpoint returns no x-ratelimit-*/retry-after headers to
        # guide the delay — which is exactly why the backoff is a fixed
        # schedule rather than header-driven.
        self._retryable = (APIConnectionError, RateLimitError, InternalServerError)
        self._fatal = (
            AuthenticationError, BadRequestError, PermissionDeniedError, NotFoundError,
        )

    def complete(self, system: str, user: str, temperature: float = 0.1) -> CompletionResult:
        def _once() -> CompletionResult:
            response = self._client.chat.completions.create(
                model=self._model,
                temperature=temperature,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                extra_headers=self._extra_headers or None,
            )
            text = response.choices[0].message.content or ""
            usage = response.usage
            return CompletionResult(
                text=text, model=self._model,
                input_tokens=usage.prompt_tokens if usage else None,
                output_tokens=usage.completion_tokens if usage else None,
            )

        return _call_with_retry(
            _once, retryable=self._retryable, fatal=self._fatal,
            max_attempts=self._max_attempts, description=f"{self._model} completion",
        )

    def complete_structured(
        self, system: str, user: str, schema: type[T], temperature: float = 0.1, max_retries: int = 1
    ) -> T:
        return _complete_structured_impl(
            self.complete, system, user, schema, temperature, max_retries
        )


class OpenAIProvider(_OpenAICompatibleProvider):
    def __init__(self, model: str, api_key: str, timeout_seconds: float = 30.0):
        super().__init__(model, api_key, base_url=None, timeout_seconds=timeout_seconds)


class OllamaProvider(_OpenAICompatibleProvider):
    """Ollama's OpenAI-compatible endpoint (base_url swap only).

    Three deployment shapes share this one class, which is the reason it
    needs no Ollama-specific SDK:

    - Local models ("qwen3:8b") run on the machine's own daemon at
      localhost:11434. There is no credential at all — the OpenAI SDK
      still requires a non-empty api_key string, so a placeholder is sent
      and ignored by Ollama.
    - Cloud models via the local daemon (":cloud" tag, e.g.
      "kimi-k3:cloud") are proxied by that daemon to Ollama's hosted
      infrastructure, authenticated by its own `ollama signin` session
      rather than a per-request key.
    - Cloud models via a direct API key talk straight to
      https://ollama.com/v1 with the key as a Bearer token, no local
      daemon involved. Selected automatically when an Ollama key is
      present (OLLAMA_API_KEY or LLM_API_KEY) and no explicit base URL
      overrides it — this is the shape that works on a machine that has
      never run `ollama signin`.

    Timeout defaults to 300s rather than the 30s used for hosted vendors.
    This pipeline issues 4+ sequential structured calls per query; local
    CPU inference and cold cloud starts both routinely exceed 30s per
    call, and a too-short timeout surfaces as an APITimeoutError that
    looks like an outage rather than a slow model.
    """

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        timeout_seconds: float = 300.0,
        base_url: str | None = None,
    ):
        # OLLAMA_API_KEY wins over the generic LLM_API_KEY. The generic var
        # very often still holds a previous provider's key (e.g. an
        # "sk-or-..." OpenRouter key left in .env after switching
        # LLM_PROVIDER), and sending that upstream produces a bare 401
        # that looks like an invalid Ollama key rather than the wrong key
        # entirely. Preferring the provider-specific var makes switching
        # providers safe without having to clear the old value first.
        resolved_key = (
            os.environ.get("OLLAMA_API_KEY", "").strip()
            or (api_key or "").strip()
            or None
        )

        if base_url:
            resolved_base = base_url
        elif env_base := os.environ.get("OLLAMA_BASE_URL", "").strip():
            resolved_base = env_base
        elif resolved_key:
            # A real key means we can reach Ollama's cloud directly and
            # skip the local daemon entirely, which matters on a machine
            # that has never run `ollama signin` (the daemon would answer
            # 401 for a :cloud model despite a perfectly valid key,
            # because the daemon authenticates with its own session and
            # ignores the one passed per-request).
            resolved_base = "https://ollama.com/v1"
        else:
            resolved_base = "http://localhost:11434/v1"

        # The ":cloud" tag exists only in the local daemon's namespace — it
        # marks a model the daemon should proxy upstream rather than run
        # locally. ollama.com's own API names the same model without it
        # ("kimi-k3", not "kimi-k3:cloud"), and rejects the suffixed form
        # with a bare 401 that reads like an auth failure rather than a bad
        # model id. Strip it when talking to the cloud directly so a config
        # copied from `ollama run` docs doesn't fail confusingly.
        if resolved_base.startswith("https://ollama.com") and model.endswith(":cloud"):
            model = model[: -len(":cloud")]

        super().__init__(
            model,
            # The OpenAI SDK rejects an empty api_key before any request is
            # made. A local daemon ignores the value entirely, so a
            # placeholder is the documented way to satisfy the constructor.
            api_key=resolved_key or "ollama",
            base_url=resolved_base,
            timeout_seconds=timeout_seconds,
        )


def load_llm_provider() -> LLMProvider:
    """Reads LLM_PROVIDER/LLM_MODEL/LLM_API_KEY from the environment and
    returns the matching provider. This is the single place a provider is
    chosen — every prompt-calling site calls load_llm_provider() and
    never imports a concrete provider class directly, which is what makes
    the anthropic/openai/ollama swap a config-only change."""
    provider_kind = os.environ.get("LLM_PROVIDER", "").strip().lower()
    model = os.environ.get("LLM_MODEL", "").strip()
    api_key = os.environ.get("LLM_API_KEY", "").strip()

    # Ollama is the one provider that legitimately has no API key: local
    # models need no credential, and cloud models can authenticate through
    # the daemon's own `ollama signin` session rather than a per-request
    # key. Requiring LLM_API_KEY for it would reject a correct config.
    key_required = provider_kind != "ollama"

    if not provider_kind or not model or (key_required and not api_key):
        raise RuntimeError(
            "LLM_PROVIDER and LLM_MODEL must be set in .env, and LLM_API_KEY "
            "must be set for every provider except 'ollama' "
            f"(got provider={provider_kind!r}, model={model!r}, api_key_set={bool(api_key)})."
        )

    if provider_kind == "anthropic":
        return AnthropicProvider(model=model, api_key=api_key)
    if provider_kind == "openai":
        return OpenAIProvider(model=model, api_key=api_key)
    if provider_kind == "ollama":
        return OllamaProvider(model=model, api_key=api_key or None)

    raise ValueError(
        f"Unknown LLM_PROVIDER={provider_kind!r}; expected anthropic, openai, or ollama."
    )
