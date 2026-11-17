"""Reuters' daily dry bulk report where it is republished: Cyprus Shipping News and MarineLink.

Cyprus Shipping News (cyprusshippingnews.com) is a WordPress site whose REST
API returns posts with their text (robots.txt: no restriction on /wp-json/).
MarineLink (www.marinelink.com, robots.txt crawl delay 2 s) lists every
article of a month at /news/sitemaparchive/YYYYMM; the daily Baltic reports
carry "baltic" or "capesize" in their address. Hellenic Shipping News is read
through ffabasis.sources.hsn_posts.

Every article is cached; the figures are parsed by ffabasis.sources.reuters.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import urllib.parse
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

from . import reuters
from .http import Fetcher, FetchError

CSN_POSTS = "https://cyprusshippingnews.com/wp-json/wp/v2/posts"
MARINELINK_ARCHIVE = "https://www.marinelink.com/news/sitemaparchive/"
LICENCE = "Copyright of the publisher (Reuters text as republished); cached, not redistributed"


def iter_csn(fetcher: Fetcher, year: int, refetch: bool = False) -> Iterator[dict[str, Any]]:
    """Cyprus Shipping News posts of a year that print capesize earnings, with their text."""
    for page in range(1, 20):
        query = urllib.parse.urlencode(
            {
                "search": "average daily earnings capesize",
                "per_page": 100,
                "page": page,
                "_fields": "id,date,link,title,content",
                "after": f"{year}-01-01T00:00:00",
                "before": f"{year + 1}-01-01T00:00:00",
            }
        )
        try:
            path = fetcher.get(
                f"{CSN_POSTS}?{query}", source="Cyprus Shipping News (posts)", licence=LICENCE, refetch=refetch
            )
        except FetchError as error:
            if "HTTP 400" in str(error):
                return
            raise
        items = json.loads(path.read_text(encoding="utf-8"))
        yield from items
        if len(items) < 100:
            return


def marinelink_month(fetcher: Fetcher, year: int, month: int, refetch: bool = False) -> list[str]:
    """MarineLink article addresses of a month whose slug names the Baltic index or capesize."""
    url = f"{MARINELINK_ARCHIVE}{year}{month:02d}"
    path = fetcher.get(
        url,
        key=f"marinelink_sitemap_{year}{month:02d}",
        source="MarineLink sitemap archive",
        licence="listing",
        refetch=refetch,
    )
    locs = re.findall(r"<loc>([^<]+)</loc>", path.read_text(encoding="utf-8", errors="replace"))
    return [loc for loc in locs if re.search(r"/news/[^/]*(baltic|capesize)[^/]*-\d+$", loc, re.I)]


def article_text(path: Path) -> tuple[str, str | None]:
    """Text and publication date (ISO) of a cached MarineLink article page."""
    soup = BeautifulSoup(path.read_text(encoding="utf-8", errors="replace"), "lxml")
    published = None
    for attr in ("article:published_time", "og:article:published_time", "datePublished"):
        tag = soup.find("meta", attrs={"property": attr}) or soup.find("meta", attrs={"itemprop": attr})
        if tag and tag.get("content"):
            published = tag["content"][:10]
            break
    if published is None:
        match = re.search(
            r'"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})', path.read_text(encoding="utf-8", errors="replace")
        )
        if match:
            published = match.group(1)
    return soup.get_text(" ", strip=True), published


def parse_post(item: dict[str, Any], source: str) -> dict[str, Any] | None:
    text = BeautifulSoup(item["content"]["rendered"], "lxml").get_text(" ", strip=True)
    row = reuters.parse(text, dt.date.fromisoformat(item["date"][:10]))
    if row:
        row.update(source=source, url=item.get("link", ""))
    return row


def iter_csn_search(
    fetcher: Fetcher, search: str, after: str, before: str, refetch: bool = False
) -> Iterator[dict[str, Any]]:
    """Cyprus Shipping News posts matching a search in a window, with their text."""
    for page in range(1, 20):
        query = urllib.parse.urlencode(
            {
                "search": search,
                "per_page": 100,
                "page": page,
                "_fields": "id,date,link,title,content",
                "after": after,
                "before": before,
            }
        )
        try:
            path = fetcher.get(
                f"{CSN_POSTS}?{query}", source="Cyprus Shipping News (posts)", licence=LICENCE, refetch=refetch
            )
        except FetchError as error:
            if "HTTP 400" in str(error):
                return
            raise
        items = json.loads(path.read_text(encoding="utf-8"))
        yield from items
        if len(items) < 100:
            return
