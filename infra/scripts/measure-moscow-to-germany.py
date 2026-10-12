#!/usr/bin/env python3
"""Bounded Moscow→Germany HTTPS latency sample for F-01 evidence."""
from __future__ import annotations

import json
import statistics
import time
import urllib.error
import urllib.request
from typing import Any

URL = "https://dev-api.gobadminton.ru/v1/health"
SAMPLES = 30


def one() -> dict[str, Any]:
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(URL, timeout=10) as response:
            body = response.read()
            elapsed_ms = (time.perf_counter() - started) * 1000
            return {
                "ok": response.status == 200,
                "status": response.status,
                "ms": round(elapsed_ms, 2),
                "bytes": len(body),
            }
    except Exception as exc:  # noqa: BLE001
        elapsed_ms = (time.perf_counter() - started) * 1000
        return {"ok": False, "error": str(exc), "ms": round(elapsed_ms, 2)}


def main() -> None:
    rows = [one() for _ in range(SAMPLES)]
    ok = [r for r in rows if r.get("ok")]
    times = [float(r["ms"]) for r in ok]
    summary = {
        "url": URL,
        "samples": SAMPLES,
        "successes": len(ok),
        "failures": SAMPLES - len(ok),
        "loss_pct": round(100 * (SAMPLES - len(ok)) / SAMPLES, 2),
    }
    if times:
        summary.update(
            {
                "min_ms": round(min(times), 2),
                "avg_ms": round(statistics.fmean(times), 2),
                "p95_ms": round(sorted(times)[max(0, int(0.95 * len(times)) - 1)], 2),
                "max_ms": round(max(times), 2),
            }
        )
    print(json.dumps({"summary": summary, "samples": rows}, indent=2))


if __name__ == "__main__":
    main()
