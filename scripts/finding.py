"""Rewrite the README's finding block (between its markers) from the artifacts.

The block states the five findings the refresh keeps current, in the words of
the research note (ffabasis.prose): hedge effectiveness, the basis left, the
forward bias, the curve's shape and TD3C through the closure.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from ffabasis.prose import day, five_findings  # noqa: E402

START, END = "<!-- finding:start -->", "<!-- finding:end -->"


def block() -> str:
    """The finding block: the data's date and the five findings of the note, numbered."""
    data = ROOT / "data"
    load = {
        n: json.loads((data / f"{n}.json").read_text(encoding="utf-8"))
        for n in ("overview", "curve", "roll", "td3c", "method")
    }
    findings = five_findings(load["overview"], load["curve"], load["roll"], load["td3c"], load["method"])
    lines = [f"**Data to {day(load['overview']['as_of'])}.**", ""]
    lines += [f"{i}. {text}" for i, text in enumerate(findings, 1)]
    return START + "\n" + "\n".join(lines) + "\n" + END


def main() -> int:
    readme = ROOT / "README.md"
    text = readme.read_text(encoding="utf-8")
    if START not in text or END not in text:
        print("README.md has no finding markers")
        return 1
    new = re.sub(re.escape(START) + r".*?" + re.escape(END), block(), text, flags=re.S)
    readme.write_text(new, encoding="utf-8")
    print(block())
    return 0


if __name__ == "__main__":
    sys.exit(main())
