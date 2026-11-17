"""A polite, cached, resumable HTTP fetcher with a provenance manifest.

Rules it enforces, from the study's network policy (data/AUDIT.md):

* An honest User-Agent that names the project and its address. SEC EDGAR asks
  for a contact as well, so requests to sec.gov hosts send the value of the
  environment variable SEC_USER_AGENT instead, and refuse to run without it.
  The contact is never written to a committed file.
* robots.txt is read once per host and obeyed: a disallowed path is refused,
  and the host's Crawl-delay, when larger than the floor, sets the interval.
* At least MIN_INTERVAL_S seconds between two requests to the same host.
* A host that answers 403 or 429, or refuses the connection through the
  proxy, is marked blocked for the rest of the run and not asked again.
* Every stored file is recorded in the manifest with its URL, its retrieval
  time in UTC, its sha256, its size and its content type. A file already in
  the cache is never fetched again unless the caller asks (refetch=True), so a
  long download can be stopped and resumed.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import time
import urllib.parse
import urllib.robotparser
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import requests

PROJECT_URL = "https://nathancouturier.github.io/ffa-basis-hedging-study/"
USER_AGENT = f"ffa-basis-hedging-study/1.0 (public research project; +{PROJECT_URL})"
#: The token matched against robots.txt groups.
ROBOTS_AGENT = "ffa-basis-hedging-study"
MIN_INTERVAL_S = 2.0
TIMEOUT_S = 90
RETRIES = 4

SEC_HOSTS = ("www.sec.gov", "sec.gov", "data.sec.gov", "efts.sec.gov")


class FetchError(RuntimeError):
    """A download that could not be made, with the reason."""


class BlockedError(FetchError):
    """The host refused us (403, 429, a proxy refusal) or robots.txt disallows the path."""


@dataclass
class Fetcher:
    """Download through a cache, one host at a time, politely.

    raw_dir is the cache root (data/raw); manifest_path its manifest. With
    offline=True nothing is downloaded and a missing file raises FetchError.
    """

    raw_dir: Path
    manifest_path: Path
    offline: bool = False
    min_interval_s: float = MIN_INTERVAL_S
    session: requests.Session = field(default_factory=requests.Session)
    _last_request: dict[str, float] = field(default_factory=dict)
    _robots: dict[str, urllib.robotparser.RobotFileParser | None] = field(default_factory=dict)
    _blocked: dict[str, str] = field(default_factory=dict)
    _manifest: dict[str, dict[str, Any]] | None = None

    # ------------------------------------------------------------- manifest

    @property
    def manifest(self) -> dict[str, dict[str, Any]]:
        if self._manifest is None:
            if self.manifest_path.exists():
                data = json.loads(self.manifest_path.read_text(encoding="utf-8"))
                self._manifest = {entry["key"]: entry for entry in data["entries"]}
            else:
                self._manifest = {}
        return self._manifest

    def save_manifest(self) -> None:
        """Write the manifest, merged with what is on disk, under a lock.

        Two downloads can run at once (one per host), each in its own process;
        each merges its entries into the file rather than overwriting it.
        """
        self.manifest_path.parent.mkdir(parents=True, exist_ok=True)
        lock_path = self.manifest_path.with_suffix(".lock")
        with open(lock_path, "w", encoding="utf-8") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            merged: dict[str, dict[str, Any]] = {}
            if self.manifest_path.exists():
                data = json.loads(self.manifest_path.read_text(encoding="utf-8"))
                merged = {entry["key"]: entry for entry in data["entries"]}
            merged.update(self.manifest)
            self._manifest = merged
            entries = sorted(merged.values(), key=lambda e: e["key"])
            payload = {
                "about": "Every file the pipeline downloaded: URL, retrieval time (UTC), sha256, size. The files "
                "themselves stay out of git (data/raw/ is ignored); make data fetches them again from these URLs.",
                "entries": entries,
            }
            text = json.dumps(payload, indent=1, ensure_ascii=False) + "\n"
            temp = self.manifest_path.with_suffix(".tmp")
            temp.write_text(text, encoding="utf-8")
            os.replace(temp, self.manifest_path)
            fcntl.flock(lock, fcntl.LOCK_UN)

    # ---------------------------------------------------------------- paths

    @staticmethod
    def key_for(url: str) -> str:
        """A stable, readable key for a URL: host and path, slugged, plus a short hash of the query."""
        parts = urllib.parse.urlsplit(url)
        slug = re.sub(r"[^A-Za-z0-9._-]+", "_", (parts.netloc + parts.path).strip("/"))
        slug = slug[-150:]
        if parts.query:
            slug += "__" + hashlib.sha256(parts.query.encode()).hexdigest()[:10]
        return slug

    def path_for(self, key: str, url: str) -> Path:
        host = urllib.parse.urlsplit(url).netloc
        return self.raw_dir / host / key

    def cached(self, url: str, key: str | None = None) -> Path | None:
        key = key or self.key_for(url)
        entry = self.manifest.get(key)
        if entry is None:
            return None
        path = self.raw_dir / entry["path"]
        return path if path.exists() else None

    # --------------------------------------------------------------- policy

    def _headers(self, host: str, extra: Mapping[str, str] | None) -> dict[str, str]:
        if host in SEC_HOSTS:
            agent = os.environ.get("SEC_USER_AGENT", "").strip()
            if not agent:
                raise FetchError("SEC EDGAR needs a contact in its User-Agent: set the SEC_USER_AGENT variable")
            headers = {"User-Agent": agent, "Accept-Encoding": "gzip, deflate"}
        else:
            headers = {"User-Agent": USER_AGENT}
        if extra:
            headers.update(extra)
        return headers

    def _robots_for(self, scheme: str, host: str) -> urllib.robotparser.RobotFileParser | None:
        if host in self._robots:
            return self._robots[host]
        parser: urllib.robotparser.RobotFileParser | None = urllib.robotparser.RobotFileParser()
        robots_url = f"{scheme}://{host}/robots.txt"
        try:
            self._wait(host, self.min_interval_s)
            response = self.session.get(robots_url, headers=self._headers(host, None), timeout=TIMEOUT_S)
            self._last_request[host] = time.monotonic()
            if response.status_code >= 400:
                # No robots.txt (or none we may read): the standard reads that as no restriction.
                parser.parse([])
            else:
                parser.parse(response.text.splitlines())
        except requests.RequestException:
            parser = None
        self._robots[host] = parser
        return parser

    def interval_for(self, scheme: str, host: str) -> float:
        parser = self._robots_for(scheme, host)
        delay = None
        if parser is not None:
            delay = parser.crawl_delay(ROBOTS_AGENT)
        return max(self.min_interval_s, float(delay or 0.0))

    def _wait(self, host: str, interval: float) -> None:
        last = self._last_request.get(host)
        if last is not None:
            remaining = interval - (time.monotonic() - last)
            if remaining > 0:
                time.sleep(remaining)

    # ------------------------------------------------------------------ get

    def get(
        self,
        url: str,
        *,
        key: str | None = None,
        source: str = "",
        licence: str = "",
        refetch: bool = False,
        headers: Mapping[str, str] | None = None,
        accept_status: tuple[int, ...] = (200,),
    ) -> Path:
        """The cached file for url, downloading it first if it is not cached.

        Returns the path. Raises BlockedError for a refused host or path, and
        FetchError for anything else that leaves no file.
        """
        key = key or self.key_for(url)
        if not refetch:
            hit = self.cached(url, key)
            if hit is not None:
                return hit
        if self.offline:
            raise FetchError(f"offline and not cached: {url}")
        parts = urllib.parse.urlsplit(url)
        host = parts.netloc
        if host in self._blocked:
            raise BlockedError(f"{host} refused earlier in this run ({self._blocked[host]})")
        parser = self._robots_for(parts.scheme, host)
        if parser is not None and not parser.can_fetch(ROBOTS_AGENT, url):
            raise BlockedError(f"robots.txt of {host} disallows {parts.path}")
        interval = self.interval_for(parts.scheme, host)
        last_error: Exception | None = None
        for attempt in range(RETRIES):
            self._wait(host, interval)
            try:
                response = self.session.get(url, headers=self._headers(host, headers), timeout=TIMEOUT_S)
            except requests.exceptions.ProxyError as error:
                self._last_request[host] = time.monotonic()
                text = str(error)
                # A policy denial (403 or 407 to CONNECT) is final and never retried; anything else
                # from the proxy (a tunnel that dropped, a busy gateway) is retried after a pause.
                if "403" in text or "407" in text:
                    self._blocked[host] = "proxy denied the connection (policy)"
                    raise BlockedError(f"{host}: the network proxy denied the connection") from error
                last_error = error
                time.sleep(min(120.0, max(30.0, interval) * (2**attempt)))
                continue
            except requests.RequestException as error:
                self._last_request[host] = time.monotonic()
                last_error = error
                time.sleep(min(60.0, interval * (2**attempt)))
                continue
            self._last_request[host] = time.monotonic()
            if response.status_code in (403, 429):
                self._blocked[host] = f"HTTP {response.status_code}"
                raise BlockedError(f"{host} answered HTTP {response.status_code} for {url}")
            if response.status_code >= 500:
                last_error = FetchError(f"HTTP {response.status_code} for {url}")
                time.sleep(min(60.0, interval * (2**attempt)))
                continue
            if response.status_code not in accept_status:
                raise FetchError(f"HTTP {response.status_code} for {url}")
            return self._store(url, key, response, source, licence)
        raise FetchError(f"gave up on {url}: {last_error}")

    def _store(self, url: str, key: str, response: requests.Response, source: str, licence: str) -> Path:
        body = response.content
        path = self.path_for(key, url)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        self.manifest[key] = {
            "key": key,
            "url": url,
            "path": str(path.relative_to(self.raw_dir)),
            "retrieved_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sha256": hashlib.sha256(body).hexdigest(),
            "bytes": len(body),
            "content_type": response.headers.get("Content-Type", ""),
            "status": response.status_code,
            "source": source,
            "licence": licence,
        }
        self.save_manifest()
        return path

    def record_local(self, url: str, key: str, path: Path, source: str, licence: str, note: str = "") -> None:
        """Record a file produced outside get(), such as a page rendered in a browser."""
        body = path.read_bytes()
        self.manifest[key] = {
            "key": key,
            "url": url,
            "path": str(path.relative_to(self.raw_dir)),
            "retrieved_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sha256": hashlib.sha256(body).hexdigest(),
            "bytes": len(body),
            "content_type": "text/html; rendered",
            "status": 200,
            "source": source,
            "licence": licence,
            "note": note,
        }
        self.save_manifest()

    def blocked_hosts(self) -> dict[str, str]:
        return dict(self._blocked)


def default_fetcher(root: Path, offline: bool = False) -> Fetcher:
    """The fetcher the pipeline uses: data/raw under the repository root."""
    return Fetcher(
        raw_dir=root / "data" / "raw", manifest_path=root / "data" / "raw" / "manifest.json", offline=offline
    )
