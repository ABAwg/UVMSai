from __future__ import annotations

import threading
import time

from .config import settings

_lock = threading.Lock()
_memory_owner: dict[str, tuple[str, float]] = {}
_memory_cancelled: dict[str, float] = {}
_redis_client = None
_redis_failed_until = 0.0


def _redis():
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


def register_request(request_id: str, user_id: str, ttl_seconds: int = 900) -> None:
    client = _redis()
    if client is not None:
        try:
            client.setex(f"uvms:gen:owner:{request_id}", ttl_seconds, user_id)
            client.delete(f"uvms:gen:cancel:{request_id}")
            return
        except Exception:
            pass
    with _lock:
        now = time.time()
        _prune(now)
        _memory_owner[request_id] = (user_id, now + ttl_seconds)
        _memory_cancelled.pop(request_id, None)


def request_owned(request_id: str, user_id: str) -> bool:
    client = _redis()
    if client is not None:
        try:
            return client.get(f"uvms:gen:owner:{request_id}") == user_id
        except Exception:
            pass
    with _lock:
        now = time.time()
        _prune(now)
        item = _memory_owner.get(request_id)
        return bool(item and item[0] == user_id and item[1] > now)


def cancel_request(request_id: str, user_id: str, ttl_seconds: int = 900) -> bool:
    if not request_owned(request_id, user_id):
        return False
    client = _redis()
    if client is not None:
        try:
            client.setex(f"uvms:gen:cancel:{request_id}", ttl_seconds, "1")
            return True
        except Exception:
            pass
    with _lock:
        _memory_cancelled[request_id] = time.time() + ttl_seconds
    return True


def is_cancelled(request_id: str) -> bool:
    client = _redis()
    if client is not None:
        try:
            return bool(client.get(f"uvms:gen:cancel:{request_id}"))
        except Exception:
            pass
    with _lock:
        now = time.time()
        _prune(now)
        return _memory_cancelled.get(request_id, 0) > now


def finish_request(request_id: str) -> None:
    client = _redis()
    if client is not None:
        try:
            client.delete(f"uvms:gen:owner:{request_id}", f"uvms:gen:cancel:{request_id}")
        except Exception:
            pass
    with _lock:
        _memory_owner.pop(request_id, None)
        _memory_cancelled.pop(request_id, None)


def _prune(now: float) -> None:
    for key, (_owner, expires) in list(_memory_owner.items()):
        if expires <= now:
            _memory_owner.pop(key, None)
    for key, expires in list(_memory_cancelled.items()):
        if expires <= now:
            _memory_cancelled.pop(key, None)
