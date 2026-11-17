"""Hellenic Shipping News posts with their text: the daily and weekly market reports.

The WordPress posts endpoint returns up to 100 posts a request with their
rendered content, so the daily Reuters dry bulk reports and the Baltic's
weekly tanker reports, as HSN republishes them, are read in a few dozen
requests at the site's 30 second crawl delay rather than one request a day.

Endpoint, as probed on 17 November 2026:

    https://www.hellenicshippingnews.com/wp-json/wp/v2/posts?search=<terms>&per_page=100&page=<n>
        &_fields=id,date,link,title,content&after=<ISO>&before=<ISO>

Each page is cached like any download (the key carries the query), so a
rebuild reads the cache and a refresh asks only for the window after the
latest post it holds.
"""

from __future__ import annotations

import json
import urllib.parse
from collections.abc import Iterator
from typing import Any

from .http import Fetcher, FetchError

BASE = "https://www.hellenicshippingnews.com/wp-json/wp/v2/posts"


def iter_posts(
    fetcher: Fetcher,
    search: str,
    *,
    after: str | None = None,
    before: str | None = None,
    max_pages: int = 60,
    refetch: bool = False,
) -> Iterator[dict[str, Any]]:
    """Every post matching a search, newest first, with title and content."""
    for page in range(1, max_pages + 1):
        query: dict[str, Any] = {
            "search": search,
            "per_page": 100,
            "page": page,
            "_fields": "id,date,link,title,content",
            "orderby": "date",
            "order": "desc",
        }
        if after:
            query["after"] = after
        if before:
            query["before"] = before
        url = f"{BASE}?{urllib.parse.urlencode(query)}"
        try:
            path = fetcher.get(url, source="Hellenic Shipping News (posts)", licence="listing", refetch=refetch)
        except FetchError as error:
            if "HTTP 400" in str(error):
                return
            raise
        items = json.loads(path.read_text(encoding="utf-8"))
        if not items:
            return
        yield from items
        if len(items) < 100:
            return
