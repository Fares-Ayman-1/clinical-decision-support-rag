"""Section detection using per-document heading profiles — ARCHITECTURE.md §6.3.

Builds the hierarchical section_path ("Chapter 3 > Acute Coronary Syndrome >
Symptom Recognition") that every downstream chunk carries. Two detection
strategies, matching the two profile_type values written in Phase 2:

- hand_tuned (who_acs_stroke, who_bec): explicit font-size tiers confirmed by
  direct inspection. High confidence.
- generic (the 5 Tier-2 documents): relative-size + bold heuristic against
  the document's own measured body size. Lower confidence by design.

Fallback (ARCHITECTURE.md §6.3): when no heading is detected for a page, the
section path inherits from the last known heading and the page is flagged
section_confidence: "inherited". Retrieval still works; the citation is
honest about its precision.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

from app.services.ingestion.boilerplate_filter import is_boilerplate_heading

_CHAPTER_NUMBER_STRIP_RE = re.compile(r"^\d+\s*\t?\s*")


@dataclass(frozen=True)
class DetectedHeading:
    level: str  # "chapter" | "subsection" | "section" (generic profile)
    text: str
    page_number: int
    y0: float
    is_boilerplate: bool = False


@dataclass(frozen=True)
class SectionAssignment:
    section: str | None
    subsection: str | None
    section_path: str
    confidence: str  # "detected" | "inherited"
    is_boilerplate: bool = False


def compute_body_text_size(pages: list[dict]) -> float:
    """The font size used by the most distinct text LINES (block count, not
    total character count) — the generic profile's basis for relative
    heading detection (generic.yaml).

    Block count, not character count: found necessary after character-count
    weighting picked 7.0pt as who_sari's "body size", skewed by a modest
    number of unusually long dense-text blocks at that size (checklists/
    protocol text) outweighing thousands of normal-length 11pt paragraph
    lines. A wrong-by-4pt body-size baseline made 11pt regular prose and 9pt
    bold running-footer text both look anomalously large, causing the
    generic heading detector to fire on ~8,400 candidates across a 306-page
    document. Block count reflects "what does a typical line look like"
    rather than "which size has the most ink", which is the actual question
    a heading detector needs answered.
    """
    sizes: Counter[float] = Counter()
    for page in pages:
        for block in page["blocks"]:
            if block["block_type"] != "text" or not block.get("font_sizes"):
                continue
            # One vote per LINE (block), using its first span's size — not
            # one vote per span. A first attempt at this fix iterated all
            # spans in a block and still picked 7.0pt for who_sari, because
            # some dense checklist-style blocks are internally split into
            # many small 7pt spans, which inflated the span-level count past
            # the genuinely more common single-span 11pt paragraph lines.
            sizes[block["font_sizes"][0]] += 1
    if not sizes:
        return 11.0  # sane fallback; never observed empty in this corpus
    return sizes.most_common(1)[0][0]


_LINE_MERGE_DISTANCE_FACTOR = 1.5  # x font size: catches a same-line span or one wrapped line below


def detect_headings_hand_tuned(
    pages: list[dict], profile: dict, margin_band_pt: float = 50.0
) -> list[DetectedHeading]:
    """Two same-level heading lines are merged into one heading only when
    they sit within _LINE_MERGE_DISTANCE_FACTOR x font-size of each other —
    e.g. a chapter number and its title sharing one visual line, or a title
    wrapping onto a second line immediately below (24pt title: ~30pt line
    gap, comfortably under a 36pt threshold). Lines further apart on the
    same page are genuinely separate headings.

    Scaled by font size rather than a single fixed constant: found necessary
    after an initial fixed 4pt threshold correctly separated who_acs_stroke
    page 7's five distinct 14pt subsection headings (>90pt apart) but then
    incorrectly split a genuinely wrapped 24pt chapter title on page 11
    ("Purpose, use and objective of the" / "framework", a 29.5pt gap) into
    two separate headings.

    Text in the margin band is excluded from heading candidacy — a running
    header/footer is never a real heading, regardless of its font size. This
    mirrors a real bug found and fixed in detect_headings_generic on
    who_sari; who_bec's own "PARTICIPANT WORKBOOK" running header (22pt,
    within the chapter-level 22-26pt size range) sits right at this
    boundary, so the same guard is applied here defensively even though no
    active corruption was observed for the two hand-tuned documents.
    """
    levels = profile["heading_levels"]
    exclude = {h.lower() for h in profile.get("exclude_headings", [])}
    headings: list[DetectedHeading] = []

    for page in pages:
        page_height = page["height"]
        per_level_lines: dict[str, list[tuple[float, str]]] = {}
        for block in page["blocks"]:
            if block["block_type"] != "text" or not block.get("font_sizes"):
                continue
            y0 = block["y0"]
            if y0 < margin_band_pt or y0 > page_height - margin_band_pt:
                continue
            size = block["font_sizes"][0]
            level = _match_level(size, levels, bold=block.get("bold", False))
            if level is None:
                continue
            per_level_lines.setdefault(level, []).append((block["y0"], block["text"]))

        for level, lines in per_level_lines.items():
            lines.sort(key=lambda e: e[0])
            level_font_size = next(
                (lv["font_size_min"] for lv in levels if lv["level"] == level), 14.0
            )
            merge_distance = level_font_size * _LINE_MERGE_DISTANCE_FACTOR
            for group in _cluster_by_proximity(lines, merge_distance):
                merged_text = " ".join(" ".join(t.split()) for _, t in group).strip()
                numbering_pattern = next(
                    (lv.get("numbering_pattern") for lv in levels if lv["level"] == level), None
                )
                if numbering_pattern:
                    merged_text = re.sub(numbering_pattern, "", merged_text).strip()
                else:
                    merged_text = _CHAPTER_NUMBER_STRIP_RE.sub("", merged_text).strip()

                if not merged_text:
                    continue

                # A boilerplate heading (Contents, References, ...) is still
                # RECORDED as a heading — not dropped — so that pages under
                # it get correctly tagged with a boilerplate section name and
                # can be skipped downstream (clean_document.py). Dropping it
                # here instead would make assign_sections() skip straight
                # past it to the next real heading, silently mis-tagging the
                # boilerplate pages as belonging to whatever section
                # happened to come next. Found during Phase 4 verification:
                # who_acs_stroke pages 3-6 (Contents/Tables/Figures/Boxes/
                # Acknowledgements/Abbreviations) were showing as
                # "(no section detected)" instead of being excluded.
                boilerplate = merged_text.lower() in exclude or is_boilerplate_heading(merged_text)

                headings.append(
                    DetectedHeading(
                        level=level,
                        text=merged_text,
                        page_number=page["page_number"],
                        y0=group[0][0],
                        is_boilerplate=boilerplate,
                    )
                )
    return headings


def _cluster_by_proximity(
    lines: list[tuple[float, str]], max_distance: float
) -> list[list[tuple[float, str]]]:
    """Group a y-sorted list of (y0, text) into clusters where consecutive
    entries are within max_distance of each other."""
    if not lines:
        return []
    clusters: list[list[tuple[float, str]]] = [[lines[0]]]
    for entry in lines[1:]:
        if entry[0] - clusters[-1][-1][0] <= max_distance:
            clusters[-1].append(entry)
        else:
            clusters.append([entry])
    return clusters


def _match_level(size: float, levels: list[dict], bold: bool) -> str | None:
    for lv in levels:
        if lv["font_size_min"] <= size <= lv["font_size_max"]:
            if lv.get("bold_required") and not bold:
                continue
            return lv["level"]
    return None


def detect_headings_generic(
    pages: list[dict],
    body_size: float,
    min_size_delta: float = 1.5,
    bold_required_below_delta: float = 3.0,
    min_length: int = 3,
    max_length: int = 120,
    margin_band_pt: float = 50.0,
) -> list[DetectedHeading]:
    """generic.yaml heading_detection: larger than body size AND (bold OR a
    large enough size delta to stand on its own).

    Text inside the top/bottom margin band is never a candidate heading — a
    genuine heading does not live in a running header/footer zone by
    definition. Required after a real bug found on who_sari during Phase 4
    verification: its computed body size (7.0pt, skewed low by heavy use of
    small footnote-style text) made a 9.0pt BOLD running-title footer clear
    the heading threshold, which then flip-flopped with the real "1.
    Epidemiology of SARI" chapter heading every other page — corrupting
    section assignment across the whole document (100% "detected"
    confidence was reported, which should have been a red flag: Phase 2
    profiling predicted a WEAK heading signal for this document, not a
    perfect one).
    """
    headings: list[DetectedHeading] = []
    for page in pages:
        page_height = page["height"]
        for block in page["blocks"]:
            if block["block_type"] != "text" or not block.get("font_sizes"):
                continue
            y0 = block["y0"]
            if y0 < margin_band_pt or y0 > page_height - margin_band_pt:
                continue
            size = block["font_sizes"][0]
            delta = size - body_size
            if delta < min_size_delta:
                continue
            if delta < bold_required_below_delta and not block.get("bold", False):
                continue
            text = block["text"].strip()
            if not (min_length <= len(text) <= max_length):
                continue
            # Boilerplate headings are recorded, not dropped — see the
            # matching comment in detect_headings_hand_tuned for why.
            boilerplate = is_boilerplate_heading(text)
            # Generic detection makes no chapter/subsection distinction —
            # treat every qualifying line as a single "section" level. This
            # matches generic.yaml's stated lower confidence: it has no
            # basis for a hand-tuned two-tier hierarchy on documents that
            # were never profiled that closely (docs/corpus-profile.md).
            headings.append(
                DetectedHeading(
                    level="section",
                    text=text,
                    page_number=page["page_number"],
                    y0=block["y0"],
                    is_boilerplate=boilerplate,
                )
            )
    return headings


def assign_sections(pages: list[dict], headings: list[DetectedHeading]) -> dict[int, SectionAssignment]:
    """Walk pages in order, carrying forward the most recent heading(s).

    Returns page_number -> SectionAssignment. A page with no heading of its
    own inherits the prior page's section (confidence: "inherited").
    """
    by_page: dict[int, list[DetectedHeading]] = {}
    for h in headings:
        by_page.setdefault(h.page_number, []).append(h)
    for hs in by_page.values():
        hs.sort(key=lambda h: h.y0)

    assignments: dict[int, SectionAssignment] = {}
    current_section: str | None = None
    current_subsection: str | None = None
    current_is_boilerplate: bool = False

    for page in pages:
        pno = page["page_number"]
        page_headings = by_page.get(pno, [])

        if not page_headings:
            assignments[pno] = _build_assignment(
                current_section, current_subsection, confidence="inherited", is_boilerplate=current_is_boilerplate
            )
            continue

        confidence = "detected"
        for h in page_headings:
            if h.level in ("chapter", "section"):
                current_section = h.text
                current_subsection = None
                current_is_boilerplate = h.is_boilerplate
            elif h.level == "subsection":
                current_subsection = h.text
                # A boilerplate chapter with a real-looking subsection
                # heading underneath it (rare, but not impossible) still
                # belongs to the boilerplate chapter — do not clear the flag.

        assignments[pno] = _build_assignment(
            current_section, current_subsection, confidence=confidence, is_boilerplate=current_is_boilerplate
        )

    return assignments


def _build_assignment(
    section: str | None, subsection: str | None, confidence: str, is_boilerplate: bool = False
) -> SectionAssignment:
    parts = [p for p in (section, subsection) if p]
    path = " > ".join(parts) if parts else "(no section detected)"
    return SectionAssignment(
        section=section,
        subsection=subsection,
        section_path=path,
        confidence=confidence if parts else "inherited",
        is_boilerplate=is_boilerplate,
    )
