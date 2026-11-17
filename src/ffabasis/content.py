"""The words and tables around the numbers: conventions, validation, coverage, facts, sources.

Every figure placed here is read from the panel, the public records or the
engine at build time; the prose holds no number of its own except the
contract and convention figures, each with its document and page.
"""

from __future__ import annotations

import datetime as dt
import json
from collections import Counter
from pathlib import Path
from typing import Any

from . import engine, td3c, voyage
from .sources import docs

GMB88 = "Baltic Exchange, Guide to Market Benchmarks v8.8 (September 2026)"
GMB709 = "Baltic Exchange, Guide to Market Benchmarks v7.09 (December 2025)"
EEX = "EEX Contract Specifications for Trade Registration, release 047a (23 July 2026)"
ICE = "ICE Futures Europe, TD3C FFA Middle East Gulf to China (Baltic) Future (TDL), contract specification"
URLS = {d.key: d.url for d in docs.DOCUMENTS}


def clean(text: str | None) -> str | None:
    """Third-party sentences go on the site with long dashes turned into commas (the site carries none)."""
    if text is None:
        return None
    return " ".join(text.replace("\u2014", ",").replace("\u2013", ",").split())


def conventions() -> list[dict[str, Any]]:
    return [
        {
            "name": "5TC basket, 180,000 t (to 24 December 2025)",
            "rule": "C5TC = Sum(C8_14 x 0.25, C9_14 x 0.125, C10_14 x 0.25, C14 x 0.25, C16 x 0.125), the Baltic "
            "Capesize (BCI180) of 180,000 dwt, every route at 5 percent total commission",
            "source": GMB709,
            "where": "printed page 75",
            "url": URLS["baltic_gmb_legacy_path"],
        },
        {
            "name": "5TC basket, 182,000 t (from 2 January 2026)",
            "rule": "C5TC(182) = Sum(C8_182 x 0.15, C9_182 x 0.125, C10_182 x 0.35, C14_182 x 0.25, C16_182 x 0.125); "
            "C5TC(180) is a derived value, C5TC(182) less USD 3,503 a day",
            "source": GMB88,
            "where": "printed page 77",
            "url": URLS["baltic_gmb_current"],
        },
        {
            "name": "Capesize futures, EEX",
            "rule": "CPTM (180,000 t basket) and C5TM (182,000 t basket): one day a lot, USD a day to two decimals, the "
            "underlying the arithmetic average of all the Baltic's daily assessments of the month; December's "
            "last registration day is 24 December. (BDRY's filings name its 180 kt contract C5TCM, a data "
            "vendor ticker.)",
            "source": EEX,
            "where": "pages 7 and 8",
            "url": URLS["eex_contract_specs_047a"],
        },
        {
            "name": "TD3C route",
            "rule": "270,000 t Middle East Gulf to China (Ras Tanura to Ningbo), laydays 15/30 days from index date, age "
            "max 15 years, 3.75 percent total commission; published in Worldscale (TD3C), in USD a tonne "
            "(TD3C$) and as a round-trip TCE (TD3C-TCE: 2 days load, 2 discharge, 2 waiting)",
            "source": GMB88,
            "where": "printed pages 84 and 87",
            "url": URLS["baltic_gmb_current"],
        },
        {
            "name": "TD3C futures, ICE (TDL)",
            "rule": "1,000 t a lot, USD a tonne to 0.0001; final settlement the average of the Baltic's assessments for "
            "each Baltic publication day of the month; December expires on the 24th or the business day before",
            "source": ICE,
            "where": "specification sheet, retrieved 17 November 2026",
            "url": URLS["ice_tdl_spec"],
        },
        {
            "name": "Gross against net",
            "rule": "A time charter index and its FFA are gross daily hire; a voyage TCE is net of commission and is "
            "grossed up by it before the comparison; the owner keeps the net share, so its hedge is the "
            "voyage's days times that share",
            "source": GMB88,
            "where": "section 7.4.3, pages 35 and 36",
            "url": URLS["baltic_gmb_current"],
        },
        {
            "name": "Baltic standard Capesize of the date",
            "rule": "BCI182 from 2 January 2026: 14 knots on 52 t laden, 44 t ballast (GMB v8.8 page 78). BCI180 before: "
            "14 knots laden or 15 knots ballast on 62 t, 12 or 13 knots on 43 t (GMB v7.09 page 76). Each "
            "priced at its fastest pairs.",
            "source": GMB88 + "; " + GMB709,
            "where": "printed pages 78 and 76",
            "url": URLS["baltic_gmb_current"],
        },
        {
            "name": "Publication days",
            "rule": "London business days: weekdays less England and Wales bank holidays, by statute and proclamation",
            "source": "Banking and Financial Dealings Act 1971; Amplify Commodity Trust 10-Q (30 September 2025)",
            "where": "schedule 1; note 1",
            "url": "https://www.sec.gov/Archives/edgar/data/1610940/000121390025110548/ea0263477-10q_amplify.htm",
        },
    ]


def formulas() -> list[dict[str, str]]:
    return [
        {
            "name": "Settlement",
            "text": "S(month) = average of the Baltic's assessments on every publication day of the "
            "month; a quarter is the average of its three months",
        },
        {"name": "Basis", "text": "basis = FFA - spot, per tenor, on the same basket"},
        {
            "name": "Strip",
            "text": "F0 = sum over months of days(month) x F(month) / voyage days, days counted from the fixture date",
        },
        {
            "name": "Hedge size",
            "text": "FFA days in a month = voyage days in that month x (1 - commission) x k; TD3C "
            "in tonnes equal to the cargo",
        },
        {"name": "Paper", "text": "short (owner): (F0 - S) x size; long (charterer): (S - F0) x size"},
        {
            "name": "Surprise",
            "text": "U = gross TCE - F0; hedged = U - k (S - F0); effectiveness = 1 - Var(hedged) / Var(U)",
        },
        {
            "name": "Residual at k = 1",
            "text": "TCE - S = (TCE - 5TC on the day) route + (5TC on the day - S on the "
            "ship's basket) timing + (S ship - S curve) size",
        },
        {
            "name": "Forecast error",
            "text": "error = S - F(h months before expiry); roll cost of a rolling long = "
            "F - S (positive: the long pays, the short earns)",
        },
        {"name": "Worldscale", "text": "USD a tonne = WS / 100 x flat rate"},
    ]


def validation(panel: dict[str, Any], results: dict[str, Any]) -> list[dict[str, Any]]:
    """Each anchor of the brief: expected, reproduced, error, and where it was read."""
    rows: list[dict[str, Any]] = []

    def add(
        group: str,
        item: str,
        expected: float,
        got: float | None,
        unit: str,
        url: str | None,
        tol: float = 0.5,
        note: str = "",
    ) -> None:
        error = None if got is None else got - expected
        rows.append(
            {
                "group": group,
                "item": item,
                "expected": expected,
                "reproduced": got,
                "unit": unit,
                "error": error,
                "ok": got is not None and abs(error) <= tol,
                "url": url,
                "note": note,
            }
        )

    sec_url = "https://www.sec.gov/Archives/edgar/data/1610940/000121390025110548/ea0263477-10q_amplify.htm"
    marks = {(m["fund"], m["as_of"], m["contract_month"]): m for m in panel["sec_marks"]}
    for month, value in (("2025-10", 24864), ("2025-11", 24707), ("2025-12", 23121)):
        m = marks.get(("BDRY", "2025-09-30", month))
        add(
            "SEC 10-Q, 30 September 2025",
            f"BDRY Capesize {month}, notional / contracts",
            value,
            None if m is None else m["price"],
            "usd_day",
            sec_url,
            0.0,
        )
    for month, value in (("2025-10", 17.412), ("2025-11", 16.285), ("2025-12", 16.047)):
        m = marks.get(("BWET", "2025-09-30", month))
        add(
            "SEC 10-Q, 30 September 2025",
            f"BWET TD3C {month}, notional / contracts / 1,000",
            value,
            None if m is None else round(m["price"], 4),
            "usd_t",
            sec_url,
            0.0,
        )

    def curve_value(date: str, period: str) -> float | None:
        c = panel["curves"].get(date, {})
        t = c.get("tenors", {}).get(period)
        return None if t is None else t["usd_day"]

    w27 = [
        ("2022-07", 22764),
        ("2022-08", 27857),
        ("2022-09", 29857),
        ("2022-10", 28821),
        ("2022-Q3", 26826),
        ("2022-Q4", 26282),
        ("2023-Q1", 12786),
        ("2023-Q2", 17271),
    ]
    url22 = panel["curves"].get("2022-07-11", {}).get("url")
    for period, value in w27:
        add(
            "Banchero Costa week 27 of 2022, FFA of 11 July",
            period,
            value,
            curve_value("2022-07-11", period),
            "usd_day",
            url22,
            0.0,
        )
    for day, value in (("2022-07-08", 18825), ("2022-07-01", 19745)):
        d = panel["daily"].get(day)
        add(
            "Banchero Costa week 27 of 2022, BCI TC average",
            day,
            value,
            None if d is None else d["value_180"],
            "usd_day",
            url22,
            0.0,
        )
    r22 = panel["routes"].get("2022-07-08", {})
    add("Banchero Costa week 27 of 2022", "C3, 8 July", 30.13, r22.get("c3_usd_t"), "usd_t", url22, 0.0)
    add("Banchero Costa week 27 of 2022", "C5, 8 July", 11.39, r22.get("c5_usd_t"), "usd_t", url22, 0.0)

    w30 = [
        ("2026-07", 38360),
        ("2026-08", 35228),
        ("2026-09", 38392),
        ("2026-10", 39535),
        ("2026-12", 37621),
        ("2027-Q1", 28157),
        ("2027-Q2", 34728),
        ("2027-Q3", 33349),
    ]
    url26 = panel["curves"].get("2026-07-27", {}).get("url")
    for period, value in w30:
        add(
            "Banchero Costa week 30 of 2026, FFA of 27 July (182,000 t basket)",
            period,
            value,
            curve_value("2026-07-27", period),
            "usd_day",
            url26,
            0.0,
        )
    d = panel["daily"].get("2026-07-24")
    add(
        "Banchero Costa week 30 of 2026, BCI TC average (180,000 t)",
        "24 July",
        35357,
        None if d is None else d["value_180"],
        "usd_day",
        url26,
        0.0,
    )
    r26 = panel["routes"].get("2026-07-24", {})
    add(
        "Banchero Costa week 30 of 2026 (route rates, USD a tonne)",
        "C3, 24 July",
        34.68,
        r26.get("c3_usd_t"),
        "usd_t",
        url26,
        0.0,
    )
    add(
        "Banchero Costa week 30 of 2026 (route rates, USD a tonne)",
        "C5, 24 July",
        12.86,
        r26.get("c5_usd_t"),
        "usd_t",
        url26,
        0.0,
    )
    settle = results["settlements"]
    july = settle.get("2026-07")
    if july:
        s182 = july["value_180"] + engine.C5TC_180_DIFFERENTIAL_USD_DAY
        july_price = (panel["curves"].get("2026-07-27", {}).get("tenors", {}).get("2026-07") or {}).get("usd_day")
        nearer = None
        if july_price is not None:
            nearer = 182000 if abs(july_price - s182) < abs(july_price - july["value_180"]) else 180000
        rows.append(
            {
                "group": "Banchero Costa week 30 of 2026, basket of the curve",
                "item": "July contract on 27 July against July's settlement on each basket: the nearer basket",
                "expected": 182000,
                "reproduced": nearer,
                "unit": "basket_t",
                "error": None if nearer is None else nearer - 182000,
                "ok": nearer == 182000,
                "url": url26,
                "note": "July 2026 settled at %s on 182,000 t and %s on 180,000 t; the curve's %s is %s from "
                "the first and %s from the second"
                % (
                    format(round(s182), ","),
                    format(round(july["value_180"]), ","),
                    "n/a" if july_price is None else format(round(july_price), ","),
                    "n/a" if july_price is None else format(round(july_price - s182), ","),
                    "n/a" if july_price is None else format(round(july_price - july["value_180"]), ","),
                ),
            }
        )

    # The basket gap from what the sources printed on each day: the 182,000 t print (handybulk) less a 180,000 t
    # print of another source (Banchero Costa's table on 3 July, Reuters on 29 July).
    for day, expected_182, expected_180, url in (
        ("2026-07-03", 37181, 33678, "https://www.handybulk.com/baltic-dry-index/2026/july/"),
        ("2026-07-29", 36887, 33384, URLS["maritimeprofessional_baltic_2026_07_29"]),
    ):
        prints = (panel.get("anchor_prints") or {}).get(day, [])
        p182 = next((x for x in prints if x["basket_t"] == 182000), None)
        p180 = next((x for x in prints if x["basket_t"] == 180000 and x["source"] != (p182 or {}).get("source")), None)
        add(
            "2026 basket gap",
            f"{day}: 182,000 t print less 180,000 t print",
            3503.0,
            None if p182 is None or p180 is None else float(p182["usd_day"] - p180["usd_day"]),
            "usd_day",
            url,
            0.0,
            note=(
                "no pair of prints on the day"
                if p182 is None or p180 is None
                else "%s prints %s (182,000 t), %s prints %s (180,000 t)"
                % (
                    p182["source"],
                    format(round(p182["usd_day"]), ","),
                    p180["source"],
                    format(round(p180["usd_day"]), ","),
                )
            ),
        )
        for basket, expected, found in ((182000, expected_182, p182), (180000, expected_180, p180)):
            add(
                "2026 basket gap",
                f"{day}: the {format(basket, ',')} t print as the brief quotes it",
                float(expected),
                None if found is None else float(found["usd_day"]),
                "usd_day",
                url,
                0.0,
            )
        d = panel["daily"].get(day)
        add(
            "2026 basket gap",
            f"{day}: the study's daily series on 180,000 t",
            float(expected_180),
            None if d is None else d["value_180"],
            "usd_day",
            url,
            0.0,
        )

    weekly = panel["td3c_weekly"]
    for week, ws, tce in (
        ("2025-12-12", 125.78, 122676),
        ("2026-10-09", 1318.75, 1412594),
        ("2026-11-13", 1014.38, 1078714),
    ):
        w = weekly.get(week, {})
        add("TD3C weekly prints", f"week to {week}, WS", ws, w.get("td3c_ws_points"), "ws_points", w.get("url"), 0.0)
        add("TD3C weekly prints", f"week to {week}, TCE", tce, w.get("td3c_tce_usd_day"), "usd_day", w.get("url"), 0.0)
    w = weekly.get("2026-10-09", {})
    add(
        "TD3C weekly prints",
        "week to 2026-10-09, TD34 WS",
        841.07,
        w.get("td34_ws_points"),
        "ws_points",
        w.get("url"),
        0.0,
    )
    add(
        "TD3C weekly prints",
        "week to 2026-10-09, TD34 TCE",
        912660,
        w.get("td34_tce_usd_day"),
        "usd_day",
        w.get("url"),
        0.0,
    )

    bw = {r["report_date"]: r for r in panel.get("breakwave", [])}
    for day, usd, idx in (("2025-10-21", 20.73, 1658), ("2026-06-30", 59.62, 3711), ("2026-09-08", 136.98, 11230)):
        r = bw.get(day, {})
        add(
            "Breakwave tanker reports", f"{day}, TD3C USD a tonne", usd, r.get("td3c_usd_t"), "usd_t", r.get("url"), 0.0
        )
        add(
            "Breakwave tanker reports",
            f"{day}, Tanker Futures Index",
            idx,
            r.get("btfi_points"),
            "points",
            r.get("url"),
            0.0,
        )

    paper = voyage.paper()
    c3 = voyage.tce(voyage.anchor_inputs("C3", "2026-07-03"))
    c5 = voyage.tce(voyage.anchor_inputs("C5", "2026-10-23", freight_usd_t=14.15))
    vurl = "https://github.com/nathancouturier/voyage-tce-model/blob/0be3b7eb0c1bfda63135ce717b5cb4b335426532/data/paper.json"
    rows.append(
        {
            "group": "Vendored voyage engine",
            "item": "C3, 3 July 2026, USD 30.11 a tonne",
            "expected": 35429.099952,
            "reproduced": round(c3, 6),
            "unit": "usd_day",
            "error": c3 - 35429.099952,
            "ok": abs(c3 / 35429.099952 - 1) < 1e-9,
            "url": vurl,
            "note": "relative error below 1e-9",
        }
    )
    rows.append(
        {
            "group": "Vendored voyage engine",
            "item": "C5 fixture, 22 October 2026, USD 14.15 a wet tonne",
            "expected": paper["c5_fixture"]["fixture_tce_usd_day"],
            "reproduced": round(c5, 6),
            "unit": "usd_day",
            "error": c5 - 43669.795671,
            "ok": abs(c5 / 43669.795671 - 1) < 1e-9,
            "url": vurl,
            "note": "relative error below 1e-9",
        }
    )

    for month, row in sorted(settle.items()):
        if row["status"] == "complete" and row.get("published_180") is not None:
            add(
                "Monthly 5TC averages (180,000 t) against Himalaya Shipping's published averages",
                month,
                row["published_180"],
                round(row["value_180"], 2),
                "usd_day",
                row.get("published_url"),
                50.0,
            )
    return rows


MONTH_NAMES = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)  # fmt: skip


def month_ranges(months: list[str]) -> str:
    """Months as runs of consecutive months: 2023-07, 2026-01 ... 2026-10 read "July 2023; January to October 2026"."""
    runs: list[list[str]] = []
    for m in months:
        if runs and engine.add_months(runs[-1][-1], 1) == m:
            runs[-1].append(m)
        else:
            runs.append([m])

    def name(m: str, year: bool = True) -> str:
        return MONTH_NAMES[int(m[5:7]) - 1] + (f" {m[:4]}" if year else "")

    parts = []
    for run in runs:
        first, last = run[0], run[-1]
        if first == last:
            parts.append(name(first))
        elif first[:4] == last[:4]:
            parts.append(f"{name(first, False)} to {name(last)}")
        else:
            parts.append(f"{name(first)} to {name(last)}")
    return "; ".join(parts)


def coverage(panel: dict[str, Any], results: dict[str, Any]) -> dict[str, Any]:
    curves = results["curves"]
    years = Counter(c["date"][:4] for c in curves)
    settle = results["settlements"]
    status_by_year: dict[str, Counter] = {}
    for month, row in settle.items():
        status_by_year.setdefault(month[:4], Counter())[row["status"]] += 1
    hedge_n = Counter((r["voyage"], r["horizon_months"]) for r in results["hedge_rows"])
    td3c_sources = Counter(r.get("source", "") for r in panel["td3c_weekly"].values())
    return {
        "first_ffa_week": curves[0]["date"] if curves else None,
        "last_ffa_week": curves[-1]["date"] if curves else None,
        "ffa_weeks_by_year": dict(sorted(years.items())),
        "issues_read": len(panel["issues"]),
        "ocr_issues": sum(1 for i in panel["issues"] if i.get("ocr")),
        "ocr_ffa_tenors": panel.get("ocr_ffa_tenors"),
        "settlements_by_year": {y: dict(c) for y, c in sorted(status_by_year.items())},
        "exact_months_180": sum(1 for r in settle.values() if r["status"] in ("complete", "published")),
        "exact_months_182": sum(
            1 for m, r in settle.items() if r["status"] in ("complete", "published") and m >= engine.BASKET_182_FROM[:7]
        ),
        "complete_months_180": sum(1 for r in settle.values() if r["status"] == "complete"),
        "complete_months_182": sum(
            1 for m, r in settle.items() if r["status"] == "complete" and m >= engine.BASKET_182_FROM[:7]
        ),
        "complete_months": month_ranges(sorted(m for m, r in settle.items() if r["status"] == "complete")),
        "published_months": month_ranges(sorted(m for m, r in settle.items() if r["status"] == "published")),
        "daily_days": len(panel["daily"]),
        "daily_printed_days": sum(1 for v in panel["daily"].values() if v.get("kind") == "printed"),
        "daily_implied_days": sum(1 for v in panel["daily"].values() if v.get("kind") == "implied"),
        "hedge_observations": [{"voyage": v, "horizon_months": h, "n": n} for (v, h), n in sorted(hedge_n.items())],
        "td3c_weekly": len(panel["td3c_weekly"]),
        "td3c_weekly_first": min(panel["td3c_weekly"]) if panel["td3c_weekly"] else None,
        "td3c_weekly_last": max(panel["td3c_weekly"]) if panel["td3c_weekly"] else None,
        "td3c_sources": dict(td3c_sources),
        "breakwave_reports": len(panel.get("breakwave", [])),
        "sec_quarter_ends_bdry": len({m["as_of"] for m in panel["sec_marks"] if m["fund"] == "BDRY"}),
        "sec_quarter_ends_bwet": len({m["as_of"] for m in panel["sec_marks"] if m["fund"] == "BWET"}),
    }


def long_date(iso: str | None) -> str:
    """2023-10-20 as "20 October 2023"."""
    if not iso:
        return "n/a"
    d = dt.date.fromisoformat(iso)
    return f"{d.day} {MONTH_NAMES[d.month - 1]} {d.year}"


def limitations(cov: dict[str, Any], results: dict[str, Any]) -> list[dict[str, str]]:
    """What the study cannot do, with the coverage figures that bound it (the README states the same)."""
    hedge = [r for r in results["hedge_rows"] if r["voyage"] == "C5" and r["horizon_months"] == 1]
    first = long_date(min((r["fixture"] for r in hedge), default=None))
    return [
        {
            "title": "A hedging study, not a forecast or a strategy",
            "text": "There is no signal, no position sizing and no profit and loss presented as a strategy. Forward "
            "bias and roll cost are costs and premiums a hedger faces, reported as such.",
        },
        {
            "title": "The daily 5TC is public in full only from January 2026",
            "text": "A month's settlement is the study's own average only when every London publication day is in a "
            "public print or implied by the next day's printed change "
            f"({cov['complete_months']}); otherwise it is the average Himalaya Shipping published in "
            "its SEC filings (May 2023 onwards), which agrees with every complete month to within a dollar. Earlier "
            "months have only partial averages and enter the robustness checks alone.",
        },
        {
            "title": "The forward curve is one broker's weekly assessment",
            "text": f"Banchero Costa's weekly (mostly Monday) Capesize FFA assessments as Hellenic Shipping News "
            f"republishes them, "
            f"{long_date(cov['first_ffa_week'])} to {long_date(cov['last_ffa_week'])}, with gaps where issues were "
            "not reachable. The "
            "next issue's previous-week column is a re-assessment; the study uses first prints and shows the latest "
            "as a sensitivity.",
        },
        {
            "title": "Some tables were read by OCR",
            "text": f"{cov['ocr_issues']} of {cov['issues_read']} issues had at least one table set in fonts that "
            "do not extract as text. A row read by OCR is kept only if it reproduces its own printed week-on-week "
            "change (bunkers: the printed spread between grades).",
        },
        {
            "title": "Voyage earnings are estimates, not fixtures",
            "text": "C3 and C5 TCEs come from the voyage engine with the Baltic's standard ship of the date and that "
            "week's Singapore bunkers. Port charges and loading time at the port's scale have no public figure and "
            "are left out, so the level of the route basis is overstated; its variability, which drives the results, "
            "is not. No route FFA is used: a voyage hedged with 5TC paper carries route basis by construction.",
        },
        {
            "title": "The hedge sample is short",
            "text": f"Hedged fixtures with exact settlements start on {first}; the out-of-sample hedge ratio needs 52 "
            "settled fixtures first, so it covers the later part of the sample only. Intervals are wide and a "
            "percentile interval can sit off its estimate in small samples.",
        },
        {
            "title": "TD3C in dollars a tonne is approximate",
            "text": "The Baltic's weekly reports give TD3C in Worldscale. Flat rates are licensed and never stated; "
            "dated public pairs (a Breakwave dollar print and the Baltic's Worldscale print four days earlier) imply a "
            "consistent one only in the second half of 2025, so the study keeps Worldscale and the dollar case "
            "studies use Breakwave's bi-weekly prints, a month settled at the average of its one to three prints. A "
            "month with one print settles at its own fixture, so the share of variance a TD3C hedge removes is not "
            "computed (too few months have two prints); the forward errors are, labelled approximate.",
        },
        {
            "title": "The published hedging studies could not be obtained",
            "text": "Their publishers' and repositories' sites could not be reached when the data were gathered, so no "
            "published result is quoted; Ederington's measure is reported for the reader to set beside them.",
        },
    ]


#: Where a reader finds each source family: its archive, listing or filer page (every document's own address is
#: in data/raw/manifest.json).
SOURCE_LINKS = {
    "Banchero Costa weekly reports (via Hellenic Shipping News)": [
        {
            "label": "Hellenic Shipping News, Banchero Costa reports",
            "url": "https://www.hellenicshippingnews.com/?s=banchero+costa",
        }
    ],
    "Breakwave tanker reports (via Hellenic Shipping News)": [
        {
            "label": "Hellenic Shipping News, Breakwave reports",
            "url": "https://www.hellenicshippingnews.com/?s=breakwave",
        },
        {"label": "Breakwave Advisors, 7 April 2026", "url": "https://www.breakwaveadvisors.com/insights/tanker4726"},
    ],
    "Baltic Exchange weekly reports": [
        {
            "label": "Baltic Exchange weekly roundup",
            "url": "https://www.balticexchange.com/en/data-services/WeeklyRoundup.html",
        }
    ],
    "Baltic Exchange guides and notes": [
        {
            "label": "Guide to Market Benchmarks",
            "url": "https://www.balticexchange.com/content/dam/balticexchange/consumer/documents/data-services/"
            "documentation/ocean-bulk-guides-policies/GMB.pdf",
        }
    ],
    "handybulk.com daily archive": [
        {"label": "handybulk.com Baltic Dry Index archive", "url": "https://www.handybulk.com/baltic-dry-index/"}
    ],
    "Reuters daily reports as republished": [
        {"label": "Cyprus Shipping News", "url": "https://cyprusshippingnews.com/"},
        {"label": "MarineLink", "url": "https://www.marinelink.com/"},
        {"label": "Maritime Professional", "url": "https://www.maritimeprofessional.com/"},
    ],
    "The Edge Malaysia (Baltic weekly report)": [{"label": "The Edge Malaysia", "url": "https://theedgemalaysia.com/"}],
    "SEC EDGAR (Amplify Commodity Trust, Himalaya Shipping)": [
        {
            "label": "Amplify Commodity Trust filings",
            "url": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001610940&type=10-&dateb=&owner=include&count=40",
        },
        {
            "label": "Himalaya Shipping filings",
            "url": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001959455&type=6-K&dateb=&owner=include&count=40",
        },
    ],
    "Exchanges (EEX, ICE)": [
        {
            "label": "EEX contract specifications, release 047a",
            "url": "https://www.eex.com/fileadmin/EEX/Downloads/Rules/EEX-Contract_Specifications_for_Trade_Registration/"
            "20260723_EEX_Contract_Specifications_for_Trade_Registration_047a_EN_FINAL.pdf",
        },
        {
            "label": "ICE TD3C future (TDL) specification",
            "url": "https://www.ice.com/api/productguide/spec/57250507/pdf",
        },
    ],
    "EIA": [
        {"label": "EIA, Today in Energy, 26 March 2026", "url": "https://www.eia.gov/todayinEnergy/detail.php?id=67386"}
    ],
}


def manifest(root: Path, panel: dict[str, Any]) -> dict[str, Any]:
    """Provenance: each source family, how many documents, the first and latest retrieval, licence."""
    data = json.loads((root / "data" / "raw" / "manifest.json").read_text(encoding="utf-8"))
    families: dict[str, dict[str, Any]] = {}
    rules = (
        ("Banchero Costa weekly reports (via Hellenic Shipping News)", lambda e: "Bancosta" in e["url"]),
        ("Breakwave tanker reports (via Hellenic Shipping News)", lambda e: "BreakwaveTankers" in e["url"]),
        ("Baltic Exchange weekly reports", lambda e: e["key"].startswith("baltic_") and "report" in e["key"]),
        ("Baltic Exchange guides and notes", lambda e: e["key"].startswith("baltic_") and "report" not in e["key"]),
        ("handybulk.com daily archive", lambda e: "handybulk" in e["url"]),
        (
            "Reuters daily reports as republished",
            lambda e: (
                any(h in e["url"] for h in ("marinelink.com", "cyprusshippingnews.com", "maritimeprofessional.com"))
                or ("hellenicshippingnews.com/wp-json/wp/v2/posts" in e["url"])
            ),
        ),
        ("The Edge Malaysia (Baltic weekly report)", lambda e: "theedgemalaysia.com" in e["url"]),
        ("SEC EDGAR (Amplify Commodity Trust, Himalaya Shipping)", lambda e: "sec.gov" in e["url"]),
        ("Exchanges (EEX, ICE)", lambda e: any(h in e["url"] for h in ("eex.com", "ice.com"))),
        ("EIA", lambda e: "eia.gov" in e["url"]),
    )
    for entry in data["entries"]:
        for name, test in rules:
            if test(entry):
                f = families.setdefault(
                    name,
                    {
                        "documents": 0,
                        "first_retrieved": entry["retrieved_at"],
                        "last_retrieved": entry["retrieved_at"],
                        "licence": set(),
                    },
                )
                f["documents"] += 1
                f["first_retrieved"] = min(f["first_retrieved"], entry["retrieved_at"])
                f["last_retrieved"] = max(f["last_retrieved"], entry["retrieved_at"])
                if entry.get("licence") and entry["licence"] != "listing":
                    f["licence"].add(entry["licence"])
                break
    out = []
    for name, f in families.items():
        out.append(
            {
                "source": name,
                "links": SOURCE_LINKS.get(name, []),
                "documents": f["documents"],
                "first_retrieved": f["first_retrieved"],
                "last_retrieved": f["last_retrieved"],
                "licence": sorted(f["licence"]),
            }
        )
    as_of = {
        "ffa_curve": panel["curves"] and max(d for d, c in panel["curves"].items() if c.get("tenors")),
        "daily_5tc": max(panel["daily"]) if panel["daily"] else None,
        "td3c_weekly": max(panel["td3c_weekly"]) if panel["td3c_weekly"] else None,
        "sec_marks": max(m["as_of"] for m in panel["sec_marks"]) if panel["sec_marks"] else None,
        "published_5tc": max(r["month"] for r in panel.get("published_5tc", []))
        if panel.get("published_5tc")
        else None,
        "breakwave": panel["breakwave"][-1]["report_date"] if panel.get("breakwave") else None,
    }
    return {
        "artifact": "manifest",
        "built_on": panel["built_on"],
        "as_of": as_of,
        "sources": out,
        "documents": len(data["entries"]),
    }


def facts(panel: dict[str, Any], results: dict[str, Any]) -> list[dict[str, Any]]:
    c5 = next((r for r in results["hedge"] if r["voyage"] == "C5" and r["horizon_months"] == 1), None)
    contango = results["shape"]["front_vs_spot"].get("all", {})
    weekly = panel["td3c_weekly"]
    peak_week = max(weekly, key=lambda w: weekly[w]["td3c_ws_points"]) if weekly else None
    out = []
    if c5:
        out.append(
            {
                "key": "basis_left",
                "value_usd_day": round(c5["sd_hedged_usd_day"]),
                "unhedged_usd_day": round(c5["sd_unhedged_usd_day"]),
                "n": c5["n"],
            }
        )
    if contango:
        out.append(
            {
                "key": "contango_share",
                "value": round(contango["contango"], 4),
                "n": contango["n"],
                "measure": "front month above the spot of the curve's day, or of the latest earlier day within four days (the Friday before a Monday curve), on the same basket",
            }
        )
    if peak_week:
        w = weekly[peak_week]
        out.append(
            {
                "key": "td3c_peak",
                "week": peak_week,
                "ws_points": w["td3c_ws_points"],
                "tce_usd_day": w["td3c_tce_usd_day"],
                "url": w.get("url"),
            }
        )
    return out


def td3c_artifact(panel: dict[str, Any], results: dict[str, Any], as_of: str) -> dict[str, Any]:
    t = results["td3c"]
    weekly = [
        {
            "week": w,
            "ws_points": r["td3c_ws_points"],
            "tce_usd_day": r["td3c_tce_usd_day"],
            "td34_ws_points": r.get("td34_ws_points"),
            "td34_tce_usd_day": r.get("td34_tce_usd_day"),
            "assessed_day": r.get("assessed_day"),
            "td34_assessed_day": r.get("td34_assessed_day"),
            "thin_market": bool(r.get("thin_market")),
            "thin_reason": r.get("thin_reason"),
            "note": clean(" ".join(x for x in (r.get("range_note"), r.get("assessment_note")) if x) or None),
            "url": r.get("url"),
            "source": r.get("source"),
        }
        for w, r in sorted(t["weekly"].items())
    ]
    for w, typo in (t.get("source_typos") or {}).items():
        r = t["weekly_printed"][w]
        weekly.append(
            {
                "week": w,
                "ws_points": None,
                "tce_usd_day": None,
                "td34_ws_points": r.get("td34_ws_points"),
                "td34_tce_usd_day": r.get("td34_tce_usd_day"),
                "assessed_day": r.get("assessed_day"),
                "td34_assessed_day": r.get("td34_assessed_day"),
                "thin_market": False,
                "thin_reason": None,
                "note": None,
                "source_typo": typo["note"],
                "ws_points_printed": typo["ws_points_printed"],
                "tce_usd_day_printed": typo["tce_usd_day_printed"],
                "url": r.get("url"),
                "source": r.get("source"),
            }
        )
    weekly.sort(key=lambda row: row["week"])
    flat = {
        p: {
            k: (round(v, 4) if k == "dispersion" else v) for k, v in f.items() if k in ("n", "dispersion", "consistent")
        }
        | {"tolerance": td3c.FLAT_RATE_DISPERSION, "min_pairs": td3c.MIN_PAIRS}
        for p, f in t["flat"].items()
    }
    return {
        "artifact": "td3c",
        "as_of": t.get("as_of") or as_of,
        "weekly": weekly,
        "breakwave": [
            {
                "date": b["report_date"],
                "td3c_usd_t": b.get("td3c_usd_t"),
                "btfi_points": b.get("btfi_points"),
                "url": b.get("url"),
            }
            for b in t["breakwave"]
        ],
        "strips": t["strips"],
        "monthly": {
            # Worldscale only: a dollar figure beside the Worldscale average it came from would state the
            # implied flat rate (data policy: flat rates are never published).
            m: {
                "ws_points": round(v["ws_points"], 2),
                "weeks": v["weeks"],
                "flagged_weeks": v["flagged_weeks"],
                "month_to_date": bool(v.get("month_to_date")),
            }
            for m, v in t["monthly"].items()
        },
        "flat_rate_test": flat,
        "dollar_months": {
            m: {k: (round(v, 3) if isinstance(v, float) else v) for k, v in d.items()}
            for m, d in t["dollar_months"].items()
        },
        "cases": [
            c
            | {
                "fixture_source": "The month's first Breakwave TD3C print in USD a tonne (the cargo's freight)",
                "settlement_source": "The average of the month's Breakwave TD3C prints, one to three a month: an "
                "approximation of the ICE TDL settlement, which averages every Baltic publication day; a month "
                "with one print settles at its own fixture, so its paper exactly offsets its physical side",
                "mark_source": "Amplify Commodity Trust (BWET) futures schedule at the quarter end: notional / "
                "(contracts x 1,000 t)",
            }
            for c in t["cases"]
        ],
        "statistics": {
            "by_horizon": t["statistics"]["by_horizon"],
            "counts": t["statistics"]["counts"],
            "threshold_months": t["statistics"]["threshold_months"],
            "rows": t["statistics"]["rows"],
            "without_thin_weeks": t["statistics_without_thin_weeks"]["by_horizon"],
            "min_prints_for_residual": t["statistics"]["min_prints_for_residual"],
        },
        "breakwave_statement": td3c.BREAKWAVE_STATEMENT,
        "statement_check": t["statement_check"],
        "events": [
            {
                "date": "2026-03-02",
                "text": "Iran closes the Strait of Hormuz",
                "source": "EIA, Today in Energy, 26 March 2026",
                "url": URLS["eia_tie_67386"],
            },
            {
                "date": "2026-03-26",
                "text": "TD34, 270,000 t Gulf of Oman to China, first assessed (WS197) as an alternative to TD3C on "
                "public trial",
                "source": "Baltic Exchange weekly tanker report, week 13 of 2026; route: Guide to Market Benchmarks "
                "v8.8, page 87 (Mina Al Fahal to Ningbo)",
                "url": "https://www.balticexchange.com/en/data-services/WeeklyRoundup/tanker/news/2026/"
                "tanker-report-week-13.html",
            },
        ],
    }


def lab_defaults(panel: dict[str, Any], results: dict[str, Any]) -> dict[str, Any]:
    latest = results["curves"][-1] if results["curves"] else None
    last_friday = max(panel["routes"]) if panel["routes"] else None
    days = {}
    if last_friday:
        from . import hedge

        for route in ("C3", "C5"):
            v = hedge.voyage_on(panel, route, last_friday)
            if v:
                days[route] = round(v["days"], 3)
    bwet = td3c.quarter_end_strips(panel["sec_marks"])
    return {
        "artifact": "lab",
        "curve": None
        if latest is None
        else {
            "date": latest["date"],
            "basket_t": latest["basket_t"],
            "tenors": [{"period": p, "usd_day": v} for p, v in sorted(latest["tenors"].items())],
            "source": "Banchero Costa weekly market report %s, Dry bulk FFA assessments" % latest.get("issue"),
            "url": panel["curves"][latest["date"]].get("url"),
        },
        "voyage_days": dict(days, **{"5TC trip": days.get("C5")}),
        "voyage_days_on": last_friday,
        "commission_pct": engine.CAPESIZE_COMMISSION_PCT,
        "td3c_strip": bwet[-1] if bwet else None,
        "td3c_cargo_t": td3c.CARGO_T,
    }


def as_of(panel: dict[str, Any]) -> str:
    dates = [max(panel["daily"]), max(d for d, c in panel["curves"].items() if c.get("tenors"))]
    return max(dates) if dates else dt.date.today().isoformat()


def sources_line(m: dict[str, Any]) -> dict[str, str]:
    retrieved = long_date(max(s["last_retrieved"] for s in m["sources"])[:10])
    return {
        "overview": "Banchero Costa weekly FFA assessments and spot tables (via Hellenic Shipping News); Baltic 5TC "
        "daily prints (handybulk.com, Reuters as republished); Himalaya Shipping monthly averages (SEC); "
        "voyage-tce-model engine. Retrieved to %s." % retrieved,
        "curve": "Banchero Costa weekly FFA assessments; Baltic 5TC prints; Amplify Commodity Trust filings (SEC). "
        "Retrieved to %s." % retrieved,
        "roll": "Banchero Costa weekly FFA assessments; 5TC monthly settlements from daily prints and Himalaya "
        "Shipping's published averages (SEC). Retrieved to %s." % retrieved,
        "lab": "Banchero Costa weekly FFA assessments (the latest cited curve and the historical fixtures); 5TC "
        "settlements from daily prints and Himalaya Shipping's averages (SEC); voyage-tce-model engine; Amplify "
        "Commodity Trust filings (SEC) for TD3C. Retrieved to %s." % retrieved,
        "td3c": "Baltic Exchange weekly tanker reports; Breakwave Advisors tanker reports (via Hellenic Shipping "
        "News); Amplify Commodity Trust filings (SEC); EIA. Retrieved to %s." % retrieved,
        "method": "Baltic Exchange Guide to Market Benchmarks v8.8 and v7.09; EEX and ICE contract specifications; "
        "every source in the manifest. Retrieved to %s." % retrieved,
    }
