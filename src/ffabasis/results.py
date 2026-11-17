"""Every result the study reports, computed from the panel in one place.

compute(panel) returns plain records: the curve shape, the forward errors and
roll cost, the hedge effectiveness by voyage and horizon with its intervals and
residual split, the robustness variants, Ederington's regression and the TD3C
record and cases. ffabasis.export writes the parts the site and the note show.
"""

from __future__ import annotations

from typing import Any

from . import analysis, engine, hedge, td3c

ROBUSTNESS = (
    (
        "headline",
        "First prints, exact settlements (complete or published months), quarter proxies allowed",
        {"print_choice": "first", "statuses": analysis.EXACT, "allow_proxy": True},
    ),
    (
        "latest_print",
        "Latest print of each curve (the next issue's re-assessment) instead of the first",
        {"print_choice": "latest", "statuses": analysis.EXACT, "allow_proxy": True},
    ),
    (
        "all_months",
        "All months, estimated settlements of incomplete months included",
        {"print_choice": "first", "statuses": analysis.ALL, "allow_proxy": True},
    ),
    (
        "complete_only",
        "Only months the study's own daily series completes (2026 and July 2023)",
        {"print_choice": "first", "statuses": ("complete",), "allow_proxy": True},
    ),
    (
        "no_proxies",
        "No quarter proxies: a voyage month must be printed as a month",
        {"print_choice": "first", "statuses": analysis.EXACT, "allow_proxy": False},
    ),
    (
        "basket_180_2026",
        "2026 curves read as 180,000 t (each 2026 price less 3,503)",
        {"print_choice": "first", "statuses": analysis.EXACT, "allow_proxy": True, "basket_override": 180000},
    ),
)


#: Why a variant cannot differ from the headline in some cells, where it is so by construction.
BY_CONSTRUCTION = {
    "basket_180_2026": "a 2026 price and its settlement move by the same fixed USD 3,503, so forecast errors cannot "
    "change",
}


def _robustness_notes(variants: list[dict[str, Any]]) -> None:
    """Say, for each variant, which of its cells equal the headline's, so an identical row is never unexplained."""
    base = next(v for v in variants if v["key"] == "headline")

    def cells(v: dict[str, Any]) -> dict[tuple[str, int], tuple[Any, ...]]:
        return {(c["voyage"], c["horizon_months"]): (c["n"], round(c["effectiveness_k1"], 6)) for c in v["hedge"]}

    for v in variants:
        if v["key"] == "headline":
            continue
        notes = []
        if cells(v) == cells(base):
            notes.append("every hedge cell equals the headline's: no hedged fixture's price or settlement changes")
        same_bias = all(
            (v["bias"].get(h) or {}).get("mean_usd_day") == (base["bias"].get(h) or {}).get("mean_usd_day")
            for h in analysis.HORIZONS
        )
        if same_bias:
            notes.append(BY_CONSTRUCTION.get(v["key"], "the forecast errors equal the headline's"))
        missing = sorted(set(cells(base)) - set(cells(v)))
        if missing:
            notes.append(
                "no fixture qualifies for "
                + ", ".join(f"{voyage} at {h} month{'s' if h > 1 else ''}" for voyage, h in missing)
            )
        v["note"] = "; ".join(notes) or None


def _hedge_table(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    table = []
    for voyage in hedge.VOYAGES:
        for h in analysis.HORIZONS:
            summary = hedge.summarise([r for r in rows if r["voyage"] == voyage], h)
            if summary:
                table.append(dict(summary, voyage=voyage, horizon_months=h))
    return table


def _by_year(rows: list[dict[str, Any]], voyage: str, h: int) -> list[dict[str, Any]]:
    out = []
    years = sorted({r["fixture"][:4] for r in rows})
    for year in years:
        sel = [r for r in rows if r["fixture"][:4] == year and r["voyage"] == voyage]
        s = hedge.summarise(sel, h)
        if s:
            out.append(
                {
                    "year": int(year),
                    "n": s["n"],
                    "effectiveness_k1": s["effectiveness_k1"],
                    "sd_unhedged_usd_day": s["sd_unhedged_usd_day"],
                    "sd_hedged_usd_day": s["sd_hedged_usd_day"],
                }
            )
    return out


def compute(panel: dict[str, Any]) -> dict[str, Any]:
    settle = analysis.settlements(panel)
    curves = analysis.usable_curves(panel, "first")
    shape = analysis.curve_shape(panel, curves)
    errors = analysis.forecast_errors(panel, curves, settle)
    quarters = analysis.quarter_errors(curves, settle)
    rows = hedge.observations(panel, curves, settle)

    robustness = []
    for key, label, opts in ROBUSTNESS:
        c = analysis.usable_curves(panel, opts["print_choice"])
        r = hedge.observations(
            panel,
            c,
            settle,
            allow_proxy=opts["allow_proxy"],
            statuses=opts["statuses"],
            basket_override=opts.get("basket_override"),
        )
        e = analysis.forecast_errors(panel, c, settle, statuses=opts["statuses"])
        robustness.append(
            {
                "key": key,
                "label": label,
                "hedge": [
                    {
                        k: v
                        for k, v in s.items()
                        if k
                        in (
                            "voyage",
                            "horizon_months",
                            "n",
                            "effectiveness_k1",
                            "sd_unhedged_usd_day",
                            "sd_hedged_usd_day",
                        )
                    }
                    for s in _hedge_table(r)
                ],
                "bias": {h: analysis.error_summary(e, h) for h in analysis.HORIZONS},
            }
        )
    _robustness_notes(robustness)

    weekly = panel["td3c_weekly"]
    bw = panel.get("breakwave", [])
    pairs = td3c.implied_flat_rates(weekly, bw)
    flat = td3c.flat_rate_by_period(pairs)
    monthly = td3c.monthly_estimates(weekly, flat)
    strips = td3c.quarter_end_strips(panel["sec_marks"])
    dollars = td3c.dollar_months(bw)

    return {
        "settlements": settle,
        "curves": curves,
        "shape_rows": shape,
        "shape": {
            "front_vs_spot": analysis.shape_shares(shape, "front_vs_spot"),
            "front_vs_spot_by_year": analysis.shape_shares(shape, "front_vs_spot", "year"),
            "front_vs_spot_by_month": analysis.shape_shares(shape, "front_vs_spot", "month"),
            "front_spread": analysis.shape_shares(shape, "front_spread_shape"),
            "front_spread_by_year": analysis.shape_shares(shape, "front_spread_shape", "year"),
            "front_spread_by_month": analysis.shape_shares(shape, "front_spread_shape", "month"),
            "month_spreads": analysis.spread_shares(shape, "month_spreads"),
            "quarter_spreads": analysis.spread_shares(shape, "quarter_spreads"),
            "slope_by_spot": analysis.slope_by_spot(shape),
            "q1_discount": [r for r in shape if "q1_minus_q4" in r],
        },
        "errors": errors,
        "bias": {h: analysis.error_summary(errors, h) for h in analysis.HORIZONS},
        "quarter_errors": quarters,
        "quarter_bias": analysis.error_summary(quarters),
        "roll_1m": analysis.roll_cost_by_year(errors, 1),
        "roll_quarter": analysis.roll_cost_by_year(
            [dict(q, horizon_months=1, contract=q["contract"][:4]) for q in quarters], 1
        ),
        "hedge_rows": rows,
        "hedge": _hedge_table(rows),
        "hedge_by_year": {v: _by_year(rows, v, 1) for v in hedge.VOYAGES},
        "ederington": hedge.ederington(panel, curves),
        "robustness": robustness,
        "td3c": {
            "weekly": weekly,
            "breakwave": bw,
            "flat_pairs": pairs,
            "flat": flat,
            "monthly": monthly,
            "strips": strips,
            "dollar_months": dollars,
            "cases": td3c.cases(strips, dollars),
            "statement_check": td3c.statement_check(strips, bw, dollars),
            "statistics": td3c.statistics(strips, dollars),
            "statistics_without_thin_weeks": td3c.statistics(
                strips, dollars, exclude={w[:7] for w, row in weekly.items() if row.get("thin_market")}
            ),
        },
        "constants": engine.constants(),
    }
