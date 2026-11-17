"""The daily Capesize 5TC: every public print of it, pooled, checked and averaged by month.

Sources (data/AUDIT.md): handybulk.com's daily paragraphs; Reuters' daily dry
bulk report as republished by Hellenic Shipping News, Cyprus Shipping News and
MarineLink; and the two Friday values Banchero Costa's weekly report prints.

Each print is an observation of one day's 5TC on one basket. From 2 January
2026 the two baskets differ by the fixed USD 3,503 (GMB v8.8 page 77), so a
print on either gives both; before that date only the 180,000 t basket
settled futures, and a 182,000 t print (the trial routes of 2025) is kept out.

A Reuters or handybulk print also gives its change from the previous
publication day. Where that day has no print, its level is implied (level
minus change), marked "implied", and used only when the previous publication
day is unambiguous on the London calendar. Where it has one, the two must
agree: the chain check, which confirms both the prints and the calendar.

A month's settlement is the plain average over every publication day
(ffabasis.engine.settlement_average). It is computed only for a complete
month, one with a value for every expected day; an incomplete month keeps its
coverage and the average of what was observed, labelled partial, which the
study uses only in the robustness that admits all months.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from . import calendar, engine

#: When two prints of a day disagree, the order of trust (the chain check reports every disagreement).
PRIORITY = ("handybulk.com", "Reuters", "Banchero Costa")
TOLERANCE_USD_DAY = 1.0


def _family(source: str) -> str:
    if source.startswith("handybulk"):
        return "handybulk.com"
    if source.startswith("Banchero"):
        return "Banchero Costa"
    return "Reuters"


def to_180(value: float, basket: int, day: str) -> float | None:
    """A print on the 180,000 t basket, or None when the day's basket cannot settle 180 t futures."""
    if basket == 180000:
        return float(value)
    if basket == 182000 and day >= engine.BASKET_182_FROM:
        return engine.convert_basket(value, 182000, 180000, day)
    return None


def pool(observations: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """One record a day: the 180 t value chosen, every print beside it, conflicts and chain checks.

    observations: dicts with date, c5tc_usd_day, basket_t, source, url and,
    for daily reports, change_usd_day.
    """
    by_day: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for obs in observations:
        if obs.get("basket_t") is None or not calendar.is_publication_day(obs["date"]):
            continue
        value = to_180(obs["c5tc_usd_day"], obs["basket_t"], obs["date"])
        if value is None:
            continue
        by_day[obs["date"]].append(dict(obs, value_180=value, family=_family(obs.get("source", ""))))

    days: dict[str, dict[str, Any]] = {}
    for day, prints in by_day.items():
        prints.sort(key=lambda p: PRIORITY.index(p["family"]))
        chosen = prints[0]["value_180"]
        conflicts = [p for p in prints if abs(p["value_180"] - chosen) > TOLERANCE_USD_DAY]
        days[day] = {
            "date": day,
            "value_180": chosen,
            "kind": "printed",
            "families": sorted({p["family"] for p in prints}),
            "n_prints": len(prints),
            "conflicts": [
                {"source": p.get("source"), "value_180": p["value_180"], "url": p.get("url")} for p in conflicts
            ],
            "prints": prints,
        }

    # Implied previous days and the chain check.
    implied: dict[str, dict[str, Any]] = {}
    for day, record in sorted(days.items()):
        for p in record["prints"]:
            change = p.get("change_usd_day")
            if change is None:
                continue
            previous = calendar.previous_publication_day(day)
            level_prev = p["value_180"] - change
            if previous in days:
                ok = abs(days[previous]["value_180"] - level_prev) <= TOLERANCE_USD_DAY
                days[previous].setdefault("chain", []).append({"from": day, "ok": ok, "implied": level_prev})
            elif previous not in implied:
                implied[previous] = {
                    "date": previous,
                    "value_180": level_prev,
                    "kind": "implied",
                    "families": [p["family"]],
                    "n_prints": 0,
                    "conflicts": [],
                    "from": day,
                    "prints": [],
                }
    for day, record in implied.items():
        days.setdefault(day, record)
    return dict(sorted(days.items()))


def months(days: dict[str, dict[str, Any]], first: str, last: str) -> list[dict[str, Any]]:
    """Each month's coverage and, for a complete month, its settlement on both baskets."""
    out = []
    month = first
    while month <= last:
        expected = calendar.publication_days(month)
        values = [days[d]["value_180"] for d in expected if d in days]
        printed = sum(1 for d in expected if d in days and days[d]["kind"] == "printed")
        complete = len(values) == len(expected) and len(expected) > 0
        broken = [d for d in expected if d in days and any(not c["ok"] for c in days[d].get("chain", []))]
        conflicted = [d for d in expected if d in days and days[d]["conflicts"]]
        row: dict[str, Any] = {
            "month": month,
            "expected_days": len(expected),
            "observed_days": len(values),
            "printed_days": printed,
            "implied_days": len(values) - printed,
            "coverage": len(values) / len(expected) if expected else 0.0,
            "complete": complete,
            "chain_breaks": broken,
            "conflicts": conflicted,
            "settlement_180_usd_day": engine.settlement_average(values) if complete else None,
            "partial_average_180_usd_day": engine.settlement_average(values) if values else None,
        }
        if complete and month >= engine.BASKET_182_FROM[:7]:
            row["settlement_182_usd_day"] = row["settlement_180_usd_day"] + engine.C5TC_180_DIFFERENTIAL_USD_DAY
        out.append(row)
        month = engine.add_months(month, 1)
    return out
