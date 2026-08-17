"""Tests for backend/app/llm/provider.py's structured-output parsing and
retry logic — the part every Phase 10 prompt depends on for schema
validity, tested without any real API call (no network / no API key
needed here, since only _parse_structured and the provider-selection
logic are pure/mockable).
"""

from __future__ import annotations

import json

import pytest
from pydantic import BaseModel

from app.llm.provider import (
    CompletionResult,
    SchemaViolationError,
    _parse_structured,
    _schema_instruction,
    load_llm_provider,
)


class Answer(BaseModel):
    label: str
    confidence: float


def test_parse_structured_plain_json():
    result = _parse_structured('{"label": "cardiovascular", "confidence": 0.9}', Answer)
    assert result.label == "cardiovascular"
    assert result.confidence == 0.9


def test_parse_structured_strips_markdown_fence():
    text = '```json\n{"label": "respiratory", "confidence": 0.8}\n```'
    result = _parse_structured(text, Answer)
    assert result.label == "respiratory"


def test_parse_structured_strips_bare_fence_no_language_tag():
    text = '```\n{"label": "emergency", "confidence": 0.7}\n```'
    result = _parse_structured(text, Answer)
    assert result.label == "emergency"


def test_parse_structured_invalid_json_raises():
    with pytest.raises(json.JSONDecodeError):
        _parse_structured("not json at all", Answer)


def test_parse_structured_schema_mismatch_raises_validation_error():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        _parse_structured('{"label": "x"}', Answer)  # missing required "confidence"


def test_schema_instruction_embeds_json_schema():
    instruction = _schema_instruction(Answer)
    assert "label" in instruction
    assert "confidence" in instruction
    assert "JSON object" in instruction


class _FakeProvider:
    """Minimal stand-in exercising the same complete_structured retry
    logic pattern used by the real providers, to verify the retry
    contract without a real API call."""

    def __init__(self, responses: list[str]):
        self._responses = responses
        self._call_count = 0

    def complete(self, system, user, temperature=0.1):
        text = self._responses[self._call_count]
        self._call_count += 1
        return CompletionResult(text=text, model="fake-model")

    def complete_structured(self, system, user, schema, temperature=0.1, max_retries=1):
        prompt = user + _schema_instruction(schema)
        last_error = None
        for _ in range(max_retries + 1):
            result = self.complete(system, prompt, temperature)
            try:
                return _parse_structured(result.text, schema)
            except Exception as e:  # noqa: BLE001
                last_error = e
        raise SchemaViolationError(f"failed: {last_error}")


def test_complete_structured_succeeds_first_try():
    provider = _FakeProvider(['{"label": "a", "confidence": 0.5}'])
    result = provider.complete_structured("sys", "user", Answer)
    assert result.label == "a"
    assert provider._call_count == 1


def test_complete_structured_retries_once_then_succeeds():
    provider = _FakeProvider(["not valid json", '{"label": "b", "confidence": 0.6}'])
    result = provider.complete_structured("sys", "user", Answer, max_retries=1)
    assert result.label == "b"
    assert provider._call_count == 2


def test_complete_structured_raises_after_exhausting_retries():
    provider = _FakeProvider(["still not json", "still not json either"])
    with pytest.raises(SchemaViolationError):
        provider.complete_structured("sys", "user", Answer, max_retries=1)
    assert provider._call_count == 2


def test_load_llm_provider_missing_env_raises(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="LLM_PROVIDER"):
        load_llm_provider()


def test_load_llm_provider_unknown_provider_raises(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "not-a-real-provider")
    monkeypatch.setenv("LLM_MODEL", "some-model")
    monkeypatch.setenv("LLM_API_KEY", "fake-key")
    with pytest.raises(ValueError, match="Unknown LLM_PROVIDER"):
        load_llm_provider()


def test_load_llm_provider_selects_openai(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_MODEL", "gpt-4o-mini")
    monkeypatch.setenv("LLM_API_KEY", "fake-key-not-a-real-call")
    provider = load_llm_provider()
    from app.llm.provider import OpenAIProvider

    assert isinstance(provider, OpenAIProvider)


def test_load_llm_provider_rejects_removed_openrouter(monkeypatch):
    """OpenRouter was removed as a provider. An .env still naming it must
    fail loudly at startup rather than silently falling through to some
    other provider or a confusing downstream error."""
    monkeypatch.setenv("LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("LLM_MODEL", "openai/gpt-oss-20b:free")
    monkeypatch.setenv("LLM_API_KEY", "sk-or-v1-whatever")
    with pytest.raises(ValueError, match="Unknown LLM_PROVIDER"):
        load_llm_provider()


def test_load_llm_provider_selects_ollama_without_api_key(monkeypatch):
    """Ollama is the one provider with no required credential — a local
    daemon needs none. Requiring LLM_API_KEY would reject a correct
    config."""
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("LLM_MODEL", "qwen3:8b")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OLLAMA_API_KEY", raising=False)
    monkeypatch.delenv("OLLAMA_BASE_URL", raising=False)
    from app.llm.provider import OllamaProvider

    provider = load_llm_provider()
    assert isinstance(provider, OllamaProvider)
    assert "localhost:11434" in str(provider._client.base_url)


def test_ollama_key_takes_precedence_over_stale_generic_key(monkeypatch):
    """Regression: switching LLM_PROVIDER to ollama while a previous
    provider's LLM_API_KEY is still in .env must not send that stale key
    upstream. Doing so produced a bare 401 that reads as an invalid Ollama
    key rather than the wrong key entirely."""
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("LLM_MODEL", "gpt-oss:120b")
    monkeypatch.setenv("LLM_API_KEY", "sk-or-v1-stale-openrouter-key")
    monkeypatch.setenv("OLLAMA_API_KEY", "real-ollama-key")
    monkeypatch.delenv("OLLAMA_BASE_URL", raising=False)

    provider = load_llm_provider()
    assert provider._client.api_key == "real-ollama-key"
    # A real key also means we address ollama.com directly rather than
    # routing through a local daemon that may never have been signed in.
    assert "ollama.com" in str(provider._client.base_url)


def test_ollama_strips_cloud_suffix_for_direct_api(monkeypatch):
    """Regression: ":cloud" exists only in the local daemon's namespace.
    ollama.com names the same model without it and answers a suffixed id
    with a bare 401 that looks like an auth failure."""
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("LLM_MODEL", "kimi-k3:cloud")
    monkeypatch.setenv("OLLAMA_API_KEY", "real-ollama-key")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OLLAMA_BASE_URL", raising=False)

    provider = load_llm_provider()
    assert provider._model == "kimi-k3"

    # The suffix is meaningful to a local daemon, so it must survive there.
    monkeypatch.delenv("OLLAMA_API_KEY")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
    assert load_llm_provider()._model == "kimi-k3:cloud"
