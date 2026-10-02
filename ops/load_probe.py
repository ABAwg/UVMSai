from __future__ import annotations

import argparse
import statistics
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed


def percentile(values: list[float], percent: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * percent))))
    return ordered[index]


def one(url: str, timeout: float, bearer: str | None) -> tuple[bool, float, int]:
    headers = {"User-Agent": "UVMS-AI-production-load-probe/1.3"}
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    request = urllib.request.Request(url, headers=headers)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response.read(1024)
            elapsed = (time.perf_counter() - started) * 1000
            return 200 <= response.status < 400, elapsed, response.status
    except urllib.error.HTTPError as exc:
        elapsed = (time.perf_counter() - started) * 1000
        return False, elapsed, exc.code
    except Exception:
        elapsed = (time.perf_counter() - started) * 1000
        return False, elapsed, 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Small dependency-free UVMS HTTP concurrency probe")
    parser.add_argument("url", help="Full URL, e.g. https://ai.example.com/live")
    parser.add_argument("--requests", type=int, default=100)
    parser.add_argument("--concurrency", type=int, default=10)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--bearer", default=None, help="Optional access token for an authenticated endpoint")
    parser.add_argument("--max-error-rate", type=float, default=0.01)
    parser.add_argument("--max-p95-ms", type=float, default=1500.0)
    args = parser.parse_args()

    if args.requests < 1 or args.concurrency < 1 or args.concurrency > args.requests:
        parser.error("requests >= concurrency >= 1 is required")

    results: list[tuple[bool, float, int]] = []
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = [pool.submit(one, args.url, args.timeout, args.bearer) for _ in range(args.requests)]
        for future in as_completed(futures):
            results.append(future.result())
    wall = time.perf_counter() - started

    latencies = [row[1] for row in results]
    failures = [row for row in results if not row[0]]
    error_rate = len(failures) / len(results)
    statuses: dict[int, int] = {}
    for _, _, status in results:
        statuses[status] = statuses.get(status, 0) + 1

    print(f"requests={len(results)} concurrency={args.concurrency} wall_seconds={wall:.2f} rps={len(results)/max(wall, 0.001):.2f}")
    print(f"latency_ms mean={statistics.fmean(latencies):.1f} p50={percentile(latencies,0.50):.1f} p95={percentile(latencies,0.95):.1f} p99={percentile(latencies,0.99):.1f}")
    print("statuses=" + ",".join(f"{code}:{count}" for code, count in sorted(statuses.items())))
    print(f"error_rate={error_rate:.4f}")

    if error_rate > args.max_error_rate:
        print("FAIL: error rate exceeded threshold")
        return 1
    if percentile(latencies, 0.95) > args.max_p95_ms:
        print("FAIL: p95 latency exceeded threshold")
        return 1
    print("Load probe PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
