"""The pre-registered analysis: curve shape, forward bias and roll cost, hedge effectiveness.

Every function reads the panel (data/cache/panel.json, built by ffabasis.build)
and returns plain records; ffabasis.export writes the derived ones the site
reads. The rules, fixed before the results were seen, are in
docs/methodology.md; each is restated where it is applied.
"""

from __future__ import annotations

import datetime as dt
import itertools
import math
from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from . import engine, stats

HORIZONS = (1, 2, 3)
WEEKS_PER_MONTH = 52.0 / 12.0
#: An incomplete month's settlement is estimated only from at least four observed days with one in
#: the first ten and one in the last ten calendar days of the month.
MIN_ESTIMATE_DAYS = 4


# ---------------------------------------------------------------------------
# Settlements
# ---------------------------------------------------------------------------


def settlements(panel: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Each month's settlement on the 180,000 t basket, with how it is known.

    complete: every expected publication day is in the study's own daily series; the plain average.
    published: the month's average as Himalaya Shipping published it (SEC 6-K exhibits), used where the daily
        series is incomplete; checked to the dollar against every complete month (data/AUDIT.md).
    estimated: the average of the days observed in an incomplete month with no published average, kept only
        when at least four days are observed with one in the first ten and one in the last ten days.
    value(basket): the 180,000 t value, plus 3,503 for the 182,000 t basket from January 2026.
    """
    published = {row["month"]: row for row in panel.get("published_5tc", [])}
    out: dict[str, dict[str, Any]] = {}
    for month in panel["months"]:
        days = [d for d in panel["daily"] if d[:7] == month["month"]]
        first = any(int(d[8:10]) <= 10 for d in days)
        last = any(int(d[8:10]) >= 19 for d in days)
        pub = published.get(month["month"])
        if month["complete"]:
            status, value = "complete", month["settlement_180_usd_day"]
        elif pub is not None:
            status, value = "published", pub["value_usd_day"]
        elif month["observed_days"] >= MIN_ESTIMATE_DAYS and first and last:
            status, value = "estimated", month["partial_average_180_usd_day"]
        else:
            continue
        out[month["month"]] = {
            "status": status,
            "value_180": value,
            "coverage": month["coverage"],
            "observed_days": month["observed_days"],
            "expected_days": month["expected_days"],
            "published_180": None if pub is None else pub["value_usd_day"],
            "published_url": None if pub is None else pub["url"],
        }
    return out


EXACT = ("complete", "published")
ALL = ("complete", "published", "estimated")


def settlement_in(settle: dict[str, dict[str, Any]], month: str, basket: int) -> float | None:
    row = settle.get(month)
    if row is None:
        return None
    if basket == 182000:
        if month < engine.BASKET_182_FROM[:7]:
            return None
        return row["value_180"] + engine.C5TC_180_DIFFERENTIAL_USD_DAY
    return row["value_180"]


def spot_in(panel: dict[str, Any], day: str, basket: int) -> float | None:
    row = panel["daily"].get(day)
    if row is None:
        return None
    if basket == 182000:
        if day < engine.BASKET_182_FROM:
            return None
        return row["value_180"] + engine.C5TC_180_DIFFERENTIAL_USD_DAY
    return row["value_180"]


# ---------------------------------------------------------------------------
# Curves
# ---------------------------------------------------------------------------


def usable_curves(panel: dict[str, Any], print_choice: str = "first") -> list[dict[str, Any]]:
    """Dated curves, oldest first; with print_choice "latest" a reprinted tenor takes its reprint."""
    out = []
    for date, curve in sorted(panel["curves"].items()):
        if not curve.get("tenors"):
            continue
        tenors = {p: t["usd_day"] for p, t in curve["tenors"].items()}
        if print_choice == "latest":
            for reprint in curve.get("reprints", []):
                for period, value in reprint["tenors"].items():
                    if value is not None and period in tenors:
                        tenors[period] = value
        out.append(
            {
                "date": date,
                "tenors": tenors,
                "basket_t": curve.get("basket_t", 180000),
                "flags": curve.get("flags", []),
                "issue": curve.get("issue"),
            }
        )
    return out


def price(curve: dict[str, Any], month: str, allow_proxy: bool = True) -> tuple[float | None, bool]:
    """A month's FFA on a curve: the month when printed, else its quarter (a proxy), else None."""
    if month in curve["tenors"]:
        return curve["tenors"][month], False
    if allow_proxy:
        quarter = engine.quarter_of(month)
        if quarter in curve["tenors"]:
            return curve["tenors"][quarter], True
    return None, False


def latest_curve(curves: list[dict[str, Any]], on_or_before: str) -> dict[str, Any] | None:
    best = None
    for curve in curves:
        if curve["date"] <= on_or_before:
            best = curve
        else:
            break
    return best


def months_back(day: str, months: int) -> str:
    """The same day of the month `months` earlier, or the month's last day when it has fewer days."""
    year, mon, d = engine.parse_date(day)
    index = year * 12 + (mon - 1) - months
    y, m = index // 12, index % 12 + 1
    return dt.date(y, m, min(d, engine.days_in_month(y, m))).isoformat()


# ---------------------------------------------------------------------------
# Curve shape
# ---------------------------------------------------------------------------


def curve_shape(panel: dict[str, Any], curves: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """For each dated curve: front month against spot, adjacent month and quarter spreads, slope."""
    rows = []
    for curve in curves:
        date, basket = curve["date"], curve["basket_t"]
        spot = spot_in(panel, date, basket)
        spot_day = date
        if spot is None:
            # the Friday before the Monday assessment
            friday = (dt.date.fromisoformat(date) - dt.timedelta(days=3)).isoformat()
            spot, spot_day = spot_in(panel, friday, basket), friday
        months = sorted(p for p in curve["tenors"] if p[5:6].isdigit())
        quarters = sorted(p for p in curve["tenors"] if "-Q" in p)
        front = date[:7] if date[:7] in curve["tenors"] else (months[0] if months else None)
        row: dict[str, Any] = {
            "date": date,
            "basket_t": basket,
            "year": int(date[:4]),
            "month": int(date[5:7]),
            "spot_day": spot_day if spot is not None else None,
        }
        if front and spot is not None:
            row["front_minus_spot"] = curve["tenors"][front] - spot
            row["front_minus_spot_pct"] = row["front_minus_spot"] / spot
            row["front_vs_spot"] = engine.shape(spot, curve["tenors"][front])
            row["spot_level"] = spot
        month_spreads = []
        for a, b in itertools.pairwise(months):
            if engine.months_between(a, b) == 1:
                month_spreads.append(
                    {
                        "from": a,
                        "to": b,
                        "spread": curve["tenors"][b] - curve["tenors"][a],
                        "shape": engine.shape(curve["tenors"][a], curve["tenors"][b]),
                    }
                )
        quarter_spreads = []
        for a, b in itertools.pairwise(quarters):
            quarter_spreads.append(
                {
                    "from": a,
                    "to": b,
                    "spread": curve["tenors"][b] - curve["tenors"][a],
                    "shape": engine.shape(curve["tenors"][a], curve["tenors"][b]),
                }
            )
        row["month_spreads"] = month_spreads
        row["quarter_spreads"] = quarter_spreads
        if month_spreads:
            row["front_spread"] = month_spreads[0]["spread"]
            row["front_spread_shape"] = month_spreads[0]["shape"]
        # Slope: the first quarter that starts after the front month, against the front month, in percent of spot.
        if front and spot:
            later = [q for q in quarters if engine.quarter_months(q)[0] > front]
            if later:
                row["slope_pct"] = (curve["tenors"][later[0]] - curve["tenors"][front]) / spot
                row["slope_quarter"] = later[0]
        # The first-quarter discount: Q1 of next year against Q4 of this one, when both are printed.
        for q in quarters:
            if q.endswith("Q4"):
                nxt = "%d-Q1" % (int(q[:4]) + 1)
                if nxt in curve["tenors"]:
                    row["q1_minus_q4"] = curve["tenors"][nxt] - curve["tenors"][q]
                    row["q1_minus_q4_pct"] = row["q1_minus_q4"] / curve["tenors"][q]
        rows.append(row)
    return rows


def shape_shares(rows: list[dict[str, Any]], key: str, by: str | None = None) -> dict[str, Any]:
    """Share of curves in contango and backwardation on one measure, overall or by year or calendar month."""
    groups: dict[Any, list[str]] = defaultdict(list)
    for row in rows:
        if key not in row:
            continue
        groups["all" if by is None else row[by]].append(row[key])
    out = {}
    for group, shapes in sorted(groups.items(), key=lambda kv: str(kv[0])):
        n = len(shapes)
        out[str(group)] = {
            "n": n,
            "contango": sum(s == "contango" for s in shapes) / n,
            "backwardation": sum(s == "backwardation" for s in shapes) / n,
        }
    return out


def spread_shares(rows: list[dict[str, Any]], kind: str, by: str | None = None) -> dict[str, Any]:
    """Share of adjacent spreads (months or quarters) in contango, pooled over every pair of every curve."""
    groups: dict[Any, list[str]] = defaultdict(list)
    for row in rows:
        for spread in row.get(kind, []):
            groups["all" if by is None else row[by]].append(spread["shape"])
    return {
        str(g): {
            "n": len(s),
            "contango": sum(x == "contango" for x in s) / len(s),
            "backwardation": sum(x == "backwardation" for x in s) / len(s),
        }
        for g, s in sorted(groups.items(), key=lambda kv: str(kv[0]))
    }


def slope_by_spot(rows: list[dict[str, Any]], width: float = 5000.0) -> list[dict[str, Any]]:
    """Mean slope (first full quarter against front month, percent of spot) by bins of the spot level."""
    bins: dict[int, list[float]] = defaultdict(list)
    for row in rows:
        if "slope_pct" in row and "spot_level" in row:
            bins[int(row["spot_level"] // width)].append(row["slope_pct"])
    return [
        {
            "spot_from": b * width,
            "spot_to": (b + 1) * width,
            "n": len(v),
            "mean_slope_pct": stats.mean(v),
            "contango_share": sum(x > 0 for x in v) / len(v),
        }
        for b, v in sorted(bins.items())
    ]


# ---------------------------------------------------------------------------
# Forward bias and roll cost
# ---------------------------------------------------------------------------


def forecast_errors(
    panel: dict[str, Any],
    curves: list[dict[str, Any]],
    settle: dict[str, dict[str, Any]],
    statuses: Iterable[str] = EXACT,
) -> list[dict[str, Any]]:
    """For every settled contract month and horizon h: error = settlement - price on the last curve of month M - h.

    Positive: the contract settled above the price paid, a gain to the long (the charterer) and a cost to
    the short (the owner). The roll cost a rolling long pays is the negative: price paid - settlement.
    """
    allowed = set(statuses)
    by_month: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for curve in curves:
        by_month[curve["date"][:7]].append(curve)
    rows = []
    for month, info in sorted(settle.items()):
        if info["status"] not in allowed:
            continue
        for h in HORIZONS:
            source_month = engine.add_months(month, -h)
            candidates = by_month.get(source_month)
            if not candidates:
                continue
            curve = candidates[-1]
            if month not in curve["tenors"]:
                continue
            f = curve["tenors"][month]
            s = settlement_in(settle, month, curve["basket_t"])
            if s is None:
                continue
            spot = spot_in(panel, curve["date"], curve["basket_t"])
            if spot is None:
                friday = (dt.date.fromisoformat(curve["date"]) - dt.timedelta(days=3)).isoformat()
                spot = spot_in(panel, friday, curve["basket_t"])
            rows.append(
                {
                    "contract": month,
                    "horizon_months": h,
                    "priced_on": curve["date"],
                    "basket_t": curve["basket_t"],
                    "price_usd_day": f,
                    "settlement_usd_day": s,
                    "settlement_status": info["status"],
                    "error_usd_day": s - f,
                    "error_pct": (s - f) / s,
                    "naive_error_usd_day": None if spot is None else s - spot,
                    "flagged": any(fl.get("period") == month for fl in curve["flags"]),
                }
            )
    return rows


def quarter_errors(
    curves: list[dict[str, Any]], settle: dict[str, dict[str, Any]], statuses: Iterable[str] = EXACT
) -> list[dict[str, Any]]:
    """The front quarter bought on the last curve before it starts, held to the average of its three months."""
    allowed = set(statuses)
    rows = []
    quarters = sorted({engine.quarter_of(m) for m in settle})
    for quarter in quarters:
        months = engine.quarter_months(quarter)
        if not all(m in settle and settle[m]["status"] in allowed for m in months):
            continue
        before = engine.add_months(months[0], -1)
        candidates = [c for c in curves if c["date"][:7] == before and quarter in c["tenors"]]
        if not candidates:
            continue
        curve = candidates[-1]
        values = [settlement_in(settle, m, curve["basket_t"]) for m in months]
        if None in values:
            continue
        s = sum(values) / 3.0
        f = curve["tenors"][quarter]
        rows.append(
            {
                "contract": quarter,
                "priced_on": curve["date"],
                "basket_t": curve["basket_t"],
                "price_usd_day": f,
                "settlement_usd_day": s,
                "error_usd_day": s - f,
                "error_pct": (s - f) / s,
                "statuses": sorted({settle[m]["status"] for m in months}),
            }
        )
    return rows


def block_months(h: int) -> int:
    """The bootstrap block for monthly contract errors: horizon in weeks plus four, in months."""
    return max(1, math.ceil((WEEKS_PER_MONTH * h + 4.0) / WEEKS_PER_MONTH))


def error_summary(rows: list[dict[str, Any]], h: int | None = None) -> dict[str, Any] | None:
    sel = [r for r in rows if h is None or r.get("horizon_months") == h]
    if len(sel) < 3:
        return None
    errors = [r["error_usd_day"] for r in sel]
    pct = [r["error_pct"] for r in sel]
    block = block_months(h or 3)
    out = {
        "n": len(sel),
        "mean_usd_day": stats.mean(errors),
        "median_usd_day": stats.median(errors),
        "rmse_usd_day": stats.rmse(errors),
        "share_positive": stats.share_positive(errors),
        "mean_pct": stats.mean(pct),
        "mean_ci": stats.block_bootstrap(errors, stats.mean, block),
        "rmse_ci": stats.block_bootstrap(errors, stats.rmse, block),
        "first": sel[0].get("contract"),
        "last": sel[-1].get("contract"),
    }
    naive = [r["naive_error_usd_day"] for r in sel if r.get("naive_error_usd_day") is not None]
    if len(naive) == len(sel):
        out["rmse_naive_usd_day"] = stats.rmse(naive)
        out["rmse_ratio_ffa_to_naive"] = out["rmse_usd_day"] / out["rmse_naive_usd_day"]
    return out


def roll_cost_by_year(rows: list[dict[str, Any]], h: int = 1) -> list[dict[str, Any]]:
    """A rolling long's cost each year: mean (price paid - settlement), USD a day and percent, and a ship-year."""
    years: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        if r.get("horizon_months", h) == h:
            years[int(r["contract"][:4])].append(r)
    out = []
    for year, sel in sorted(years.items()):
        cost = [-r["error_usd_day"] for r in sel]
        pct = [-r["error_pct"] for r in sel]
        out.append(
            {
                "year": year,
                "n": len(sel),
                "roll_cost_usd_day": stats.mean(cost),
                "roll_cost_pct": stats.mean(pct),
                "ship_year_usd": stats.mean(cost) * 365.0,
                "statuses": sorted({r.get("settlement_status", "") for r in sel} - {""}),
            }
        )
    return out
