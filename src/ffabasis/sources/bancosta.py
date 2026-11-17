"""Banchero Costa's weekly market report, as republished by Hellenic Shipping News.

Each issue (a PDF of about 16 pages) prints three tables the study reads:

* the Capesize spot table of the chartering section: "BCI TC Average"
  (USD a day), C3 Tubarao to Qingdao and C5 West Australia to Qingdao (USD a
  tonne), for two Fridays (the week's and the one before);
* "Dry bulk FFA assessments" (derivatives section), Capesize block: the
  current month, the next months and three or four quarters, in USD a day,
  for two Mondays, with week on week change and a premium column;
* the bunker table (commodities section): IFO380, VLSFO and LSMGO at
  Rotterdam, Fujairah and Singapore, USD a tonne, for two Fridays, followed
  by the HSFO to VLSFO spread, which the parser uses as a check.

Terms: Banchero Costa's reports are its copyright. The extracted levels stay
in the gitignored cache (data/cache/bancosta_*.json); the repository commits
derived statistics and a few individually cited dated points only
(data/AUDIT.md, data policy).

Text is taken with pdfplumber's extract_text. A row is recognised by its
label at the start of a line followed by its unit; the chart axis labels that
share a line come after the figures and are ignored. Rotterdam's "tt"
ligature is extracted as "=", "<" or "tt" depending on the issue.
"""

from __future__ import annotations

import datetime as dt
import re
from pathlib import Path
from typing import Any

import pdfplumber

MONTHS = {
    m: i + 1 for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])
}
FULL_MONTHS = {
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
NUMBER = r"(-?[\d,]+(?:\.\d+)?)"
CELL = r"(-?[\d,]+(?:\.\d+)?|-|n/a|N/A)"

HEADER_RE = re.compile(r"Week\s+(\d{1,2})\s*/\s*(\d{4})\s*\(([^)]*)\)")
DATE_PAIR_RE = re.compile(r"(\d{1,2})-([A-Z][a-z]{2})\s+(\d{1,2})-([A-Z][a-z]{2})")
SPOT_ROWS = {
    "bci_tc_avg": re.compile(
        r"^BCI\s*(?:182\s*)?TC\s*Average\s+usd/day\s+" + CELL + r"\s+" + CELL + r"(?:\s+([+-]?[\d.]+%))?", re.M
    ),
    "c3": re.compile(
        r"^C3\s+Tubarao\s*-\s*Qingdao\s+usd/t\s+" + CELL + r"\s+" + CELL + r"(?:\s+([+-]?[\d.]+%))?", re.M
    ),
    "c5": re.compile(
        r"^C5\s+W\.?\s*Aust\.?\s*-\s*Qingdao\s+usd/t\s+" + CELL + r"\s+" + CELL + r"(?:\s+([+-]?[\d.]+%))?", re.M
    ),
}
TENOR_RE = re.compile(
    r"^(?:(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2})|Q([1-4])\s*(\d{2})|Cal\s*(\d{2}))\s+usd/day\s+"
    + CELL
    + r"(?:\s+"
    + CELL
    + r")?(?:\s+([+-]?[\d.]+%|-))?(?:\s+([+-]?[\d.]+%|-))?",
    re.M,
)
#: Unanchored and tolerant of OCR noise ("usdit", "481.3."): a hub name, its unit, then two figures.
BUNKER_ROW_RE = re.compile(
    r"(Ro\S{0,3}erdam|Fujairah|Singapore)\s+usd\S?t\s+(-?[\d,]+(?:\.\d+)?)\.?\s+(-?[\d,]+(?:\.\d+)?)", re.M
)


def number(text: str | None) -> float | None:
    if text is None or text in ("-", "n/a", "N/A"):
        return None
    return float(text.replace(",", ""))


def page_texts(path: Path) -> list[str]:
    with pdfplumber.open(path) as pdf:
        return [page.extract_text() or "" for page in pdf.pages]


def parse_header(first_page: str) -> dict[str, Any]:
    """Week, year and the printed week range from the cover."""
    flat = " ".join(first_page.split())
    match = HEADER_RE.search(flat)
    if not match:
        raise ValueError("no 'Week NN/YYYY (...)' header on the cover")
    return {"week": int(match.group(1)), "year": int(match.group(2)), "range_text": match.group(3).strip()}


def anchor_day(year: int, week: int, range_text: str) -> dt.date:
    """A day inside the issue's week: the end of the printed range when it parses, else the ISO Friday."""
    parts = re.findall(r"(\d{1,2})\s+([A-Z][a-z]+)", range_text)
    if parts:
        day, month_name = parts[-1]
        month = FULL_MONTHS.get(month_name) or MONTHS.get(month_name[:3])
        if month:
            candidate = dt.date(year, month, int(day))
            # A week 1 range can end in January of the issue year or a week 52 one start in December.
            iso_friday = dt.date.fromisocalendar(year, min(week, 52), 5)
            for shift in (0, 1, -1):
                try:
                    shifted = candidate.replace(year=year + shift)
                except ValueError:
                    continue
                if abs((shifted - iso_friday).days) <= 20:
                    return shifted
            return candidate
    return dt.date.fromisocalendar(year, min(week, 52), 5)


def resolve(day: int, mon: str, near: dt.date) -> dt.date:
    """A 'd-Mon' date without its year: the year that puts it nearest the issue's week."""
    month = MONTHS[mon]
    best = None
    for year in (near.year - 1, near.year, near.year + 1):
        try:
            candidate = dt.date(year, month, day)
        except ValueError:
            continue
        if best is None or abs((candidate - near).days) < abs((best - near).days):
            best = candidate
    if best is None:
        raise ValueError(f"impossible date {day}-{mon}")
    return best


def _date_pair(line: str, near: dt.date) -> tuple[str, str]:
    match = DATE_PAIR_RE.search(line)
    if not match:
        raise ValueError(f"no date pair in {line!r}")
    first = resolve(int(match.group(1)), match.group(2), near)
    second = resolve(int(match.group(3)), match.group(4), near)
    return first.isoformat(), second.isoformat()


def _block(text: str, start_pattern: str, end_patterns: tuple[str, ...]) -> str | None:
    start = re.search(start_pattern, text)
    if not start:
        return None
    rest = text[start.start() :]
    end = len(rest)
    for pattern in end_patterns:
        found = re.search(pattern, rest[10:])
        if found:
            end = min(end, found.start() + 10)
    return rest[:end]


def parse_spot(text: str, near: dt.date) -> dict[str, Any] | None:
    block = _block(text, r"CAPESIZE\s+Unit\s+\d{1,2}-[A-Z][a-z]{2}", (r"\n1-YR TC|Newcastlemax|PANAMAX",))
    if block is None or "BCI" not in block:
        return None
    current, previous = _date_pair(block.splitlines()[0], near)
    labelled_182 = re.search(r"BCI\s*182\s*TC\s*Average", block) is not None
    out: dict[str, Any] = {
        "assessed_on": current,
        "previous_on": previous,
        "basket_label": "BCI 182" if labelled_182 else "BCI",
    }
    for key, pattern in SPOT_ROWS.items():
        match = pattern.search(block)
        out[key] = (
            None
            if not match
            else {"current": number(match.group(1)), "previous": number(match.group(2)), "wow_printed": match.group(3)}
        )
    return out


def parse_ffa(text: str, near: dt.date) -> dict[str, Any] | None:
    """The Capesize block of the FFA page: tenor, current, previous, week on week and premium as printed."""
    if "FFA" not in text.upper() or "ASSESSMENTS" not in text.upper():
        return None
    block = _block(text, r"CAPESIZE(?:\s*\(\d+k\))?\s+Unit\s+\d{1,2}-[A-Z][a-z]{2}", (r"PANAMAX", r"SUPRAMAX"))
    if block is None:
        return None
    label = re.match(r"CAPESIZE(?:\s*\((\d+)k\))?", block)
    first_line = re.search(r"Unit\s+\d{1,2}-[A-Z][a-z]{2}\s+\d{1,2}-[A-Z][a-z]{2}", block)
    current, previous = _date_pair(first_line.group(0) if first_line else block.splitlines()[0], near)
    tenors = []
    for match in TENOR_RE.finditer(block):
        mon, yy, q, qyy, cal = match.group(1), match.group(2), match.group(3), match.group(4), match.group(5)
        if mon:
            tenor = {"kind": "month", "period": "20%s-%02d" % (yy, MONTHS[mon]), "label": f"{mon}-{yy}"}
        elif q:
            tenor = {"kind": "quarter", "period": f"20{qyy}-Q{q}", "label": f"Q{q} {qyy}"}
        else:
            tenor = {"kind": "calendar", "period": f"20{cal}", "label": f"Cal {cal}"}
        tenor["current"] = number(match.group(6))
        tenor["previous"] = number(match.group(7))
        tenor["wow_printed"] = match.group(8)
        tenor["premium_printed"] = match.group(9)
        tenors.append(tenor)
    if not tenors:
        return None
    printed_basket = int(label.group(1)) * 1000 if label and label.group(1) else None
    return {"assessed_on": current, "previous_on": previous, "tenors": tenors, "basket_label_t": printed_basket}


def parse_bunkers(text: str, near: dt.date) -> dict[str, Any] | None:
    block = _block(text, r"BUNKER[^\n]*?Unit\s+\d{1,2}-[A-Z][a-z]{2}", (r"OIL\s*&\s*GAS\s+Unit",))
    if block is None:
        return None
    current, previous = _date_pair(block.splitlines()[0], near)
    rows = [(m.group(1), number(m.group(2)), number(m.group(3))) for m in BUNKER_ROW_RE.finditer(block)]
    hubs = ("rotterdam", "fujairah", "singapore")
    grades = ("ifo380", "vlsfo", "lsmgo", "spread")
    out: dict[str, Any] = {"assessed_on": current, "previous_on": previous, "rows": len(rows), "prices": {}}
    if len(rows) < 9:
        out["problem"] = f"{len(rows)} bunker rows, expected 12"
        return out
    for index, (name, cur, prev) in enumerate(rows[:12]):
        hub = hubs[index % 3]
        if not name.lower().startswith(hub[:2]):
            out["problem"] = f"row {index} reads {name}, expected {hub}"
            return out
        grade = grades[index // 3]
        out["prices"].setdefault(grade, {})[hub] = {"current": cur, "previous": prev}
    # The fourth block prints VLSFO less IFO380: check the grades were read in order.
    checks = []
    if "spread" in out["prices"]:
        for hub in hubs:
            for column in ("current", "previous"):
                v = out["prices"]["vlsfo"][hub][column]
                h = out["prices"]["ifo380"][hub][column]
                s = out["prices"]["spread"][hub][column]
                if None not in (v, h, s):
                    checks.append(abs((v - h) - s) <= 0.11)
    out["spread_check"] = all(checks) if checks else None
    return out


def wow_consistent(row: dict[str, Any] | None) -> bool:
    """Whether a row's two figures reproduce its printed week-on-week change (to 0.15 points, either sign)."""
    if not row or row.get("previous") in (None, 0) or row.get("current") is None or not row.get("wow_printed"):
        return False
    try:
        value = float(row["wow_printed"].replace("%", "").replace("+", ""))
    except ValueError:
        return False
    implied = 100.0 * (row["current"] / row["previous"] - 1.0)
    return min(abs(implied - value), abs(implied + value)) <= 0.15


def parse_issue(path: Path) -> dict[str, Any]:
    """Every table the study reads from one issue, with what could not be read."""
    texts = page_texts(path)
    header = parse_header(texts[0])
    near = anchor_day(header["year"], header["week"], header["range_text"])
    issue: dict[str, Any] = dict(header, near=near.isoformat(), pages=len(texts), spot=None, ffa=None, bunkers=None)
    for index, text in enumerate(texts):
        if issue["spot"] is None and re.search(r"BCI\s*(?:182\s*)?TC\s*Average", text):
            issue["spot"] = parse_spot(text, near)
            if issue["spot"] is not None:
                issue["spot"]["page"] = index + 1
        if issue["ffa"] is None and "FFA" in text.upper() and "ASSESSMENTS" in text.upper():
            issue["ffa"] = parse_ffa(text, near)
            if issue["ffa"] is not None:
                issue["ffa"]["page"] = index + 1
        if issue["bunkers"] is None and re.search(r"BUNKER[^\n]*?Unit\s+\d{1,2}-[A-Z][a-z]{2}", text):
            issue["bunkers"] = parse_bunkers(text, near)
            if issue["bunkers"] is not None:
                issue["bunkers"]["page"] = index + 1
    if any(issue[k] is None for k in ("spot", "ffa", "bunkers")):
        _ocr_fallback(path, texts, near, issue)
    return issue


def _ocr_fallback(path: Path, texts: list[str], near: dt.date, issue: dict[str, Any]) -> None:
    """Read by OCR the tables whose text could not be extracted (see ffabasis.sources.ocr)."""
    from . import ocr

    if not ocr.available():
        issue["ocr"] = "unavailable"
        return
    issue["ocr"] = []
    if issue["ffa"] is None:
        for index, text in enumerate(texts):
            if "FFA ASSESSMENTS" in text.upper():
                body = ocr.page_text(path, index, right=0.6)
                parsed = parse_ffa("DRY BULK FFA ASSESSMENTS\n" + body, near)
                if parsed is not None:
                    parsed.update(page=index + 1, method="ocr")
                    issue["ffa"] = parsed
                    issue["ocr"].append("ffa")
                break
    if issue["spot"] is None:
        for index, text in enumerate(texts[:9]):
            if "CAPESIZE" in text.upper() and index >= 2:
                body = ocr.page_text(path, index, right=0.62, top=0.4)
                parsed = parse_spot(body, near)
                if parsed is not None:
                    # An OCR row is kept only when it reproduces its own week-on-week change.
                    for key in ("bci_tc_avg", "c3", "c5"):
                        if not wow_consistent(parsed.get(key)):
                            parsed[key] = None
                    parsed.update(page=index + 1, method="ocr")
                    issue["spot"] = parsed
                    issue["ocr"].append("spot")
                    break
    if issue["bunkers"] is None:
        for index, text in enumerate(texts):
            if "COMMODITY PRICES" in text.upper():
                body = ocr.page_text(path, index, right=0.62, bottom=0.55)
                parsed = parse_bunkers(body, near)
                if parsed is not None:
                    parsed.update(page=index + 1, method="ocr")
                    issue["bunkers"] = parsed
                    issue["ocr"].append("bunkers")
                break
