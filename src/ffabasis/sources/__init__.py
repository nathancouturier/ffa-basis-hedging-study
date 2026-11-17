"""Adapters for the study's public sources: fetch, cache, parse.

Every download goes through ffabasis.sources.http.Fetcher, which honours each
host's robots.txt (its rules and its crawl delay), waits at least two seconds
between requests to a host, names the project in its User-Agent, caches the
bytes under data/raw/ and records the URL, retrieval time and sha256 in
data/raw/manifest.json.
"""
