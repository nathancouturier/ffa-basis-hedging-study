"""The weekly panel: Banchero Costa's curves, Friday spot, route rates and bunkers, with their quality flags.

Built from the cached reports by build() into data/cache/panel.json (ignored by
git: these are licensed levels). Every value keeps the issue it was printed in
and the page; every curve keeps both of its prints when a later issue prints
the same date again.

Pre-registered rules (docs/methodology.md):

* First print. A curve dated D is the one printed in the issue whose current
  column is D. The next issue's previous-week column for D is a reprint (in
  fact a re-assessment: it differs by a median 3.1 percent), used to check it
  and as the "latest print" of the sensitivity; a gap over 10 percent on a
  tenor is flagged.
* SEC check. Where a quarter-end SEC mark (Amplify, BDRY) exists within three
  calendar days of D for a month printed on the curve, the two are compared
  on the same basket; a gap over 10 percent is flagged.
* One-week move. A tenor whose week-on-week change differs from the median
  change of the curve's other tenors by more than 15 percentage points is
  flagged (the Q2 23 contract of 11 July 2022: -25.7 percent against about -2).
* Repeated page. A page whose every tenor shared with the issue before it (at
  least three) carries the identical figure was not updated: Banchero Costa
  reprinted the previous assessment under new dates (weeks 28 and 29 of 2025
  repeat 30 June 2025, whose printed premium matches that day's spot). Such a
  curve is flagged and not used, and its previous-week column is not a reprint.
* Stale month labels (added after a review). A page that prints a month
  before its own date carries the previous layout's labels: if, read one month
  on, each quarter whose three months are printed equals their average to the
  dollar (as on every other page), the months are read one month on (week 48
  of 2024, dated 2 December 2024, prints the December to May prices as "Nov-24"
  to "Apr-25"); otherwise its months are left out and its quarters kept.
  Flagged either way.
* Copied previous column (added after a review). A previous-week column whose
  figures sit in the earlier page under other tenors (at least three, none
  under its own) copies that page into rows relabelled for the new date (1
  July 2024 repeats 24 June 2024 one row down): flagged, not a reprint, and no
  one-week move is measured against it.
* Flags never change a value, except the stale-label rule, which says what a
  page's rows are. The analysis reports its results on first
  prints and, as a sensitivity, with flagged prints replaced by the reprint
  where one exists.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from statistics import median
from typing import Any

from . import engine
from .sources import bancosta

#: The previous-week column differs from the first print by a median 3.1 percent (90th percentile 8.6
#: percent, 1,000+ tenor pairs, data/AUDIT.md): it is a later re-assessment, not a copy. A gap over 10
#: percent is flagged as a disagreement worth reading.
REPRINT_TOLERANCE = 0.10
SEC_TOLERANCE = 0.10
MOVE_TOLERANCE_PP = 15.0
SEC_WINDOW_DAYS = 3
#: A page is a repeat of the one before when at least this many shared tenors carry identical figures.
REPEAT_MIN_TENORS = 3


def issue_key(year: int, week: int) -> str:
    return "%04d-W%02d" % (year, week)


def parse_all(raw_dir: Path, manifest: dict[str, dict[str, Any]], cache_path: Path) -> list[dict[str, Any]]:
    """Every cached Banchero Costa issue, parsed once per file hash."""
    cache: dict[str, Any] = {}
    if cache_path.exists():
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
        # Entries of an older parser version are dropped: the cache only ever holds what this code reads.
        cache = {k: v for k, v in cache.items() if k.endswith(f":v{bancosta.PARSER_VERSION}")}
    issues = []
    for entry in manifest.values():
        if not re.search(r"(?i)bancosta[-_ ]weekly", entry["url"]) or not entry["url"].lower().endswith(".pdf"):
            continue
        path = raw_dir / entry["path"]
        if not path.exists():
            continue
        digest = entry["sha256"]
        key = f"{digest}:v{bancosta.PARSER_VERSION}"
        if key not in cache:
            try:
                parsed = bancosta.parse_issue(path)
            except Exception as error:  # a broken file is reported, never silently dropped
                parsed = {"error": str(error)}
            cache[key] = parsed
        parsed = dict(cache[key])
        parsed.update(url=entry["url"], sha256=digest, retrieved_at=entry["retrieved_at"])
        issues.append(parsed)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache, indent=0, sort_keys=True), encoding="utf-8")
    return issues


def choose_issues(issues: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """One issue per report week: the first uploaded; the others kept as duplicates for the record."""
    by_week: dict[str, list[dict[str, Any]]] = {}
    for issue in issues:
        if "error" in issue or "week" not in issue:
            continue
        by_week.setdefault(issue_key(issue["year"], issue["week"]), []).append(issue)
    chosen, duplicates = [], []
    for _week, group in sorted(by_week.items()):
        group.sort(key=lambda i: (i["retrieved_at"], i["url"]))
        # The upload without a "-1" or "_compressed" suffix is the first; HSN appends -1 to a re-upload.
        group.sort(key=lambda i: (bool(re.search(r"-\d\.pdf$", i["url"])), i["url"]))
        chosen.append(group[0])
        duplicates.extend(group[1:])
    return chosen, duplicates


def curves(chosen: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Every dated Capesize curve: first print, reprint and the flags of the rules above."""
    out: dict[str, dict[str, Any]] = {}
    last: tuple[str, dict[str, float]] | None = None
    for issue in chosen:
        ffa = issue.get("ffa")
        if not ffa:
            continue
        date = ffa["assessed_on"]
        ocr = ffa.get("method") == "ocr"
        tenors = {
            t["period"]: {
                "kind": t["kind"],
                "label": t["label"],
                "usd_day": t["current"],
                "wow_printed": t["wow_printed"],
                "premium_printed": t["premium_printed"],
            }
            for t in ffa["tenors"]
            if t["current"] is not None and (not ocr or _wow_consistent(t))
        }
        tenors, relabel, stale = stale_month_labels(date, tenors)
        record = out.setdefault(date, {"assessed_on": date, "tenors": {}, "flags": []})
        if stale is not None and not record["tenors"]:
            key = issue_key(issue["year"], issue["week"])
            record["flags"].append({"rule": "stale_month_labels", "issue": key, **stale})
        printed = {p: v["usd_day"] for p, v in tenors.items()}
        repeated_from = None
        if last is not None and last[0] != date:
            shared = [p for p in printed if p in last[1]]
            if len(shared) >= REPEAT_MIN_TENORS and all(printed[p] == last[1][p] for p in shared):
                repeated_from = last[0]
        if printed:
            last = (date, printed)
        if repeated_from is not None:
            record["flags"].append(
                {"rule": "repeated_page", "issue": issue_key(issue["year"], issue["week"]), "same_as": repeated_from}
            )
            record["repeated_page"] = {"issue": issue_key(issue["year"], issue["week"]), "url": issue["url"]}
            continue
        if record["tenors"]:
            record["flags"].append({"rule": "second_first_print", "issue": issue_key(issue["year"], issue["week"])})
            continue
        record.update(
            tenors=tenors,
            issue=issue_key(issue["year"], issue["week"]),
            url=issue["url"],
            page=ffa.get("page"),
            previous_on=ffa["previous_on"],
        )
        # The previous-week column of this issue reprints the curve of previous_on.
        reprint = {
            relabel.get(t["period"], t["period"]): t["previous"]
            for t in ffa["tenors"]
            if t["previous"] is not None and relabel.get(t["period"], t["period"]) is not None
        }
        prior = out.setdefault(ffa["previous_on"], {"assessed_on": ffa["previous_on"], "tenors": {}, "flags": []})
        if rolled_copy(reprint, {p: v["usd_day"] for p, v in prior["tenors"].items()}):
            # The previous-week column copies the earlier page's figures into rows relabelled for the new
            # date: not a re-assessment, so neither a reprint nor a base for one-week moves.
            prior["flags"].append({"rule": "previous_column_copied", "issue": issue_key(issue["year"], issue["week"])})
            continue
        prior.setdefault("reprints", []).append(
            {"issue": issue_key(issue["year"], issue["week"]), "url": issue["url"], "tenors": reprint}
        )
    for record in out.values():
        _reprint_flags(record)
        _move_flags(record, out)
    return dict(sorted(out.items()))


def rolled_copy(column: dict[str, float], first: dict[str, float], at_least: int = 3) -> bool:
    """A previous-week column that repeats the earlier page's figures under other rows: at least three of its
    values sit in that page under another tenor, and none under its own."""
    values = set(first.values())
    same = sum(1 for p, v in column.items() if first.get(p) == v)
    moved = sum(1 for p, v in column.items() if v in values and first.get(p) != v)
    return moved >= at_least and same == 0


#: A printed quarter matches the average of its three months to within this many dollars a day.
QUARTER_CHECK_USD = 2.0


def stale_month_labels(
    date: str, tenors: dict[str, dict[str, Any]]
) -> tuple[dict[str, dict[str, Any]], dict[str, str | None], dict[str, Any] | None]:
    """A page that prints a month before its own date carries the previous layout's month labels.

    Banchero Costa's quarters are the average of their months to the dollar. If moving every month label one
    month on makes each quarter whose three months are printed equal their average (at least one, none against),
    the months are read one month on; otherwise the page's months are left out and its quarters kept. Returns
    the tenors, the period map applied to the page's other columns (None: dropped) and the flag, or None.
    """
    months = {p: v for p, v in tenors.items() if v["kind"] == "month"}
    if not any(p < date[:7] for p in months):
        return tenors, {}, None
    shifted = {engine.add_months(p, 1): v for p, v in months.items()}
    quarters = {p: v for p, v in tenors.items() if v["kind"] == "quarter"}
    checked, against = [], []
    for q, v in quarters.items():
        parts = engine.quarter_months(q)
        if all(m in shifted for m in parts):
            mean = sum(shifted[m]["usd_day"] for m in parts) / 3.0
            (checked if abs(mean - v["usd_day"]) <= QUARTER_CHECK_USD else against).append(q)
    if checked and not against:
        relabel = {p: engine.add_months(p, 1) for p in months}
        out = {relabel[p]: dict(v, label_printed=v["label"]) for p, v in months.items()} | quarters
        return out, relabel, {"months_read_one_month_on": len(months), "quarters_checked": sorted(checked)}
    return quarters, dict.fromkeys(months), {"months_left_out": len(months)}


def _wow_consistent(tenor: dict[str, Any]) -> bool:
    """An OCR row is kept only if its two figures reproduce its printed week-on-week change (to 0.15 points)."""
    printed = tenor.get("wow_printed")
    if tenor.get("previous") in (None, 0) or not printed or printed == "-":
        return False
    try:
        value = float(printed.replace("%", "").replace("+", ""))
    except ValueError:
        return False
    implied = 100.0 * (tenor["current"] / tenor["previous"] - 1.0)
    # OCR sometimes reads the sign "+" as "4": accept the printed magnitude with either sign.
    return min(abs(implied - value), abs(implied + value), abs(abs(implied) - abs(value) % 10)) <= 0.15


def _reprint_flags(record: dict[str, Any]) -> None:
    for reprint in record.get("reprints", []):
        for period, value in reprint["tenors"].items():
            first = record["tenors"].get(period, {}).get("usd_day")
            if first is None or value is None or first == 0:
                continue
            gap = value / first - 1.0
            if abs(gap) > REPRINT_TOLERANCE:
                record["flags"].append(
                    {
                        "rule": "reprint",
                        "period": period,
                        "first": first,
                        "reprint": value,
                        "gap": gap,
                        "issue": reprint["issue"],
                    }
                )


def _move_flags(record: dict[str, Any], all_curves: dict[str, dict[str, Any]]) -> None:
    """Week-on-week moves against the same tenor on the reprinted previous curve of the same issue."""
    reprinted_prev = None
    prev_date = record.get("previous_on")
    if prev_date and prev_date in all_curves:
        for reprint in all_curves[prev_date].get("reprints", []):
            if reprint["issue"] == record.get("issue"):
                reprinted_prev = reprint["tenors"]
    if not reprinted_prev:
        return
    moves = {}
    for period, tenor in record["tenors"].items():
        before = reprinted_prev.get(period)
        if before:
            moves[period] = 100.0 * (tenor["usd_day"] / before - 1.0)
    for period, move in moves.items():
        others = [m for p, m in moves.items() if p != period]
        if len(others) < 3:
            continue
        typical = median(others)
        if abs(move - typical) > MOVE_TOLERANCE_PP:
            record["flags"].append(
                {"rule": "one_week_move", "period": period, "move_pct": move, "median_other_pct": typical}
            )


def sec_check(
    curve_map: dict[str, dict[str, Any]], marks: list[dict[str, Any]], basket_of_curve
) -> list[dict[str, Any]]:
    """Each curve within three days of a BDRY quarter-end mark, tenor by tenor, on the 180 t basket."""
    import datetime as dt

    rows = []
    for mark in marks:
        if mark["fund"] != "BDRY" or mark["product"] != "capesize_5tc":
            continue
        as_of = dt.date.fromisoformat(mark["as_of"])
        for date, curve in curve_map.items():
            gap_days = (dt.date.fromisoformat(date) - as_of).days
            if abs(gap_days) > SEC_WINDOW_DAYS or mark["contract_month"] not in curve["tenors"]:
                continue
            value = curve["tenors"][mark["contract_month"]]["usd_day"]
            basket = basket_of_curve(date)
            value_180 = value - engine.C5TC_180_DIFFERENTIAL_USD_DAY if basket == 182000 else value
            gap = value_180 / mark["price"] - 1.0
            rows.append(
                {
                    "curve": date,
                    "sec_as_of": mark["as_of"],
                    "days_apart": gap_days,
                    "contract_month": mark["contract_month"],
                    "curve_usd_day_180": value_180,
                    "curve_basket_t": basket,
                    "sec_usd_day_180": mark["price"],
                    "gap": gap,
                    "flag": abs(gap) > SEC_TOLERANCE,
                    "sec_url": mark["url"],
                }
            )
    return rows


def fingerprint(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True).encode()).hexdigest()[:16]
