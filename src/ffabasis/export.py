"""Write the artifacts the site reads (data/*.json), the downloads (data/downloads/*.csv) and the manifest.

Everything here is derived from data/cache/panel.json and the public records in
data/public/, under the data policy of data/AUDIT.md: no daily index series, no
weekly FFA panel, raw FFA levels only on the cited dated curves of CITED_CURVES
and in the SEC marks. tools/check-policy.mjs enforces the same rule on the
files this module writes. Output is byte for byte reproducible: keys sorted,
floats rounded to the precision their unit carries.
"""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from typing import Any

from . import analysis, engine, hedge

#: The dated curves the site may show (individually cited points): the validation anchor weeks, the
#: double-printed curve of 29 June 2026, and the latest curve, added at export time.
CITED_CURVES = ("2022-07-11", "2026-06-29", "2026-07-27")
DECIMALS = {"usd_day": 0, "usd_t": 3, "ws_points": 2, "pct": 4, "share": 4, "ratio": 4, "days": 3}
SITE = "https://nathancouturier.github.io/ffa-basis-hedging-study/"


def _r(value: Any, places: int) -> Any:
    if value is None:
        return None
    return round(float(value), places)


def _usd(v: Any) -> Any:
    return _r(v, 0)


def _share(v: Any) -> Any:
    """A share to six decimals: rounding it again for display (one decimal of a percent) then rounds once."""
    return _r(v, 6)


def dump(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")


def write_csv(path: Path, header: list[str], rows: list[list[Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    path.write_text(buffer.getvalue(), encoding="utf-8")


def _ci(ci: dict[str, Any] | None) -> dict[str, Any] | None:
    if not ci:
        return None
    return {
        "low": _share(ci["low"]),
        "high": _share(ci["high"]),
        "block": ci["block"],
        "resamples": ci["resamples"],
        "seed": ci["seed"],
    }


def hedge_cells(table: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for row in table:
        oos = row.get("oos") or {}
        out.append(
            {
                "voyage": row["voyage"],
                "horizon_months": row["horizon_months"],
                "n": row["n"],
                "first_fixture": row["first_fixture"],
                "last_fixture": row["last_fixture"],
                "effectiveness_k1": _share(row["effectiveness_k1"]),
                "effectiveness_k1_ci": _ci(row["effectiveness_k1_ci"]),
                "k_in_sample": _r(row["k_in_sample"], 3),
                "effectiveness_kstar_oos": _share(oos.get("effectiveness_kstar")),
                "effectiveness_k1_same_rows": _share(oos.get("effectiveness_k1_same_rows")),
                "n_oos": oos.get("n"),
                "oos_first_fixture": oos.get("first_fixture"),
                "k_oos_last": _r(oos.get("k_last"), 3),
                "sd_unhedged_usd_day": _usd(row["sd_unhedged_usd_day"]),
                "sd_hedged_usd_day": _usd(row["sd_hedged_usd_day"]),
                "mean_unhedged_usd_day": _usd(row["mean_unhedged_usd_day"]),
                "mean_hedged_usd_day": _usd(row["mean_hedged_usd_day"]),
                "cvar_unhedged_usd_day": _usd(row["cvar_unhedged_usd_day"]),
                "cvar_hedged_usd_day": _usd(row["cvar_hedged_usd_day"]),
                "cvar_reduction_k1": _share(row["cvar_reduction_k1"]),
                "cvar_route_mean_removed_usd_day": _usd(row["cvar_route_mean_removed_usd_day"]),
                "residual_variance_share": {k: _share(v) for k, v in row["residual_variance_share"].items()},
                "residual_mean_usd_day": {k: _usd(v) for k, v in row["residual_mean_usd_day"].items()},
                "residual_sd_usd_day": {k: _usd(v) for k, v in row["residual_sd_usd_day"].items()},
                "curve_baskets": row["curve_baskets"],
                "k_window_min_fixtures": row["k_window_min_fixtures"],
            }
        )
    return out


def cited_curves(results: dict[str, Any], panel: dict[str, Any]) -> list[dict[str, Any]]:
    dates = list(CITED_CURVES)
    latest = results["curves"][-1]["date"] if results["curves"] else None
    if latest and latest not in dates:
        dates.append(latest)
    out = []
    for date in dates:
        curve = panel["curves"].get(date)
        if not curve or not curve.get("tenors"):
            continue
        basket = curve.get("basket_t", 180000)
        spot, spot_day = analysis.spot_on_or_before(panel, date, basket)
        out.append(
            {
                "date": date,
                "basket_t": basket,
                "basket_how": curve.get("basket_how"),
                "issue": curve.get("issue"),
                "source": "Banchero Costa weekly market report %s, Dry bulk FFA assessments (Capesize)"
                % curve.get("issue"),
                "url": curve.get("url"),
                "page": curve.get("page"),
                "tenors": [
                    {"period": p, "kind": t["kind"], "label": t["label"], "usd_day": t["usd_day"]}
                    for p, t in sorted(curve["tenors"].items(), key=lambda kv: _period_order(kv[0]))
                ],
                "spot_usd_day": _usd(spot),
                "spot_on": spot_day if spot is not None else None,
                "spot_sources": sorted(set((panel["daily"].get(spot_day) or {}).get("sources") or []))
                if spot is not None
                else [],
                "spot_kind": (panel["daily"].get(spot_day) or {}).get("kind") if spot is not None else None,
                "reprints": [
                    {
                        "issue": r["issue"],
                        "url": r["url"],
                        "tenors": {p: v for p, v in r["tenors"].items() if v is not None},
                    }
                    for r in curve.get("reprints", [])
                ],
                "flags": curve.get("flags", []),
            }
        )
    return out


def _period_order(period: str) -> tuple[str, int]:
    if "-Q" in period:
        months = engine.quarter_months(period)
        return (months[0], 1)
    return (period, 0)


def write_all(root: Path, results: dict[str, Any], panel: dict[str, Any], extra: dict[str, Any]) -> list[Path]:
    """Write every artifact; extra carries the method text, validation table and manifest built elsewhere."""
    data = root / "data"
    written: list[Path] = []
    as_of = extra["as_of"]
    hedge_table = hedge_cells(results["hedge"])
    c5_1m = next((c for c in hedge_table if c["voyage"] == "C5" and c["horizon_months"] == 1), None)
    shape = results["shape"]

    overview = {
        "artifact": "overview",
        "as_of": as_of,
        "headline": c5_1m,
        "effectiveness": hedge_table,
        "facts": extra["facts"],
        "sources_line": extra["sources_line"]["overview"],
    }
    dump(data / "overview.json", overview)
    written.append(data / "overview.json")

    weeks = [
        {
            "date": r["date"],
            "front_vs_spot": r.get("front_vs_spot"),
            "front_spread": r.get("front_spread_shape"),
            "basket_t": r["basket_t"],
        }
        for r in results["shape_rows"]
    ]
    curve = {
        "artifact": "curve",
        "as_of": as_of,
        "cited_curves": cited_curves(results, panel),
        "weeks": weeks,
        "shares": {k: v for k, v in shape.items() if k not in ("slope_by_spot", "q1_discount")},
        "slope_by_spot": [
            {k: (_share(v) if "pct" in k or "share" in k else v) for k, v in b.items()} for b in shape["slope_by_spot"]
        ],
        "q1_discount": {
            "n": len(shape["q1_discount"]),
            "share_below": _share(
                sum(1 for r in shape["q1_discount"] if r["q1_minus_q4"] < 0) / len(shape["q1_discount"])
            )
            if shape["q1_discount"]
            else None,
            "mean_pct": _share(sum(r["q1_minus_q4_pct"] for r in shape["q1_discount"]) / len(shape["q1_discount"]))
            if shape["q1_discount"]
            else None,
        },
        "td3c_strips": results["td3c"]["strips"],
        "sources_line": extra["sources_line"]["curve"],
    }
    dump(data / "curve.json", curve)
    written.append(data / "curve.json")

    def bias_row(s: dict[str, Any] | None, h: Any) -> dict[str, Any] | None:
        if not s:
            return None
        return {
            "horizon_months": h,
            "n": s["n"],
            "mean_usd_day": _usd(s["mean_usd_day"]),
            "median_usd_day": _usd(s["median_usd_day"]),
            "rmse_usd_day": _usd(s["rmse_usd_day"]),
            "share_positive": _share(s["share_positive"]),
            "mean_pct": _share(s["mean_pct"]),
            "mean_ci": {
                "low": _usd(s["mean_ci"]["low"]),
                "high": _usd(s["mean_ci"]["high"]),
                "block": s["mean_ci"]["block"],
            },
            "rmse_ci": {"low": _usd(s["rmse_ci"]["low"]), "high": _usd(s["rmse_ci"]["high"])},
            "ci_note": None
            if s["mean_ci"].get("low") is not None
            else f"No interval: {s['n']} contracts, fewer than two bootstrap blocks of {s['mean_ci']['block']}",
            "n_naive": s.get("n_naive"),
            "rmse_naive_usd_day": _usd(s.get("rmse_naive_usd_day")),
            "rmse_ffa_paired_usd_day": _usd(s.get("rmse_ffa_paired_usd_day")),
            "rmse_ratio_ffa_to_naive": _r(s.get("rmse_ratio_ffa_to_naive"), 3),
            "first": s["first"],
            "last": s["last"],
        }

    roll = {
        "artifact": "roll",
        "as_of": as_of,
        "bias": [bias_row(results["bias"][h], h) for h in analysis.HORIZONS],
        "quarter_bias": bias_row(results["quarter_bias"], "front quarter"),
        "errors": [
            {
                "contract": e["contract"],
                "horizon_months": e["horizon_months"],
                "priced_on": e["priced_on"],
                "basket_t": e["basket_t"],
                "error_usd_day": _usd(e["error_usd_day"]),
                "error_pct": _share(e["error_pct"]),
                "settlement_status": e["settlement_status"],
            }
            for e in results["errors"]
        ],
        "roll_1m": [
            {
                **r,
                "roll_cost_usd_day": _usd(r["roll_cost_usd_day"]),
                "roll_cost_pct": _share(r["roll_cost_pct"]),
                "ship_year_usd": _usd(r["ship_year_usd"]),
            }
            for r in results["roll_1m"]
        ],
        "roll_quarter": [
            {
                **r,
                "roll_cost_usd_day": _usd(r["roll_cost_usd_day"]),
                "roll_cost_pct": _share(r["roll_cost_pct"]),
                "ship_year_usd": _usd(r["ship_year_usd"]),
            }
            for r in results["roll_quarter"]
        ],
        "settlements": [
            {
                "month": m,
                "status": s["status"],
                "usd_day_180": _usd(s["value_180"]),
                "usd_day_182": _usd(s["value_180"] + engine.C5TC_180_DIFFERENTIAL_USD_DAY)
                if m >= engine.BASKET_182_FROM[:7]
                else None,
                "coverage": _share(s["coverage"]),
                "published_url": s.get("published_url"),
            }
            for m, s in sorted(results["settlements"].items())
        ],
        "sources_line": extra["sources_line"]["roll"],
    }
    dump(data / "roll.json", roll)
    written.append(data / "roll.json")

    lab = extra["lab"]
    lab["bands"] = _bands(results["hedge_rows"])
    lab["history"] = [
        {
            "fixture": r["fixture"],
            "voyage": r["voyage"],
            "horizon_months": r["horizon_months"],
            "hedged_on": r["hedged_on"],
            "months": r["months"],
            "unhedged_usd_day": _usd(r["unhedged"]),
            "paper_move_usd_day": _usd(r["paper_move"]),
            "residual_usd_day": _usd(r["unhedged"] - r["paper_move"]),
            "timing_usd_day": _usd(r["timing_basis"]),
            "route_usd_day": _usd(r["route_basis"]),
            "size_usd_day": _usd(r["size_basis"]),
            "days": _r(r["days"], 3),
            "curve_basket_t": r["curve_basket_t"],
            "ship_basket_t": r["ship_basket_t"],
        }
        for r in results["hedge_rows"]
    ]
    lab["sources_line"] = extra["sources_line"]["lab"]
    dump(data / "lab.json", lab)
    written.append(data / "lab.json")

    dump(data / "td3c.json", extra["td3c"] | {"sources_line": extra["sources_line"]["td3c"]})
    written.append(data / "td3c.json")
    dump(data / "method.json", extra["method"] | {"sources_line": extra["sources_line"]["method"]})
    written.append(data / "method.json")
    dump(data / "engine.json", {"artifact": "engine", "constants": engine.constants()})
    written.append(data / "engine.json")

    downloads = data / "downloads"
    write_csv(
        downloads / "hedge_effectiveness.csv",
        [
            "voyage",
            "horizon_months",
            "n",
            "first_fixture",
            "last_fixture",
            "effectiveness_k1",
            "ci_low",
            "ci_high",
            "effectiveness_kstar_oos",
            "n_oos",
            "sd_unhedged_usd_day",
            "sd_hedged_usd_day",
            "cvar_reduction_k1",
            "share_timing",
            "share_route",
            "share_size",
        ],
        [
            [
                c["voyage"],
                c["horizon_months"],
                c["n"],
                c["first_fixture"],
                c["last_fixture"],
                c["effectiveness_k1"],
                (c["effectiveness_k1_ci"] or {}).get("low"),
                (c["effectiveness_k1_ci"] or {}).get("high"),
                c["effectiveness_kstar_oos"],
                c["n_oos"],
                c["sd_unhedged_usd_day"],
                c["sd_hedged_usd_day"],
                c["cvar_reduction_k1"],
                c["residual_variance_share"]["timing"],
                c["residual_variance_share"]["route"],
                c["residual_variance_share"]["size"],
            ]
            for c in hedge_table
        ],
    )
    write_csv(
        downloads / "forecast_errors.csv",
        ["contract", "horizon_months", "priced_on", "basket_t", "error_usd_day", "error_pct", "settlement_status"],
        [
            [
                e["contract"],
                e["horizon_months"],
                e["priced_on"],
                e["basket_t"],
                e["error_usd_day"],
                e["error_pct"],
                e["settlement_status"],
            ]
            for e in roll["errors"]
        ],
    )
    write_csv(
        downloads / "roll_cost_by_year.csv",
        [
            "strategy",
            "year",
            "n",
            "contracts_on_180000_t",
            "contracts_on_182000_t",
            "roll_cost_usd_day",
            "roll_cost_pct",
            "ship_year_usd",
        ],
        [
            [
                name,
                r["year"],
                r["n"],
                r["baskets"]["180000"],
                r["baskets"]["182000"],
                r["roll_cost_usd_day"],
                r["roll_cost_pct"],
                r["ship_year_usd"],
            ]
            for name, key in (("one-month long", "roll_1m"), ("front-quarter long", "roll_quarter"))
            for r in roll[key]
        ],
    )
    write_csv(
        downloads / "monthly_settlements_5tc.csv",
        ["month", "status", "usd_day_180", "usd_day_182", "coverage", "published_url"],
        [
            [s["month"], s["status"], s["usd_day_180"], s["usd_day_182"], s["coverage"], s["published_url"]]
            for s in roll["settlements"]
        ],
    )
    write_csv(
        downloads / "hedge_outcomes.csv",
        [
            "fixture",
            "voyage",
            "horizon_months",
            "hedged_on",
            "days",
            "unhedged_usd_day",
            "paper_move_usd_day",
            "residual_usd_day",
            "timing_usd_day",
            "route_usd_day",
            "size_usd_day",
            "curve_basket_t",
            "ship_basket_t",
        ],
        [
            [
                h["fixture"],
                h["voyage"],
                h["horizon_months"],
                h["hedged_on"],
                h["days"],
                h["unhedged_usd_day"],
                h["paper_move_usd_day"],
                h["residual_usd_day"],
                h["timing_usd_day"],
                h["route_usd_day"],
                h["size_usd_day"],
                h["curve_basket_t"],
                h["ship_basket_t"],
            ]
            for h in lab["history"]
        ],
    )
    write_csv(
        downloads / "sec_freight_futures_marks.csv",
        [
            "fund",
            "product",
            "as_of",
            "contract_month",
            "contracts",
            "notional_usd",
            "price",
            "unit",
            "form",
            "filed",
            "url",
        ],
        [
            [
                m["fund"],
                m["product"],
                m["as_of"],
                m["contract_month"],
                m["contracts"],
                m["notional_usd"],
                round(m["price"], 4),
                m["unit"],
                m["form"],
                m["filed"],
                m["url"],
            ]
            for m in panel["sec_marks"]
        ],
    )
    write_csv(
        downloads / "td3c_weekly_prints.csv",
        [
            "week_ending",
            "td3c_ws_points",
            "td3c_tce_usd_day",
            "td34_ws_points",
            "td34_tce_usd_day",
            "thin_market",
            "source",
            "url",
        ],
        [
            [
                w,
                r["td3c_ws_points"],
                r["td3c_tce_usd_day"],
                r.get("td34_ws_points"),
                r.get("td34_tce_usd_day"),
                bool(r.get("thin_market")),
                r.get("source"),
                r.get("url"),
            ]
            for w, r in sorted(results["td3c"]["weekly"].items())
        ],
    )
    written += sorted(downloads.glob("*.csv"))
    manifest = dict(extra["manifest"])
    manifest["downloads"] = [
        {
            "file": path.name,
            "description": DOWNLOADS.get(path.stem, ""),
            "rows": max(0, len(path.read_text(encoding="utf-8").splitlines()) - 1),
        }
        for path in sorted(downloads.glob("*.csv"))
    ]
    dump(data / "manifest.json", manifest)
    written.append(data / "manifest.json")
    return written


#: What each CSV download holds (the manifest lists them with their row counts).
DOWNLOADS = {
    "hedge_effectiveness": "Effectiveness by voyage and horizon: k = 1 with its interval, k* out of sample, CVaR, "
    "residual shares",
    "hedge_outcomes": "Every fixture's surprise, paper move and basis components, USD a day (no price levels)",
    "forecast_errors": "Settlement less the FFA price 1, 2 and 3 months before, by contract month, USD a day",
    "roll_cost_by_year": "Roll cost of a rolling one-month and front-quarter long by year",
    "monthly_settlements_5tc": "Monthly 5TC settlement averages with their status and both baskets in 2026",
    "sec_freight_futures_marks": "Every BDRY and BWET freight future at each quarter end, from the SEC filings",
    "td3c_weekly_prints": "The Baltic's weekly TD3C and TD34 prints, each with its report's link",
}


def _bands(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Quantiles of the residual (TCE - settlement, at k = 1) by voyage and horizon, for the lab's basis bands.

    The route basis enters with its mean removed: its level is overstated (the voyage TCEs leave out port charges
    and the loading time at the port's scale, which have no public figure) while its spread is not, so the bands
    show the spread the hedge leaves around the locked level, not a level the data cannot support. The mean
    removed is kept in the band (route_mean_removed_usd_day).
    """
    import numpy as np

    out = []
    for voyage in hedge.VOYAGES:
        for h in analysis.HORIZONS:
            sel = [r for r in rows if r["voyage"] == voyage and r["horizon_months"] == h]
            if len(sel) < 10:
                continue
            route_mean = float(np.mean([r["route_basis"] for r in sel]))
            values = [r["unhedged"] - r["paper_move"] - route_mean for r in sel]
            q = np.percentile(values, [5, 25, 50, 75, 95])
            out.append(
                {
                    "voyage": voyage,
                    "horizon_months": h,
                    "n": len(values),
                    "route_mean_removed_usd_day": _usd(route_mean),
                    "p05": _usd(q[0]),
                    "p25": _usd(q[1]),
                    "p50": _usd(q[2]),
                    "p75": _usd(q[3]),
                    "p95": _usd(q[4]),
                }
            )
    return out
