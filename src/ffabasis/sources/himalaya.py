"""Published monthly 5TC averages: Himalaya Shipping's monthly commercial updates, as filed with the SEC.

Himalaya Shipping Ltd. (NYSE: HSHP, SEC CIK 1959455) trades its Capesizes on
index-linked time charters and files each month's commercial update as an
exhibit to a Form 6-K. Each states the month's average of the Baltic 5TC, for
example (filed 8 August 2025):

    "The Baltic 5TC Capesize Index averaged US$22,008 during July 2025."

and, from 2026, "The Baltic 5TC 180 Capesize Index averaged ...", naming the
180,000 t basket. A month's average of the daily index is exactly the final
settlement of that month's 180,000 t 5TC future (EEX CPTM), so these are
published settlement values. The study uses one for a month only where its
own daily series is incomplete, and checks it to the dollar against every
month that series completes.

Discovery: EDGAR full-text search (efts.sec.gov), then each exhibit from the
Archives. SEC fair access rules apply (SEC_USER_AGENT, two seconds apart).
Public record; committed with links.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import warnings
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

from .http import Fetcher, FetchError

CIK = 1959455
SEARCH = "https://efts.sec.gov/LATEST/search-index"
ARCHIVE = "https://www.sec.gov/Archives/edgar/data/1959455/"
PHRASES = (
    "Baltic 5TC Capesize Index averaged",
    "Baltic 5TC 180 Capesize Index averaged",
    "5TC Capesize Index averaged",
)
SOURCE = "Himalaya Shipping Ltd., monthly commercial update (SEC Form 6-K exhibit)"
LICENCE = "US public record (SEC EDGAR)"
MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]
AVERAGE_RE = re.compile(
    r"Baltic\s+5TC\s+(?P<basket>180\s+|182\s+)?Capesize\s+Index\s+averaged\s+(?:approximately\s+)?US\$\s?"
    r"(?P<value>[\d,]+)\s+(?:during|in|for)\s+(?:the\s+month\s+of\s+)?(?P<month>[A-Z][a-z]+)\s+(?P<year>\d{4})",
    re.I,
)


def search(fetcher: Fetcher, refetch: bool = False) -> list[dict[str, str]]:
    """Every 6-K exhibit EDGAR's full-text search finds for the phrases, with its address."""
    found: dict[str, dict[str, str]] = {}
    for phrase in PHRASES:
        query = urllib.parse.urlencode({"q": f'"{phrase}"', "forms": "6-K"})
        try:
            path = fetcher.get(
                f"{SEARCH}?{query}", source="SEC EDGAR full-text search", licence="listing", refetch=refetch
            )
        except FetchError:
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for hit in data.get("hits", {}).get("hits", []):
            accession, filename = hit["_id"].split(":", 1)
            url = f"{ARCHIVE}{accession.replace('-', '')}/{filename}"
            found[url] = {"url": url, "accession": accession, "filed": hit["_source"].get("file_date", "")}
    return sorted(found.values(), key=lambda r: r["filed"])


def parse(path: Path) -> list[dict[str, Any]]:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", XMLParsedAsHTMLWarning)
        text = " ".join(
            BeautifulSoup(path.read_text(encoding="utf-8", errors="replace"), "lxml").get_text(" ", strip=True).split()
        )
    rows = []
    for match in AVERAGE_RE.finditer(text):
        month_name = match.group("month").capitalize()
        if month_name not in MONTHS:
            continue
        rows.append(
            {
                "month": "%s-%02d" % (match.group("year"), MONTHS.index(month_name) + 1),
                "value_usd_day": float(match.group("value").replace(",", "")),
                "basket_printed": (match.group("basket") or "").strip() or None,
                "sentence": match.group(0),
            }
        )
    return rows


def fetch_and_parse(fetcher: Fetcher, refetch: bool = False) -> list[dict[str, Any]]:
    """One published average per month: the first filing that states it (later restatements recorded)."""
    out: dict[str, dict[str, Any]] = {}
    for hit in search(fetcher, refetch=refetch):
        try:
            path = fetcher.get(hit["url"], source=SOURCE, licence=LICENCE)
        except FetchError:
            continue
        for row in parse(path):
            row.update(url=hit["url"], filed=hit["filed"], accession=hit["accession"])
            if row["month"] in out:
                if abs(out[row["month"]]["value_usd_day"] - row["value_usd_day"]) > 0.5:
                    out[row["month"]].setdefault("other_prints", []).append(
                        {"value_usd_day": row["value_usd_day"], "url": row["url"]}
                    )
                continue
            out[row["month"]] = row
    return [out[m] for m in sorted(out)]
