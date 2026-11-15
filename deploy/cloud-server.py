#!/usr/bin/env python3
"""Druid Grove cloud saves: a tiny standard-library HTTP service behind nginx (/api/cloud/).

There are no accounts. A player turns cloud save on and gets a random code; anyone holding the
code can read and write that code's worlds, so the code is the secret. On disk each code is a
folder named by the SHA-256 of the code (the codes themselves are never stored), holding one
file per save slot plus the previous version of each (a one-step undo for accidents).

  POST   /api/cloud/new               -> {"code": "ABCD-EFGH-JKMN"}
  GET    /api/cloud/<code>            -> {"slots": {"0": {"savedAt": ms, "size": bytes}, ...}}
  GET    /api/cloud/<code>/slot/<i>   -> the save (the game's own JSON, as it keeps it locally)
  PUT    /api/cloud/<code>/slot/<i>   -> 204, or 409 {"savedAt": ms} if the stored save is newer
  DELETE /api/cloud/<code>/slot/<i>   -> 204 (the save is kept aside as slot-<i>.deleted.json)

No IP addresses or other request details are logged.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.environ.get("CLOUD_DIR", "/var/lib/druid-grove-cloud")
PORT = int(os.environ.get("CLOUD_PORT", "8100"))
SLOTS = 4
MAX_SAVE = 4 * 1024 * 1024  # a late-game save is a few hundred KB
# No 0/O, 1/I/L or U: easy to read aloud and type on a phone. 12 of 30 symbols is ~59 bits.
ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_LEN = 12

ROUTE = re.compile(r"^/api/cloud/([A-Za-z0-9-]+)(?:/slot/(\d))?$")


def normalize(code: str) -> str | None:
    c = re.sub(r"[^A-Za-z0-9]", "", code).upper()
    if len(c) != CODE_LEN or any(ch not in ALPHABET for ch in c):
        return None
    return c


def pretty(c: str) -> str:
    return "-".join(c[i : i + 4] for i in range(0, CODE_LEN, 4))


def folder(c: str) -> str:
    return os.path.join(ROOT, hashlib.sha256(c.encode()).hexdigest()[:40])


def saved_at(raw: bytes) -> int:
    try:
        v = json.loads(raw).get("savedAt")
        return int(v) if isinstance(v, (int, float)) else 0
    except Exception:
        return -1


def write_atomic(path: str, data: bytes):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


class Handler(BaseHTTPRequestHandler):
    server_version = "dg-cloud"
    sys_version = ""

    def log_message(self, *args):  # no request logs (they'd include addresses)
        pass

    def reply(self, status: int, body=None):
        data = b"" if body is None else json.dumps(body).encode()
        self.send_response(status)
        if data:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def route(self):
        m = ROUTE.match(self.path.split("?")[0])
        if not m:
            return None, None
        code = normalize(m.group(1))
        slot = m.group(2)
        if code is None:
            return None, None
        if slot is not None and not (0 <= int(slot) < SLOTS):
            return None, None
        return code, slot

    def do_POST(self):
        if self.path != "/api/cloud/new":
            return self.reply(404)
        for _ in range(5):
            c = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LEN))
            d = folder(c)
            if not os.path.exists(d):
                os.makedirs(d)
                return self.reply(200, {"code": pretty(c)})
        return self.reply(500)

    def do_GET(self):
        code, slot = self.route()
        if code is None:
            return self.reply(404)
        d = folder(code)
        if not os.path.isdir(d):
            return self.reply(404, {"error": "unknown code"})
        if slot is None:
            slots = {}
            for i in range(SLOTS):
                p = os.path.join(d, f"slot-{i}.json")
                if os.path.exists(p):
                    with open(p, "rb") as f:
                        raw = f.read()
                    slots[str(i)] = {"savedAt": saved_at(raw), "size": len(raw)}
            return self.reply(200, {"slots": slots})
        p = os.path.join(d, f"slot-{slot}.json")
        if not os.path.exists(p):
            return self.reply(404)
        with open(p, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_PUT(self):
        code, slot = self.route()
        if code is None or slot is None:
            return self.reply(404)
        d = folder(code)
        if not os.path.isdir(d):
            return self.reply(404, {"error": "unknown code"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_SAVE:
            return self.reply(413)
        raw = self.rfile.read(n)
        t = saved_at(raw)
        if t < 0:
            return self.reply(400, {"error": "not a save"})
        p = os.path.join(d, f"slot-{slot}.json")
        if os.path.exists(p):
            with open(p, "rb") as f:
                old = f.read()
            have = saved_at(old)
            # A device that's behind mustn't overwrite newer progress from another one.
            force = self.headers.get("X-Overwrite") == "1"
            if have > t and not force:
                return self.reply(409, {"savedAt": have})
            write_atomic(os.path.join(d, f"slot-{slot}.prev.json"), old)
        write_atomic(p, raw)
        return self.reply(204)

    def do_DELETE(self):
        code, slot = self.route()
        if code is None or slot is None:
            return self.reply(404)
        d = folder(code)
        p = os.path.join(d, f"slot-{slot}.json")
        if os.path.exists(p):
            os.replace(p, os.path.join(d, f"slot-{slot}.deleted.json"))
        return self.reply(204)


if __name__ == "__main__":
    os.makedirs(ROOT, exist_ok=True)
    print(f"druid-grove cloud saves on 127.0.0.1:{PORT}, data in {ROOT}", file=sys.stderr)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
