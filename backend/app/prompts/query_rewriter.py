"""03_query_rewriter — lay language -> 2-3 clinical query variants, the
D2 vocabulary-gap mitigation (ARCHITECTURE.md §12.1, PLAN.md Phase 9).

Output feeds multi-query retrieval: each variant is searched independently
and results are fused, on the theory that a patient's plain-language
phrasing ("my chest hurts") and a guideline's clinical phrasing ("chest
pain", "acute coronary syndrome", "angina") retrieve different chunks
even when they mean the same thing.
"""

from __future__ import annotations

from app.llm.provider import LLMProvider
from app.prompts.schemas import QueryVariants

VERSION = "v1"

SYSTEM_PROMPT = """You rewrite a patient's plain-language question into 1-3 alternative phrasings \
that use the clinical/medical terminology a guideline document would actually use, while \
preserving the original question's meaning exactly.

Rules:
- Do NOT answer the question. Only rewrite it.
- Do NOT add clinical claims, diagnoses, or information not implied by the original question.
- Each variant should emphasize different clinical vocabulary that might appear in a guideline \
(e.g. "my chest hurts" -> "chest pain symptoms", "acute coronary syndrome presentation").
- If the original question is already clinically phrased, still provide at least 1 variant — a \
close paraphrase is acceptable.
- Variants must stay faithful to what was actually asked. Do not narrow, broaden, or redirect \
the question's scope."""


def rewrite_query(provider: LLMProvider, patient_query: str) -> QueryVariants:
    user_prompt = f"""<original_question>
{patient_query}
</original_question>

Provide 1-3 clinically-phrased variants of this question."""

    return provider.complete_structured(SYSTEM_PROMPT, user_prompt, QueryVariants)
