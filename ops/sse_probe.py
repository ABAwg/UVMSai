from __future__ import annotations

import argparse
import json
import time
import urllib.request


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify UVMS chat SSE reaches the client progressively")
    parser.add_argument("base_url", help="Public base URL, e.g. https://ai.example.com")
    parser.add_argument("--bearer", required=True, help="Disposable QA user's access token")
    parser.add_argument("--prompt", default="Write five short numbered sentences, sending them progressively.")
    parser.add_argument("--timeout", type=float, default=45.0)
    parser.add_argument("--max-first-event-ms", type=float, default=15000.0)
    args = parser.parse_args()

    url = args.base_url.rstrip("/") + "/api/v1/chat/stream"
    payload = json.dumps({"content": args.prompt, "model_id": "uvms-1-fast"}).encode()
    request = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {args.bearer}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "User-Agent": "UVMS-AI-sse-probe/1.3",
        },
    )

    started = time.perf_counter()
    first_event_ms: float | None = None
    delta_events = 0
    done = False
    with urllib.request.urlopen(request, timeout=args.timeout) as response:
        if response.headers.get_content_type() != "text/event-stream":
            raise SystemExit(f"FAIL: unexpected content type {response.headers.get('Content-Type')}")
        if "no-transform" not in response.headers.get("Cache-Control", ""):
            raise SystemExit("FAIL: stream is missing Cache-Control: no-transform")
        for raw in response:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            if first_event_ms is None:
                first_event_ms = (time.perf_counter() - started) * 1000
            if line == "event: done":
                done = True
            if line.startswith("data:"):
                try:
                    event = json.loads(line[5:].strip())
                except json.JSONDecodeError:
                    continue
                if event.get("type") == "delta" or event.get("delta"):
                    delta_events += 1

    if first_event_ms is None:
        raise SystemExit("FAIL: no SSE event arrived")
    print(f"first_event_ms={first_event_ms:.1f} delta_events={delta_events} done={done}")
    if first_event_ms > args.max_first_event_ms:
        raise SystemExit("FAIL: first event exceeded threshold")
    if delta_events < 2:
        raise SystemExit("FAIL: fewer than two visible delta events; proxy buffering/model behavior needs review")
    if not done:
        raise SystemExit("FAIL: stream ended without done event")
    print("SSE probe PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
