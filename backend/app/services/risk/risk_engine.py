"""Risk Engine — decision D3/A9, SPEC.md SAF-6.2/8.2/8.4.

Rule-based, not learned: no labeled triage dataset exists for this corpus,
and a rule table is explainable and testable in a way a fitted model would
not be (decision A9). Every level assignment carries the list of reasons
that produced it, so the UI can show *why* rather than asserting a level.

The engine's contract with the safety layer:

  assessed_urgency = rules over extracted features
  final_urgency    = apply_floor(assessed_urgency, red_flag_floor)

It may escalate above a red-flag floor. It can never fall below one
(SAF-6.2) — and it does not implement that clamp itself; it delegates to
red_flags.apply_floor so the invariant has exactly one implementation.

Confidence is a derived formula, never an LLM-guessed decimal (A17): a
model asserting "0.87 confidence" in a medical UI is false precision.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.services.safety.red_flags import RedFlagResult, Urgency, apply_floor

# Feature keywords → urgency contribution. Deliberately coarse: this is a
# triage floor-setter, not a diagnostic system, and over-fitting these
# words to look clever would create confident wrong answers.
_SEVERITY_TERMS = (
    "severe", "worst", "unbearable", "excruciating", "extreme",
    "sudden", "suddenly", "rapidly", "getting worse", "worsening",
)
_DURATION_ACUTE_TERMS = (
    "minutes ago", "just started", "right now", "an hour ago", "this morning",
    "today", "sudden",
)
_VULNERABLE_TERMS = (
    "pregnant", "pregnancy", "elderly", "my child", "my baby", "infant",
    "newborn", "toddler", "diabetic", "immunocompromised", "chemotherapy",
)


@dataclass(frozen=True)
class RiskFactor:
    """One reason contributing to the assessment — surfaced to the UI so a
    level is explained rather than asserted."""

    code: str
    description: str
    contributed: str  # which urgency this factor argued for


@dataclass(frozen=True)
class RiskAssessment:
    urgency: Urgency
    assessed_urgency: Urgency  # before the red-flag floor
    floor_applied: bool
    factors: tuple[RiskFactor, ...]
    confidence: float
    confidence_basis: str
    policy_version: str = "risk-v1"

    @property
    def reasons(self) -> tuple[str, ...]:
        return tuple(f.description for f in self.factors)


@dataclass
class _Accumulator:
    factors: list[RiskFactor] = field(default_factory=list)
    level: Urgency = Urgency.LOW

    def add(self, code: str, description: str, urgency: Urgency) -> None:
        self.factors.append(RiskFactor(code=code, description=description, contributed=urgency.value))
        if urgency.rank > self.level.rank:
            self.level = urgency


def assess_risk(
    patient_text: str,
    red_flags: RedFlagResult,
    sufficiency_state: str,
    support_count: int,
    predicted_domains: tuple[str, ...] = (),
) -> RiskAssessment:
    """Assess urgency from extracted features, then apply the red-flag floor.

    `sufficiency_state` and `support_count` participate because evidence
    quality changes what the system may claim, not just how confident it
    is — SAF-8.4 specifically requires that weak support with LOW risk
    produce a follow-up rather than reassurance.
    """
    text = patient_text.lower()
    acc = _Accumulator()

    for term in _SEVERITY_TERMS:
        if term in text:
            acc.add("SEVERITY_LANGUAGE", f"Described with severity language ({term!r})", Urgency.HIGH)
            break

    for term in _DURATION_ACUTE_TERMS:
        if term in text:
            acc.add("ACUTE_ONSET", f"Acute or very recent onset ({term!r})", Urgency.MODERATE)
            break

    for term in _VULNERABLE_TERMS:
        if term in text:
            acc.add("VULNERABLE_GROUP", f"Higher-risk group mentioned ({term!r})", Urgency.MODERATE)
            break

    emergency_domains = {"emergency", "acs", "stroke", "acute-care"}
    if emergency_domains & set(predicted_domains):
        matched = sorted(emergency_domains & set(predicted_domains))
        acc.add("EMERGENCY_DOMAIN", f"Query matched emergency domain(s): {', '.join(matched)}", Urgency.MODERATE)

    # Red flags are recorded as factors so the UI can explain the floor,
    # even though the floor itself is applied below rather than here.
    for match in red_flags.matches:
        acc.factors.append(
            RiskFactor(
                code=f"RED_FLAG:{match.rule_id}",
                description=f"Red flag — {match.label}",
                contributed=match.urgency_floor.value,
            )
        )

    if not acc.factors:
        acc.add("NO_ESCALATING_FEATURES", "No urgent warning signs identified in the description", Urgency.LOW)

    assessed = acc.level
    final = apply_floor(assessed, red_flags.urgency_floor)

    confidence, basis = _derive_confidence(
        sufficiency_state=sufficiency_state,
        support_count=support_count,
        red_flag_triggered=red_flags.triggered,
        factor_count=len([f for f in acc.factors if not f.code.startswith("RED_FLAG")]),
    )

    return RiskAssessment(
        urgency=final,
        assessed_urgency=assessed,
        floor_applied=final != assessed,
        factors=tuple(acc.factors),
        confidence=confidence,
        confidence_basis=basis,
    )


def _derive_confidence(
    sufficiency_state: str, support_count: int, red_flag_triggered: bool, factor_count: int
) -> tuple[float, str]:
    """A17: confidence is DERIVED from observable quantities, never guessed
    by a model. The formula is deliberately simple and its inputs are
    named in `confidence_basis` so the number is auditable rather than
    mysterious."""
    base = {
        "SUFFICIENT": 0.80,
        "PARTIAL": 0.55,
        "INSUFFICIENT": 0.25,
        "OUT_OF_SCOPE": 0.15,
    }.get(sufficiency_state, 0.30)

    support_bonus = min(support_count, 5) * 0.02
    # A red-flag match is a deterministic rule hit, not an inference, so it
    # genuinely increases confidence in the URGENCY (not in the diagnosis).
    flag_bonus = 0.10 if red_flag_triggered else 0.0

    value = min(0.95, base + support_bonus + flag_bonus)
    basis = (
        f"sufficiency={sufficiency_state} (base {base:.2f}), "
        f"support={support_count} (+{support_bonus:.2f}), "
        f"red_flag={'yes' if red_flag_triggered else 'no'} (+{flag_bonus:.2f}), "
        f"other_factors={factor_count}"
    )
    return round(value, 2), basis
