#!/usr/bin/env python3
"""GoBadminton v2 synthetic TLS upload checksum check. No production writes.

Normal mode requires --run and an independently approved synthetic receiver
at /__gb_v2_synthetic_bytes behind the already verified mTLS Gate.
Never falls back to production /v1/me/avatar or disables certificate checks.
"""
import argparse
import hashlib
import http.client
import json
import os
import socket
import ssl
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

PORTS = (18542, 18552, 18562)
SIZES_KIB = (16, 64, 384, 512)
HOSTNAME = "gb-api-gate.internal"
PATH = "/__gb_v2_synthetic_bytes"


def envelope(payload):
    return (
        "PUT " + PATH + " HTTP/1.1\r\n"
        "Host: " + HOSTNAME + "\r\n"
        "Content-Type: application/octet-stream\r\n"
        "Content-Length: " + str(len(payload)) + "\r\n"
        "Connection: close\r\n"
        "Cache-Control: no-store\r\n"
        "\r\n"
    ).encode("ascii") + payload


def send(port, size_kib, context):
    payload = os.urandom(size_kib * 1024)
    expected = hashlib.sha256(payload).hexdigest()
    request = envelope(payload)
    started = time.monotonic()
    with socket.create_connection(("127.0.0.1", port), timeout=8) as raw:
        with context.wrap_socket(raw, server_hostname=HOSTNAME) as tunnel:
            tunnel.settimeout(35)
            tunnel.sendall(request)
            response = http.client.HTTPResponse(tunnel)
            response.begin()
            status = response.status
            data = response.read(4097)
            response.close()
    if len(data) > 4096:
        raise ValueError("oversized response")
    if status != 200:
        raise ValueError("HTTP status %s (expected 200)" % status)
    result = json.loads(data)
    if result.get("received") != len(payload):
        raise ValueError("received byte count mismatch")
    if result.get("sha256") != expected:
        raise ValueError("SHA256 mismatch")
    return {
        "lane": port, "size_kib": size_kib,
        "received": result["received"],
        "sha256": expected,
        "seconds": round(time.monotonic() - started, 3),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true",
                        help="local CPU-only request construction; no sockets")
    parser.add_argument("--run", action="store_true",
                        help="requires independently approved synthetic Gate receiver")
    parser.add_argument("--ca", default="/etc/gobadminton-interserver/ca.crt")
    parser.add_argument("--cert", default="/etc/gobadminton-interserver/moscow-client.crt")
    parser.add_argument("--key", default="/etc/gobadminton-interserver/moscow-client.key")
    args = parser.parse_args()
    if args.self_test and not args.run:
        for size in SIZES_KIB:
            payload = os.urandom(size * 1024)
            wire = envelope(payload)
            assert wire.endswith(payload)
            assert len(payload) == size * 1024
            assert "Content-Length: %d\r\n" % len(payload) in wire.split(b"\r\n\r\n", 1)[0].decode("ascii")
            assert len(hashlib.sha256(payload).hexdigest()) == 64
        print("SELF_TEST_PASS: four payload sizes, SHA256 and HTTP framing; NO NETWORK")
        return
    if not args.run or args.self_test:
        parser.error("use --self-test (offline) or --run (approved receiver only)")
    context = ssl.create_default_context(cafile=args.ca)
    context.check_hostname = True
    context.verify_mode = ssl.CERT_REQUIRED
    context.load_cert_chain(args.cert, args.key)
    results = []
    failures = []
    for size in SIZES_KIB:
        with ThreadPoolExecutor(max_workers=3) as pool:
            tasks = {pool.submit(send, port, size, context): port for port in PORTS}
            for future in as_completed(tasks):
                port = tasks[future]
                try:
                    record = future.result()
                    results.append(record)
                    print("PASS", json.dumps(record, sort_keys=True), flush=True)
                except Exception as exc:
                    failures.append((port, size, type(exc).__name__, str(exc)[:140]))
                    print("FAIL lane=%s size_kib=%s reason=%s" %
                          (port, size, type(exc).__name__), flush=True)
        if failures:
            break
    print("RESULT passed=%d failed=%d expected=12" %
          (len(results), len(failures)), flush=True)
    if failures or len(results) != 12:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
