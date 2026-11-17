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

When a day's prints disagree, the value most independent sources support
wins: each print supports its own value, and each print of the next
publication day supports the level its change implies. Sources are counted by
family (handybulk, Reuters in any republication, Banchero Costa); a tie goes
to a direct print over an implied level, then to the value nearest the median
of the other days within a week, then to the order in PRIORITY. A print that
loses implies nothing for the day before it. (handybulk's March
2024 page carries the 4 March 2025 report under "5-March-2024", and its
December 2025 page dates the first week's reports a day late; Reuters, Banchero
Costa and the chain outvote both.)

A month's settlement is the plain average over every publication day
(ffabasis.engine.settlement_average). It is computed only for a complete
month, one with a value for every expected day; an incomplete month keeps its
coverage and the average of what was observed, labelled partial, which the
study uses only in the robustness that admits all months.
"""

from __future__ import annotations

import datetime as dt
import statistics
from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from . import calendar, engine

#: When two prints of a day disagree, the order of trust (the chain check reports every disagreement).
PRIORITY = ("handybulk.com", "Reuters", "Banchero Costa")
TOLERANCE_USD_DAY = 1.0
#: A tie between source families goes to the value nearest the median of the other days this close.
NEIGHBOUR_DAYS = 7


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


def resolve_baskets(observations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Give a 2026 print with no basket the basket its own change ties it to.

    A print's level less its change is the previous publication day's level on
    the same basket. Where that equals, to the dollar, a known print of the
    previous day on one basket, the print is on that basket (handybulk left out
    the BCI points from 21 to 27 April 2026; the chain from 20 April tags them).
    Walking forward in date order carries a run of untagged days along.
    """
    known: dict[str, dict[int, float]] = defaultdict(dict)
    for obs in observations:
        if obs.get("basket_t") is not None:
            known[obs["date"]][obs["basket_t"]] = float(obs["c5tc_usd_day"])
    out = []
    for obs in sorted(observations, key=lambda o: o["date"]):
        untagged = obs.get("basket_t") is None and obs.get("change_usd_day") is not None
        if untagged and obs["date"] >= engine.BASKET_182_FROM:
            previous = calendar.previous_publication_day(obs["date"])
            implied = float(obs["c5tc_usd_day"]) - float(obs["change_usd_day"])
            for basket, level in known.get(previous, {}).items():
                if abs(level - implied) <= TOLERANCE_USD_DAY:
                    obs = dict(obs, basket_t=basket, basket_how="carried by the day's change from the previous print")
                    known[obs["date"]][basket] = float(obs["c5tc_usd_day"])
                    break
        out.append(obs)
    return out


def pool(observations: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """One record a day: the 180 t value chosen, every print beside it, conflicts and chain checks.

    observations: dicts with date, c5tc_usd_day, basket_t, source, url and,
    for daily reports, change_usd_day.
    """
    by_day: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for obs in resolve_baskets(list(observations)):
        if obs.get("basket_t") is None or not calendar.is_publication_day(obs["date"]):
            continue
        value = to_180(obs["c5tc_usd_day"], obs["basket_t"], obs["date"])
        if value is None:
            continue
        by_day[obs["date"]].append(dict(obs, value_180=value, family=_family(obs.get("source", ""))))

    # The level each print's change implies for the previous publication day: support for that day's value.
    support_from_next: dict[str, list[tuple[float, str]]] = defaultdict(list)
    for day, prints in by_day.items():
        previous = calendar.previous_publication_day(day)
        for p in prints:
            if p.get("change_usd_day") is not None:
                support_from_next[previous].append((p["value_180"] - p["change_usd_day"], p["family"]))

    days: dict[str, dict[str, Any]] = {}
    choices = {day: _vote(prints, support_from_next.get(day, [])) for day, prints in by_day.items()}
    # A tie between families goes to the value nearest the median of the other days within a week.
    settled = {d: c[0] for d, c in choices.items() if len(c[1]) < 2}
    for day, (_value, tied) in choices.items():
        if len(tied) < 2:
            continue
        here = dt.date.fromisoformat(day)
        near = [
            v for d, v in settled.items() if d != day and abs((dt.date.fromisoformat(d) - here).days) <= NEIGHBOUR_DAYS
        ]
        if near:
            middle = statistics.median(near)
            choices[day] = (min(tied, key=lambda v: abs(v - middle)), tied)
    for day, prints in by_day.items():
        prints.sort(key=lambda p: PRIORITY.index(p["family"]))
        chosen = choices[day][0]
        conflicts = [p for p in prints if abs(p["value_180"] - chosen) > TOLERANCE_USD_DAY]
        for p in prints:
            p["outvoted"] = abs(p["value_180"] - chosen) > TOLERANCE_USD_DAY
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
            if change is None or p.get("outvoted"):
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


def _vote(prints: list[dict[str, Any]], implied: list[tuple[float, str]]) -> tuple[float, list[float]]:
    """The value most source families support (prints and the next day's implied levels), and the values that
    tie with it on that count (empty when one value leads); a tie is settled by the neighbouring days."""
    groups: list[dict[str, Any]] = []
    for value, family, direct in [(p["value_180"], p["family"], True) for p in prints] + [
        (v, f, False) for v, f in implied
    ]:
        group = next((g for g in groups if abs(g["value"] - value) <= TOLERANCE_USD_DAY), None)
        if group is None:
            group = {"value": value, "families": set(), "direct": False, "best": len(PRIORITY)}
            groups.append(group)
        group["families"].add(family)
        if direct:
            group["direct"] = True
            group["value"] = value if group["best"] == len(PRIORITY) else group["value"]
            group["best"] = min(group["best"], PRIORITY.index(family))
    groups = [g for g in groups if g["direct"]] or groups
    best = max(groups, key=lambda g: (len(g["families"]), g["direct"], -g["best"]))
    tied = [float(g["value"]) for g in groups if len(g["families"]) == len(best["families"])]
    return float(best["value"]), tied if len(tied) > 1 else []


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
