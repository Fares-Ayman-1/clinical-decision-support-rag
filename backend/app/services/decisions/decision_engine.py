"""Decision Engine — decision D3, SPEC.md SAF-6.3/6.4/6.6/6.7, SAF-8.2/8.3/8.4.

Emits BOOLEAN ACTION FLAGS ONLY. It decides what the UI should offer; it
never performs anything. SAF-6.6 forbids the system placing a call or
sending a message autonomously, and SAF-6.7 requires explicit user
confirmation for every external action — a flag-only output makes an
autonomous side effect structurally impossible rather than merely
prohibited by policy (the same design reasoning as the generator emitting
evidence_ids instead of citations).

Encoded requirements:
  SAF-6.3  CRITICAL leads with the emergency instruction.
  SAF-6.4  Wellness content is suppressed on HIGH and CRITICAL.
  SAF-8.2  LOW risk uses fixed copy, never generated.
  SAF-8.3  LOW risk is never rendered as "you are healthy".
  SAF-8.4  Weak support + LOW risk produces a follow-up, not reassurance.
"""

from __future__ import annotations

import functools
import pathlib
from dataclasses import dataclass

import yaml

from app.services.safety.red_flags import Urgency

CONFIG_PATH = pathlib.Path(__file__).resolve().parents[4] / "config" / "emergency.yaml"

# SAF-8.2 — fixed copy. Deliberately a module constant, not a prompt
# output: "no urgent warning signs were identified" is a statement about
# what the system checked, and a generated paraphrase could easily drift
# into "you're fine", which SAF-8.3 forbids.
LOW_RISK_FIXED_COPY = (
    "No urgent warning signs were identified from the information and evidence "
    "currently available."
)

# Language-keyed fixed copy — still module constants, never prompt output
# (the SAF-8.2 rationale above applies per language: each Arabic string is
# a reviewed translation of the fixed English, not a paraphrase).
LOW_RISK_FIXED_COPY_BY_LANG = {
    "en": LOW_RISK_FIXED_COPY,
    "fr": (
        "Aucun signe d'alerte urgent n'a été identifié à partir des informations "
        "et des preuves actuellement disponibles."
    ),
    "ar": (
        "لم يتم رصد علامات إنذار عاجلة من المعلومات والأدلة المتاحة حاليًا."
    ),
}


@dataclass(frozen=True)
class EmergencyGuidance:
    lead_text: str
    locale_label: str
    number: str | None
    instruction: str


@dataclass(frozen=True)
class DecisionActions:
    """Every field is a boolean or display text. Nothing here can execute."""

    show_emergency_banner: bool
    lead_with_emergency: bool
    recommend_emergency_care: bool
    recommend_urgent_care: bool
    recommend_routine_care: bool
    recommend_self_care: bool
    suppress_wellness_content: bool
    require_user_confirmation_for_external_actions: bool
    show_followup_question: bool
    fixed_low_risk_copy: str | None
    emergency: EmergencyGuidance | None
    policy_version: str = "decision-v1"


@functools.lru_cache(maxsize=1)
def _load_emergency_config(config_path: str | None = None) -> dict:
    path = pathlib.Path(config_path) if config_path else CONFIG_PATH
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _emergency_guidance(
    urgency: Urgency, config_path: str | None = None, lang: str = "en"
) -> EmergencyGuidance | None:
    """SAF-6.5 — emergency contact details come from configuration, never
    from the LLM and never from retrieved document text. Non-English
    display text comes from `<key>_ar`-style siblings in the same config,
    falling back to English when a translation is absent — a missing
    translation must never suppress an emergency instruction."""
    if urgency.rank < Urgency.HIGH.rank:
        return None

    def localized(mapping: dict, key: str) -> str:
        if lang != "en":
            value = mapping.get(f"{key}_{lang}")
            if value:
                return value.strip()
        return mapping[key].strip()

    cfg = _load_emergency_config(config_path)
    locale = cfg["locales"][cfg.get("default_locale", "generic")]
    lead_key = "critical_lead" if urgency == Urgency.CRITICAL else "high_lead"
    return EmergencyGuidance(
        lead_text=localized(cfg, lead_key),
        locale_label=localized(locale, "label"),
        number=locale.get("number"),
        instruction=localized(locale, "instruction"),
    )


def decide_actions(
    urgency: Urgency,
    sufficiency_state: str,
    support_count: int,
    is_refusal: bool = False,
    config_path: str | None = None,
    lang: str = "en",
) -> DecisionActions:
    critical = urgency == Urgency.CRITICAL
    high_or_above = urgency.rank >= Urgency.HIGH.rank

    # SAF-8.4: weak support with LOW risk must produce a follow-up rather
    # than reassurance. Thin evidence means the system does not actually
    # know enough to reassure, and reassurance is the failure mode with
    # the worst consequence at LOW risk.
    weak_support = sufficiency_state in ("PARTIAL", "INSUFFICIENT") or support_count < 2
    low_risk = urgency == Urgency.LOW

    return DecisionActions(
        show_emergency_banner=high_or_above,
        lead_with_emergency=critical,  # SAF-6.3
        recommend_emergency_care=critical,
        recommend_urgent_care=urgency == Urgency.HIGH,
        recommend_routine_care=urgency == Urgency.MODERATE,
        # A refusal must not also tell the user to self-care — the system
        # does not know enough to recommend anything at that point.
        recommend_self_care=low_risk and not weak_support and not is_refusal,
        suppress_wellness_content=high_or_above,  # SAF-6.4
        require_user_confirmation_for_external_actions=True,  # SAF-6.7, always
        show_followup_question=(low_risk and weak_support) or is_refusal,  # SAF-8.4
        fixed_low_risk_copy=(
            LOW_RISK_FIXED_COPY_BY_LANG.get(lang, LOW_RISK_FIXED_COPY) if low_risk else None
        ),  # SAF-8.2
        emergency=_emergency_guidance(urgency, config_path, lang=lang),
    )
