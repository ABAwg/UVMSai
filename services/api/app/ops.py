from __future__ import annotations

import json
import logging
import secrets
import time
from collections import Counter
from threading import Lock

from fastapi import HTTPException, Request
from sqlalchemy import text

from .config import effective_ai_provider, provider_api_key, settings
from .database import engine
from .storage_backend import healthcheck as storage_healthcheck

log = logging.getLogger("uvms.api")
_metrics_lock = Lock()
_metrics = Counter()
_started = time.time()
_metrics_redis_client = None
_metrics_redis_failed_until = 0.0


def _metrics_redis():
    """Return a cached Redis client for cross-worker counters when available."""
    global _metrics_redis_client, _metrics_redis_failed_until
    if not settings.redis_url or time.time() < _metrics_redis_failed_until:
        return None
    if _metrics_redis_client is not None:
        return _metrics_redis_client
    try:
        import redis

        _metrics_redis_client = redis.Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=0.5,
            socket_timeout=0.5,
        )
        _metrics_redis_client.ping()
        return _metrics_redis_client
    except Exception:
        _metrics_redis_failed_until = time.time() + 15
        return None


def configure_logging() -> None:
    level = logging.INFO
    logging.basicConfig(level=level, format="%(message)s")
    logging.getLogger('httpx').setLevel(logging.WARNING)
    logging.getLogger('httpcore').setLevel(logging.WARNING)


def log_request(*, request_id: str, method: str, path: str, status: int, duration_ms: float, client_ip: str) -> None:
    payload = {
        "event": "http_request",
        "request_id": request_id,
        "method": method,
        "path": path,
        "status": status,
        "duration_ms": round(duration_ms, 2),
        "client_ip": client_ip,
    }
    log.info(json.dumps(payload, ensure_ascii=False))
    with _metrics_lock:
        _metrics["http_requests_total"] += 1
        _metrics[f"http_status_{status}"] += 1
    client = _metrics_redis()
    if client is not None:
        try:
            pipe = client.pipeline(transaction=False)
            pipe.incr("uvms:metrics:http_requests_total")
            pipe.hincrby("uvms:metrics:http_responses_total", str(status), 1)
            pipe.execute()
        except Exception:
            # Metrics must never break user requests. Local counters remain available.
            pass


def readiness() -> dict:
    checks: dict[str, dict] = {}
    ok = True
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        checks["database"] = {"ok": True}
    except Exception as exc:
        checks["database"] = {"ok": False, "detail": type(exc).__name__}
        ok = False

    storage_ok, storage_detail = storage_healthcheck()
    checks["storage"] = {"ok": storage_ok, "detail": storage_detail}
    ok = ok and storage_ok

    if settings.redis_url:
        try:
            import redis
            client = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=0.5, socket_timeout=0.5)
            client.ping()
            checks["redis"] = {"ok": True}
        except Exception as exc:
            checks["redis"] = {"ok": False, "detail": type(exc).__name__}
            ok = False
    else:
        checks["redis"] = {"ok": True, "detail": "disabled"}

    provider = effective_ai_provider(settings)
    key = provider_api_key(settings)
    live_ai = bool(key) and provider != 'demo'
    explicit_live = settings.ai_provider in {'openai','openrouter','openai-compatible','gemini'}
    checks["ai_provider"] = {"ok": live_ai or (not explicit_live and not settings.require_live_ai), "detail": "configured" if live_ai else "not_configured" if explicit_live else "demo"}
    ok = ok and checks["ai_provider"]["ok"]
    return {"status": "ready" if ok else "not_ready", "checks": checks}


def metrics_text(request: Request) -> str:
    if settings.metrics_token:
        supplied = request.headers.get("authorization", "")
        expected = f"Bearer {settings.metrics_token}"
        if not secrets.compare_digest(supplied, expected):
            raise HTTPException(status_code=401, detail="Metrics authentication required")
    with _metrics_lock:
        snapshot = dict(_metrics)
    backend = "process"
    client = _metrics_redis()
    if client is not None:
        try:
            total = int(client.get("uvms:metrics:http_requests_total") or 0)
            statuses = {str(k): int(v) for k, v in client.hgetall("uvms:metrics:http_responses_total").items()}
            snapshot = {"http_requests_total": total, **{f"http_status_{k}": v for k, v in statuses.items()}}
            backend = "redis"
        except Exception:
            pass
    lines = [
        "# HELP uvms_process_uptime_seconds API worker process uptime.",
        "# TYPE uvms_process_uptime_seconds gauge",
        f"uvms_process_uptime_seconds {int(time.time() - _started)}",
        "# HELP uvms_metrics_backend_info Metrics aggregation backend.",
        "# TYPE uvms_metrics_backend_info gauge",
        f'uvms_metrics_backend_info{{backend="{backend}"}} 1',
        "# HELP uvms_http_requests_total Total HTTP requests handled.",
        "# TYPE uvms_http_requests_total counter",
        f"uvms_http_requests_total {snapshot.get('http_requests_total', 0)}",
    ]
    for key, value in sorted(snapshot.items()):
        if key.startswith("http_status_"):
            status = key.rsplit("_", 1)[-1]
            lines.append(f'uvms_http_responses_total{{status="{status}"}} {value}')
    return "\n".join(lines) + "\n"
