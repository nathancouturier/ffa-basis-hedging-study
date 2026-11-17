"""The Baltic Exchange's publication days: London business days.

The Baltic publishes its indices on United Kingdom business days (Amplify
Commodity Trust 10-Q, 30 September 2025: "Each Reference Index is published
each United Kingdom business day"). The study takes England and Wales bank
holidays by their statutory rules (Banking and Financial Dealings Act 1971,
schedule 1, and the annual proclamations): New Year's Day, Good Friday,
Easter Monday, the first and last Mondays of May, the last Monday of August,
Christmas Day and Boxing Day, with a weekend holiday moved to the next
weekday; and the one-off changes of the years studied: 8 May 2020 (the early
May holiday moved for VE Day), 2 and 3 June 2022 (the spring holiday moved,
and the Platinum Jubilee), 19 September 2022 (the State Funeral), 8 May 2023
(the Coronation).

GOV.UK's machine-readable list (www.gov.uk/bank-holidays.json) could not be
reached when the data were gathered; tests/test_calendar.py holds the rule to
the published dates of 2018 to 2026, typed from that list's public pages, and
the complete months of 2026 confirm it against the Baltic's own prints.
"""

from __future__ import annotations

import datetime as dt
from functools import cache

#: One-off changes: the dates added, and the rule dates they replace.
EXTRA = {
    "2020-05-08": "VE Day (early May holiday moved)",
    "2022-06-02": "spring holiday moved",
    "2022-06-03": "Platinum Jubilee",
    "2022-09-19": "State Funeral of Queen Elizabeth II",
    "2023-05-08": "Coronation of King Charles III",
}
REPLACED = {"2020-05-04", "2022-05-30"}


def easter(year: int) -> dt.date:
    """Gregorian Easter Sunday (the anonymous Gregorian algorithm)."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    ell = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * ell) // 451
    month, day = divmod(h + ell - 7 * m + 114, 31)
    return dt.date(year, month, day + 1)


def _first_monday(year: int, month: int) -> dt.date:
    day = dt.date(year, month, 1)
    return day + dt.timedelta(days=(7 - day.weekday()) % 7)


def _last_monday(year: int, month: int) -> dt.date:
    nxt = dt.date(year + (month == 12), month % 12 + 1, 1)
    day = nxt - dt.timedelta(days=1)
    return day - dt.timedelta(days=day.weekday())


@cache
def bank_holidays(year: int) -> frozenset[str]:
    """England and Wales bank holidays of a year, as ISO dates."""
    days: set[dt.date] = set()
    new_year = dt.date(year, 1, 1)
    days.add(new_year + dt.timedelta(days={5: 2, 6: 1}.get(new_year.weekday(), 0)))
    sunday = easter(year)
    days.add(sunday - dt.timedelta(days=2))
    days.add(sunday + dt.timedelta(days=1))
    days.add(_first_monday(year, 5))
    days.add(_last_monday(year, 5))
    days.add(_last_monday(year, 8))
    christmas, boxing = dt.date(year, 12, 25), dt.date(year, 12, 26)
    if christmas.weekday() == 5:  # Saturday: Monday 27 and Tuesday 28
        days.update({dt.date(year, 12, 27), dt.date(year, 12, 28)})
    elif christmas.weekday() == 6:  # Sunday: Boxing Day on Monday 26, Christmas moved to Tuesday 27
        days.update({boxing, dt.date(year, 12, 27)})
    elif boxing.weekday() == 5:  # Friday Christmas, Saturday Boxing Day: Monday 28
        days.update({christmas, dt.date(year, 12, 28)})
    else:
        days.update({christmas, boxing})
    iso = {d.isoformat() for d in days} - REPLACED
    iso |= {d for d in EXTRA if d.startswith(str(year))}
    return frozenset(iso)


def is_publication_day(day: str) -> bool:
    date = dt.date.fromisoformat(day)
    return date.weekday() < 5 and day not in bank_holidays(date.year)


def publication_days(month: str) -> list[str]:
    """Every expected publication day of a 'YYYY-MM' month."""
    year, mon = int(month[:4]), int(month[5:7])
    day = dt.date(year, mon, 1)
    out = []
    while day.month == mon:
        if is_publication_day(day.isoformat()):
            out.append(day.isoformat())
        day += dt.timedelta(days=1)
    return out


def previous_publication_day(day: str) -> str:
    date = dt.date.fromisoformat(day) - dt.timedelta(days=1)
    while not is_publication_day(date.isoformat()):
        date -= dt.timedelta(days=1)
    return date.isoformat()
