"""The Baltic Exchange's weekly tanker report, as republished: TD3C and TD34 in Worldscale and as a TCE.

The report's VLCC paragraph reads, for example (week to 27 February 2026,
via Hellenic Shipping News):

    "The rate for the 270,000mt Middle East Gulf to China trip (TD3C)
    ascended about 47.5 points over the week to WS216.89 which corresponds to
    a daily round-trip TCE of $209,550 for the standard Baltic VLCC."

From the week to 27 March 2026 the report also prints TD34, 270,000 t Gulf
of Oman to China (Mina Al Fahal to Ningbo in the Guide to Market Benchmarks
v8.8, page 87), "an alternative to the TD3C route, which is on public trial"
(week 13 report), assessed on Thursdays: in Worldscale only until the week
to 3 July 2026, with a TCE from the week to 10 July. A report is dated by its
week: the Friday on or before the day it was posted.

The VLCC paragraph is read for the Baltic's own words on how the Gulf was
assessed. A week is marked when the Baltic says the assessment was
theoretical, hypothetical or notional, that its panellists had a difficult
week or faced challenges or difficulties in assessing the region, or that
transits through the Strait of Hormuz were extremely limited or blocked; the
reason (assessment, transits or both) and the sentence are kept. "Able to
price" is recorded beside it.

Terms: the Baltic's report is its copyright; each weekly print the study
uses is committed as an individually cited figure with its article link, as
voyage-tce-model does.
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Any

NUM = r"([\d,]+(?:\.\d+)?)"
TD3C_RE = re.compile(
    r"(?:Middle East Gulf|MEG|Arabian Gulf)[^.]{0,40}?(?:to|/|-)\s*China[^.]{0,40}?\(TD3C\)(?:[^.]|\.\d)*?WS\s?"
    + NUM
    + r"(?:[^.]|\.\d)*?TCE[^$]{0,40}\$\s?"
    + NUM,
    re.I,
)
TD3C_LEAD_RE = re.compile(
    r"TD3C(?:\s+route)?\s*\([^)]*\)(?:[^.]|\.\d)*?WS\s?" + NUM + r"(?:[^.]|\.\d)*?TCE[^$]{0,40}\$\s?" + NUM,
    re.I,
)
TD34_RE = re.compile(
    r"(?:\(TD34\)|TD34(?:\s+route)?\s*\([^)]*\))(?:[^.]|\.\d)*?WS\s?"
    + NUM
    + r"(?:[^.]|\.\d)*?TCE[^$]{0,40}\$\s?"
    + NUM,
    re.I,
)
TD34_ALT_RE = re.compile(
    r"TD34(?:[^.]|\.\d)*?WS\s?" + NUM + r"(?:[^.]|\.\d)*?\$\s?" + NUM,
    re.I,
)
#: The Baltic's own words that its Gulf assessment was hard or theoretical (week 10 of 2026: "while mostly
#: theoretical, the TD3C route ... is being assessed"; week 11: "an extraordinarily difficult week was
#: experienced for the Baltic panellists"; week 12: "challenges for the Baltic panellists"; week 13: "some
#: difficulties in assessing the Baltic routes from the region").
ASSESSMENT_RE = re.compile(
    r"[^.]*\b(theoretical|hypothetical|notional|untested|no fixtures|absence of fixtures|lack of fixtures|"
    r"difficult(?:y|ies) in assessing|unable to price|difficult week[^.]*panellists|challenges for the Baltic "
    r"panellists)\b[^.]*\.",
    re.I,
)
#: The Baltic's words that transits were nearly or wholly stopped (weeks 13 and 15: "extremely limited";
#: week 16: "a blockade by the US Navy"; week 17: "both the US and Iran claiming the Strait of Hormuz blocked").
TRANSIT_RE = re.compile(r"[^.]*\b(extremely limited|blockade|Strait of Hormuz blocked)\b[^.]*\.", re.I)
ABLE_RE = re.compile(r"[^.]*\bable to price\b[^.]*\.", re.I)


def _float(text: str) -> float:
    return float(text.replace(",", ""))


def week_ending(posted: dt.date) -> dt.date:
    """The Friday on or before the post date: the week the report describes."""
    return posted - dt.timedelta(days=(posted.weekday() - 4) % 7)


LEVEL_RE = re.compile(r"(?:\bto|\bat|\bof)\s+WS\s?" + NUM, re.I)
ANY_WS_RE = re.compile(r"WS\s?" + NUM, re.I)
TCE_RE = re.compile(r"TCE[^$]{0,60}?\$\s?" + NUM, re.I)
NEXT_ROUTE_RE = re.compile(r"\b(TD3C|TD15|TD22|TD34|TD6|TD20|TD25|TD27|In the Atlantic|Suezmax|Aframax)\b")


#: Before the Baltic named its routes in the report (2023 and 2024), TD3C reads "270,000 mt Middle East Gulf to China".
ALIASES = {"TD3C": r"270,000\s?mt Middle East Gulf (?:to|/)\s?China"}


def _route(flat: str, code: str) -> dict[str, Any] | None:
    """The level, TCE and sentence of one route: the first mention followed by a Worldscale figure and a TCE.

    The level is the last "to/at/of WS" figure before the route's TCE (the week's close after any figure
    the week passed through); nothing after the TCE is read, so the next route's figures never bleed in.
    """
    pattern = r"\b" + code + r"\b"
    if code in ALIASES:
        pattern = "(?:" + pattern + "|" + ALIASES[code] + ")"
    for match in re.finditer(pattern, flat):
        window = flat[match.start() : match.start() + 700]
        stop = NEXT_ROUTE_RE.search(window, len(match.group(0)))
        if stop and stop.group(1) != code:
            window = window[: stop.start()]
        tce = TCE_RE.search(window)
        if not tce:
            continue
        head = window[: tce.start()]
        levels = LEVEL_RE.findall(head) or ANY_WS_RE.findall(head)
        if not levels:
            continue
        span = RANGE_RE.search(head)
        tce_value, tce_note = _tce(tce.group(1))
        return {
            "ws_points": _float(levels[-1]),
            "tce_usd_day": tce_value,
            "tce_note": tce_note,
            "sentence": window[: tce.end()][:500],
            "assessed_day": _day_of(head, levels[-1]),
            "range_note": (
                f"The report gives a range, WS{span.group(1)} to WS{span.group(2)}; its upper end is recorded."
                if span and span.group(2).rstrip(",") == levels[-1].rstrip(",")
                else None
            ),
        }
    return None


def _tce(text: str) -> tuple[float | None, str | None]:
    """A TCE as printed, with the report's own slips handled: "$35.305" (week to 31 May 2024, between 47,578 and
    32,300) uses a dot for the thousands separator and is read as 35,305; any other figure under USD 1,000 a day
    is not a VLCC's round-trip TCE and is dropped."""
    if re.fullmatch(r"\d{1,3}\.\d{3}", text):
        return float(text.replace(".", "")), f"The report prints ${text}; read as ${text.replace('.', ',')}."
    value = _float(text)
    if value < 1000.0:
        return None, f"The report prints a TCE of ${text}, not a plausible round-trip TCE; left out."
    return value, None


#: A level the report states as a range ("hovering around the WS57.5 to WS58 level", week to 2 February 2024).
RANGE_RE = re.compile(r"(?:around|between)\s+(?:the\s+)?WS\s?" + NUM + r"\s+(?:to|and)\s+WS\s?" + NUM, re.I)


def _day_of(text: str, level: str) -> str | None:
    """The weekday the report ties to this very level, right beside it ("assessed on Thursday at WS197",
    "to WS120.50 on Thursday"), else None: a weekday elsewhere in the sentence may belong to another figure
    ("climbed to WS74.55 on Tuesday easing back to be assessed at WS71.5")."""
    days = r"(Monday|Tuesday|Wednesday|Thursday|Friday)"
    lvl = r"WS\s?" + re.escape(level.rstrip(",")) + r"\b"
    match = re.search(r"\bon " + days + r" at " + lvl, text, re.I) or re.search(
        lvl + r"\s+on " + days + r"\b", text, re.I
    )
    return match.group(1).capitalize() if match else None


def _level_only(flat: str, code: str) -> dict[str, Any] | None:
    """A route printed in Worldscale without a TCE (TD34 until July 2026): its level, day and sentence."""
    for match in re.finditer(r"\b" + code + r"\b", flat):
        window = flat[match.start() : match.start() + 400]
        stop = NEXT_ROUTE_RE.search(window, len(match.group(0)))
        if stop and stop.group(1) != code:
            window = window[: stop.start()]
        end = window.find(". ")
        sentence = window if end < 0 else window[: end + 1]
        levels = LEVEL_RE.findall(sentence)
        if levels:
            return {
                "ws_points": _float(levels[-1]),
                "tce_usd_day": None,
                "sentence": sentence[:500],
                "assessed_day": _day_of(sentence, levels[-1]),
            }
    return None


def parse(text: str, posted: dt.date) -> dict[str, Any] | None:
    """TD3C (and TD34 when printed) from one weekly report, or None when the report has no TD3C line."""
    flat = " ".join(text.split())
    td3c = _route(flat, "TD3C")
    if td3c is None:
        return None
    week = week_ending(posted)
    row: dict[str, Any] = {
        "week_ending": week.isoformat(),
        "printed_on": posted.isoformat(),
        "td3c_ws_points": td3c["ws_points"],
        "td3c_tce_usd_day": td3c["tce_usd_day"],
        "td3c_sentence": td3c["sentence"],
        "assessed_day": td3c["assessed_day"],
    }
    if td3c.get("range_note") or td3c.get("tce_note"):
        row["range_note"] = " ".join(x for x in (td3c.get("range_note"), td3c.get("tce_note")) if x)
    td34 = _route(flat, "TD34") or _level_only(flat, "TD34")
    if td34:
        row["td34_ws_points"] = td34["ws_points"]
        row["td34_tce_usd_day"] = td34["tce_usd_day"]
        row["td34_sentence"] = td34["sentence"]
        row["td34_assessed_day"] = td34["assessed_day"]
    head = flat.find("VLCC ")
    end = flat.find("Suezmax", head + 5) if head >= 0 else -1
    vlcc = flat[head:end] if head >= 0 and end > head else flat[max(0, flat.find("TD3C") - 1500) :]
    assessment = [m.group(0).strip() for m in ASSESSMENT_RE.finditer(vlcc)]
    transits = [m.group(0).strip() for m in TRANSIT_RE.finditer(vlcc)]
    able = [m.group(0).strip() for m in ABLE_RE.finditer(vlcc)]
    row["thin_market"] = bool(assessment or transits)
    row["thin_reason"] = (
        "assessment and transits"
        if assessment and transits
        else "assessment"
        if assessment
        else "transits"
        if transits
        else None
    )
    notes = list(dict.fromkeys(assessment + transits + able))
    if notes:
        row["assessment_note"] = " ".join(notes)[:600]
    return row
