#!/usr/bin/env python3
import urllib.request

urls = [
    "http://127.0.0.1/.well-known/acme-challenge/ping.txt",
    "http://127.0.0.1/",
    "http://194.87.214.217/.well-known/acme-challenge/ping.txt",
]
for url in urls:
    req = urllib.request.Request(url, headers={"Host": "gobadminton.ru"})
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            body = response.read(160).decode("utf-8", "replace").replace("\n", " ")
            print(f"{url} -> {response.status} {body[:100]}")
    except Exception as exc:  # noqa: BLE001
        print(f"{url} -> ERR {exc}")
