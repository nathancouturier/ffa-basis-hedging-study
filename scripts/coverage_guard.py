"""Fail when a rebuild would publish a smaller panel than the one committed.

A refresh runs on a cache that CI keeps between runs; if that cache was lost the
pipeline would rebuild from fewer documents. This compares data/method.json's
coverage with the committed copy (git HEAD) and fails on any shrinkage, so the
refresh never commits a thinner study.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KEYS = (
    "exact_months_180",
    "complete_months_180",
    "complete_months_182",
    "td3c_weekly",
    "sec_quarter_ends_bdry",
    "sec_quarter_ends_bwet",
    "issues_read",
    "daily_days",
)


def main() -> int:
    out = None
    if "--github-output" in sys.argv:
        out = Path(sys.argv[sys.argv.index("--github-output") + 1])
    new = json.loads((ROOT / "data" / "method.json").read_text(encoding="utf-8"))["coverage"]
    try:
        old_text = subprocess.run(
            ["git", "show", "HEAD:data/method.json"], cwd=ROOT, capture_output=True, text=True, check=True
        ).stdout
    except subprocess.CalledProcessError:
        print("no committed method.json: nothing to compare")
        if out is not None:
            with out.open("a", encoding="utf-8") as handle:
                handle.write("complete=true\n")
        return 0
    old = json.loads(old_text)["coverage"]
    shrunk = [f"{k}: {old.get(k)} -> {new.get(k)}" for k in KEYS if (new.get(k) or 0) < (old.get(k) or 0)]
    if out is not None:
        with out.open("a", encoding="utf-8") as handle:
            handle.write(f"complete={'false' if shrunk else 'true'}\n")
    if shrunk:
        print("coverage shrank:\n  " + "\n  ".join(shrunk))
        return 0 if out is not None else 1
    print("coverage holds: " + ", ".join(f"{k} {new.get(k)}" for k in KEYS))
    return 0


if __name__ == "__main__":
    sys.exit(main())
