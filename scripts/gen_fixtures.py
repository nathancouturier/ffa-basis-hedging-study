"""Write the engine's parity cases: random inputs (fixed seed) and every anchor, with the Python results.

    python scripts/gen_fixtures.py          write data/fixtures/engine_cases.json
    python scripts/gen_fixtures.py --check  fail if the file differs from a fresh build

tools/validate-engine.mjs runs src/engine.js on each case and compares within 1e-9 (relative).
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from ffabasis import engine  # noqa: E402

SEED = 20261117
OUT = ROOT / "data" / "fixtures" / "engine_cases.json"


def random_date(rng: random.Random) -> str:
    year = rng.randint(2018, 2028)
    month = rng.randint(1, 12)
    return "%04d-%02d-%02d" % (year, month, rng.randint(1, engine.days_in_month(year, month)))


def cases() -> list[dict]:
    rng = random.Random(SEED)
    out: list[dict] = []

    def add(fn: str, *args) -> None:
        result = getattr(engine, fn)(*args)
        out.append({"fn": fn, "args": list(args), "expected": result})

    # Anchors: the voyage of voyage-tce-model's Paper view, the SEC divisions, the 2026 basket gap.
    add("month_days", "2026-07-03", 76.522292)
    add("hedge_lots", engine.month_days("2026-07-03", 76.522292), 5.0, 1.0)
    add("gross_up", 35429.099952, 5.0)
    add("convert_basket", 37181, 182000, 180000, "2026-07-03")
    add("convert_basket", 33384, 180000, 182000, "2026-07-29")
    add("settles_on", "2025-12-24", "2025-12", "td3c")
    add("settles_on", "2025-12-29", "2025-12", "td3c")
    add("settles_on", "2025-12-29", "2025-12", "5tc")
    add("quarter_months", "2027-Q1")
    add("add_months", "2026-01", -1)

    for _ in range(40):
        start = random_date(rng)
        days = round(rng.uniform(0.5, 140.0), 6)
        weights = engine.month_days(start, days)
        prices = {w["month"]: round(rng.uniform(5000.0, 90000.0), 2) for w in weights}
        add("month_days", start, days)
        add("strip_price", weights, prices)
        add("hedge_lots", weights, rng.choice([5.0, 3.75, 0.0, 2.5]), round(rng.uniform(0.0, 1.5), 4))
        settle = {w["month"]: round(rng.uniform(5000.0, 90000.0), 2) for w in weights}
        lots = engine.hedge_lots(weights, 5.0, 1.0)
        add("strip_pnl", rng.choice(["owner", "charterer"]), lots, prices, settle)
    for _ in range(30):
        role = rng.choice(["owner", "charterer"])
        add(
            "outcome",
            role,
            round(rng.uniform(5000, 120000), 2),
            round(rng.uniform(5000, 90000), 2),
            round(rng.uniform(5000, 90000), 2),
            round(rng.uniform(10, 100), 6),
            rng.choice([5.0, 3.75]),
            round(rng.uniform(0, 1.5), 4),
        )
        add(
            "td3c_outcome",
            role,
            round(rng.uniform(5, 200), 4),
            round(rng.uniform(5, 200), 4),
            round(rng.uniform(5, 200), 4),
            rng.choice([270000.0, 280000.0, 135000.0]),
            round(rng.uniform(0, 1.5), 4),
        )
    for _ in range(20):
        values = [round(rng.uniform(1000, 100000), 2) for _ in range(rng.randint(1, 23))]
        add("settlement_average", values)
        add(
            "paper_pnl",
            rng.choice(["owner", "charterer"]),
            round(rng.uniform(5000, 90000), 2),
            round(rng.uniform(5000, 90000), 2),
            round(rng.uniform(1, 120), 4),
        )
        add(
            "hedged_surprise",
            round(rng.uniform(5000, 90000), 2),
            round(rng.uniform(5000, 90000), 2),
            round(rng.uniform(5000, 90000), 2),
            round(rng.uniform(0, 1.5), 4),
        )
        add("surprise", round(rng.uniform(5000, 90000), 2), round(rng.uniform(5000, 90000), 2))
        add("gross_up", round(rng.uniform(1000, 90000), 6), rng.choice([5.0, 3.75, 2.5]))
        add("net_share", rng.choice([5.0, 3.75, 2.5, 0.0]))
        add("ws_to_usd_t", round(rng.uniform(20, 1500), 2), round(rng.uniform(5, 40), 4))
        add("implied_flat_rate", round(rng.uniform(2, 300), 4), round(rng.uniform(20, 1500), 2))
        day = random_date(rng)
        add("basket_of", day)
        add("settles_on", day, day[:7], rng.choice(["5tc", "td3c"]))
        month = day[:7]
        add("add_months", month, rng.randint(-30, 30))
        add("months_between", month, random_date(rng)[:7])
        add("quarter_of", month)
        add("shape", round(rng.uniform(1000, 9000), 0), round(rng.uniform(1000, 9000), 0))
        add("basis", round(rng.uniform(1000, 90000), 2), round(rng.uniform(1000, 90000), 2))
        if day >= engine.BASKET_182_FROM:
            add("convert_basket", round(rng.uniform(5000, 90000), 2), 182000, 180000, day)
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    payload = {
        "about": "Parity cases for src/engine.js, computed by src/ffabasis/engine.py (scripts/gen_fixtures.py, "
        "seed %d)." % SEED,
        "cases": cases(),
    }
    text = json.dumps(payload, indent=0, sort_keys=True) + "\n"
    if args.check:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            print("data/fixtures/engine_cases.json differs from a fresh build: run python scripts/gen_fixtures.py")
            return 1
        print("fixtures up to date: %d cases" % len(payload["cases"]))
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    print("wrote %d cases" % len(payload["cases"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
