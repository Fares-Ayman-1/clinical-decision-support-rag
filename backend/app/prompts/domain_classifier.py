"""02_domain_classifier — ARCHITECTURE.md §9.2 / §12.1. Patient state ->
domain labels. Output feeds hybrid_search's predicted_domains directly
(backend/app/services/retrieval/hybrid_search.py) — this is the piece
that domain boosting has been waiting for since Phase 8.

Multi-domain prediction is expected: "chest pain and difficulty breathing"
should predict both cardiovascular and respiratory (and likely emergency)
simultaneously, per ARCHITECTURE.md §9.2.
"""

from __future__ import annotations

from app.llm.provider import LLMProvider
from app.prompts.schemas import DOMAIN_LABELS, DomainClassification, PatientState

VERSION = "v1"

SYSTEM_PROMPT = f"""You classify a patient's extracted symptom state into zero or more clinical \
domains, from this fixed list ONLY: {', '.join(DOMAIN_LABELS)}.

Rules:
- Return every domain that plausibly applies. A patient with chest pain AND trouble breathing \
should get BOTH cardiovascular and respiratory (and likely emergency), not just one.
- Do NOT invent a domain not in the list above.
- Return an empty list if nothing in the list plausibly applies (e.g. a question about an \
unrelated topic like insurance paperwork or a request unrelated to any listed clinical area) — \
this is a normal, correct outcome, not a failure.
- This classification only affects which reference material is prioritized for retrieval. It \
does not diagnose and is never shown to the patient directly."""


def classify_domains(provider: LLMProvider, patient_state: PatientState) -> DomainClassification:
    state_summary = patient_state.model_dump_json()
    user_prompt = f"""<patient_state>
{state_summary}
</patient_state>

Classify the domains that apply to this patient state."""

    return provider.complete_structured(SYSTEM_PROMPT, user_prompt, DomainClassification)
