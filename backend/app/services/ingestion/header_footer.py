"""Header/footer removal via frequency analysis — ARCHITECTURE.md §6.2.

A line counts as a repeated header/footer if it recurs at a consistent
y-band (top or bottom margin) on more than the configured fraction of pages.
This catches both fixed-string headers (e.g. "PARTICIPANT WORKBOOK") and
position-varying-but-structurally-fixed content like page numbers, since
both live in the same margin band on most pages — we key on (position band,
normalized text) for exact repeats, and separately catch pure page-number
footers by pattern regardless of exact text.

docs/corpus-profile.md confirmed this exact pattern on who_bec: a constant
document-name header AND a second header that changes per module (current
module name) — a single fixed-string list would miss the second one, which
is why detection here is frequency-based, not a hardcoded list.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

MARGIN_BAND_PT = 50.0
MIN_REPEAT_FRACTION = 0.30  # PLAN.md Phase 4: ">30% of pages"
Y_POSITION_TOLERANCE_PT = 1.0
MIN_Y_SLOT_OCCUPANCY_FRACTION = 0.30
_PAGE_NUMBER_RE = re.compile(r"^[ivxlcdm]+$|^\d{1,4}$", re.IGNORECASE)


@dataclass(frozen=True)
class HeaderFooterProfile:
    document_id: str
    page_height: float
    repeated_top_texts: frozenset[str]
    repeated_bottom_texts: frozenset[str]
    top_band_pt: float
    bottom_band_pt: float
    # Y-slots (rounded y0) that are consistently occupied by *some* short
    # line across many pages, regardless of the exact text. Catches
    # varying-text running headers like per-module titles that individually
    # never clear MIN_REPEAT_FRACTION on exact text (who_bec: each module
    # header only spans that module's page range, but the y-slot is
    # occupied by *a* header on almost every page). See docs/corpus-profile.md
    # and PROJECT-STATE.md — found during Phase 4 verification.
    recurring_top_y_slots: frozenset[float]
    recurring_bottom_y_slots: frozenset[float]


MAX_HEADER_LINE_LENGTH = 60  # headers are short; real body text starting near a margin is not


def detect_header_footer(
    document_id: str,
    pages: list[dict],
    page_height: float,
    margin_band_pt: float = MARGIN_BAND_PT,
    min_repeat_fraction: float = MIN_REPEAT_FRACTION,
    min_y_slot_occupancy_fraction: float = MIN_Y_SLOT_OCCUPANCY_FRACTION,
) -> HeaderFooterProfile:
    """pages: the raw list of CanonicalPage dicts from data/parsed/{id}.json."""
    n_pages = len(pages)
    top_counter: Counter[str] = Counter()
    bottom_counter: Counter[str] = Counter()
    top_y_slots: dict[int, list[str]] = {}
    bottom_y_slots: dict[int, list[str]] = {}

    for page in pages:
        seen_top: set[str] = set()
        seen_bottom: set[str] = set()
        for block in page["blocks"]:
            if block["block_type"] != "text":
                continue
            norm = _normalize(block["text"])
            if not norm:
                continue
            if block["y0"] < margin_band_pt:
                seen_top.add(norm)
                top_y_slots.setdefault(round(block["y0"]), []).append(norm)
            elif block["y0"] > page_height - margin_band_pt:
                seen_bottom.add(norm)
                bottom_y_slots.setdefault(round(block["y0"]), []).append(norm)
        for t in seen_top:
            top_counter[t] += 1
        for t in seen_bottom:
            bottom_counter[t] += 1

    min_count = max(1, int(n_pages * min_repeat_fraction))
    repeated_top = frozenset(t for t, c in top_counter.items() if c >= min_count)
    repeated_bottom = frozenset(t for t, c in bottom_counter.items() if c >= min_count)

    recurring_top_y = _detect_recurring_slots(top_y_slots, n_pages, min_y_slot_occupancy_fraction)
    recurring_bottom_y = _detect_recurring_slots(
        bottom_y_slots, n_pages, min_y_slot_occupancy_fraction
    )

    return HeaderFooterProfile(
        document_id=document_id,
        page_height=page_height,
        repeated_top_texts=repeated_top,
        repeated_bottom_texts=repeated_bottom,
        top_band_pt=margin_band_pt,
        bottom_band_pt=margin_band_pt,
        recurring_top_y_slots=recurring_top_y,
        recurring_bottom_y_slots=recurring_bottom_y,
    )


def _detect_recurring_slots(
    y_slots: dict[int, list[str]], n_pages: int, min_occupancy_fraction: float
) -> frozenset[float]:
    """A y-slot is a recurring (varying-text) header/footer position if it is
    occupied on enough pages by SHORT lines. Occupancy alone is not enough —
    verified against who_bec: a genuine header slot (y=16) had 100
    occurrences across only 10 distinct short strings (module names, all
    varying-text but the SAME "channels" pages went by y-position), while
    noise slots (y=36, 46, 49) had only 1-7 occurrences and were correctly
    rejected by the occupancy threshold alone. The max-length check is a
    second guard against a slot where body paragraphs happen to start.
    """
    min_count = max(1, int(n_pages * min_occupancy_fraction))
    slots = set()
    for y, texts in y_slots.items():
        if len(texts) < min_count:
            continue
        if max(len(t) for t in texts) > MAX_HEADER_LINE_LENGTH:
            continue
        slots.add(float(y))
    return frozenset(slots)


def is_header_footer_line(text: str, y0: float, profile: HeaderFooterProfile) -> bool:
    """True if this line should be stripped as a repeated header/footer.

    Rules, any one sufficient:
    1. Exact normalized-text match against the document's detected repeat set.
    2. A bare page number (digits or lowercase roman numerals) sitting in
       either margin band — these vary page to page by definition and so
       never hit the frequency threshold in rule 1, but are structurally
       always boilerplate.
    3. The line sits in a y-slot that recurs across many pages with short,
       varying text — catches per-chapter/per-module running headers that
       individually never repeat often enough for rule 1 (who_bec: each
       module's header text only spans that module's own page range).
    """
    norm = _normalize(text)
    if not norm:
        return False

    in_top_band = y0 < profile.top_band_pt
    in_bottom_band = y0 > profile.page_height - profile.bottom_band_pt
    if not (in_top_band or in_bottom_band):
        return False

    if in_top_band and norm in profile.repeated_top_texts:
        return True
    if in_bottom_band and norm in profile.repeated_bottom_texts:
        return True

    if (in_top_band or in_bottom_band) and _PAGE_NUMBER_RE.match(norm):
        return True

    y_slot = float(round(y0))
    if in_top_band and y_slot in profile.recurring_top_y_slots and len(norm) <= MAX_HEADER_LINE_LENGTH:
        return True
    if (
        in_bottom_band
        and y_slot in profile.recurring_bottom_y_slots
        and len(norm) <= MAX_HEADER_LINE_LENGTH
    ):
        return True

    return False


def _normalize(text: str) -> str:
    return " ".join(text.split()).strip()
