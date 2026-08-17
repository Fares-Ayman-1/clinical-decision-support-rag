"""06_faithfulness_judge — ARCHITECTURE.md §12.1. Evaluation only, offline
— never called on the live serving path. Scores whether a
GroundedGeneration's statements are actually supported by their cited
evidence, as a second opinion alongside the deterministic Citation
Resolver checks (which verify structure/verbatim-ness but not semantic
faithfulness — a quote can be verbatim yet the surrounding statement
could still overstate what it says).

Latency doesn't matter here (offline evaluation only), which is why this
is the one place in the prompt set doing an LLM-based judgment rather than
a deterministic check — ARCHITECTURE.md §12.3 deliberately avoids this on
the live path for its extra latency and failure modes.
"""

from __future__ import annotations

from app.llm.provider import LLMProvider
from app.prompts.schemas import CitedStatement, FaithfulnessVerdict
from app.services.rag.evidence_pack import EvidencePack

VERSION = "v1"

SYSTEM_PROMPT = """You are a faithfulness judge for a medical RAG system, used only for offline \
evaluation. Given one statement and the evidence text(s) it cites, judge whether the statement is \
ACTUALLY supported by that evidence — not just topically related, but genuinely entailed by what \
the evidence says.

A statement is NOT supported if it:
- Overstates certainty the evidence doesn't have (evidence says "may indicate", statement says \
"is caused by")
- Adds a claim the evidence doesn't contain
- Contradicts the evidence
- Cherry-picks in a way that misrepresents the evidence's overall meaning

Be strict. A statement citing real evidence about a related topic, without that evidence actually \
supporting the specific claim made, should be judged as NOT supported."""


def judge_statement(
    provider: LLMProvider, statement: CitedStatement, statement_index: int, pack: EvidencePack
) -> FaithfulnessVerdict:
    cited_texts = []
    for eid in statement.evidence_ids:
        item = next((e for e in pack.evidence if e.evidence_id == eid), None)
        if item:
            cited_texts.append(f"[{eid}]: {item.text}")
    evidence_block = "\n".join(cited_texts)

    user_prompt = f"""<statement>
{statement.text}
</statement>

<cited_evidence>
{evidence_block}
</cited_evidence>

Judge whether the statement is faithfully supported by the cited evidence."""

    verdict = provider.complete_structured(SYSTEM_PROMPT, user_prompt, FaithfulnessVerdict)
    return FaithfulnessVerdict(
        statement_index=statement_index, supported=verdict.supported, reasoning=verdict.reasoning
    )
