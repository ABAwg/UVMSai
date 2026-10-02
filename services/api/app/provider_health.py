"""Shared diagnostics derived from persisted accounting, never raw upstream errors."""
from datetime import datetime, timezone

from sqlalchemy import select

from .config import effective_ai_provider, provider_api_key, settings
from .models import UsageEvent


def provider_health(db):
    from .ai_gateway import ProviderError, upstream_model
    provider = effective_ai_provider(settings)
    models = {mode: upstream_model('uvms-1-' + mode) for mode in ('fast', 'balanced', 'deep')}
    if provider == 'groq':
        models.update(transcription=settings.groq_transcription_model)
    rows = db.scalars(select(UsageEvent).where(
        UsageEvent.kind == 'provider.request',
        UsageEvent.meta['provider'].as_string() == provider,
        UsageEvent.meta['operation'].as_string() == 'text',
        UsageEvent.meta['provider_model'].as_string().in_(list(models.values())),
        UsageEvent.meta['status'].as_string().in_(['completed', 'failed']),
    ).order_by(UsageEvent.created_at.desc()).limit(100)).all()
    latest = rows[0] if rows else None
    last_failure = next((row for row in rows if row.meta.get('status') == 'failed'), None)
    safe_codes = {'timeout','capability','configuration','authentication','rate_limit','daily_limit','busy','network',
                  'upstream_error','malformed_response','interrupted','incomplete','unavailable'}
    last_error = None
    if last_failure:
        code = last_failure.meta.get('error_code')
        code = code if code in safe_codes else 'unavailable'
        last_error = {'code': code, 'message': str(ProviderError(code)), 'at': last_failure.created_at.replace(tzinfo=timezone.utc)}
    configured = bool(provider_api_key(settings)) and provider != 'demo'
    checked_at = latest.created_at.replace(tzinfo=timezone.utc) if latest else None
    fresh = checked_at is not None and (datetime.now(timezone.utc) - checked_at).total_seconds() < 900
    status = ('unavailable' if not configured else 'unknown' if not fresh else
              'available' if latest.meta.get('status') == 'completed' else 'unavailable')
    from .beta_quota import latest
    snapshots = [latest(model) for model in set(models.values())] if provider == 'groq' else []
    return {'provider': provider, 'name': {'gemini':'Gemini', 'groq':'Groq'}.get(provider, provider),
            'status': status, 'configured': configured, 'models': models,
            'checked_at': checked_at, 'last_error': last_error,
            'vision_enabled': provider != 'groq',
            'rate_limits': [snapshot for snapshot in snapshots if snapshot],
            'recent_errors': [{'code': row.meta.get('error_code') if row.meta.get('error_code') in safe_codes else 'unavailable',
                               'request_id': row.meta.get('request_id'), 'at': row.created_at.replace(tzinfo=timezone.utc)}
                              for row in rows if row.meta.get('status') == 'failed'][:10]}
