"""05_followup_generator — ARCHITECTURE.md §12.1. Missing info -> one
targeted follow-up question.

Used when PatientState.missing_information (from 01_symptom_extractor)
suggests triage-relevant detail is missing, typically alongside a PARTIAL
sufficiency state — the system asks one clarifying question rather than
guessing or over-hedging.
"""

from __future__ import annotations

from app.llm.provider import LLMProvider
from app.prompts.schemas import FollowupQuestion, PatientState

VERSION = "v1"

SYSTEM_PROMPT = """You generate exactly ONE follow-up question to ask a patient, based on what \
clinically relevant information is missing from their symptom description.

Rules:
- Ask about only the SINGLE most triage-relevant missing detail — not everything that's missing.
- Phrase the question in plain, patient-friendly language, not clinical jargon.
- Do not diagnose or suggest what the answer might reveal.
- The question must be answerable by a patient without medical training (e.g. "does the pain \
spread to your arm or jaw?" not "is there radiation of pain consistent with cardiac etiology?")."""


def generate_followup(provider: LLMProvider, patient_state: PatientState) -> FollowupQuestion:
    state_summary = patient_state.model_dump_json()
    user_prompt = f"""<patient_state>
{state_summary}
</patient_state>

Missing information: {', '.join(patient_state.missing_information) or 'none listed'}

Generate the single most useful follow-up question."""

    return provider.complete_structured(SYSTEM_PROMPT, user_prompt, FollowupQuestion)
