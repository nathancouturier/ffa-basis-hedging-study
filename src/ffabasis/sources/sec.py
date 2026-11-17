"""Amplify Commodity Trust (SEC CIK 1610940): quarter-end freight futures marks of BDRY and BWET.

The trust, formerly ETF Managers Group Commodity Trust I, files a 10-Q for
each quarter and a 10-K for each fiscal year ending 30 June. Each filing's
schedule of investments lists every freight future a fund holds at the
quarter end and at the previous fiscal year end, one line each:

    Baltic Exchange Capesize T/C Average Shipping Route Index Expiring
    October 31, 2025 (Underlying Face Amount at Market Value - $ 6,837,600 )
    ( 275 contracts)

The mark is the face amount over the contract size: one day a lot for the
Capesize 5TC future (USD a day), 1,000 t a lot for the TD3C future (USD a
tonne). Filings are public records: the marks are committed with links.

Endpoints: https://data.sec.gov/submissions/CIK0001610940.json for the list of
filings, https://www.sec.gov/Archives/edgar/data/1610940/<accession>/<document>
for each. SEC's fair access policy asks for a User-Agent with a contact
(environment variable SEC_USER_AGENT, never committed) and fewer than ten
requests a second; the fetcher waits two seconds.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import warnings
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

from .. import engine
from .http import Fetcher

CIK = 1610940
SUBMISSIONS = "https://data.sec.gov/submissions/CIK0001610940.json"
ARCHIVE = "https://www.sec.gov/Archives/edgar/data/1610940/"
SOURCE = "Amplify Commodity Trust, SEC EDGAR"
LICENCE = "US public record (SEC EDGAR)"
FORMS = ("10-Q", "10-K", "10-Q/A", "10-K/A")
MONTHS = {
    m: i + 1
    for i, m in enumerate(
        [
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
    )
}

SCHEDULE_RE = re.compile(
    r"BREAKWAVE (?P<fund>DRY BULK|TANKER) SHIPPING ETF(?:(?!BREAKWAVE).){0,400}?(?:Futures Contracts?|Open Futures)"
    r"(?:(?!BREAKWAVE).){0,300}?(?P<date>(?:January|February|March|April|May|June|July|August|September|October|"
    r"November|December) \d{1,2}, \d{4})",
    re.S | re.I,
)
LINE_RE = re.compile(
    r"(?P<name>Baltic[^()$]{0,120}?)\s+Expiring\s+(?:[$(),\d\s-]*?)"
    r"(?P<expiry>(?:January|February|March|April|May|June|July|August|September|October|November|December)"
    r" \d{1,2}, \d{4})\s*\(\s*Underlying Face Amount at Market Value\s*-?\s*\$\s*(?P<notional>[\d,]+)\s*\)?\s*"
    r"\(\s*(?P<contracts>[\d,]+)\s*contracts?\s*\)",
    re.S,
)


def _date(text: str) -> str:
    month, day, year = re.match(r"([A-Z][a-z]+) (\d{1,2}), (\d{4})", text).groups()
    return dt.date(int(year), MONTHS[month], int(day)).isoformat()


def product_of(name: str) -> str | None:
    lowered = " ".join(name.lower().split())
    if "capesize" in lowered:
        return "capesize_5tc"
    if "middle east gulf to china" in lowered or "td3c" in lowered:
        return "td3c"
    return None


def filings(fetcher: Fetcher, refetch: bool = False) -> list[dict[str, str]]:
    """Every 10-Q and 10-K of the trust, oldest first."""
    path = fetcher.get(SUBMISSIONS, key="sec_submissions_1610940", source=SOURCE, licence=LICENCE, refetch=refetch)
    data = json.loads(path.read_text(encoding="utf-8"))
    recent = data["filings"]["recent"]
    rows = []
    for form, filed, report, accession, document in zip(
        recent["form"],
        recent["filingDate"],
        recent["reportDate"],
        recent["accessionNumber"],
        recent["primaryDocument"],
        strict=True,
    ):
        if form in FORMS:
            url = f"{ARCHIVE}{accession.replace('-', '')}/{document}"
            rows.append({"form": form, "filed": filed, "period": report, "accession": accession, "url": url})
    return sorted(rows, key=lambda r: (r["period"], r["filed"]))


def parse_filing(path: Path, filing: dict[str, str]) -> list[dict[str, Any]]:
    """Every Capesize 5TC and TD3C futures line of a filing, with its schedule date."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", XMLParsedAsHTMLWarning)
        soup = BeautifulSoup(path.read_text(encoding="utf-8", errors="replace"), "lxml")
    text = " ".join(soup.get_text(" ", strip=True).split())
    heads = list(SCHEDULE_RE.finditer(text))
    rows = []
    for index, head in enumerate(heads):
        end = heads[index + 1].start() if index + 1 < len(heads) else len(text)
        block = text[head.end() : end]
        fund = "BDRY" if head.group("fund").upper() == "DRY BULK" else "BWET"
        as_of = _date(head.group("date"))
        for line in LINE_RE.finditer(block):
            product = product_of(line.group("name"))
            if product is None:
                continue
            notional = float(line.group("notional").replace(",", ""))
            contracts = float(line.group("contracts").replace(",", ""))
            size = engine.DAYS_PER_LOT_5TC if product == "capesize_5tc" else engine.TONNES_PER_LOT_TD3C
            rows.append(
                {
                    "fund": fund,
                    "product": product,
                    "as_of": as_of,
                    "contract_month": _date(line.group("expiry"))[:7],
                    "name": " ".join(line.group("name").split()),
                    "notional_usd": notional,
                    "contracts": contracts,
                    "price": notional / (contracts * size),
                    "unit": "usd_day" if product == "capesize_5tc" else "usd_t",
                    "form": filing["form"],
                    "filed": filing["filed"],
                    "accession": filing["accession"],
                    "url": filing["url"],
                }
            )
    return rows


def fetch_and_parse(fetcher: Fetcher, refetch_list: bool = False) -> list[dict[str, Any]]:
    """Every mark of every filing, one per fund, product, date and contract month.

    A schedule date printed again in a later filing keeps its first filing; a
    different later price is recorded as "restated". Within one schedule, a
    contract month printed twice for the same product keeps the line with more
    contracts and records the other: the 10-Q for 31 March 2024 labels BWET's
    TD20 lines (5 contracts, 10 percent of the fund) "Middle East Gulf to China"
    at USD 17.43 to 18.53 a tonne beside its 65 TD3C contracts.
    """
    marks: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for filing in filings(fetcher, refetch=refetch_list):
        path = fetcher.get(filing["url"], source=SOURCE, licence=LICENCE)
        seen_here: dict[tuple[str, str, str, str], dict[str, Any]] = {}
        for row in parse_filing(path, filing):
            key = (row["fund"], row["product"], row["as_of"], row["contract_month"])
            if key in seen_here:
                kept = seen_here[key]
                loser = row if row["contracts"] <= kept["contracts"] else kept
                winner = kept if loser is row else row
                winner.setdefault("duplicate_lines", []).append(
                    {"contracts": loser["contracts"], "price": loser["price"], "note": "same label, fewer contracts"}
                )
                seen_here[key] = winner
                continue
            seen_here[key] = row
        for key, row in seen_here.items():
            if key in marks:
                previous = marks[key]
                if abs(previous["price"] - row["price"]) > 1e-9:
                    previous.setdefault("restated", []).append({"filed": row["filed"], "price": row["price"]})
                continue
            marks[key] = row
    return sorted(marks.values(), key=lambda r: (r["fund"], r["as_of"], r["contract_month"]))
