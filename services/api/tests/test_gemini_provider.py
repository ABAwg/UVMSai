"""Offline contract/failure regressions. These are never evidence of live Gemini quality."""
import importlib
import json
import threading
import time
from dataclasses import replace

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import ai_gateway as gateway
from app import provider_usage
from app.config import settings, effective_ai_provider, provider_api_key
from app.database import SessionLocal
from app.main import app
from app.models import UsageEvent, User
from test_stabilization import register

HISTORY = [{'role':'developer','content':'Project: metric units. Memory: concise.'},
           {'role':'user','content':'Earlier question'}, {'role':'assistant','content':'Earlier answer'},
           {'role':'user','content':[{'type':'input_text','text':'Привет. Salom. Document: retention 73%.'},
                                    {'type':'input_image','image_url':'data:image/jpeg;base64,cGl4ZWxz','detail':'low'}]}]
USAGE = {'prompt_tokens':100, 'completion_tokens':20, 'total_tokens':120}


def frame(value):
    return ('data: ' + json.dumps(value, ensure_ascii=False) + '\n\n').encode()


def chunk(text=None, finish=None):
    return {'choices':[{'index':0,'delta':{'content':text},'finish_reason':finish}]}


def completed(text='READY', finish='stop'):
    return frame(chunk(text)) + frame(chunk(finish=finish)) + frame({'choices':[], 'usage':USAGE}) + b'data: [DONE]\n\n'


@pytest.fixture
def gemini(monkeypatch):
    config = replace(settings, ai_provider='gemini', gemini_api_key='gemini-fixture-only',
                     openai_api_key='unused-openai-fixture', openrouter_api_key='unused-router-fixture',
                     provider_prices=json.dumps({'gemini-3.8-flash':{'input_per_million':2,'output_per_million':8}}))
    for name in ('ai_gateway','provider_usage','provider_health','services','routes','ai_features','ops'):
        monkeypatch.setattr(importlib.import_module('app.' + name), 'settings', config)
    original = httpx.Client
    def install(handler):
        monkeypatch.setattr(gateway.httpx, 'Client', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    return install


@pytest.mark.parametrize('alias,effort', [('fast','low'),('balanced','medium'),('deep','high')])
def test_wire_contract_preserves_context_and_isolates_credentials(gemini, alias, effort):
    def handler(request):
        assert str(request.url) == 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
        assert request.headers['authorization'] == 'Bearer gemini-fixture-only'
        body = json.loads(request.content)
        assert body['model'] == 'gemini-3.8-flash' and body['reasoning_effort'] == effort
        assert body['stream'] is True and body['stream_options'] == {'include_usage':True}
        assert body['max_tokens'] == settings.output_tokens
        assert 'reasoning' not in body and 'input' not in body
        messages = body['messages']
        assert messages[1] == {'role':'system','content':HISTORY[0]['content']}
        assert messages[2:4] == HISTORY[1:3]
        assert messages[-1]['content'][0] == {'type':'text','text':HISTORY[-1]['content'][0]['text']}
        assert messages[-1]['content'][1] == {'type':'image_url','image_url':{'url':'data:image/jpeg;base64,cGl4ZWxz','detail':'low'}}
        return httpx.Response(200, content=completed())
    gemini(handler)
    runtime = {'provider_model':'stale-openrouter-model','reasoning_effort':'none'}
    trace = provider_usage.new_trace('uvms-1-' + alias, 'text', runtime)
    runtime['_trace'] = trace
    assert gateway.complete_answer(HISTORY, 'uvms-1-' + alias, runtime=runtime) == 'READY'
    assert trace['provider'] == 'gemini' and trace['provider_model'] == 'gemini-3.8-flash'
    assert trace['attempts'] == [{'input_tokens':100,'output_tokens':20,'total_tokens':120}]
    assert trace['first_token_ms'] is not None


def test_progressive_deltas_before_terminal_usage(gemini):
    consumed = []
    class Stream(httpx.SyncByteStream):
        def __iter__(self):
            for text in ('Первая ', 'часть ', 'ответа'):
                consumed.append(text)
                yield frame(chunk(text))
            yield frame(chunk(finish='stop')) + frame({'choices':[], 'usage':USAGE}) + b'data: [DONE]\n\n'
    gemini(lambda request: httpx.Response(200, stream=Stream()))
    events = gateway.stream_events(HISTORY, 'uvms-1-fast')
    assert next(events)['delta'] == 'Первая ' and len(consumed) == 1
    assert [event['delta'] for event in events] == ['часть ', 'ответа']


def test_live_usage_shape_includes_thinking_in_accounting_and_cost(gemini):
    # Sanitized numeric usage observed from a real Gemini medium-effort response.
    usage = {'prompt_tokens':310, 'completion_tokens':908, 'total_tokens':2614}
    body = frame(chunk('answer')) + frame(chunk(finish='stop')) + frame({'choices':[], 'usage':usage}) + b'data: [DONE]\n\n'
    gemini(lambda request: httpx.Response(200, content=body))
    trace = provider_usage.new_trace('uvms-1-balanced', 'text')
    assert gateway.complete_answer(HISTORY, 'uvms-1-balanced', runtime={'_trace':trace}) == 'answer'
    totals = trace['attempts'][0]
    assert totals == {'input_tokens':310, 'output_tokens':2304, 'total_tokens':2614}
    assert provider_usage._cost(trace, totals) == pytest.approx(.019052)


def test_missing_usage_is_not_fabricated(gemini):
    body = frame(chunk('answer')) + frame(chunk(finish='stop')) + b'data: [DONE]\n\n'
    gemini(lambda request: httpx.Response(200, content=body))
    trace = provider_usage.new_trace('uvms-1-fast', 'text')
    gateway.complete_answer(HISTORY, 'uvms-1-fast', runtime={'_trace':trace})
    assert trace['attempts'] == [{}]


@pytest.mark.parametrize('status,code', [(401,'authentication'),(403,'authentication'),(429,'rate_limit'),(503,'upstream_error')])
def test_http_errors_safe_and_never_retry_on_another_provider(gemini, status, code):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={'error':{'message':'gemini-fixture-only RAW secret'}})
    gemini(handler)
    with pytest.raises(gateway.ProviderError) as error:
        list(gateway.stream_events(HISTORY,'uvms-1-fast'))
    assert error.value.code == code and 'secret' not in str(error.value) and 'RAW' not in str(error.value)
    assert len(calls) == 1


@pytest.mark.parametrize('body,code', [
    (b'data: {broken}\n\n','malformed_response'),
    (frame([]), 'malformed_response'),
    (frame({'choices':'wrong'}), 'malformed_response'),
    (frame(chunk('partial')), 'interrupted'),
    (frame(chunk('partial')) + frame(chunk(finish='stop')), 'interrupted'),
    (completed('','stop'), 'malformed_response'),
    (completed('partial','length'), 'incomplete'),
    (completed('','content_filter'), 'capability'),
    (frame({'error':{'code':429,'message':'private secret'}}), 'rate_limit'),
    (frame(chunk({'invalid':'object'})), 'malformed_response'),
])
def test_bad_terminal_contract_is_not_success(gemini, body, code):
    gemini(lambda request: httpx.Response(200, content=body))
    with pytest.raises(gateway.ProviderError) as error:
        list(gateway.stream_events(HISTORY,'uvms-1-fast'))
    assert error.value.code == code and 'secret' not in str(error.value)


@pytest.mark.parametrize('scenario', ['timeout','stop','disconnect'])
def test_stream_lifecycle_closes_socket(gemini, monkeypatch, scenario):
    closed = threading.Event()
    cancel = threading.Event()
    class Stream(httpx.SyncByteStream):
        def __iter__(self):
            yield frame(chunk('partial'))
            if scenario == 'disconnect': raise httpx.RemoteProtocolError('private details')
            closed.wait(2)
        def close(self): closed.set()
    gemini(lambda request: httpx.Response(200, stream=Stream()))
    monkeypatch.setattr(gateway, 'settings', replace(gateway.settings, provider_timeout=.25))
    events = gateway.stream_events(HISTORY,'uvms-1-fast',runtime={'_cancel':cancel.is_set})
    assert next(events)['delta'] == 'partial'
    started = time.monotonic()
    if scenario == 'stop':
        cancel.set()
        assert list(events) == []
    else:
        with pytest.raises(gateway.ProviderError) as error: list(events)
        assert error.value.code == ('timeout' if scenario == 'timeout' else 'network')
    assert time.monotonic() - started < 1 and closed.wait(.5)


def test_missing_gemini_key_never_uses_other_keys(gemini, monkeypatch):
    config = replace(gateway.settings, gemini_api_key='')
    monkeypatch.setattr(gateway,'settings', config)
    assert provider_api_key(config) == '' and effective_ai_provider(config) == 'gemini'
    with pytest.raises(gateway.ProviderError) as error: gateway.provider_connection()
    assert error.value.code == 'configuration'


@pytest.mark.parametrize('key', ['', 'CHANGE_ME_PROVIDER_KEY', 'gemini-fixture-only'])
def test_production_gemini_requires_its_own_backend_credential(monkeypatch, key):
    from app import main
    from test_production_hardening import production_settings
    monkeypatch.setattr(main, 'settings', production_settings(ai_provider='gemini', gemini_api_key=key))
    if key == 'gemini-fixture-only':
        main._validate_runtime_settings()
    else:
        with pytest.raises(RuntimeError, match='real backend credential'):
            main._validate_runtime_settings()


def test_api_accounting_health_permissions_and_errors(gemini):
    gemini(lambda request: httpx.Response(200, content=completed()))
    with TestClient(app) as client:
        pair, headers = register(client)
        assert client.post('/api/v1/admin/provider-health/check', headers=headers).status_code == 403
        with SessionLocal() as db:
            db.get(User, pair['user']['id']).role = 'admin'
            db.commit()
        caps = client.get('/api/v1/capabilities', headers=headers).json()
        assert caps['provider'] == 'gemini' and caps['ai_mode'] == 'live'
        assert not caps['images'] and not caps['voice'] and not caps['search']
        assert caps['images_mode'] == 'unavailable'
        models = client.get('/api/v1/admin/models', headers=headers).json()
        assert {row['provider_model'] for row in models} == {'gemini-3.8-flash'}
        assert next(row for row in models if row['id']=='uvms-1-fast')['reasoning_effort'] == 'low'
        response = client.post('/api/v1/chat/stream', headers=headers, json={'content':'READY'})
        assert 'event: done' in response.text and 'event: error' not in response.text
        request_id = response.headers['X-UVMS-Request-Id']
        with SessionLocal() as db:
            rows = db.scalars(select(UsageEvent).where(UsageEvent.user_id == pair['user']['id'], UsageEvent.kind=='provider.request')).all()
            assert len(rows) == 1 and rows[0].meta['request_id'] == request_id
            assert rows[0].meta['provider'] == 'gemini' and rows[0].meta['total_tokens'] == 120
            assert rows[0].meta['estimated_cost_usd'] == pytest.approx(.00036)
        health = client.post('/api/v1/admin/provider-health/check', headers=headers).json()
        assert health['status'] == 'available' and health['name'] == 'Gemini'
        gemini(lambda request: httpx.Response(429, json={'error':'gemini-fixture-only RAW secret'}))
        response = client.post('/api/v1/chat/stream', headers=headers, json={'content':'quota'})
        assert 'event: error' in response.text and 'event: done' not in response.text and 'quota' in response.text
        stats = client.get('/api/v1/admin/stats', headers=headers)
        health = stats.json()['provider_health']
        assert health['status'] == 'unavailable' and health['last_error']['code'] == 'rate_limit'
        assert 'gemini-fixture-only' not in stats.text and 'RAW' not in stats.text
        assert any(row['name']=='gemini' for row in stats.json()['provider_usage']['by_provider'])


def test_health_probe_rejects_http_200_wrong_answer(gemini):
    gemini(lambda request: httpx.Response(200, content=completed('Not ready')))
    with TestClient(app) as client:
        pair, headers = register(client)
        with SessionLocal() as db:
            db.get(User, pair['user']['id']).role = 'admin'
            db.commit()
        health = client.post('/api/v1/admin/provider-health/check', headers=headers).json()
        assert health['status'] == 'unavailable' and health['last_error']['code'] == 'malformed_response'
