from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass

from .config import settings
from .security import decode_token
from jwt import InvalidTokenError


@dataclass
class RateLimitResult:
    allowed: bool
    limit: int
    remaining: int
    retry_after: int


_lock = threading.Lock()
_memory: dict[str, deque[float]] = defaultdict(deque)
_redis_client = None
_redis_failed_until = 0.0


def _client():
    global _redis_client, _redis_failed_until
    if not settings.redis_url or time.time() < _redis_failed_until:
        return None
    if _redis_client is not None:
        return _redis_client
    try:
        import redis
        _redis_client = redis.Redis.from_url(settings.redis_url, decode_responses=True, socket_connect_timeout=0.5, socket_timeout=0.5)
        _redis_client.ping()
        return _redis_client
    except Exception:
        _redis_failed_until = time.time() + 15
        return None


def identity_key(ip: str, authorization: str | None) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        try:
            claims = decode_token(authorization.split(' ', 1)[1], 'access')
            return f"user:{claims['sub']}"
        except (InvalidTokenError, KeyError):
            pass
    return f"ip:{ip or 'unknown'}"


def _memory_check(key: str, limit: int, window_seconds: int) -> RateLimitResult:
    now = time.time()
    cutoff = now - window_seconds
    with _lock:
        bucket = _memory[key]
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            retry = max(1, int(window_seconds - (now - bucket[0])))
            return RateLimitResult(False, limit, 0, retry)
        bucket.append(now)
        return RateLimitResult(True, limit, max(0, limit - len(bucket)), 0)


def check_rate_limit(key: str, limit: int, window_seconds: int = 60) -> RateLimitResult:
    if not settings.rate_limit_enabled or limit <= 0:
        return RateLimitResult(True, limit, max(0, limit), 0)

    client = _client()
    redis_key = f"uvms:rl:{window_seconds}:{key}"
    if client is not None:
        try:
            pipe = client.pipeline(transaction=True)
            pipe.incr(redis_key)
            pipe.ttl(redis_key)
            count, ttl = pipe.execute()
            if int(count) == 1 or int(ttl) < 0:
                client.expire(redis_key, window_seconds)
                ttl = window_seconds
            allowed = int(count) <= limit
            return RateLimitResult(allowed, limit, max(0, limit - int(count)), max(1, int(ttl)) if not allowed else 0)
        except Exception:
            # Fail over to a process-local limiter instead of failing requests.
            pass

    return _memory_check(redis_key, limit, window_seconds)
