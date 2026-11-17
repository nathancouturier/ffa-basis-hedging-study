"""Assemble the study's panel from the cache: every series the analysis reads, with its provenance.

build(root) reads data/raw (through its manifest), parses every source, pools
the daily 5TC, tags baskets, applies the quality rules of ffabasis.panel and
writes data/cache/panel.json. That file holds licensed levels and stays out
of git; ffabasis.export turns it into the derived artifacts the site reads.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

from . import calendar, daily, engine, panel, voyage
from .sources import baltic_weekly, breakwave, handybulk, republished, reuters, tankers

#: The Baltic standard Capesize before 2 January 2026 (BCI180): GMB v7.09, December 2025, printed page 76.
#: "14 knots laden or 15 knots ballast on 62mt fuel oil (380cst), no diesel at sea, 12 knots laden or 13
#: knots ballast on 43mt fuel oil (380cst), no diesel at sea." Priced at its fastest pairs, as
#: voyage-tce-model prices the BCI182 at its fastest pair.
BCI180 = {
    "id": "BCI180",
    "laden_kn": 14,
    "ballast_kn": 15,
    "laden_curve": [[14, 62], [12, 43]],
    "ballast_curve": [[15, 62], [13, 43]],
    "source": "Baltic Exchange, Guide to Market Benchmarks v7.09 (December 2025), printed page 76",
}
CARGO_T = 170000
BUNKER_HUB = "singapore"
BUNKER_MAX_AGE_DAYS = 7


def vessel_for(day: str) -> dict[str, Any]:
    """The Baltic standard Capesize of a date, as the vendored engine takes it."""
    if day >= engine.BASKET_182_FROM:
        v = voyage.baltic().VESSELS["BCI182"]
        return {
            "id": "BCI182",
            "laden_kn": v.reference_laden_kn,
            "ballast_kn": v.reference_ballast_kn,
            "laden_curve": [list(p) for p in v.laden],
            "ballast_curve": [list(p) for p in v.ballast],
            "source": "Baltic Exchange, Guide to Market Benchmarks v8.8 (September 2026), printed page 78",
        }
    return dict(BCI180)


def _manifest(root: Path) -> dict[str, dict[str, Any]]:
    data = json.loads((root / "data" / "raw" / "manifest.json").read_text(encoding="utf-8"))
    return {entry["key"]: entry for entry in data["entries"]}


def _soup_text(html: str) -> str:
    return " ".join(BeautifulSoup(html, "lxml").get_text(" ", strip=True).split())


# ---------------------------------------------------------------------------
# Daily 5TC observations
# ---------------------------------------------------------------------------


def daily_observations(root: Path, manifest: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    raw = root / "data" / "raw"
    obs: list[dict[str, Any]] = []
    for key, entry in manifest.items():
        path = raw / entry["path"]
        if not path.exists():
            continue
        url = entry["url"]
        if key.startswith("handybulk_bdi_"):
            obs += [dict(r, url=url) for r in handybulk.parse_month(path)]
        elif "wp-json/wp/v2/posts" in url and ("cyprusshippingnews.com" in url or "hellenicshippingnews.com" in url):
            if "capesize" not in url and "average" not in url:
                continue
            host = url.split("/")[2]
            for item in json.loads(path.read_text(encoding="utf-8")):
                row = republished.parse_post(item, "Reuters via " + host)
                if row:
                    obs.append(row)
        elif (
            "marinelink.com/news/" in url and "sitemaparchive" not in url
        ) or "maritimeprofessional.com/amp/news/" in url:
            text, published = republished.article_text(path)
            if published:
                row = reuters.parse(text, dt.date.fromisoformat(published))
                if row:
                    host = "Maritime Professional" if "maritimeprofessional" in url else "MarineLink"
                    obs.append(dict(row, source="Reuters via " + host, url=url))
    return obs


def banchero_spot_observations(chosen: Iterable[dict[str, Any]], days_182: dict[str, float]) -> list[dict[str, Any]]:
    """The two Friday 5TC values of each issue, each with the basket it is on."""
    obs = []
    for issue in chosen:
        spot = issue.get("spot")
        if not spot or not spot.get("bci_tc_avg"):
            continue
        for column, day in (("current", spot["assessed_on"]), ("previous", spot["previous_on"])):
            value = spot["bci_tc_avg"][column]
            if value is None:
                continue
            basket = _spot_basket(value, day, spot.get("basket_label"), days_182)
            obs.append(
                {
                    "date": day,
                    "c5tc_usd_day": value,
                    "basket_t": basket,
                    "source": "Banchero Costa weekly report",
                    "url": issue["url"],
                    "printed_on": spot["assessed_on"],
                    "column": column,
                }
            )
    return obs


def _spot_basket(value: float, day: str, label: str | None, days_182: dict[str, float]) -> int | None:
    if day < engine.BASKET_182_FROM:
        return 180000
    reference = days_182.get(day)
    if reference is not None:
        if abs(value - reference) <= 1.0:
            return 182000
        if abs(value - (reference - engine.C5TC_180_DIFFERENTIAL_USD_DAY)) <= 1.0:
            return 180000
        return None
    return 182000 if label == "BCI 182" else None


# ---------------------------------------------------------------------------
# Curves: basket of each print
# ---------------------------------------------------------------------------


def curve_basket(curve: dict[str, Any], days: dict[str, dict[str, Any]]) -> tuple[int, str]:
    """The basket of a dated curve and how it was established."""
    date = curve["assessed_on"]
    if date < engine.BASKET_182_FROM:
        return 180000, "before 2 January 2026 only the 180,000 t basket settled"
    if curve.get("basket_label_t"):
        return int(curve["basket_label_t"]), "labelled on the page"
    month = date[:7]
    front = curve["tenors"].get(month)
    spot = days.get(date)
    if front and front.get("premium_printed") and spot:
        text = front["premium_printed"].replace("%", "").strip()
        try:
            size = abs(float(text.replace("+", "")))
        except ValueError:
            size = None
        if size is not None:
            # A premium printed without its sign (an OCR or layout loss) is tried both ways.
            signs = [1.0] if text.startswith("+") else [-1.0] if text.startswith("-") else [1.0, -1.0]
            s180 = spot["value_180"]
            s182 = s180 + engine.C5TC_180_DIFFERENTIAL_USD_DAY
            best = None
            for sign in signs:
                implied = front["usd_day"] / (1.0 + sign * size / 100.0)
                for basket, level in ((182000, s182), (180000, s180)):
                    miss = abs(implied / level - 1.0)
                    if best is None or miss < best[0]:
                        best = (miss, basket)
            if best and best[0] < 0.01:
                return best[1], "the premium column implies the %s t spot" % format(best[1], ",")
    return 182000, "inferred: 2026 curves read as 182,000 t where tested (settlement and premium checks)"


# ---------------------------------------------------------------------------
# Tankers
# ---------------------------------------------------------------------------


def td3c_weekly(root: Path, manifest: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Weekly TD3C (and TD34) prints: the Baltic's own report first, republished copies beside it."""
    raw = root / "data" / "raw"
    weeks: dict[str, dict[str, Any]] = {}
    secondary: list[dict[str, Any]] = []
    seed = json.loads((root / "data" / "seed" / "edge_weekly_reports.json").read_text(encoding="utf-8"))
    edge_weeks = {address: week for week, address in seed["reports"].items()}
    for key, entry in manifest.items():
        path = raw / entry["path"]
        if not path.exists():
            continue
        match = re.match(r"baltic_tanker_report_(\d{4})_w(\d{2})", key)
        if match:
            row = baltic_weekly.parse_tanker(path, int(match.group(1)), int(match.group(2)))
            if row:
                row["source"] = "Baltic Exchange weekly tanker report"
                weeks[row["week_ending"]] = row
            continue
        url = entry["url"]
        if "theedgemalaysia.com/node/" in url and url in edge_weeks:
            text = _soup_text(path.read_text(encoding="utf-8", errors="replace"))
            row = tankers.parse(text, dt.date.fromisoformat(edge_weeks[url]))
            if row:
                secondary.append(dict(row, source="The Edge Malaysia", url=url))
        elif "wp-json/wp/v2/posts" in url and "TD3C" in url:
            host = url.split("/")[2]
            for item in json.loads(path.read_text(encoding="utf-8")):
                row = tankers.parse(_soup_text(item["content"]["rendered"]), dt.date.fromisoformat(item["date"][:10]))
                if row:
                    secondary.append(dict(row, source=host, url=item.get("link", "")))
    for row in sorted(secondary, key=lambda r: r["printed_on"]):
        week = row["week_ending"]
        if week not in weeks:
            weeks[week] = dict(row, note="no Baltic page for this week; republished copy")
        else:
            agree = abs(weeks[week]["td3c_ws_points"] - row["td3c_ws_points"]) < 0.005
            weeks[week].setdefault("copies", []).append(
                {"source": row["source"], "url": row.get("url"), "agree": agree}
            )
    return dict(sorted(weeks.items()))


def breakwave_prints(root: Path, manifest: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Breakwave's bi-weekly tanker reports: TD3C in USD a tonne and the futures index, by report date."""
    rows = {}
    for entry in manifest.values():
        if "BreakwaveTankers" not in entry["url"] or not entry["url"].lower().endswith(".pdf"):
            continue
        path = root / "data" / "raw" / entry["path"]
        if not path.exists():
            continue
        try:
            row = breakwave.parse(path)
        except Exception:  # a damaged file is skipped and counted in the audit
            row = None
        if row:
            row["url"] = entry["url"]
            rows.setdefault(row["report_date"], row)
    ordered = [rows[d] for d in sorted(rows)]
    return [
        r
        for prev, r in zip([None, *ordered], ordered, strict=False)
        if not (prev and (prev["btfi_points"], prev["td3c_usd_t"]) == (r["btfi_points"], r["td3c_usd_t"]))
    ]


def breakwave_repeats(prints: list[dict[str, Any]], root: Path, manifest: dict[str, dict[str, Any]]) -> list[str]:
    """Reports whose side panel repeats the previous report's figures (not updated): left out of the prints."""
    kept = {r["report_date"] for r in prints}
    every = {}
    for entry in manifest.values():
        if "BreakwaveTankers" in entry["url"] and entry["url"].lower().endswith(".pdf"):
            path = root / "data" / "raw" / entry["path"]
            if path.exists():
                try:
                    row = breakwave.parse(path)
                except Exception:  # counted with the damaged files
                    row = None
                if row:
                    every.setdefault(row["report_date"], entry["url"])
    return [every[d] for d in sorted(every) if d not in kept]


# ---------------------------------------------------------------------------
# The panel
# ---------------------------------------------------------------------------


def build(root: Path) -> dict[str, Any]:
    manifest = _manifest(root)
    raw = root / "data" / "raw"
    cache = root / "data" / "cache"
    issues = panel.parse_all(raw, manifest, cache / "bancosta_parsed.json")
    chosen, duplicates = panel.choose_issues(issues)

    obs = daily_observations(root, manifest)
    first_pool = daily.pool(obs)
    days_182 = {
        d: r["value_180"] + engine.C5TC_180_DIFFERENTIAL_USD_DAY
        for d, r in first_pool.items()
        if d >= engine.BASKET_182_FROM
    }
    obs += banchero_spot_observations(chosen, days_182)
    days = daily.pool(obs)
    first_month = "2018-01"
    last_month = (dt.date.today().replace(day=1) - dt.timedelta(days=1)).strftime("%Y-%m")
    months = daily.months(days, first_month, last_month)

    curve_map = panel.curves(chosen)
    for date, curve in curve_map.items():
        issue = next((i for i in chosen if i.get("ffa") and i["ffa"]["assessed_on"] == date), None)
        if issue:
            curve["basket_label_t"] = issue["ffa"].get("basket_label_t")
            curve["method"] = issue["ffa"].get("method", "text")
        if curve["tenors"]:
            curve["basket_t"], curve["basket_how"] = curve_basket(curve, days)

    public = root / "data" / "public"
    marks = (
        json.loads((public / "sec_marks.json").read_text(encoding="utf-8"))
        if (public / "sec_marks.json").exists()
        else []
    )
    published_5tc = (
        json.loads((public / "himalaya_5tc.json").read_text(encoding="utf-8"))
        if (public / "himalaya_5tc.json").exists()
        else []
    )
    sec_rows = panel.sec_check(
        {d: c for d, c in curve_map.items() if c["tenors"]}, marks, lambda d: curve_map[d].get("basket_t", 180000)
    )

    routes, bunkers = _routes_and_bunkers(chosen)

    return {
        "built_on": dt.date.today().isoformat(),
        "issues": [{k: i.get(k) for k in ("year", "week", "url", "sha256", "retrieved_at", "ocr")} for i in chosen],
        "duplicate_issues": [{"url": i["url"], "week": panel.issue_key(i["year"], i["week"])} for i in duplicates],
        "curves": curve_map,
        "sec_check": sec_rows,
        "daily": {
            d: {k: v for k, v in r.items() if k != "prints"} | {"sources": [p.get("source") for p in r["prints"]]}
            for d, r in days.items()
        },
        "months": months,
        "routes": dict(sorted(routes.items())),
        "bunkers": dict(sorted(bunkers.items())),
        "sec_marks": marks,
        "published_5tc": published_5tc,
        "td3c_weekly": td3c_weekly(root, manifest),
        "ocr_ffa_tenors": _ocr_tenor_counts(chosen),
        "breakwave": (bw := breakwave_prints(root, manifest)),
        "breakwave_repeats": breakwave_repeats(bw, root, manifest),
        "calendar_note": calendar.__doc__.strip().splitlines()[0],
    }


def _ocr_tenor_counts(chosen: list[dict[str, Any]]) -> dict[str, int]:
    """FFA tenors read by OCR and those that reproduce their printed week-on-week change (the rest are left out)."""
    read = kept = 0
    for issue in chosen:
        ffa = issue.get("ffa") or {}
        if ffa.get("method") != "ocr":
            continue
        for tenor in ffa["tenors"]:
            read += 1
            kept += tenor["current"] is not None and panel._wow_consistent(tenor)
    return {"read": read, "kept": kept}


def _plausible_bunkers(hub: dict[str, float | None]) -> bool:
    values = [hub.get(g) for g in ("ifo380", "vlsfo", "lsmgo")]
    if None in values:
        return False
    ifo, vlsfo, mgo = values
    return 100.0 < ifo < vlsfo < mgo < 3000.0


def _routes_and_bunkers(chosen: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Route rates and Singapore bunkers by Friday, from every print of that Friday, the best one kept.

    Candidates are each issue's current and previous columns. A bunker table must pass its own check (the
    printed HSFO to VLSFO spread equals VLSFO less IFO380) and the order IFO380 < VLSFO < LSMGO; text beats
    OCR; among equals the current column of the week's own issue (the first print) wins.
    """
    route_cands: dict[str, list[tuple[int, dict[str, Any]]]] = {}
    bunker_cands: dict[str, list[tuple[int, dict[str, Any]]]] = {}
    for issue in chosen:
        spot = issue.get("spot") or {}
        method = 1 if spot.get("method") == "ocr" else 0
        for column, day in (("current", spot.get("assessed_on")), ("previous", spot.get("previous_on"))):
            if not day:
                continue
            c3 = (spot.get("c3") or {}).get(column)
            c5 = (spot.get("c5") or {}).get(column)
            if c3 is None or c5 is None or not (3.0 < c5 < c3 < 120.0):
                continue
            rank = method * 2 + (column == "previous")
            route_cands.setdefault(day, []).append(
                (
                    rank,
                    {
                        "c3_usd_t": c3,
                        "c5_usd_t": c5,
                        "url": issue["url"],
                        "column": column,
                        "method": "ocr" if method else "text",
                    },
                )
            )
        b = issue.get("bunkers") or {}
        if b.get("spread_check") is False:
            continue
        method = 1 if b.get("method") == "ocr" else 0
        prices = b.get("prices", {})
        for column, day in (("current", b.get("assessed_on")), ("previous", b.get("previous_on"))):
            if not day or "vlsfo" not in prices:
                continue
            hub = {g: prices[g].get(BUNKER_HUB, {}).get(column) for g in ("ifo380", "vlsfo", "lsmgo") if g in prices}
            if not _plausible_bunkers(hub):
                continue
            if method and b.get("spread_check") is not True:
                continue
            rank = method * 2 + (column == "previous")
            bunker_cands.setdefault(day, []).append(
                (
                    rank,
                    {
                        "singapore": hub,
                        "url": issue["url"],
                        "column": column,
                        "spread_check": b.get("spread_check"),
                        "method": "ocr" if method else "text",
                    },
                )
            )
    routes = {d: min(c, key=lambda x: x[0])[1] for d, c in sorted(route_cands.items())}
    bunkers = {d: min(c, key=lambda x: x[0])[1] for d, c in sorted(bunker_cands.items())}
    return routes, bunkers


def write(root: Path) -> Path:
    data = build(root)
    out = root / "data" / "cache" / "panel.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=0, sort_keys=True, default=str), encoding="utf-8")
    return out
