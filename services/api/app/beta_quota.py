"""Conservative Public Beta admission shared by API workers through Redis.

One atomic reservation covers daily/per-minute user limits and global capacity.
No queues or automatic provider retries. Redis failure closes production admission.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import math
import re
import threading
import time
import uuid

from .config import settings

_lock = threading.Lock()
_active = {}
_daily = {}
_minute = {}
_cooldown = {}
_observations = {}
_client = None
_client_url = None

_ADMIT = '''
local now=tonumber(ARGV[1]); local rid=ARGV[2]; local expires=tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now)
redis.call('ZREMRANGEBYSCORE',KEYS[3],'-inf',now-60)
local wait=redis.call('TTL',KEYS[4]); if wait>0 then return {4,wait} end
if tonumber(redis.call('GET',KEYS[2]) or '0')>=tonumber(ARGV[4]) then return {1,tonumber(ARGV[7])} end
if redis.call('ZCARD',KEYS[3])>=tonumber(ARGV[5]) then
 local first=redis.call('ZRANGE',KEYS[3],0,0,'WITHSCORES'); return {2,math.max(1,math.ceil(60-now+tonumber(first[2])))}
end
if redis.call('ZCARD',KEYS[1])>=tonumber(ARGV[6]) then return {3,5} end
redis.call('ZADD',KEYS[1],expires,rid); redis.call('EXPIRE',KEYS[1],math.ceil(expires-now)+60)
redis.call('INCR',KEYS[2]); redis.call('EXPIRE',KEYS[2],tonumber(ARGV[7])+60)
redis.call('ZADD',KEYS[3],now,rid); redis.call('EXPIRE',KEYS[3],61)
return {0,0}
'''


def client():
    global _client, _client_url
    if not settings.redis_url: return None
    if _client is None or _client_url != settings.redis_url:
        import redis
        _client = redis.Redis.from_url(settings.redis_url, decode_responses=True, socket_timeout=1, socket_connect_timeout=1)
        _client_url = settings.redis_url
    return _client


def _day(now):
    date = datetime.fromtimestamp(now, timezone.utc)
    return date.strftime('%Y%m%d'), max(1, math.ceil(86400 - (now % 86400)))


def _limits():
    return min(10, settings.beta_daily_requests), min(5, settings.beta_minute_requests), min(3, settings.beta_global_concurrency)


def _reserve(user, rid, model):
    from .ai_gateway import ProviderError
    now = time.time(); day, ttl = _day(now); daily, minute, concurrent = _limits()
    expires = now + settings.provider_timeout + 30
    redis = client()
    if redis is not None:
        try:
            code, retry = redis.eval(_ADMIT, 4, 'uvms:beta:active', f'uvms:beta:day:{day}:{user}',
                                    f'uvms:beta:minute:{user}', f'uvms:beta:cooldown:{model}',
                                    now, rid, expires, daily, minute, concurrent, ttl)
            return int(code), int(retry), redis
        except Exception:
            if settings.env.lower() == 'production': raise ProviderError('busy', 5) from None
    elif settings.env.lower() == 'production':
        raise ProviderError('busy', 5)
    with _lock:
        for key, expiry in list(_active.items()):
            if expiry <= now: _active.pop(key, None)
        for key in list(_daily):
            if key[0] != day: _daily.pop(key, None)
        for key, values in list(_minute.items()):
            _minute[key] = [t for t in values if t > now-60]
            if not _minute[key]: _minute.pop(key, None)
        ticks = _minute.get(user, [])
        if _cooldown.get(model, 0) > now: return 4, math.ceil(_cooldown[model]-now), None
        if _daily.get((day,user), 0) >= daily: return 1, ttl, None
        if len(ticks) >= minute: return 2, max(1, math.ceil(60-now+ticks[0])), None
        if len(_active) >= concurrent: return 3, 5, None
        _active[rid] = expires; _daily[(day,user)] = _daily.get((day,user), 0)+1
        _minute[user] = ticks + [now]
    return 0, 0, None


@contextmanager
def provider_slot(trace, *, enabled):
    if not enabled:
        yield; return
    from .ai_gateway import ProviderError
    if not trace or not trace.get('user_id'): raise ProviderError('configuration')
    # A client may reuse its correlation ID; capacity leases must be unique.
    rid = str(uuid.uuid4())
    code, retry, redis = _reserve(trace['user_id'], rid, trace['provider_model'])
    if code: raise ProviderError({1:'daily_limit', 2:'rate_limit', 3:'busy', 4:'rate_limit'}[code], retry)
    trace['quota_admitted'] = True
    try:
        yield
    finally:
        if redis is not None:
            try: redis.zrem('uvms:beta:active', rid)
            except Exception: pass  # Lease expires even after a crashed worker/Redis outage.
        else:
            with _lock: _active.pop(rid, None)


def retry_seconds(headers):
    value = headers.get('retry-after', '')
    try:
        seconds = float(value)
    except (ValueError, TypeError):
        try: seconds = parsedate_to_datetime(value).timestamp() - time.time()
        except (ValueError, TypeError, OverflowError):
            reset = headers.get('x-ratelimit-reset-tokens', '')
            seconds = sum(float(n)*{'ms':.001,'s':1,'m':60,'h':3600}[unit] for n,unit in re.findall(r'(\d+(?:\.\d+)?)(ms|s|m|h)',reset))
            seconds = max(60, seconds)  # Also covers quota dimensions absent from headers.
    return min(86400, max(1, math.ceil(seconds))) if math.isfinite(seconds) else 60


def observe_response(response, trace, model):
    allowed = ('x-ratelimit-remaining-requests','x-ratelimit-remaining-tokens','x-ratelimit-limit-requests',
               'x-ratelimit-limit-tokens','x-ratelimit-reset-requests','x-ratelimit-reset-tokens','retry-after')
    safe = {}
    for key in allowed:
        value = response.headers.get(key, '')
        # Never persist arbitrary upstream header content. Retry-After HTTP dates
        # are converted to numeric seconds; durations and numeric quotas are bounded.
        if value and re.fullmatch(r'[0-9.msh ]{1,80}', value): safe[key] = value
        elif key == 'retry-after' and value: safe[key] = str(retry_seconds(response.headers))
    snapshot = {'model': model, 'at': time.time(), 'status': response.status_code, 'headers': safe}
    if trace is not None:
        trace['rate_limits'] = safe; trace['provider_http_status'] = response.status_code
    with _lock: _observations[model] = snapshot
    wait = retry_seconds(response.headers) if response.status_code == 429 else 0
    if wait:
        with _lock: _cooldown[model] = time.time()+wait
    redis = client()
    if redis is not None:
        try:
            redis.setex(f'uvms:beta:observed:{model}', 86400, json.dumps(snapshot))
            if wait: redis.setex(f'uvms:beta:cooldown:{model}', wait, '1')
        except Exception: pass  # Admission itself fails closed in production.


def latest(model):
    redis = client()
    if redis is not None:
        try:
            value = redis.get(f'uvms:beta:observed:{model}')
            if value: return json.loads(value)
        except Exception: pass
    with _lock: return dict(_observations.get(model, {}))


def used_today(user):
    day, _ = _day(time.time()); redis = client()
    if redis is not None:
        try: return int(redis.get(f'uvms:beta:day:{day}:{user}') or 0)
        except Exception: return None
    with _lock: return _daily.get((day,user), 0)


def apply_budget(runtime, alias, history=None):
    if not settings.public_beta: return
    from .ai_gateway import upstream_model, _last_user_text
    from .groq_routing import is_coding
    snapshot = latest(upstream_model(alias, runtime))
    try:
        spare = (time.time() - snapshot['at'] < 60 and int(snapshot['headers']['x-ratelimit-remaining-tokens']) >= 6000
                 and snapshot['status'] == 200)
    except (KeyError, ValueError, TypeError): spare = False
    coding = is_coding(runtime.get('_routing_prompt', _last_user_text(history or [])))
    output = settings.beta_extended_output_tokens if spare and (coding or alias == 'uvms-1-deep') else settings.beta_output_tokens
    runtime['output_tokens'] = min(output, settings.output_tokens)
    runtime['context_tokens'] = min(settings.beta_context_tokens, settings.context_tokens)
