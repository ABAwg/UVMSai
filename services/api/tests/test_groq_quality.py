"""Offline routing/contract regressions, never a substitute for live answer review."""
import importlib
import json
from dataclasses import replace

import httpx
import pytest

from app import ai_gateway as gateway, provider_usage
from app.config import settings
from app.groq_routing import route, is_uzbek, is_coding
from test_gemini_provider import completed


@pytest.mark.parametrize('prompt', [
    'Menga zaxira nusxa bilan sinxronlash orasidagi farqni tushuntiring.',
    'Uyga kelgach nima qilish kerak va qanday dam olish mumkin?',
    'Менга қувват билан энергия орасидаги фарқни тушунтиринг.',
    'Объясни на o‘zbek tilida, пожалуйста.',
])
def test_uzbek_language_multiple_signals(prompt):
    assert is_uzbek(prompt)


@pytest.mark.parametrize('prompt', ['What does the Uzbek word bilan mean?', 'RU: слово uchun в словаре',
                                   'Calculate the integral of x ln(1+x).', 'Read the attached file about Python.'])
def test_default_language_is_not_one_word_detection(prompt):
    assert not is_uzbek(prompt)
    assert not is_coding(prompt)


@pytest.mark.parametrize('prompt', ['Fix this Python function', 'Debug FastAPI endpoint', 'React useEffect bug',
    'Implement TypeScript component', 'SQL query debugging', 'Docker architecture', 'Настрой nginx',
    'software architecture', 'TypeError: undefined'])
def test_coding_topics(prompt):
    result = route(prompt, images=0, default_model='default', qwen_model='qwen', effort='low')
    assert result['model'] == 'default' and result['reasoning_effort'] == 'low'
    assert result['temperature'] == .6


@pytest.fixture
def groq(monkeypatch):
    config = replace(settings, ai_provider='groq', groq_api_key='private-fixture-only', groq_vision_enabled=True,
                     openai_api_key='unused-other-fixture', openrouter_api_key='unused-router-fixture')
    for name in ('ai_gateway', 'provider_usage', 'provider_health', 'services', 'routes', 'ai_features'):
        monkeypatch.setattr(importlib.import_module('app.' + name), 'settings', config)
    original = httpx.Client
    def install(handler):
        monkeypatch.setattr(gateway.httpx, 'Client', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    return install


@pytest.mark.parametrize('prompt,model,effort', [
    ('Ответь: READY', 'openai/gpt-oss-120b', 'low'),
    ('Menga bu nima uchun kerak va qanday ishlashini ayting.', 'openai/gpt-oss-120b', 'low'),
    ('Fix React component', 'openai/gpt-oss-120b', 'low'),
])
def test_actual_wire_model_and_accounting(groq, prompt, model, effort):
    def handler(request):
        assert str(request.url) == 'https://api.groq.com/openai/v1/chat/completions'
        assert request.headers['authorization'] == 'Bearer private-fixture-only'
        body = json.loads(request.content)
        assert body['model'] == model and body['reasoning_effort'] == effort
        assert body['include_reasoning'] is False and body['stream_options']['include_usage']
        return httpx.Response(200, content=completed())
    groq(handler)
    trace = provider_usage.new_trace('uvms-1-fast', 'text')
    assert gateway.complete_answer([{'role': 'user', 'content': prompt}], 'uvms-1-fast', runtime={'_trace': trace}) == 'READY'
    assert trace['provider_model'] == model and trace['attempts'][0]['total_tokens'] == 120


def test_attachment_text_does_not_override_original_prompt(groq):
    def handler(request):
        assert json.loads(request.content)['model'] == 'openai/gpt-oss-120b'
        return httpx.Response(200, content=completed())
    groq(handler)
    history = [{'role': 'user', 'content': 'Extract data. Attached file: Fix React component.'}]
    assert gateway.complete_answer(history, 'uvms-1-fast', runtime={'_routing_prompt': 'Extract data.'}) == 'READY'


def test_legacy_vision_flag_cannot_enable_upstream(groq):
    groq(lambda request: pytest.fail('Public Beta must not call Qwen even with legacy flag enabled'))
    history = [{'role': 'user', 'content': [{'type': 'input_image', 'image_url': 'data:image/png;base64,cGl4ZWxz'}]}]
    with pytest.raises(gateway.ProviderError) as error:
        gateway.complete_answer(history, 'uvms-1-fast')
    assert error.value.code == 'capability'


@pytest.mark.parametrize('status,code', [(401,'authentication'), (403,'authentication'), (429,'rate_limit'), (503,'upstream_error')])
def test_groq_safe_http_errors(groq, status, code):
    groq(lambda request: httpx.Response(status, json={'error': {'message': 'sensitive upstream details'}}))
    with pytest.raises(gateway.ProviderError) as error:
        gateway.complete_answer([{'role': 'user', 'content': 'Hello'}], 'uvms-1-fast')
    assert error.value.code == code and 'sensitive' not in str(error.value)


def test_disabled_vision_rejects_before_upstream(groq, monkeypatch):
    config = replace(gateway.settings, groq_vision_enabled=False)
    for name in ('ai_gateway', 'ai_features', 'services', 'routes'):
        monkeypatch.setattr(importlib.import_module('app.' + name), 'settings', config)
    from app.ai_features import features
    class EmptyDB:
        def get(self, *args): return None
    assert features(EmptyDB())['vision'] is False
    groq(lambda request: pytest.fail('Disabled Vision must never reach Groq'))
    history = [{'role': 'user', 'content': [{'type': 'input_image', 'image_url': 'data:image/png;base64,cGl4ZWxz'}]}]
    with pytest.raises(gateway.ProviderError) as error:
        gateway.complete_answer(history, 'uvms-1-fast')
    assert error.value.code == 'capability'


def test_safe_rate_headers_and_single_attempt(groq):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(429, headers={'retry-after': '12', 'x-ratelimit-remaining-tokens': '0',
            'x-ratelimit-remaining-requests': 'sensitive details'}, json={'error': {'message':'private'}})
    groq(handler)
    trace = provider_usage.new_trace('uvms-1-fast', 'text')
    with pytest.raises(gateway.ProviderError) as error:
        gateway.complete_answer([{'role':'user','content':'Hello'}], 'uvms-1-fast', runtime={'_trace':trace})
    assert error.value.code == 'rate_limit' and error.value.retry_after == 12 and len(calls) == 1
    assert trace['provider_http_status'] == 429
    assert trace['rate_limits'] == {'retry-after':'12','x-ratelimit-remaining-tokens':'0'}


def test_disabled_vision_public_api_with_real_upload(groq, monkeypatch):
    import io
    from PIL import Image
    from fastapi.testclient import TestClient
    from app.main import app
    from test_stabilization import register
    config = replace(gateway.settings, groq_vision_enabled=False)
    for name in ('ai_gateway', 'ai_features', 'services', 'routes'):
        monkeypatch.setattr(importlib.import_module('app.' + name), 'settings', config)
    # Install the Groq transport after TestClient construction, so local ASGI
    # requests use its own transport and only attempted upstream calls fail.
    with TestClient(app) as client:
        _, headers = register(client)
        assert client.get('/api/v1/capabilities', headers=headers).json()['vision'] is False
        data = io.BytesIO(); Image.new('RGB', (20,20), 'blue').save(data, format='PNG')
        upload = client.post('/api/v1/files', headers=headers, files={'upload': ('fixture.png', data.getvalue(), 'image/png')})
        assert upload.status_code == 201
        groq(lambda request: pytest.fail('Disabled image input reached upstream'))
        result = client.post('/api/v1/chat/stream', headers=headers, json={'content': 'Describe.', 'attachment_ids': [upload.json()['id']]})
        assert result.status_code == 422 and 'Images are unavailable' in result.json()['detail']
