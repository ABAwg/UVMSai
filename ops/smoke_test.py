from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

base = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost").rstrip("/")

for path in ("/live", "/ready"):
    with urllib.request.urlopen(base + path, timeout=10) as response:
        body = json.loads(response.read().decode())
        expected = "ok" if path == "/live" else "ready"
        if response.status != 200 or body.get("status") != expected:
            raise SystemExit(f"{path} FAIL: status={response.status} body={body}")
        print(path, response.status, body.get("status"))

metrics_token = os.getenv("UVMS_METRICS_TOKEN", "")
if metrics_token:
    request = urllib.request.Request(base + "/metrics", headers={"Authorization": f"Bearer {metrics_token}"})
    with urllib.request.urlopen(request, timeout=10) as response:
        body = response.read().decode("utf-8", errors="replace")
        if response.status != 200 or "uvms_http_requests_total" not in body:
            raise SystemExit("/metrics FAIL")
        print("/metrics", response.status, "protected endpoint reachable")

print("Smoke test PASS")
