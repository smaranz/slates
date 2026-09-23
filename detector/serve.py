"""
The detector sidecar.

MELD takes ~22 seconds to load and ~0.2 seconds to score, so it is loaded once
and kept warm behind a tiny HTTP server — the same shape as the scraper
service next door. Slates' essay route calls it over loopback; if it isn't
running, the route starts it and waits, and if it can't be started the AI check
falls back to the local statistics and says so.

Loopback only, no auth, no logging of submitted text: the whole point of doing
detection locally is that a student's unpublished draft doesn't leave the
machine, and writing it to a log file here would undo that.
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from meld import Detector  # noqa: E402

# Slates' block; see web/lib/ports.ts.
PORT = int(os.environ.get("SLATES_DETECTOR_PORT", "7530"))
MAX_BODY = 2_000_000  # a 650-word essay is ~4KB; this is only a sanity bound

print(f"[detector] loading MELD from {os.environ.get('SLATES_MELD_DIR', '~/.slates/meld/model')}", flush=True)
DETECTOR = Detector()
print(f"[detector] ready on {PORT}, flagging above {DETECTOR.threshold:.3f}", flush=True)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/") in ("", "/health"):
            self._send(200, {"ok": True, "model": "meld-v5", "threshold": DETECTOR.threshold})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/score":
            self._send(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self._send(400, {"error": "bad body length"})
            return

        try:
            text = json.loads(self.rfile.read(length)).get("text") or ""
        except Exception:
            self._send(400, {"error": "bad json"})
            return

        if not text.strip():
            self._send(400, {"error": "nothing to score"})
            return

        try:
            self._send(200, DETECTOR.score(text))
        except Exception as e:  # a bad tensor shape shouldn't kill the server
            self._send(500, {"error": f"{type(e).__name__}: {e}"})

    def log_message(self, *args):
        """Silence the access log — it would record every scored draft."""


if __name__ == "__main__":
    # Loopback only. This must never be reachable off the machine.
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
