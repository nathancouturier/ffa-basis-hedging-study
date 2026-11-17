"""handybulk.com's monthly Baltic Dry Index archive: one page a month, one paragraph a day.

Endpoint, as probed on 17 November 2026:

    https://www.handybulk.com/baltic-dry-index/<year>/<month name>/

The archive index (https://www.handybulk.com/baltic-dry-index/) links 62
months, from March 2016 to October 2026, sparse before 2023; other months
answer 404. Each day reads, for example (31 July 2026):

    "The Baltic Capesize Index (BCI) increased by 129 points to 4,296 points,
    with average daily earnings for capesize bulk carriers increased by $1,165
    to $38,960."

The capesize earnings are the Baltic's 5TC. The page does not say which
basket; the BCI it prints beside them does, because the BCI is the basket
times a published factor: 0.11026 for the 182,000 t basket (GMB v8.8 page 76)
and 0.12058 (0.25 x 0.12058 = 0.030145, the C8_14 weight of GMB v7.09 page 75)
for the 180,000 t one. basket_from_bci() reads it day by day.

Terms: robots.txt allows all paths to general agents and signals
"search=yes, ai-train=no, use=reference". The study reads figures for
reference, trains nothing, and keeps the daily values in the gitignored cache.
"""

from __future__ import annotations

import datetime as dt
import re
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

from . import reuters
from .http import Fetcher, FetchError

BASE = "https://www.handybulk.com/baltic-dry-index/"
SOURCE = "handybulk.com, Baltic Dry Index archive"
LICENCE = "Copyright of the publisher; robots content signal use=reference, ai-train=no; cached, not redistributed"
MONTH_NAMES = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
]

DAY_RE = re.compile(r"^(\d{1,2})-([A-Za-z]+)-(\d{4})$", re.M)
CAPE_RE = re.compile(
    r"average daily (?:earnings|income) for capesize[^$]*?"
    r"(?:(increased|decreased|rose|fell|gained|lost|up|down)[^$]*?by \$([\d,]+)[^$]*?to \$([\d,]+)"
    r"|(?:remained )?unchanged at \$([\d,]+)|(?:stood|was|were) at \$([\d,]+))",
    re.I | re.S,
)
BCI_RE = re.compile(
    r"Baltic Capesize Index \(BCI\)[^.]*?(?:(increased|decreased|rose|fell|gained|lost)[^.]*?by ([\d,]+) points? to ([\d,]+)"
    r"|(?:remained )?unchanged at ([\d,]+))",
    re.I | re.S,
)
#: BCI points per USD a day of 5TC, by basket (see the module text).
BCI_FACTOR = {182000: 0.11026, 180000: 0.12058}


def month_url(year: int, month: int) -> str:
    return f"{BASE}{year}/{MONTH_NAMES[month - 1]}/"


def archive_months(fetcher: Fetcher, refetch: bool = False) -> list[tuple[int, int]]:
    """The (year, month) pairs the archive index links."""
    path = fetcher.get(BASE, key="handybulk_archive_index", source=SOURCE, licence=LICENCE, refetch=refetch)
    soup = BeautifulSoup(path.read_text(encoding="utf-8", errors="replace"), "lxml")
    months = set()
    for anchor in soup.find_all("a", href=True):
        match = re.search(r"baltic-dry-index/(\d{4})/([a-z]+)/", anchor["href"])
        if match and match.group(2) in MONTH_NAMES:
            months.add((int(match.group(1)), MONTH_NAMES.index(match.group(2)) + 1))
    return sorted(months)


def _int(text: str | None) -> int | None:
    return None if text is None else int(text.replace(",", ""))


def parse_month(path: Path) -> list[dict[str, Any]]:
    """Every daily report on a month page, read with the Reuters parser.

    A heading is the day handybulk posted the paragraph. In 2026 the paragraph
    describes that day; in 2025 and before it is often a rewritten Reuters
    report posted the next morning, naming its weekday ("on Tuesday"), so the
    index date is that weekday on or before the heading (ffabasis.sources.reuters).
    """
    soup = BeautifulSoup(path.read_text(encoding="utf-8", errors="replace"), "lxml")
    text = soup.get_text("\n", strip=True)
    heads = list(DAY_RE.finditer(text))
    days = []
    for index, head in enumerate(heads):
        end = heads[index + 1].start() if index + 1 < len(heads) else len(text)
        body = text[head.end() : end]
        cut = body.find("Back to Baltic Dry Index")
        if cut >= 0:
            body = body[:cut]
        month_name = head.group(2).lower()
        if month_name not in MONTH_NAMES:
            continue
        posted = dt.date(int(head.group(3)), MONTH_NAMES.index(month_name) + 1, int(head.group(1)))
        row = reuters.parse(" ".join(body.split()), posted)
        if row is not None:
            row["source"] = SOURCE
            days.append(row)
    return days


def basket_from_bci(bci_points: int | None, c5tc_usd_day: int) -> int | None:
    """The basket whose factor turns the 5TC into the printed BCI (to the index's rounding), else None."""
    if bci_points is None or not c5tc_usd_day:
        return None
    for basket, factor in BCI_FACTOR.items():
        if abs(c5tc_usd_day * factor - bci_points) <= 1.0:
            return basket
    return None


def fetch_all(fetcher: Fetcher, refetch_recent: bool = False) -> list[Path]:
    """Every month the index links, cached; with refetch_recent the latest two months are asked again."""
    paths = []
    months = archive_months(fetcher, refetch=refetch_recent)
    for position, (year, month) in enumerate(months):
        recent = position >= len(months) - 2
        try:
            paths.append(
                fetcher.get(
                    month_url(year, month),
                    key=f"handybulk_bdi_{year}_{month:02d}",
                    source=SOURCE,
                    licence=LICENCE,
                    refetch=refetch_recent and recent,
                )
            )
        except FetchError as error:
            print(f"handybulk {year}-{month:02d}: {error}")
    return paths
