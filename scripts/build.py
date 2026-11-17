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
    reprint_pairs = sum(len(r["tenors"]) for cv in panel["curves"].values() for r in cv.get("reprints", []))
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
        f"| Monthly settlements by year | {status} |",
        f"| Exact settlement months (complete or published), 180,000 t | {c['complete_months_180']} |",
        f"| Of which on both baskets (2026) | {c['complete_months_182']} |",
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
        "coverage": content.coverage(panel, res),
        "policy": POLICY,
        "robustness": res["robustness"],
        "hedge_by_year": res["hedge_by_year"],
        "ederington": res["ederington"],
        "qc": {
            "sec_check": panel["sec_check"],
            "flags": [
                {"curve": d, **f}
                for d, c in panel["curves"].items()
                for f in c.get("flags", [])
                if f["rule"] != "reprint" or abs(f.get("gap", 0)) > 0.10
            ],
        },
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
