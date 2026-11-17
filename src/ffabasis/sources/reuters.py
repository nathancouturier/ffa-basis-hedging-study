"""Reuters' daily dry bulk report, as republished: the day's capesize 5TC and its change.

The report reads, for example (29 July 2026, via Maritime Professional):

    "The capesize index fell 73 points, or 1.8%, to 4,067 ... Average daily
    earnings for capesize vessels ... fell $664 to $33,384."

Each report gives the level on the index date and its change from the
previous publication day, so it also gives that previous day's level
(level - change). The study keeps both: the printed level, and the implied
previous level, marked "implied", used only where no print of that day exists
and only after the chain check in ffabasis.daily confirms which day it is.

The index date is the weekday the text names ("on Wednesday"), the latest such
day on or before the post's date; a post with no weekday is dated by its post
date if that is a weekday.

The basket: in 2026 Reuters prints the 5TC of the 180,000 t basket (33,384 on
29 July against the Baltic's 36,887 for 182,000 t) while the capesize index
points it prints are the 182,000 t basket's BCI (GMB v8.8 page 76: BCI =
basket x 0.11026). basket_of_print() decides from the two figures.
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Any

from .. import engine

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
UP = ("rose", "increased", "gained", "climbed", "added", "jumped", "advanced", "edged up", "were up", "was up", "up")
DOWN = (
    "fell",
    "decreased",
    "dropped",
    "declined",
    "slipped",
    "dipped",
    "lost",
    "eased",
    "edged down",
    "were down",
    "was down",
    "down",
    "slid",
    "shed",
    "retreated",
)

EARNINGS_RE = re.compile(
    r"average daily earnings for capesize(?:[^.]|\.\d)*?(?:(?P<verb>"
    + "|".join(sorted((re.escape(v) for v in UP + DOWN), key=len, reverse=True))
    + r")\s*(?:by\s*)?\$(?P<change>[\d,]+)\s*(?:a day\s*)?(?:to|at)\s*\$(?P<level>[\d,]+)"
    r"|(?:were |was |remained |held )?(?:unchanged|steady|flat) at \$(?P<flat>[\d,]+))",
    re.I | re.S,
)
INDEX_RE = re.compile(
    r"capesize index(?:[^.]|\.\d)*?(?:(?P<verb>rose|fell|gained|lost|added|dropped|declined|climbed|increased|decreased|"
    r"slipped|dipped|eased|jumped|was up|was down|edged up|edged down)(?:[^.]|\.\d)*?(?P<change>[\d,]+) points?(?:[^.]|\.\d)*?"
    r"(?:to|at) (?P<level>[\d,]+)|(?:was |remained )?(?:unchanged|steady|flat) at (?P<flat>[\d,]+))",
    re.I | re.S,
)
WEEKDAY_RE = re.compile(r"\bon (Monday|Tuesday|Wednesday|Thursday|Friday)\b", re.I)


def _int(text: str | None) -> int | None:
    return None if text is None else int(text.replace(",", ""))


def index_date(text: str, posted: dt.date) -> dt.date | None:
    """The day the report describes: the weekday it names, on or before the post date."""
    match = WEEKDAY_RE.search(text)
    if match:
        target = WEEKDAYS.index(match.group(1).lower())
        for back in range(0, 7):
            day = posted - dt.timedelta(days=back)
            if day.weekday() == target:
                return day
    return posted if posted.weekday() < 5 else None


def parse(text: str, posted: dt.date) -> dict[str, Any] | None:
    """The capesize figures of one report, or None when it prints no 5TC level."""
    match = EARNINGS_RE.search(text)
    if not match:
        return None
    if match.group("level"):
        verb = match.group("verb").lower()
        sign = -1 if verb in DOWN else 1
        level = _int(match.group("level"))
        change = sign * (_int(match.group("change")) or 0)
    else:
        level = _int(match.group("flat"))
        change = 0
    day = index_date(text, posted)
    if day is None or level is None:
        return None
    out: dict[str, Any] = {
        "date": day.isoformat(),
        "printed_on": posted.isoformat(),
        "c5tc_usd_day": level,
        "change_usd_day": change,
        "sentence": " ".join(match.group(0).split())[:300],
    }
    index = INDEX_RE.search(text)
    if index:
        points = _int(index.group("level") or index.group("flat"))
        out["bci_points"] = points
    out["basket_t"] = basket_of_print(out.get("bci_points"), level, out["date"])
    return out


def basket_of_print(bci_points: int | None, c5tc: int, day: str) -> int | None:
    """Which basket a printed 5TC is, from the BCI printed beside it.

    Before 2 January 2026 only the 180,000 t basket settles and the BCI is
    0.12058 times it. From that date the BCI is 0.11026 times the 182,000 t
    basket: a 5TC that matches it is the 182,000 t basket; one that matches it
    once 3,503 is added back is the 180,000 t basket. None when the BCI is
    missing or matches neither (the value is then not used for 2026).
    """
    if day < engine.BASKET_182_FROM:
        if bci_points is None:
            return 180000
        return 180000 if abs(c5tc * 0.12058 - bci_points) <= 1.5 else None
    if bci_points is None:
        return None
    if abs(c5tc * 0.11026 - bci_points) <= 1.5:
        return 182000
    if abs((c5tc + engine.C5TC_180_DIFFERENTIAL_USD_DAY) * 0.11026 - bci_points) <= 1.5:
        return 180000
    return None
