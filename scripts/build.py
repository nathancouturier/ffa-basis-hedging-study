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
