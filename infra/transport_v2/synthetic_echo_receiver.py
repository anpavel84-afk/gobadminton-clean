#!/usr/bin/env python3
"""Single-use bounded synthetic upload echo (loopback only; no body stored)."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib, json, threading, time

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    count = 0
    count_lock = threading.Lock()
    def log_message(self, *_args): pass
    def do_PUT(self):
        if self.path != "/__gb_v2_synthetic_bytes":
            return self.respond(404, {"error":"wrong-path"})
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            return self.respond(400, {"error":"invalid-length"})
        if length < 0 or length > 524288:
            return self.respond(413, {"error":"size-limit"})
        left = length
        h = hashlib.sha256()
        received = 0
        deadline = time.monotonic() + 28
        self.connection.settimeout(28)
        try:
            while left > 0 and time.monotonic() < deadline:
                buf = self.rfile.read(min(16384, left))
                if not buf:
                    break
                h.update(buf)
                received += len(buf)
                left -= len(buf)
        except (TimeoutError, OSError):
            return self.respond(408, {"received":received,"expected":length})
        if left:
            return self.respond(408, {"received":received,"expected":length})
        with Handler.count_lock:
            Handler.count += 1
        return self.respond(200, {"received":received, "sha256":h.hexdigest()})
    def respond(self, code, data):
        body = json.dumps(data).encode("ascii")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

s = ThreadingHTTPServer(("127.0.0.1", 18991), Handler)
s.daemon_threads = True
s.timeout = 1.0
stop = time.monotonic() + 95
print("SYNTHETIC_ECHO_READY 127.0.0.1:18991 max_body=524288", flush=True)
while time.monotonic() < stop and Handler.count < 16:
    s.handle_request()
print("SYNTHETIC_ECHO_EXIT received_requests="+str(Handler.count), flush=True)
s.server_close()
