"""Hellenic Shipping News (HSN): the republisher of most of the study's weekly reports.

HSN is a WordPress site. Its REST API lists media attachments (the PDFs of
brokers' weekly reports) and posts (the Baltic's weekly tanker report and
Reuters' daily Baltic report, as republished) a hundred at a time, which
finds every issue without guessing file names. Its robots.txt sets a crawl
delay of 30 seconds, which the fetcher obeys.

Endpoints, as probed on 17 November 2026:

    https://www.hellenicshippingnews.com/wp-json/wp/v2/media?search=<term>&per_page=100&page=<n>
    https://www.hellenicshippingnews.com/wp-json/wp/v2/posts?search=<term>&per_page=100&page=<n>

Terms: the articles and reports are the copyright of their publishers; the
study stores them in the gitignored cache and commits only figures with links.
"""

from __future__ import annotations

import json
import urllib.parse
from collections.abc import Iterator
from typing import Any

from .http import Fetcher, FetchError

BASE = "https://www.hellenicshippingnews.com/wp-json/wp/v2"
SOURCE = "Hellenic Shipping News"
LICENCE = "Copyright of the publisher; cached, not redistributed"


def _listing_url(kind: str, search: str, page: int, fields: str) -> str:
    query = urllib.parse.urlencode(
        {"search": search, "per_page": 100, "page": page, "_fields": fields, "orderby": "date", "order": "desc"}
    )
    return f"{BASE}/{kind}?{query}"


def iter_listing(
    fetcher: Fetcher, kind: str, search: str, *, max_pages: int = 40, refetch_first: bool = False
) -> Iterator[dict[str, Any]]:
    """Every item of a media or posts search, newest first.

    Pages are cached like any download; refetch_first asks the first page again
    so that a refresh sees new issues, and later pages are asked again only if
    the first page brought anything new.
    """
    fields = "id,date,slug,link,title,source_url" if kind == "media" else "id,date,slug,link,title"
    for page in range(1, max_pages + 1):
        url = _listing_url(kind, search, page, fields)
        try:
            path = fetcher.get(url, source=SOURCE, licence="listing", refetch=refetch_first and page == 1)
        except FetchError as error:
            # WordPress answers 400 for a page past the last one.
            if "HTTP 400" in str(error):
                return
            raise
        items = json.loads(path.read_text(encoding="utf-8"))
        if not items:
            return
        yield from items
        if len(items) < 100:
            return


def title_of(item: dict[str, Any]) -> str:
    title = item.get("title", "")
    if isinstance(title, dict):
        title = title.get("rendered", "")
    return str(title)
