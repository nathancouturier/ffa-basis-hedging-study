"""TD3C: the weekly record, Worldscale to dollars, quarter-end forward strips and the 2026 case studies.

Sources (data/AUDIT.md): the Baltic Exchange's weekly tanker report (TD3C and,
from its trial, TD34, in Worldscale points and as a round-trip TCE); Breakwave's
bi-weekly tanker report (TD3C in USD a tonne, the Breakwave Tanker Futures
Index); Amplify's SEC filings (BWET's TD3C futures at each quarter end, USD a
tonne).

Worldscale to dollars: USD a tonne = WS / 100 x flat rate, and flat rates are
the Worldscale Association's licensed figures. The study never states one it
did not observe: it pairs each Breakwave dollar print with the Baltic's
Worldscale print of the nearest assessment day (the gap in days is kept),
computes the implied flat rate, and adopts a year's median only if the pairs
of that year agree (interquartile range within 2 percent of the median, at
least four pairs). Worldscale amended Ras Tanura's port costs from 1 July
2025, so 2025 is tested in halves. A year without a consistent rate stays in
Worldscale and is said so.

Settlement estimates are the average of the month's weekly prints, labelled
approximate: TD3C futures settle on every publication day's assessment.
"""

from __future__ import annotations

import datetime as dt
import itertools
from collections import defaultdict
from typing import Any

import numpy as np

from . import engine

CARGO_T = 270000.0
#: A year's implied flat rate is adopted when the interquartile range of its pairs is within this share of
#: its median and it has at least MIN_PAIRS pairs.
FLAT_RATE_DISPERSION = 0.02
MIN_PAIRS = 4
MAX_GAP_DAYS = 4


def period_of(day: str) -> str:
    """The flat-rate period of a date: calendar years, with 2025 split at 1 July (Ras Tanura port costs)."""
    if day[:4] == "2025":
        return "2025-H1" if day < "2025-07-01" else "2025-H2"
    return day[:4]


def implied_flat_rates(weekly: dict[str, dict[str, Any]], breakwave: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Each Breakwave dollar print against the Baltic's Worldscale print of the nearest earlier assessment."""
    weeks = sorted(weekly)
    rows = []
    for bw in breakwave:
        if bw.get("td3c_usd_t") is None:
            continue
        day = dt.date.fromisoformat(bw["report_date"])
        best = None
        for week in weeks:
            w = weekly[week]
            assessed = dt.date.fromisoformat(week) - dt.timedelta(days=1 if w.get("assessed_day") == "Thursday" else 0)
            gap = (day - assessed).days
            if 0 <= gap <= MAX_GAP_DAYS and (best is None or gap < best[0]):
                best = (gap, week, assessed)
        if best is None:
            continue
        gap, week, assessed = best
        ws = weekly[week]["td3c_ws_points"]
        rows.append(
            {
                "breakwave_date": bw["report_date"],
                "baltic_date": assessed.isoformat(),
                "gap_days": gap,
                "usd_t": bw["td3c_usd_t"],
                "ws_points": ws,
                "implied_flat_usd_t": engine.implied_flat_rate(bw["td3c_usd_t"], ws),
                "period": period_of(bw["report_date"]),
                "breakwave_url": bw.get("url"),
                "baltic_url": weekly[week].get("url"),
            }
        )
    return rows


def flat_rate_by_period(pairs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    groups: dict[str, list[float]] = defaultdict(list)
    for p in pairs:
        groups[p["period"]].append(p["implied_flat_usd_t"])
    out = {}
    for period, values in sorted(groups.items()):
        arr = np.asarray(values)
        med = float(np.median(arr))
        q1, q3 = (float(x) for x in np.percentile(arr, [25, 75]))
        consistent = len(values) >= MIN_PAIRS and (q3 - q1) <= FLAT_RATE_DISPERSION * med
        out[period] = {
            "n": len(values),
            "median": med,
            "q1": q1,
            "q3": q3,
            "min": float(arr.min()),
            "max": float(arr.max()),
            "dispersion": (q3 - q1) / med,
            "consistent": consistent,
        }
    return out


def monthly_estimates(weekly: dict[str, dict[str, Any]], flat: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Each month's TD3C as the average of its weekly prints (approximate), in WS and, where a flat rate holds, USD/t."""
    groups: dict[str, list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    for week, row in weekly.items():
        groups[week[:7]].append((week, row))
    out = {}
    for month, rows in sorted(groups.items()):
        rows = [r for r in rows if not (month[5:7] == "12" and int(r[0][8:10]) > engine.TD3C_DECEMBER_LAST_DAY)]
        if not rows:
            continue
        ws = float(np.mean([r[1]["td3c_ws_points"] for r in rows]))
        rate = flat.get(period_of(month + "-15"))
        usd = engine.ws_to_usd_t(ws, rate["median"]) if rate and rate["consistent"] else None
        out[month] = {
            "ws_points": ws,
            "usd_t": usd,
            "weeks": len(rows),
            "flagged_weeks": sum(1 for r in rows if r[1].get("thin_market")),
            "tce_usd_day": float(np.mean([r[1]["td3c_tce_usd_day"] for r in rows])),
        }
    return out


def quarter_end_strips(marks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """BWET's TD3C futures at each quarter end, as a strip of months (USD a tonne)."""
    by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for m in marks:
        if m["fund"] == "BWET" and m["product"] == "td3c":
            by_date[m["as_of"]].append(m)
    out = []
    for date, rows in sorted(by_date.items()):
        rows.sort(key=lambda r: r["contract_month"])
        months = [
            {"month": r["contract_month"], "usd_t": r["price"], "contracts": r["contracts"], "url": r["url"]}
            for r in rows
        ]
        shapes = [
            engine.shape(a["usd_t"], b["usd_t"])
            for a, b in itertools.pairwise(months)
            if engine.months_between(a["month"], b["month"]) == 1
        ]
        out.append({"as_of": date, "months": months, "shapes": shapes})
    return out


def case(
    as_of: str,
    strip: dict[str, Any],
    physical: dict[str, float],
    settle: dict[str, float],
    unit: str,
    role: str = "owner",
) -> dict[str, Any]:
    """One quarter hedged at a quarter-end strip: per month and in total, the waterfall's steps.

    physical: the fixed rate of the month's cargo; settle: the month's settlement estimate (same unit).
    """
    months = []
    for m in strip["months"]:
        month = m["month"]
        if month not in physical or month not in settle:
            continue
        f0, p, s = m["usd_t"], physical[month], settle[month]
        outcome = engine.td3c_outcome(role, p, f0, s, CARGO_T, 1.0)
        months.append(
            {
                "month": month,
                "f0": f0,
                "physical": p,
                "settlement": s,
                "locked_usd": outcome["locked_usd"],
                "physical_vs_locked_usd": (p - f0) * CARGO_T * (1 if role == "owner" else -1),
                "paper_usd": outcome["paper_usd"],
                "total_usd": outcome["total_usd"],
            }
        )
    if not months:
        return {"as_of": as_of, "months": []}
    total = {k: sum(m[k] for m in months) for k in ("locked_usd", "physical_vs_locked_usd", "paper_usd", "total_usd")}
    return {"as_of": as_of, "unit": unit, "role": role, "cargo_t": CARGO_T, "months": months, "total": total}


#: The quarter-end marks the case studies start from, and the 7 April 2026 statement they set beside Q3 2026.
CASE_DATES = ("2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30")
BREAKWAVE_STATEMENT = {
    "date": "2026-04-07",
    "url": "https://www.breakwaveadvisors.com/insights/tanker4726",
    "text": "The VLCC futures curve is currently in steep backwardation, reflecting market expectations of an eventual "
    "resolution, with third-quarter futures trading at a nearly 50% discount to the current TD3C Index.",
}


def dollar_months(breakwave: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Each month's TD3C in USD a tonne from Breakwave's prints: the first print (the fixture) and their average.

    The average of a month's prints stands in for its settlement, which averages every publication day:
    labelled approximate, with the number of prints.
    """
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for b in breakwave:
        if b.get("td3c_usd_t") is not None:
            groups[b["report_date"][:7]].append(b)
    out = {}
    for month, rows in sorted(groups.items()):
        rows.sort(key=lambda r: r["report_date"])
        out[month] = {
            "fixture_usd_t": rows[0]["td3c_usd_t"],
            "fixture_on": rows[0]["report_date"],
            "fixture_url": rows[0].get("url"),
            "settlement_estimate_usd_t": float(np.mean([r["td3c_usd_t"] for r in rows])),
            "prints": len(rows),
        }
    return out


def cases(strips: list[dict[str, Any]], months: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """An owner's quarter hedged at each case date's marks: one 270,000 t cargo a month fixed at the month's first
    Breakwave print, the paper settled at the month's average print (approximate)."""
    out = []
    for date in CASE_DATES:
        strip = next((s for s in strips if s["as_of"] == date), None)
        if strip is None:
            continue
        quarter_months = [m for m in strip["months"] if engine.months_between(date[:7], m["month"]) <= 3]
        physical = {m: v["fixture_usd_t"] for m, v in months.items()}
        settle = {m: v["settlement_estimate_usd_t"] for m, v in months.items()}
        result = case(date, {"months": quarter_months}, physical, settle, "usd_t")
        if not result["months"]:
            continue
        for row in result["months"]:
            info = months[row["month"]]
            row.update(fixture_on=info["fixture_on"], prints=info["prints"], fixture_url=info["fixture_url"])
        result["mark_url"] = strip["months"][0]["url"]
        out.append(result)
    return out


#: Item 3's statistics for TD3C only with at least this many contract months at one horizon (pre-registered).
MIN_STATISTICS_MONTHS = 12


def statistics(
    strips: list[dict[str, Any]], months: dict[str, dict[str, Any]], exclude: set[str] | None = None
) -> dict[str, Any]:
    """Item 3 for TD3C, approximate: each quarter-end mark of month M at horizon h (months from the mark's month),
    the error S - F and the hedge of the month's cargo fixed at its first print.

    The rows are always returned; the statistics by horizon only where at least MIN_STATISTICS_MONTHS contract
    months have a mark and a settlement estimate at that horizon, the threshold set before the data were seen.
    """
    rows = []
    for strip in strips:
        for m in strip["months"]:
            h = engine.months_between(strip["as_of"][:7], m["month"])
            info = months.get(m["month"])
            if info is None or h not in (1, 2, 3) or (exclude and m["month"] in exclude):
                continue
            f0, p, s = m["usd_t"], info["fixture_usd_t"], info["settlement_estimate_usd_t"]
            rows.append(
                {
                    "as_of": strip["as_of"],
                    "contract": m["month"],
                    "horizon_months": h,
                    "f0": f0,
                    "physical": p,
                    "settlement": s,
                    "error": s - f0,
                    "unhedged": p - f0,
                    "paper_move": s - f0,
                }
            )
    out: dict[str, Any] = {
        "rows": rows,
        "by_horizon": [],
        "counts": [],
        "threshold_months": MIN_STATISTICS_MONTHS,
    }
    from . import stats

    for h in (1, 2, 3):
        sel = [r for r in rows if r["horizon_months"] == h]
        out["counts"].append({"horizon_months": h, "n": len(sel)})
        if len(sel) < MIN_STATISTICS_MONTHS:
            continue
        u = [r["unhedged"] for r in sel]
        x = [r["paper_move"] for r in sel]
        out["by_horizon"].append(
            {
                "horizon_months": h,
                "n": len(sel),
                "mean_error_usd_t": stats.mean([r["error"] for r in sel]),
                "rmse_usd_t": stats.rmse([r["error"] for r in sel]),
                "share_positive": stats.share_positive([r["error"] for r in sel]),
                "effectiveness_k1": stats.effectiveness(u, [a - b for a, b in zip(u, x, strict=True)]),
                "first": sel[0]["contract"],
                "last": sel[-1]["contract"],
            }
        )
    return out
