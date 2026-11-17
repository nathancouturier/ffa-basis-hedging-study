"""The Baltic Exchange's weekly tanker report, as republished: TD3C and TD34 in Worldscale and as a TCE.

The report's VLCC paragraph reads, for example (week to 27 February 2026,
via Hellenic Shipping News):

    "The rate for the 270,000mt Middle East Gulf to China trip (TD3C)
    ascended about 47.5 points over the week to WS216.89 which corresponds to
    a daily round-trip TCE of $209,550 for the standard Baltic VLCC."

From 26 March 2026 the report also prints TD34, 270,000 t Mina Al Fahal
(Oman) to Ningbo, on public trial under Baltic circular 17/26. A report is
dated by its week: the Friday on or before the day it was posted.

The paragraph is also searched for the words the press used when the Gulf
assessments rested on little or no fixing ("hypothetical", "notional", "no
fixtures", "untested"); a week with such words is marked, with the sentence.

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
#: The Baltic's own words, in its VLCC paragraph, that its Gulf assessments rested on few or no fixtures
#: (weeks 13 to 17 of 2026: "some difficulties in assessing", transits "extremely limited", the strait
#: "blocked"); "able to price" (weeks 10 to 12) is recorded as a statement but does not mark the week.
THIN_RE = re.compile(
    r"[^.]*\b(difficult(?:y|ies) in assessing|extremely limited|unable to price|claiming the Strait of Hormuz "
    r"blocked|blockade)\b[^.]*\.",
    re.I,
)
ABLE_RE = re.compile(r"[^.]*\bable to price\b[^.]*\.", re.I)
FLAG_RE = re.compile(
    r"[^.]*\b(hypothetical|notional|no fixtures|untested|absence of fixtures|lack of fixtures)\b[^.]*\.", re.I
)


def _float(text: str) -> float:
    return float(text.replace(",", ""))


def week_ending(posted: dt.date) -> dt.date:
    """The Friday on or before the post date: the week the report describes."""
    return posted - dt.timedelta(days=(posted.weekday() - 4) % 7)


LEVEL_RE = re.compile(r"(?:\bto|\bat|\bof)\s+WS\s?" + NUM, re.I)
ANY_WS_RE = re.compile(r"WS\s?" + NUM, re.I)
TCE_RE = re.compile(r"TCE[^$]{0,60}?\$\s?" + NUM, re.I)
NEXT_ROUTE_RE = re.compile(r"\b(TD3C|TD15|TD22|TD34|TD6|TD20|TD25|TD27|In the Atlantic|Suezmax|Aframax)\b")
DAY_RE = re.compile(r"\bon (Monday|Tuesday|Wednesday|Thursday)\b", re.I)


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
        day = DAY_RE.search(head)
        return {
            "ws_points": _float(levels[-1]),
            "tce_usd_day": _float(tce.group(1)),
            "sentence": window[: tce.end()][:500],
            "assessed_day": day.group(1).capitalize() if day else "Friday",
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
    td34 = _route(flat, "TD34")
    if td34:
        row["td34_ws_points"] = td34["ws_points"]
        row["td34_tce_usd_day"] = td34["tce_usd_day"]
        row["td34_sentence"] = td34["sentence"]
    head = flat.find("VLCC ")
    end = flat.find("Suezmax", head + 5) if head >= 0 else -1
    vlcc = flat[head:end] if head >= 0 and end > head else flat[max(0, flat.find("TD3C") - 1500) :]
    thin = [m.group(0).strip() for m in THIN_RE.finditer(vlcc)]
    able = [m.group(0).strip() for m in ABLE_RE.finditer(vlcc)]
    flags = [m.group(0).strip() for m in FLAG_RE.finditer(vlcc)]
    row["thin_market"] = bool(thin or flags)
    if thin or flags:
        row["assessment_note"] = (thin + flags)[0][:400]
    elif able:
        row["assessment_note"] = able[0][:400]
    return row
