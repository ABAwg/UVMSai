from fastapi import HTTPException
from .models import AiFeature
from .config import effective_ai_provider, settings

def features(db):
    result = {}
    for name in ('search','images','voice'):
        row = db.get(AiFeature,name)
        result[name] = row.is_enabled if row else getattr(settings,name+'_enabled')
    if effective_ai_provider(settings) == 'openrouter': result['search'] = False
    # Gemini text and Vision use Chat Completions. OpenAI-only tool endpoints
    # are not silently called with another provider's credentials or demo data.
    if effective_ai_provider(settings) == 'gemini':
        result.update(search=False, images=False, voice=False)
    if effective_ai_provider(settings) == 'groq':
        result.update(search=False, images=False)
    result['vision'] = effective_ai_provider(settings) != 'groq'
    if settings.public_beta and effective_ai_provider(settings) == 'groq': result.update(search=False, images=False)
    return result

def enforce_feature(db,name):
    if not features(db)[name]:
        raise HTTPException(403,f'{name.title()} is currently unavailable.')
