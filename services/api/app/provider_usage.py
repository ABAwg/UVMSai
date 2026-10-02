"""Private operational accounting, separate from public assistant metadata."""
import json
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from sqlalchemy import select
from .config import effective_ai_provider, settings
from .models import UsageEvent, Subscription


def new_trace(model, operation, runtime=None, request_id=None):
    from .ai_gateway import is_demo, upstream_model
    demo = is_demo(operation)
    provider = effective_ai_provider(settings)
    return {'request_id': request_id or str(uuid.uuid4()), 'provider': 'demo' if demo else provider,
            'model_id': model, 'provider_model': ('demo-' + operation) if demo else upstream_model(model, runtime) if operation == 'text' else settings.openai_image_model if operation == 'image' else settings.groq_transcription_model if provider == 'groq' else settings.openai_transcription_model,
            'operation': operation, 'started': time.perf_counter(), 'attempts': [], 'first_token_ms': None}


def usage_received(trace, usage):
    if trace is None or not isinstance(usage, dict): return
    current = trace['attempts'][-1] if trace['attempts'] else {}
    if not trace['attempts']: trace['attempts'].append(current)
    for key in ('input_tokens', 'output_tokens', 'total_tokens'):
        value = usage.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0: current[key] = value
    if isinstance(usage.get('seconds'), (int, float)): current['seconds'] = max(0, usage['seconds'])


def _cost(trace, totals):
    if trace['provider'] == 'demo': return 0.0
    try:
        rates = json.loads(settings.provider_prices).get(trace['provider_model'])
        if not isinstance(rates, dict): return None
        cost = Decimal(0)
        if trace['operation'] == 'image' and 'per_image' in rates:
            return float(Decimal(str(rates['per_image']))) if trace.get('status') == 'completed' else None
        if 'per_second' in rates and totals.get('seconds') is not None:
            return float(Decimal(str(rates['per_second'])) * Decimal(str(totals['seconds'])))
        if totals['input_tokens'] is None or totals['output_tokens'] is None: return None
        for key, rate in [('input_tokens','input_per_million'),('output_tokens','output_per_million')]:
            if rate not in rates: return None
            cost += Decimal(totals[key]) * Decimal(str(rates[rate])) / 1_000_000
        # Tool charges must be configured too; otherwise report an incomplete estimate as unknown.
        if trace.get('search_calls'):
            if 'per_search' not in rates: return None
            cost += Decimal(trace['search_calls']) * Decimal(str(rates['per_search']))
        return float(cost.quantize(Decimal('0.00000001'))) if cost.is_finite() and cost >= 0 else None
    except (ValueError, TypeError, InvalidOperation): return None


def record_trace(db, trace, user_id, chat_id, status, error_code=None):
    trace['status'] = status
    attempts = trace['attempts']
    totals = {key: sum(a[key] for a in attempts) if attempts and all(key in a for a in attempts) else None for key in ('input_tokens','output_tokens','total_tokens','seconds')}
    if trace['provider'] == 'demo': totals.update(input_tokens=0, output_tokens=0, total_tokens=0)
    plan = db.scalar(select(Subscription.plan_code).where(Subscription.user_id == user_id)) or 'free'
    meta = {k:trace[k] for k in ('provider','model_id','provider_model','request_id','operation','first_token_ms')}
    if trace.get('resolved_provider_model'): meta['resolved_provider_model'] = trace['resolved_provider_model']
    for key in ('rate_limits', 'provider_http_status', 'quota_admitted'):
        if key in trace: meta[key] = trace[key]
    meta.update(totals, estimated_cost_usd=_cost(trace, totals), duration_ms=round((time.perf_counter()-trace['started'])*1000,2), status=status, error_code=error_code, user_id=user_id, chat_id=chat_id, plan=plan, attempts=len(attempts), usage_complete=totals['total_tokens'] is not None)
    db.add(UsageEvent(user_id=user_id, kind='provider.request', units=1, meta=meta))


def accounting_summary(db):
    start = datetime.now(timezone.utc).replace(hour=0,minute=0,second=0,microsecond=0)
    rows = db.scalars(select(UsageEvent).where(UsageEvent.kind == 'provider.request', UsageEvent.created_at >= start)).all()
    def summary(items):
        return {'requests':len(items), 'tokens':sum(x.get('total_tokens') or 0 for x in items), 'estimated_cost_usd':round(sum(x.get('estimated_cost_usd') or 0 for x in items),8), 'unknown_cost_requests':sum(x.get('estimated_cost_usd') is None for x in items), 'unknown_token_requests':sum(x.get('total_tokens') is None for x in items)}
    data = [row.meta for row in rows]
    result = summary(data)
    for key, name in [('model_id','by_model'),('provider','by_provider'),('plan','by_plan'),('user_id','top_users')]:
        groups = defaultdict(list)
        for item in data: groups[item.get(key,'unknown')].append(item)
        result[name] = sorted([{'name':name,**summary(items)} for name,items in groups.items()],key=lambda x:x['tokens'],reverse=True)[:20]
    latencies = [x['first_token_ms'] for x in data if x.get('first_token_ms') is not None and x['provider'] != 'demo']
    result['average_first_token_ms'] = round(sum(latencies)/len(latencies),2) if latencies else None
    return result
