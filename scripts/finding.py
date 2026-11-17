"""Rewrite the README's finding block (between its markers) from the artifacts.

The block states the headline the refresh keeps current: the share of a C5
voyage's earnings variance a one-month 5TC hedge removed, its interval and
sample, the basis left, the curve's contango share and TD3C's 2026 peak.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
START, END = "<!-- finding:start -->", "<!-- finding:end -->"


def pct(x: float) -> str:
    return f"{100 * x:.0f} percent"


def usd(x: float) -> str:
    return f"USD {round(x):,}"


def day(iso: str) -> str:
    import datetime as dt

    d = dt.date.fromisoformat(iso)
    return f"{d.day} {d.strftime('%B %Y')}"


def block() -> str:
    data = ROOT / "data"
    ov = json.loads((data / "overview.json").read_text(encoding="utf-8"))
    h = ov["headline"]
    facts = {f["key"]: f for f in ov["facts"]}
    ci = h["effectiveness_k1_ci"]
    lines = [
        f"**Data to {day(ov['as_of'])}.** A 5TC paper hedge placed one month before a C5 West Australia to Qingdao "
        f"fixture removed {pct(h['effectiveness_k1'])} of the variance of the voyage's earnings against the forward "
        f"(90 percent interval {pct(ci['low'])} to {pct(ci['high'])}; {h['n']} weekly fixtures from "
        f"{day(h['first_fixture'])} to {day(h['last_fixture'])}, hedged one for one).",
    ]
    if "basis_left" in facts:
        b = facts["basis_left"]
        lines.append(
            f"The basis left is a standard deviation of {usd(b['value_usd_day'])} a day, against "
            f"{usd(b['unhedged_usd_day'])} unhedged."
        )
    if "contango_share" in facts:
        c = facts["contango_share"]
        lines.append(f"The front month stood above the same day's spot in {pct(c['value'])} of {c['n']} weeks.")
    if "td3c_peak" in facts:
        t = facts["td3c_peak"]
        lines.append(
            f"TD3C peaked at WS{t['ws_points']:,.2f}, a round-trip TCE of {usd(t['tce_usd_day'])} a day, in the "
            f"week to {day(t['week'])}."
        )
    return START + "\n" + " ".join(lines) + "\n" + END


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
