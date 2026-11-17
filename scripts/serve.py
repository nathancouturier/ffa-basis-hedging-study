"""Serve the repository the way GitHub Pages does: only under /ffa-basis-hedging-study/.

    python3 scripts/serve.py              http://127.0.0.1:8150/ffa-basis-hedging-study/
    python3 scripts/serve.py --port 9000

Standard library only. Any path outside the prefix is a 404, so a root-relative link that would break on
the deployed subpath also breaks here. Hidden files and folders (.git, .work, .venv) are never served.
"""

from __future__ import annotations

import argparse
import contextlib
import http.server
import mimetypes
import posixpath
import socketserver
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "/ffa-basis-hedging-study/"
TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".pdf": "application/pdf",
    ".png": "image/png",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    """Static files from the repository root, mounted at PREFIX."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def guess_type(self, path):
        suffix = Path(str(path)).suffix.lower()
        return TYPES.get(suffix) or mimetypes.guess_type(str(path))[0] or "application/octet-stream"

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _inside(self) -> str | None:
        """The repository-relative path for a request under PREFIX, or None (404)."""
        raw = urllib.parse.urlsplit(self.path).path
        path = urllib.parse.unquote(raw)
        if not path.startswith(PREFIX):
            return None
        rel = posixpath.normpath(path[len(PREFIX) :] or ".")
        parts = [p for p in rel.split("/") if p not in ("", ".")]
        if any(p.startswith(".") for p in parts) or ".." in parts:
            return None
        return "/".join(parts)

    def _route(self) -> bool:
        raw = urllib.parse.urlsplit(self.path).path
        if raw == PREFIX.rstrip("/"):
            self.send_response(301)
            self.send_header("Location", PREFIX)
            self.end_headers()
            return False
        rel = self._inside()
        if rel is None:
            self.send_error(404, "Not under %s" % PREFIX)
            return False
        query = urllib.parse.urlsplit(self.path).query
        self.path = "/" + rel + (("?" + query) if query else "")
        return True

    def do_GET(self):
        if self._route():
            super().do_GET()

    def do_HEAD(self):
        if self._route():
            super().do_HEAD()

    def log_message(self, format, *args):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), format % args))


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8150)
    parser.add_argument("--bind", default="127.0.0.1")
    args = parser.parse_args()
    with Server((args.bind, args.port), Handler) as httpd:
        print("Serving %s at http://%s:%d%s" % (ROOT.name, args.bind, args.port, PREFIX), flush=True)
        with contextlib.suppress(KeyboardInterrupt):
            httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
