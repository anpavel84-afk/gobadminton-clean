#!/usr/bin/env python3
import urllib.request

checks = [
    ("http://127.0.0.1/v1/health", "gobadminton.ru"),
    ("http://127.0.0.1/v1/ready", "gobadminton.ru"),
    ("http://127.0.0.1/", "gobadminton.ru"),
    ("http://194.87.214.217/v1/health", "gobadminton.ru"),
    ("http://194.87.214.217/", "gobadminton.ru"),
]
for url, host in checks:
    req = urllib.request.Request(url, headers={"Host": host})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            body = response.read(160).decode("utf-8", "replace").replace("\n", " ")
            print(f"{url} -> {response.status} {body[:120]}")
    except Exception as exc:  # noqa: BLE001
        print(f"{url} -> ERR {exc}")
