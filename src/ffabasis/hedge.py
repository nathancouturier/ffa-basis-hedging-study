"""Hedge effectiveness: how much of a voyage's earnings uncertainty a 5TC paper hedge removes.

Pre-registered design (docs/methodology.md, section "Hedge effectiveness"):

* Fixtures: every Friday with a 5TC print, from three months after the first
  usable curve to the last week whose voyage months have a settlement.
* Voyages: (a) a trip fixed at the day's 5TC, as long as that week's C5
  voyage, which carries timing basis only; (b) a C3 Tubarao to Qingdao and (c)
  a C5 West Australia to Qingdao voyage at that Friday's route rate, made a
  TCE by voyage-tce-model's engine with the Baltic standard Capesize of the
  date and Singapore bunkers of that week (else the latest within seven days,
  flagged), grossed up by its 5 percent commission.
* Hedge: placed 1, 2 or 3 months before the fixture on the latest curve
  printed by then, sized as the voyage's days spread over calendar months from
  the fixture date at the net share, held to settlement.
* Measure: unhedged surprise U = gross TCE - F0 (the day weighted FFA over the
  voyage's months on the hedge date); paper move X = S - F0 (the day weighted
  settlement); hedged surprise = U - k X; effectiveness = 1 - Var(U - kX) /
  Var(U) at k = 1 and at a minimum variance k estimated on past outcomes only
  (an expanding window of fixtures whose settlements were known on the hedge
  date, at least 52 of them).
* Residual at k = 1: U - X = TCE - S = route basis (gross TCE - same day's
  5TC, on the ship's basket) + timing basis (5TC on the fixture day -
  settlement over the voyage's months, ship's basket) + size basis
  (settlement on the ship's basket - settlement on the curve's basket).

A charterer mirrors the owner: the same variances, the opposite profit and loss.
"""

from __future__ import annotations

import datetime as dt
import itertools
from collections.abc import Iterable
from typing import Any

from . import analysis, build, engine, stats, voyage

VOYAGES = ("5TC trip", "C3", "C5")
MIN_WINDOW = 52


def ship_basket(day: str) -> int:
    return engine.basket_of(day)


def bunkers_for(panel: dict[str, Any], day: str) -> tuple[dict[str, float] | None, str | None, bool]:
    """Singapore bunkers of the day, else the latest printed within seven days before it (flagged)."""
    if day in panel["bunkers"]:
        return panel["bunkers"][day]["singapore"], day, False
    best = None
    for d in panel["bunkers"]:
        if d <= day and (dt.date.fromisoformat(day) - dt.date.fromisoformat(d)).days <= build.BUNKER_MAX_AGE_DAYS:
            best = d
    if best is None:
        return None, None, False
    return panel["bunkers"][best]["singapore"], best, True


def voyage_on(panel: dict[str, Any], route: str, day: str) -> dict[str, Any] | None:
    """A C3 or C5 voyage fixed on a Friday: freight, bunkers, vessel, days and gross TCE."""
    rates = panel["routes"].get(day)
    if not rates:
        return None
    freight = rates["c3_usd_t" if route == "C3" else "c5_usd_t"]
    prices, priced_on, stale = bunkers_for(panel, day)
    if freight is None or prices is None:
        return None
    ship = build.vessel_for(day)
    inputs = voyage.build(
        route,
        freight,
        {"vlsfo_usd_t": prices["vlsfo"], "hsfo_usd_t": prices["ifo380"], "mgo_usd_t": prices["lsmgo"]},
        ship,
        build.CARGO_T,
    )
    tce = voyage.tce(inputs)
    return {
        "route": route,
        "freight_usd_t": freight,
        "vessel": ship["id"],
        "bunkers_on": priced_on,
        "bunkers_stale": stale,
        "vlsfo_usd_t": prices["vlsfo"],
        "days": voyage.total_days(inputs),
        "tce_net_usd_day": tce,
        "tce_gross_usd_day": engine.gross_up(tce, engine.CAPESIZE_COMMISSION_PCT),
    }


def strip(curve: dict[str, Any], weights: list[dict[str, Any]], allow_proxy: bool) -> tuple[float | None, int]:
    """The day weighted FFA over a voyage's months on one curve, and how many months used a quarter proxy."""
    prices, proxies = {}, 0
    for w in weights:
        value, is_proxy = analysis.price(curve, w["month"], allow_proxy)
        if value is None:
            return None, proxies
        prices[w["month"]] = value
        proxies += int(is_proxy)
    return engine.strip_price(weights, prices), proxies


#: A hedge is placed on a curve at most this many days old on the hedge date.
CURVE_MAX_AGE_DAYS = 14


def observations(
    panel: dict[str, Any],
    curves: list[dict[str, Any]],
    settle: dict[str, dict[str, Any]],
    allow_proxy: bool = True,
    statuses: Iterable[str] = analysis.EXACT,
    basket_override: int | None = None,
) -> list[dict[str, Any]]:
    """Every fixture, voyage and horizon with its surprise, paper move and basis components."""
    allowed = set(statuses)
    fridays = sorted(d for d in panel["daily"] if dt.date.fromisoformat(d).weekday() == 4)
    first_curve = curves[0]["date"] if curves else None
    rows: list[dict[str, Any]] = []
    for day in fridays:
        if first_curve is None or day < first_curve:
            continue
        sb = ship_basket(day)
        spot = analysis.spot_in(panel, day, sb)
        if spot is None:
            continue
        c5 = voyage_on(panel, "C5", day)
        legs = {"C3": voyage_on(panel, "C3", day), "C5": c5}
        legs["5TC trip"] = (
            None
            if c5 is None
            else {
                "route": "5TC trip",
                "days": c5["days"],
                "tce_gross_usd_day": spot,
                "vessel": c5["vessel"],
                "bunkers_stale": c5["bunkers_stale"],
            }
        )
        for name in VOYAGES:
            leg = legs[name]
            if leg is None:
                continue
            weights = engine.month_days(day, leg["days"])
            months = [w["month"] for w in weights]
            if not all(m in settle and settle[m]["status"] in allowed for m in months):
                continue
            s_ship = engine.strip_price(weights, {m: analysis.settlement_in(settle, m, sb) for m in months})
            for h in analysis.HORIZONS:
                hedge_day = analysis.months_back(day, h)
                # The latest curve printed by the hedge date, at most 14 days old, that prices every month of the
                # voyage (a month as printed, else its quarter as a flagged proxy); a page whose rows were not
                # all read gives way to the week before it.
                window = analysis.curves_back(curves, hedge_day, CURVE_MAX_AGE_DAYS)
                curve, f0, proxies = None, None, []
                for candidate in window:
                    f0, proxies = strip(candidate, weights, allow_proxy)
                    if f0 is not None:
                        curve = candidate
                        break
                if curve is None:
                    continue
                cb = basket_override or curve["basket_t"]
                if basket_override and basket_override != curve["basket_t"]:
                    shift = engine.C5TC_180_DIFFERENTIAL_USD_DAY * (1 if basket_override == 182000 else -1)
                    f0 += shift
                s_curve = engine.strip_price(weights, {m: analysis.settlement_in(settle, m, cb) for m in months})
                if s_curve is None:
                    continue
                tce = leg["tce_gross_usd_day"]
                rows.append(
                    {
                        "fixture": day,
                        "voyage": name,
                        "horizon_months": h,
                        "hedged_on": curve["date"],
                        "curve_basket_t": cb,
                        "ship_basket_t": sb,
                        "days": leg["days"],
                        "months": months,
                        "last_month": months[-1],
                        "tce_gross_usd_day": tce,
                        "spot_5tc_usd_day": spot,
                        "f0_usd_day": f0,
                        "settlement_usd_day": s_curve,
                        "unhedged": tce - f0,
                        "paper_move": s_curve - f0,
                        "route_basis": tce - spot,
                        "timing_basis": spot - s_ship,
                        "size_basis": s_ship - s_curve,
                        "proxies": proxies,
                        "not_latest_curve": curve is not window[0],
                        "settlement_statuses": sorted({settle[m]["status"] for m in months}),
                        "bunkers_stale": bool(leg.get("bunkers_stale")),
                        "vessel": leg.get("vessel"),
                    }
                )
    return rows


def out_of_sample_ratios(rows: list[dict[str, Any]]) -> list[float | None]:
    """For each row (time order), k* from the rows whose last settlement month ended before its hedge date."""
    ks: list[float | None] = []
    for row in rows:
        known = [r for r in rows if engine.add_months(r["last_month"], 1) + "-01" <= row["hedged_on"]]
        if len(known) < MIN_WINDOW:
            ks.append(None)
            continue
        ks.append(stats.min_variance_ratio([r["unhedged"] for r in known], [r["paper_move"] for r in known]))
    return ks


def summarise(rows: list[dict[str, Any]], horizon: int) -> dict[str, Any] | None:
    """Effectiveness at k = 1 and out of sample, intervals, CVaR, and the residual's variance split."""
    sel = sorted((r for r in rows if r["horizon_months"] == horizon), key=lambda r: r["fixture"])
    if len(sel) < 10:
        return None
    u = [r["unhedged"] for r in sel]
    x = [r["paper_move"] for r in sel]
    h1 = [a - b for a, b in zip(u, x, strict=True)]
    route_mean = stats.mean([r["route_basis"] for r in sel])
    block = max(1, round(analysis.WEEKS_PER_MONTH * horizon + 4))
    out: dict[str, Any] = {
        "n": len(sel),
        "first_fixture": sel[0]["fixture"],
        "last_fixture": sel[-1]["fixture"],
        "sd_unhedged_usd_day": stats.variance(u) ** 0.5,
        "sd_hedged_usd_day": stats.variance(h1) ** 0.5,
        "mean_unhedged_usd_day": stats.mean(u),
        "mean_hedged_usd_day": stats.mean(h1),
        "effectiveness_k1": stats.effectiveness(u, h1),
        "effectiveness_k1_ci": stats.block_bootstrap((u, x), lambda a, b: stats.effectiveness(a, a - b), block),
        "k_in_sample": stats.min_variance_ratio(u, x),
        # CVaR with the route basis's mean taken out of both: its level is overstated by the costs the voyage
        # TCEs leave out, and a constant shift would move a tail measure (variances are unaffected). An owner's
        # bad tail is low earnings (the lowest 5 percent of the surprise), a charterer's is high hire (the
        # highest 5 percent): CVaR is not symmetric, so each role has its own.
        "cvar_unhedged_usd_day": stats.cvar([a - route_mean for a in u]),
        "cvar_hedged_usd_day": stats.cvar([a - route_mean for a in h1]),
        "cvar_charterer_unhedged_usd_day": stats.cvar([route_mean - a for a in u]),
        "cvar_charterer_hedged_usd_day": stats.cvar([route_mean - a for a in h1]),
        "cvar_route_mean_removed_usd_day": route_mean,
        "block_weeks": block,
        "curve_baskets": {str(b): sum(1 for r in sel if r["curve_basket_t"] == b) for b in (180000, 182000)},
        "k_window_min_fixtures": MIN_WINDOW,
    }
    out["cvar_reduction_k1"] = (
        1.0 - out["cvar_hedged_usd_day"] / out["cvar_unhedged_usd_day"] if out["cvar_unhedged_usd_day"] > 0 else None
    )
    out["cvar_reduction_k1_charterer"] = (
        1.0 - out["cvar_charterer_hedged_usd_day"] / out["cvar_charterer_unhedged_usd_day"]
        if out["cvar_charterer_unhedged_usd_day"] > 0
        else None
    )
    ks = out_of_sample_ratios(sel)
    oos = [(r, k) for r, k in zip(sel, ks, strict=True) if k is not None]
    if len(oos) >= 10:
        uu = [r["unhedged"] for r, _ in oos]
        hk = [r["unhedged"] - k * r["paper_move"] for r, k in oos]
        h1s = [r["unhedged"] - r["paper_move"] for r, _ in oos]
        out["oos"] = {
            "n": len(oos),
            "first_fixture": oos[0][0]["fixture"],
            "k_first": oos[0][1],
            "k_last": oos[-1][1],
            "effectiveness_kstar": stats.effectiveness(uu, hk),
            "effectiveness_k1_same_rows": stats.effectiveness(uu, h1s),
        }
    total = h1
    parts = {
        "route": [r["route_basis"] for r in sel],
        "timing": [r["timing_basis"] for r in sel],
        "size": [r["size_basis"] for r in sel],
    }
    var_total = stats.variance(total)
    out["residual_variance_share"] = {
        name: (float(_cov(values, total)) / var_total if var_total > 0 else None) for name, values in parts.items()
    }
    out["residual_mean_usd_day"] = {name: stats.mean(values) for name, values in parts.items()}
    out["residual_sd_usd_day"] = {
        name: stats.variance(values) ** 0.5 if len(set(values)) > 1 else 0.0 for name, values in parts.items()
    }
    return out


def _cov(a: list[float], b: list[float]) -> float:
    import numpy as np

    return float(np.cov(np.asarray(a), np.asarray(b), ddof=1)[0, 1])


def ederington(panel: dict[str, Any], curves: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Weekly spot and next-month FFA changes, Monday to Monday on the same basket, regressed (Ederington 1979)."""
    pairs = []
    dropped = {"not_7_days_apart": 0, "basket_changed": 0, "no_next_month_tenor": 0, "no_same_day_spot": 0}
    candidates = list(itertools.pairwise(curves))
    for a, b in candidates:
        gap = (dt.date.fromisoformat(b["date"]) - dt.date.fromisoformat(a["date"])).days
        if gap != 7:
            dropped["not_7_days_apart"] += 1
            continue
        if a["basket_t"] != b["basket_t"]:
            dropped["basket_changed"] += 1
            continue
        nxt = engine.add_months(b["date"][:7], 1)
        fa, fb = a["tenors"].get(nxt), b["tenors"].get(nxt)
        if None in (fa, fb):
            dropped["no_next_month_tenor"] += 1
            continue
        sa, sb = analysis.spot_in(panel, a["date"], a["basket_t"]), analysis.spot_in(panel, b["date"], b["basket_t"])
        if None in (sa, sb):
            dropped["no_same_day_spot"] += 1
            continue
        implied = any((panel["daily"].get(d) or {}).get("kind") == "implied" for d in (a["date"], b["date"]))
        pairs.append((sb - sa, fb - fa, b["date"], implied))
    if len(pairs) < 10:
        return None
    result = stats.ederington([p[0] for p in pairs], [p[1] for p in pairs])
    result.update(
        first=pairs[0][2],
        last=pairs[-1][2],
        pairs_considered=len(candidates),
        pairs_dropped=dropped,
        pairs_in_2026=sum(1 for p in pairs if p[2] >= engine.BASKET_182_FROM),
        pairs_implied_spot=sum(1 for p in pairs if p[3]),
    )
    return result
