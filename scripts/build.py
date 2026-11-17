"""Rebuild every derived file from the cache: panel, results, artifacts, downloads.

python scripts/build.py            panel from data/raw, then the artifacts
python scripts/build.py --reuse    artifacts from the existing data/cache/panel.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from ffabasis import build, content, export, results  # noqa: E402

POLICY = [
    {
        "source": "Baltic Exchange indices (5TC daily, TD3C, TD34)",
        "decision": "Daily values stay in the ignored cache. "
        "Committed: monthly settlement averages, derived statistics, and weekly TD3C and TD34 prints each with the link "
        "it was read from.",
    },
    {
        "source": "Banchero Costa weekly report (FFA assessments, spot, routes, bunkers)",
        "decision": "The extracted "
        "panel stays in the ignored cache. Committed: derived statistics and the dated curves of the validation weeks "
        "and the latest week, each cited with its issue and page.",
    },
    {
        "source": "Amplify Commodity Trust 10-Q and 10-K (BDRY, BWET)",
        "decision": "Public records: every quarter-end mark is committed with its filing's link.",
    },
    {
        "source": "Himalaya Shipping 6-K exhibits",
        "decision": "Public records: the published monthly 5TC averages are committed with their links.",
    },
    {
        "source": "Breakwave bi-weekly tanker reports",
        "decision": "TD3C in USD a tonne and the futures index are committed as cited points with each report's link.",
    },
    {
        "source": "handybulk.com, Reuters as republished",
        "decision": "Daily prints stay in the cache; they enter only monthly averages and derived statistics.",
    },
    {"source": "Worldscale flat rates", "decision": "Never published: only the test of whether dated pairs agree."},
]


def rounded(value):
    """Floats to six decimals, as the overview stores its shares, so every view shows the same digits."""
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {k: rounded(v) for k, v in value.items()}
    if isinstance(value, list):
        return [rounded(v) for v in value]
    return value


#: The SEC comparison is published as a band: a precise gap beside the public mark would give the curve's level.
SEC_BANDS = ((0.05, "within 5 percent"), (0.10, "5 to 10 percent"), (float("inf"), "over 10 percent"))
#: Keys of a quality flag that carry an FFA level: kept in the ignored cache, never published.
LEVEL_KEYS = ("first", "reprint", "curve_usd_day_180")


def qc_tables(panel: dict) -> dict:
    """The quality-control tables the site shows, without FFA levels (data policy, data/AUDIT.md).

    Re-print flags keep their gap in percent (two unknown levels, so neither can be read from it) and one-week
    moves their changes in percent; the SEC comparison keeps the public mark, the days apart and a band with its
    direction, plus the median absolute gap over all comparisons.
    """
    import statistics

    flags = [
        {k: v for k, v in {"curve": d, **f}.items() if k not in LEVEL_KEYS}
        for d, c in panel["curves"].items()
        for f in c.get("flags", [])
        if f["rule"] != "reprint" or abs(f.get("gap", 0)) > 0.10
    ]
    rows = []
    for r in panel["sec_check"]:
        gap = r["gap"]
        band = next(label for limit, label in SEC_BANDS if abs(gap) <= limit)
        rows.append(
            {
                "contract_month": r["contract_month"],
                "curve": r["curve"],
                "curve_basket_t": r["curve_basket_t"],
                "sec_as_of": r["sec_as_of"],
                "sec_url": r["sec_url"],
                "sec_usd_day_180": r["sec_usd_day_180"],
                "days_apart": r["days_apart"],
                "band": band,
                "direction": "equal" if abs(gap) < 0.0005 else "above" if gap > 0 else "below",
                "flag": r["flag"],
            }
        )
    gaps = [abs(r["gap"]) for r in panel["sec_check"]]
    return {
        "flags": flags,
        "sec_check": rows,
        "sec_summary": {
            "n": len(gaps),
            "flagged": sum(1 for r in panel["sec_check"] if r["flag"]),
            "median_abs_gap": round(statistics.median(gaps), 4) if gaps else None,
        },
    }


def audit_block(method: dict, panel: dict) -> str:
    """The coverage and quality tables of data/AUDIT.md, rewritten on every build."""
    c = method["coverage"]
    years = ", ".join(f"{y}: {n}" for y, n in c["ffa_weeks_by_year"].items())
    status = "; ".join(
        f"{y}: " + ", ".join(f"{n} {k}" for k, n in sorted(s.items())) for y, s in c["settlements_by_year"].items()
    )
    hedge = ", ".join(f"{r['voyage']} {r['horizon_months']}m {r['n']}" for r in c["hedge_observations"])
    gaps = sorted(
        abs(f["gap"]) for cv in panel["curves"].values() for f in cv.get("flags", []) if f["rule"] == "reprint"
    )
    # Pairs actually compared: a reprinted tenor whose curve has a first print of the same tenor.
    reprint_pairs = sum(
        1
        for cv in panel["curves"].values()
        for r in cv.get("reprints", [])
        for period, value in r["tenors"].items()
        if value is not None and period in cv.get("tenors", {})
    )
    sec = panel["sec_check"]
    lines = [
        "<!-- coverage:start -->",
        "## Coverage (written by scripts/build.py)",
        "",
        "| Item | Value |",
        "|---|---|",
        f"| First and last FFA curve | {c['first_ffa_week']} and {c['last_ffa_week']} |",
        f"| FFA curves by year | {years} |",
        f"| Banchero Costa issues read | {c['issues_read']} ({c['ocr_issues']} with at least one table read by OCR) |",
        f"| FFA tenors read by OCR that reproduce their printed week-on-week change (the rest are left out) | "
        f"{(c.get('ocr_ffa_tenors') or {}).get('kept')} of {(c.get('ocr_ffa_tenors') or {}).get('read')} |",
        f"| Monthly settlements by year | {status} |",
        f"| Complete settlement months (the study's own average of every publication day) | "
        f"{c['complete_months_180']} on the 180,000 t basket ({c['complete_months']}); {c['complete_months_182']} "
        "of them also on the 182,000 t basket |",
        f"| Published settlement months (Himalaya Shipping, SEC) | {c['published_months']} |",
        f"| Exact settlement months (complete or published), 180,000 t | {c['exact_months_180']} |",
        f"| Days in the pooled daily 5TC | {c['daily_days']} |",
        f"| Hedge observations (voyage, horizon, fixtures) | {hedge} |",
        f"| TD3C weekly prints | {c['td3c_weekly']} ({c['td3c_weekly_first']} to {c['td3c_weekly_last']}) |",
        f"| Breakwave tanker reports | {c['breakwave_reports']} |",
        f"| SEC quarter ends | BDRY {c['sec_quarter_ends_bdry']}, BWET {c['sec_quarter_ends_bwet']} |",
        "",
        "## Quality control (written by scripts/build.py)",
        "",
        f"- Reprints compared: {reprint_pairs} tenor pairs; {len(gaps)} differ by more than 10 percent. The previous-week "
        "column is a later re-assessment, not a copy; the first print is used and the latest is a sensitivity.",
        f"- SEC comparisons within three days of a quarter end: {len(sec)}, of which {sum(r['flag'] for r in sec)} "
        "differ by more than 10 percent (listed in data/method.json, qc).",
        f"- One-week moves flagged: {sum(1 for cv in panel['curves'].values() for f in cv.get('flags', []) if f['rule'] == 'one_week_move')}.",
        "- Repeated pages (an issue reprinting the previous assessment under new dates), not used: "
        + (
            ", ".join(
                f"{f['issue']} (dated {d}, same figures as {f['same_as']})"
                for d, cv in sorted(panel["curves"].items())
                for f in cv.get("flags", [])
                if f["rule"] == "repeated_page"
            )
            or "none"
        )
        + ".",
        "- Breakwave reports whose side panel repeats the previous report's figures, not used: "
        + (", ".join(u.rsplit("/", 1)[-1] for u in panel.get("breakwave_repeats", [])) or "none")
        + ".",
        "<!-- coverage:end -->",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reuse", action="store_true")
    args = parser.parse_args()
    if args.reuse:
        panel = json.loads((ROOT / "data" / "cache" / "panel.json").read_text(encoding="utf-8"))
    else:
        build.write(ROOT)
        panel = json.loads((ROOT / "data" / "cache" / "panel.json").read_text(encoding="utf-8"))
    res = results.compute(panel)
    as_of = content.as_of(panel)
    manifest = content.manifest(ROOT, panel)
    lines = content.sources_line(manifest)
    method = {
        "artifact": "method",
        "as_of": as_of,
        "conventions": content.conventions(),
        "formulas": content.formulas(),
        "validation": content.validation(panel, res),
        "coverage": (cov := content.coverage(panel, res)),
        "limitations": content.limitations(cov, res),
        "policy": POLICY,
        "robustness": rounded(res["robustness"]),
        "hedge_by_year": rounded(res["hedge_by_year"]),
        "ederington": rounded(res["ederington"]),
        "qc": qc_tables(panel),
    }
    extra = {
        "as_of": as_of,
        "facts": content.facts(panel, res),
        "sources_line": lines,
        "lab": content.lab_defaults(panel, res),
        "td3c": content.td3c_artifact(panel, res, as_of),
        "method": method,
        "manifest": manifest,
    }
    written = export.write_all(ROOT, res, panel, extra)
    audit = ROOT / "data" / "AUDIT.md"
    if audit.exists():
        import re

        text = audit.read_text(encoding="utf-8")
        text = re.sub(
            r"<!-- coverage:start -->.*?<!-- coverage:end -->",
            audit_block(method, panel).replace("\\", "\\\\"),
            text,
            flags=re.S,
        )
        audit.write_text(text, encoding="utf-8")
    (ROOT / "data" / "cache" / "results_summary.json").write_text(
        json.dumps(
            {"hedge": export.hedge_cells(res["hedge"]), "bias": res["bias"], "shape": res["shape"]["front_vs_spot"]},
            indent=1,
            default=str,
        ),
        encoding="utf-8",
    )
    for path in written:
        print(path.relative_to(ROOT), path.stat().st_size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
