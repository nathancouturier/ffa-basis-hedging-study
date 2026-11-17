"""Fetch what is new from every source, then rebuild every derived file.

    python scripts/refresh.py                 fetch new documents (cache first), rebuild, write artifacts
    python scripts/refresh.py --offline       rebuild from the cache only, no network
    python scripts/refresh.py --budget 300    stop fetching after 300 minutes (CI), then rebuild
    python scripts/refresh.py --list          print the jobs and what each fetches

Every download goes through ffabasis.sources.http.Fetcher (robots.txt, at least
two seconds a host, 30 for Hellenic Shipping News, cached with a manifest), so
a run on a warm cache asks only for the listings and the documents it has not
seen. With an empty cache the first run takes hours: Hellenic Shipping News
asks for 30 seconds between requests and holds some 400 of the documents.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from ffabasis.sources import (  # noqa: E402
    baltic_weekly,
    docs,
    handybulk,
    himalaya,
    hsn,
    hsn_posts,
    republished,
    sec,
)
from ffabasis.sources.http import BlockedError, FetchError, default_fetcher  # noqa: E402

JOBS = (
    ("docs", "the rule books: Baltic guides, EEX and ICE specifications, EIA, anchor articles"),
    ("sec", "Amplify Commodity Trust 10-Q and 10-K (BDRY, BWET marks); Himalaya Shipping 6-K monthly 5TC averages"),
    ("baltic", "the Baltic Exchange's weekly tanker and bulk reports"),
    ("edge", "The Edge Malaysia's republished Baltic weekly reports (addresses in data/seed)"),
    ("handybulk", "handybulk.com's monthly archive of daily 5TC prints"),
    ("reuters", "Reuters' daily report as republished by Cyprus Shipping News and MarineLink"),
    ("hsn", "Hellenic Shipping News: Banchero Costa and Breakwave PDFs, daily and weekly posts"),
    ("amplify", "Amplify's BDRY and BWET holdings pages, rendered in a browser (needs open network)"),
)


class Budget:
    def __init__(self, minutes: float | None) -> None:
        self.end = None if minutes is None else time.monotonic() + 60 * minutes

    def left(self) -> bool:
        return self.end is None or time.monotonic() < self.end


def job_docs(f, budget: Budget) -> None:
    print("docs", docs.fetch_all(f))


def job_sec(f, budget: Budget) -> None:
    public = ROOT / "data" / "public"
    public.mkdir(parents=True, exist_ok=True)
    marks = sec.fetch_and_parse(f, refetch_list=True)
    (public / "sec_marks.json").write_text(json.dumps(marks, indent=1) + "\n", encoding="utf-8")
    averages = himalaya.fetch_and_parse(f, refetch=True)
    (public / "himalaya_5tc.json").write_text(json.dumps(averages, indent=1) + "\n", encoding="utf-8")
    print("sec marks", len(marks), "published 5TC months", len(averages))


def job_baltic(f, budget: Budget) -> None:
    today = dt.date.today()
    for kind, first_year in (("tanker", 2023), ("dry", 2021)):
        for year in range(first_year, today.year + 1):
            weeks = dt.date(year, 12, 28).isocalendar()[1]
            for week in range(1, weeks + 1):
                if not budget.left() or baltic_weekly.report_friday(year, week) > today:
                    break
                recent = (today - baltic_weekly.report_friday(year, week)).days < 10
                baltic_weekly.fetch(f, kind, year, week, refetch=recent)


def job_edge(f, budget: Budget) -> None:
    seed = json.loads((ROOT / "data" / "seed" / "edge_weekly_reports.json").read_text(encoding="utf-8"))
    for url in seed["reports"].values():
        if budget.left():
            f.get(
                url,
                source="The Edge Malaysia (Baltic Exchange shipping updates)",
                licence="Copyright of the publisher; cached, not redistributed",
            )


def job_handybulk(f, budget: Budget) -> None:
    print("handybulk months", len(handybulk.fetch_all(f, refetch_recent=True)))


def job_reuters(f, budget: Budget) -> None:
    today = dt.date.today()
    for year in range(2018, today.year + 1):
        list(republished.iter_csn(f, year, refetch=year == today.year))
    for year in range(2020, today.year + 1):
        for month in range(1, 13):
            if (year, month) > (today.year, today.month) or not budget.left():
                break
            recent = (year, month) >= ((today - dt.timedelta(days=40)).year, (today - dt.timedelta(days=40)).month)
            for url in republished.marinelink_month(f, year, month, refetch=recent):
                f.get(url, source="MarineLink", licence=republished.LICENCE)


def job_hsn(f, budget: Budget) -> None:
    pdfs: list[tuple[str, str]] = []
    for term in ("bancosta", "breakwave"):
        for item in hsn.iter_listing(f, "media", term, refetch_first=True):
            url = item.get("source_url") or ""
            title = hsn.title_of(item).lower()
            if not url.lower().endswith(".pdf"):
                continue
            if re.search(r"(?i)bancosta[-_ +]weekly[-_ +]\d{4}", url) or ("breakwave" in title and "tanker" in title):
                pdfs.append((item["date"], url))
    for year in range(2018, dt.date.today().year + 1):
        list(
            hsn_posts.iter_posts(
                f,
                "average daily earnings capesize",
                after=f"{year}-01-01T00:00:00",
                before=f"{year + 1}-01-01T00:00:00",
                refetch=year == dt.date.today().year,
            )
        )
    for year in (2025, 2026, dt.date.today().year):
        list(
            hsn_posts.iter_posts(
                f,
                "TD3C",
                after=f"{year}-01-01T00:00:00",
                before=f"{year + 1}-01-01T00:00:00",
                refetch=year == dt.date.today().year,
            )
        )
    for _date, url in sorted(set(pdfs), reverse=True):
        if not budget.left():
            print("hsn: time budget reached")
            break
        f.get(
            url, source="Hellenic Shipping News (PDF)", licence="Copyright of the publisher; cached, not redistributed"
        )


def job_amplify(f, budget: Budget) -> None:
    script = ROOT / "scripts" / "amplify_holdings.mjs"
    result = subprocess.run(["node", str(script)], cwd=ROOT, capture_output=True, text=True, timeout=600)
    print(result.stdout.strip() or result.stderr.strip()[:400])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--budget", type=float, default=None, help="minutes of fetching before the rebuild")
    parser.add_argument("--only", default="", help="comma separated jobs")
    args = parser.parse_args()
    if args.list:
        for name, what in JOBS:
            print(f"{name:10s} {what}")
        return 0
    status = {}
    if not args.offline:
        f = default_fetcher(ROOT)
        budget = Budget(args.budget)
        wanted = {j for j in args.only.split(",") if j} or {name for name, _ in JOBS}
        if "SEC_USER_AGENT" not in os.environ:
            wanted.discard("sec")
            status["sec"] = "skipped: SEC_USER_AGENT is not set"
        for name, _what in JOBS:
            if name not in wanted:
                continue
            try:
                globals()["job_" + name](f, budget)
                status[name] = "ok"
            except (BlockedError, FetchError, subprocess.SubprocessError, OSError) as error:
                status[name] = f"failed: {error}"
        status["blocked_hosts"] = f.blocked_hosts()
    print(json.dumps(status, indent=1))
    build = subprocess.run([sys.executable, str(ROOT / "scripts" / "build.py")], cwd=ROOT)
    if build.returncode != 0 and cache_still_filling():
        print("the rebuild failed on a cache that holds fewer reports than the committed study: nothing replaced")
        return 0
    return build.returncode


def cache_still_filling() -> bool:
    """Whether the cache holds fewer Banchero Costa issues than the committed study was built from."""
    try:
        committed = json.loads((ROOT / "data" / "method.json").read_text(encoding="utf-8"))["coverage"]["issues_read"]
        manifest = json.loads((ROOT / "data" / "raw" / "manifest.json").read_text(encoding="utf-8"))["entries"]
    except (OSError, KeyError, ValueError):
        return True
    cached = sum(1 for e in manifest if "Bancosta" in e["url"] and (ROOT / "data" / "raw" / e["path"]).exists())
    return cached < committed


if __name__ == "__main__":
    raise SystemExit(main())
