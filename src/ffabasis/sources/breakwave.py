"""Breakwave Advisors' bi-weekly tanker report (PDF, republished by Hellenic Shipping News).

Page one prints, in its side panel, the Breakwave Tanker Futures Index
(BWETFF, 90 percent TD3C and 10 percent TD20 freight futures) and "VLCC Middle
East-Asia Spot Rates", the Baltic TD3C in US dollars a tonne, with the report's
date in its header ("Bi-Weekly Industry Report / October 21, 2025"). The
side panel is extracted interleaved with the body text, so each figure is read
as the number printed next to its label.

Terms: Breakwave's copyright; figures cited with the report's link.
"""

from __future__ import annotations

import datetime as dt
import re
from pathlib import Path
from typing import Any

import pdfplumber

#: Three headers: "Bi-Weekly Industry Report / October 21, 2025" (from October 2025), "Tanker Shipping /
#: Bi-Weekly Report / March 11, 2025" and "BWET Tanker Shipping October 17, 2023 Breakwave Tanker Futures
#: Index: 1,351 VLCC Middle East-Asia Spot Rates: $14.20", the last with each value right after its label.
DATE_RE = re.compile(r"(?:Industry Report|Bi-Weekly Report|Tanker Shipping)\s+([A-Z][a-z]+ \d{1,2}, \d{4})")
INDEX_AFTER_RE = re.compile(r"Futures Index:\s*([\d,]{3,}(?:\.\d+)?)\b")
#: A value right after its label, never a percentage ("Asia Spot Rates: 2.8% y/y" is body text).
SPOT_AFTER_RE = re.compile(r"Asia Spot Rates:\s*\$?\s?([\d,]+\.\d+)(?![\d%])")
#: The index printed right under its label's first half ("Breakwave Tanker 1296 ... Futures Index:").
INDEX_NEXT_RE = re.compile(r"Breakwave Tanker\s+(\d{1,3}(?:,\d{3})+|\d{3,})(?![\d.,%])")
#: The index sits beside its label; between them the extraction may put up to 40 words of body text.
INDEX_RE = re.compile(
    r"Breakwave Tanker\s+(?:[^\d\s]\S*\s+){0,40}?([\d,]{3,}(?:\.\d+)?)\s+(?:\S+\s+){0,40}?Futures Index:"
)
SPOT_RE = re.compile(r"([\d,]+\.\d+)\s+Asia Spot Rates")
SPOT_ALT_RE = re.compile(r"Middle East-\s*(?:\S+\s+){0,30}?([\d,]+\.\d{2})\s")


def _index(text: str) -> float | None:
    """The index: the whole number standing between its label's two halves ("Breakwave Tanker" ... "Futures Index:")."""
    start = text.find("Breakwave Tanker")
    end = text.find("Futures Index:", start)
    if start < 0 or end < 0:
        return None
    tokens = [tok for tok in text[start:end].split() if re.fullmatch(r"\d{1,3}(?:,\d{3})+|\d{3,}", tok)]
    return float(tokens[-1].replace(",", "")) if tokens else None


def parse(path: Path) -> dict[str, Any] | None:
    with pdfplumber.open(path) as pdf:
        text = " ".join((pdf.pages[0].extract_text() or "").split())
    date = DATE_RE.search(text)
    found = INDEX_NEXT_RE.search(text) or INDEX_AFTER_RE.search(text)
    index = float(found.group(1).replace(",", "")) if found else _index(text)
    spot = SPOT_AFTER_RE.search(text) or SPOT_RE.search(text) or SPOT_ALT_RE.search(text)
    if not date:
        return None
    return {
        "report_date": dt.datetime.strptime(date.group(1), "%B %d, %Y").date().isoformat(),
        "btfi_points": index,
        "td3c_usd_t": None if not spot else float(spot.group(1).replace(",", "")),
    }
