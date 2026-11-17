"""The Baltic Exchange's own weekly market reports: the primary source for TD3C and TD34 weekly prints.

Endpoints, as probed on 17 November 2026 (robots.txt: crawl delay 1 s; the
fetcher waits 2 s):

    https://www.balticexchange.com/en/data-services/WeeklyRoundup/tanker/news/<year>/tanker-report-week-<n>.html
    https://www.balticexchange.com/en/data-services/WeeklyRoundup/dry/news/<year>/bulk-report-week-<n>.html

The tanker report's VLCC paragraph gives TD3C (and TD34 from its trial) in
Worldscale points and as a round-trip TCE; the bulk report's Capesize
paragraph narrates the 5TC's week ("the BCI 182 5TC eased from just under
$50,000 to $44,374"). A report is dated by the Friday of its week; where the
text says the assessment was made on Thursday (a Friday holiday), the row
says so.

Terms: Baltic copyright. The pages stay in the cache; the study commits the
weekly TD3C and TD34 figures as individually cited points with these links.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

from . import tankers
from .http import Fetcher, FetchError

BASE = "https://www.balticexchange.com/en/data-services/WeeklyRoundup/"
SOURCE = "Baltic Exchange weekly report"
LICENCE = "Baltic copyright; cached, not redistributed; figures cited with links"


def url(kind: str, year: int, week: int) -> str:
    if kind == "tanker":
        return f"{BASE}tanker/news/{year}/tanker-report-week-{week}.html"
    return f"{BASE}dry/news/{year}/bulk-report-week-{week}.html"


def report_friday(year: int, week: int) -> dt.date:
    """The Friday of the report's week, by ISO numbering (the Baltic numbers its reports by ISO week)."""
    return dt.date.fromisocalendar(year, week, 5)


def text_of(path: Path) -> str:
    soup = BeautifulSoup(path.read_text(encoding="utf-8", errors="replace"), "lxml")
    return " ".join(soup.get_text(" ", strip=True).split())


def fetch(fetcher: Fetcher, kind: str, year: int, week: int, refetch: bool = False) -> Path | None:
    try:
        return fetcher.get(
            url(kind, year, week),
            key=f"baltic_{kind}_report_{year}_w{week:02d}",
            source=SOURCE,
            licence=LICENCE,
            refetch=refetch,
        )
    except FetchError as error:
        if "HTTP 404" in str(error):
            return None
        raise


def parse_tanker(path: Path, year: int, week: int) -> dict[str, Any] | None:
    friday = report_friday(year, week)
    row = tankers.parse(text_of(path), friday)
    if row is not None:
        row["week_ending"] = friday.isoformat()
        row["iso_week"] = f"{year}-W{week:02d}"
        row["url"] = url("tanker", year, week)
        row["source"] = SOURCE
    return row
