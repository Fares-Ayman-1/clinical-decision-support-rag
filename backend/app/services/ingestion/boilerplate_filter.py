"""Boilerplate section filter — ARCHITECTURE.md §6.2, RAG-1.5.

Excludes TOC, index, reference, acknowledgement, and copyright sections by
heading text match. This directly protects Precision@5 (G1): at 7-document
scale, tables of contents and reference lists are semantically similar to
many queries and would otherwise occupy top-k retrieval slots.

Matching is against a heading's own text, once section detection
(section_detection.py) has identified it as a heading — this module does
not do font-size analysis itself.
"""

from __future__ import annotations

import re

# Case-insensitive exact (after normalization) matches — from the Tier-1
# hand-tuned profiles' exclude_headings lists (config/heading_profiles/
# who_acs_stroke.yaml, who_bec.yaml) plus generic terms that recur across
# WHO/USPSTF document front matter.
_EXACT_BOILERPLATE_HEADINGS = frozenset(
    h.lower()
    for h in [
        "Contents",
        "Table of Contents",
        "Figures",
        "Tables",
        "Boxes",
        "Acknowledgements",
        "Acknowledgments",
        "Financial support",
        "Abbreviations and acronyms",
        "Abbreviations",
        "Executive summary",
        "References",
        "Bibliography",
        "Notes",  # who_bec worksheet marker, config/heading_profiles/who_bec.yaml known_hazards
        "Glossary",
        "Index",
        "Copyright",
        "Disclaimer",
    ]
)

# Deliberately NOT included here: "Introduction" / "INTRODUCTION". who_bec
# uses it as a front-matter running-header marker (boilerplate in that one
# document — already listed in its own config/heading_profiles/who_bec.yaml
# exclude_headings), but a plain "Introduction" heading is legitimate
# chapter-1 content elsewhere (found on who_acs_stroke page 7 during Phase 4
# verification — an earlier version of this shared list wrongly excluded it
# everywhere). Document-specific exclusions belong in that document's own
# profile YAML, not in this shared, document-agnostic list.

# Pattern matches for headings that vary by number/context but are
# structurally always boilerplate (e.g. "Annex 3", "Appendix B").
_PATTERN_BOILERPLATE_HEADINGS = [
    re.compile(r"^annex\s+\w+", re.IGNORECASE),
    re.compile(r"^appendix\s+\w+", re.IGNORECASE),
    # who_bec has a per-module "TABLE OF CONTENTS: SKILLS" appendix TOC that
    # the exact-match "Table of Contents" entry above missed (found during
    # Phase 4 verification — a dotted-line-entry TOC page for a skills
    # appendix, not the document's main table of contents). Prefix match
    # catches this and any similar "Table of Contents: X" variant.
    re.compile(r"^table of contents\s*:", re.IGNORECASE),
]


def is_boilerplate_heading(heading_text: str) -> bool:
    norm = " ".join(heading_text.split()).strip().lower()
    if not norm:
        return False
    if norm in _EXACT_BOILERPLATE_HEADINGS:
        return True
    return any(p.match(norm) for p in _PATTERN_BOILERPLATE_HEADINGS)


def is_worksheet_artifact_line(text: str) -> bool:
    """Dotted/dashed decorative rule lines carrying no semantic content.

    who_bec hazard (config/heading_profiles/who_bec.yaml
    known_hazards.worksheet_dotted_lines): dotted-line fill-in worksheet
    placeholders — "line consists of >80% '.' characters".

    who_aware hazard, found during Phase 4 verification: a horizontal-rule
    separator rendered as a run of literal dash characters (e.g.
    "-----------------------------------", 270 occurrences) — same class of
    problem, decorative punctuation with zero retrievable content, so
    checked with the same >80%-of-one-character threshold generalized to
    both punctuation marks rather than adding a second near-duplicate rule.
    """
    stripped = text.strip()
    if not stripped or len(stripped) < 5:
        return False
    dot_count = stripped.count(".")
    dash_count = stripped.count("-")
    return dot_count / len(stripped) > 0.8 or dash_count / len(stripped) > 0.8
