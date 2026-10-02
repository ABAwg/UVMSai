import base64
import io
import json
import threading
import time
from dataclasses import replace

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from app import ai_gateway as gateway
from app import provider_usage
from app.config import settings
from app.context_budget import budget_history, item_cost, SYSTEM_INSTRUCTIONS
from app.database import SessionLocal
from app.main import app
from app.models import UsageEvent, User, Subscription, Plan, AiFeature, AiModelConfig
from test_stabilization import register

HISTORY = [{'role':'user','content':'Hello / Привет / Salom. **Markdown**\n```python\nprint(1)\n```'}]
USAGE = {'input_tokens':100,'output_tokens':20,'total_tokens':120}


def sse(*events):
    return ''.join('data: '+json.dumps(event,ensure_ascii=False)+'\n\n' for event in events).encode()


def completed(text='A real-adapter fixture response'):
    return sse({'type':'response.output_text.delta','delta':text},{'type':'response.completed','response':{'usage':USAGE}})


@pytest.fixture
def provider(monkeypatch):
    live = replace(settings,ai_provider='openai',openai_api_key='fixture-only-key',openai_base_url='https://provider.example/v1',provider_prices=json.dumps({settings.openai_model:{'input_per_million':2,'output_per_million':8,'per_search':.01}}))
    monkeypatch.setattr(gateway,'settings',live)
    monkeypatch.setattr(provider_usage,'settings',live)
    original = httpx.Client
    def install(handler):
        monkeypatch.setattr(gateway.httpx,'Client',lambda **kwargs: original(transport=httpx.MockTransport(handler),**kwargs))
    return install


def test_progressive_stream_request_contract_and_usage(provider):
    consumed = []
    class Chunks(httpx.SyncByteStream):
        def __iter__(self):
            for event in [{'type':'response.output_text.delta','delta':'Привет '},{'type':'response.output_text.delta','delta':'Salom!'}, {'type':'response.completed','response':{'usage':USAGE}}]:
                consumed.append(event['type']); yield sse(event)
    def respond(request):
        body = json.loads(request.content)
        assert request.url.path == '/v1/responses'
        assert body['stream'] is True and body['store'] is False
        assert body['instructions'] == SYSTEM_INSTRUCTIONS
        assert body['max_output_tokens'] == settings.output_tokens
        assert body['input'] == HISTORY
        assert 'reasoning' not in body  # Fast/non-reasoning models omit this field.
        return httpx.Response(200,stream=Chunks())
    provider(respond)
    trace = provider_usage.new_trace('uvms-1-fast','text')
    events = gateway.stream_events(HISTORY,'uvms-1-fast',runtime={'_trace':trace})
    assert next(events)['delta'] == 'Привет '
    assert len(consumed) == 1  # no aggregation before first UI chunk
    assert next(events)['delta'] == 'Salom!'
    assert list(events) == []
    assert trace['attempts'][0]['total_tokens'] == 120 and trace['first_token_ms'] is not None


@pytest.mark.parametrize('status',[401,403,429,500,502])
def test_upstream_http_errors_are_safe(provider,status):
    provider(lambda request:httpx.Response(status,json={'error':{'message':'secret fixture-only-key https://private.example/ raw upstream detail'}}))
    with pytest.raises(gateway.ProviderError) as error: list(gateway.stream_events(HISTORY,'uvms-1-balanced'))
    assert 'fixture-only' not in str(error.value) and 'http' not in str(error.value)


@pytest.mark.parametrize('exception',[httpx.ReadTimeout,httpx.ConnectError,httpx.RemoteProtocolError])
def test_timeouts_and_network_errors(provider,exception):
    def fail(request): raise exception('private diagnostic',request=request)
    provider(fail)
    with pytest.raises(gateway.ProviderError) as error: list(gateway.stream_events(HISTORY,'uvms-1-fast'))
    assert 'private diagnostic' not in str(error.value)
    if exception is httpx.ReadTimeout: assert error.value.code == 'timeout'


@pytest.mark.parametrize('body',[
    b'data: {bad json}\n\n', b'data: []\n\n',
    sse({'type':'response.output_text.delta','delta':'Partial'}),
    sse({'type':'response.incomplete','response':{'usage':USAGE}}),
    sse({'type':'response.failed','response':{'error':{'message':'secret'}}}),
    sse({'type':'error','message':'secret'})])
def test_malformed_or_interrupted_stream_is_not_success(provider,body):
    provider(lambda request:httpx.Response(200,content=body))
    with pytest.raises(gateway.ProviderError): list(gateway.stream_events(HISTORY,'uvms-1-fast'))


def test_search_statuses_sources_and_empty_sources(provider):
    provider(lambda request:httpx.Response(200,content=sse(
        {'type':'response.web_search_call.searching'}, {'type':'response.web_search_call.completed'},
        {'type':'response.output_text.annotation.added','annotation':{'type':'url_citation','url':'javascript:alert(1)'}},
        {'type':'response.output_text.annotation.added','annotation':{'type':'url_citation','url':'https://example.com/source','title':'Verified source'}},
        {'type':'response.output_text.delta','delta':'Answer'}, {'type':'response.completed','response':{'usage':USAGE}})))
    events = list(gateway.stream_events(HISTORY,'uvms-1-balanced',web_search=True))
    assert [x['status'] for x in events if x['type']=='tool'] == ['searching','reading','completed']
    assert [x['citation']['url'] for x in events if x['type']=='citation'] == ['https://example.com/source']
    provider(lambda request:httpx.Response(200,content=completed('No relevant sources were found.')))
    _,meta = gateway.complete_answer_with_meta(HISTORY,'uvms-1-fast',web_search=True)
    assert meta['citations'] == []


@pytest.mark.parametrize('url',['javascript:alert(1)','https://','https://user:pass@example.com','https://example.com/\nsecret'])
def test_citation_safety(url):
    assert gateway._normalize_citation({'type':'url_citation','url':url}) is None


def test_search_error_fallback_is_bounded(provider):
    calls=[]
    def respond(request):
        payload=json.loads(request.content);calls.append(payload)
        return httpx.Response(500,json={'error':'unavailable'}) if 'tools' in payload else httpx.Response(200,content=completed())
    provider(respond)
    events=list(gateway.stream_events(HISTORY,'uvms-1-fast',web_search=True))
    assert len(calls)==2 and 'tools' not in calls[1]
    assert events[0]['status']=='failed'


def test_stop_interrupts_wait_for_first_token(provider):
    cancelled=threading.Event(); closed=threading.Event()
    class Waiting(httpx.SyncByteStream):
        def __iter__(self):
            closed.wait(2)
            if not closed.is_set(): yield completed()
        def close(self): closed.set()
    provider(lambda request:httpx.Response(200,stream=Waiting()))
    timer=threading.Timer(.1,cancelled.set);timer.start();start=time.monotonic()
    assert list(gateway.stream_events(HISTORY,'uvms-1-fast',runtime={'_cancel':cancelled.is_set})) == []
    assert time.monotonic()-start<1 and closed.is_set()
    timer.join()


@pytest.mark.parametrize('slow_close', [False, True])
def test_silent_upstream_obeys_total_deadline(provider, monkeypatch, slow_close):
    closed = threading.Event()
    release_close = threading.Event()
    class Waiting(httpx.SyncByteStream):
        def __iter__(self):
            closed.wait(2)
            if not closed.is_set(): yield completed()
        def close(self):
            closed.set()
            if slow_close: release_close.wait(2)
    provider(lambda request: httpx.Response(200, stream=Waiting()))
    monkeypatch.setattr(gateway, 'settings', replace(gateway.settings, provider_timeout=.15))
    start = time.monotonic()
    try:
        with pytest.raises(gateway.ProviderError) as error:
            list(gateway.stream_events(HISTORY, 'uvms-1-fast', runtime={'_cancel': lambda: False}))
        assert error.value.code == 'timeout'
        assert time.monotonic() - start < 1 and closed.is_set()
    finally:
        release_close.set()


def test_silent_upstream_without_cancel_obeys_total_deadline(provider, monkeypatch):
    closed = threading.Event()

    class Waiting(httpx.SyncByteStream):
        def __iter__(self):
            closed.wait(2)
            if not closed.is_set():
                yield completed()

        def close(self):
            closed.set()

    provider(lambda request: httpx.Response(200, stream=Waiting()))
    monkeypatch.setattr(gateway, 'settings', replace(gateway.settings, provider_timeout=.15))
    started = time.monotonic()
    with pytest.raises(gateway.ProviderError) as error:
        gateway.complete_answer(HISTORY, 'uvms-1-fast')
    assert error.value.code == 'timeout'
    assert time.monotonic() - started < 1 and closed.is_set()


def test_search_fallback_does_not_restart_expired_provider_budget(provider, monkeypatch):
    calls = []

    def respond(request):
        calls.append(json.loads(request.content))
        if len(calls) == 1:
            time.sleep(.25)
            return httpx.Response(500)
        return httpx.Response(200, content=completed())

    provider(respond)
    monkeypatch.setattr(gateway, 'settings', replace(gateway.settings, provider_timeout=.15))
    with pytest.raises(gateway.ProviderError) as error:
        list(gateway.stream_events(HISTORY, 'uvms-1-fast', web_search=True))
    assert error.value.code == 'timeout' and len(calls) == 1


def test_stream_timeout_after_first_delta_clears_active_generation(provider, monkeypatch):
    closed = threading.Event()

    class FirstThenWaiting(httpx.SyncByteStream):
        def __iter__(self):
            yield sse({'type': 'response.output_text.delta', 'delta': 'X'})
            closed.wait(2)

        def close(self):
            closed.set()

    provider(lambda request: httpx.Response(200, stream=FirstThenWaiting()))
    monkeypatch.setattr(gateway, 'settings', replace(gateway.settings, provider_timeout=.15))
    with TestClient(app) as client:
        _, headers = register(client)
        response = client.post('/api/v1/chat/stream', headers=headers, json={'content': 'Long answer'})
        assert response.status_code == 200
        assert 'event: delta' in response.text
        assert 'event: error' in response.text and 'too long' in response.text
        assert 'event: done' not in response.text
        assert client.get('/api/v1/chats/' + response.headers['X-UVMS-Chat-Id'], headers=headers).json()['messages'][-1]['role'] == 'user'
    assert closed.is_set()


def test_context_budget_preserves_recent_continuity_and_instructions():
    history=[{'role':'developer','content':'Project: metric units. Memory: concise.'}]
    history += [{'role':'user' if i%2==0 else 'assistant','content':f'{i}: '+'старый контекст '*250} for i in range(100)]
    history += [{'role':'user','content':'Previous question'},{'role':'assistant','content':'Previous answer'},HISTORY[0]]
    result=budget_history(history)
    assert result[0]['role']=='developer' and result[-3:]==history[-3:]
    assert len(result)<len(history)
    assert sum(map(item_cost,result))+len(SYSTEM_INSTRUCTIONS.encode())+settings.output_tokens+1024 <= settings.context_tokens
    with pytest.raises(HTTPException) as error: budget_history([{'role':'user','content':'Я'*50000}])
    assert error.value.status_code==413


def png(format='PNG'):
    output=io.BytesIO();Image.new('RGB',(12,12),(240,20,20)).save(output,format=format);return output.getvalue()


@pytest.mark.parametrize('format',['PNG','JPEG','WEBP'])
def test_vision_sends_actual_normalized_pixels(format):
    from app.vision import vision_part,validate_image
    part=vision_part(png(format));assert part['image_url'].startswith('data:image/jpeg;base64,')
    assert part['detail']=='low'
    with Image.open(io.BytesIO(base64.b64decode(part['image_url'].split(',')[1]))) as picture: assert picture.getpixel((0,0))[0]>200
    with pytest.raises(ValueError): validate_image(b'\x89PNG\r\n\x1a\ninvalid')
    parts=[{'role':'user','content':[{'type':'input_text','text':'Describe these'}]+[part]*2}]
    assert len(budget_history(parts)[0]['content'])==3
    with pytest.raises(HTTPException): budget_history(parts,{'supports_vision':False})


def test_image_bytes_and_speech_multipart(provider):
    calls=[]
    def respond(request):
        calls.append(request)
        if request.url.path.endswith('/images/generations'):
            return httpx.Response(200,json={'data':[{'b64_json':base64.b64encode(png()).decode()}],'usage':USAGE})
        assert 'multipart/form-data' in request.headers['content-type']
        assert b'name="file"' in request.content and b'voice.webm' in request.content
        return httpx.Response(200,json={'text':'Привет. Salom. Hello.','usage':USAGE})
    provider(respond)
    data,mime,ext,demo=gateway.generate_image_bytes('Red square')
    assert data==png() and mime=='image/png' and ext=='.png' and not demo
    assert gateway.transcribe_audio_bytes('voice.webm',b'fixture-audio','audio/webm')[0]=='Привет. Salom. Hello.'
    provider(lambda request:httpx.Response(200,json={'data':[{'url':'http://127.0.0.1/private'}]}))
    with pytest.raises(gateway.ProviderError): gateway.generate_image_bytes('Test')


def test_api_accounting_and_private_metadata(provider):
    provider(lambda request:httpx.Response(200,content=completed()))
    with TestClient(app) as client:
        pair,headers=register(client)
        response=client.post('/api/v1/chat/complete',headers=headers,json={'content':'Hello'})
        assert response.status_code==200,response.text
        assert 'provider_model' not in response.text and 'input_tokens' not in response.text
        with SessionLocal() as db:
            row=db.scalars(select(UsageEvent).where(UsageEvent.user_id==pair['user']['id'],UsageEvent.kind=='provider.request')).one()
            assert row.meta['status']=='completed' and row.meta['total_tokens']==120
            assert row.meta['estimated_cost_usd']==pytest.approx(.00036)
            assert row.meta['chat_id']==response.json()['chat_id'] and row.meta['duration_ms']>0
            db.get(User,pair['user']['id']).role='admin';db.commit()
        stats=client.get('/api/v1/admin/stats',headers=headers).json()['provider_usage']
        assert stats['tokens']>=120 and stats['by_plan'] and stats['top_users']
        provider(lambda request:httpx.Response(401,json={'message':'private key fragment'}))
        failed=client.post('/api/v1/chat/complete',headers=headers,json={'content':'Fail'})
        assert failed.status_code==502 and 'private key fragment' not in failed.text
        with SessionLocal() as db:
            failures=db.scalars(select(UsageEvent).where(UsageEvent.user_id==pair['user']['id'],UsageEvent.kind=='provider.request')).all()
            assert any(row.meta['status']=='failed' and row.meta['estimated_cost_usd'] is None for row in failures)


def test_feature_and_quota_direct_api_bypass():
    with TestClient(app) as client:
        pair,headers=register(client)
        assert client.patch('/api/v1/admin/ai-features/voice',headers=headers,json={'is_enabled':False}).status_code==403
        with SessionLocal() as db:
            db.get(User,pair['user']['id']).role='admin';db.commit()
        try:
            for name,path,kwargs in [('search','/chat/complete',{'json':{'content':'Search','web_search':True}}),('images','/images/generate',{'json':{'prompt':'Image'}}),('voice','/audio/transcribe',{'files':{'audio':('voice.webm',b'fake','audio/webm')}})]:
                assert client.patch('/api/v1/admin/ai-features/'+name,headers=headers,json={'is_enabled':False}).status_code==200
                assert client.post('/api/v1'+path,headers=headers,**kwargs).status_code==403
                client.patch('/api/v1/admin/ai-features/'+name,headers=headers,json={'is_enabled':True})
            first=client.post('/api/v1/chat/complete',headers=headers,json={'content':'History'}).json()
            messages=client.get('/api/v1/chats/'+first['chat_id'],headers=headers).json()['messages']
            with SessionLocal() as db:
                sub=db.scalar(select(Subscription).where(Subscription.user_id==pair['user']['id']))
                plan=Plan(code='qa-'+pair['user']['id'],name='QA zero',limits={'messages_daily':0,'web_search_daily':0,'deep_daily':0,'images_monthly':0,'voice_transcriptions_monthly':0,'storage_mb':1,'max_file_mb':1})
                db.add(plan);db.flush();sub.plan_code=plan.code;db.commit()
            for message,action in [(messages[0],'edit'),(messages[1],'regenerate')]:
                response=client.post(f"/api/v1/chats/{first['chat_id']}/messages/{message['id']}/{action}",headers=headers,json={'content':'Changed'} if action=='edit' else {})
                assert response.status_code==429
            assert client.post('/api/v1/chat/stream',headers=headers,json={'content':'Bypass'}).status_code==429
            assert client.post('/api/v1/images/generate',headers=headers,json={'prompt':'Bypass'}).status_code==429
            assert client.post('/api/v1/audio/transcribe',headers=headers,files={'audio':('voice.webm',b'audio','audio/webm')}).status_code==429
        finally:
            with SessionLocal() as db:
                for row in db.scalars(select(AiFeature)).all(): db.delete(row)
                db.commit()


@pytest.mark.parametrize('operation',['image','voice'])
@pytest.mark.parametrize('failure',['timeout','500','malformed'])
def test_media_errors_and_accounting(provider,operation,failure):
    def respond(request):
        if failure=='timeout': raise httpx.ReadTimeout('secret provider details',request=request)
        if failure=='500': return httpx.Response(500,json={'error':'secret provider details'})
        return httpx.Response(200,json={})
    provider(respond)
    with TestClient(app) as client:
        pair,headers=register(client)
        path='/images/generate' if operation=='image' else '/audio/transcribe'
        args={'json':{'prompt':'Fixture'}} if operation=='image' else {'files':{'audio':('voice.webm',b'fixture','audio/webm')}}
        response=client.post('/api/v1'+path,headers=headers,**args)
        assert response.status_code==(504 if failure=='timeout' else 502),response.text
        assert 'secret provider details' not in response.text
        if failure=='timeout': assert 'too long' in response.text
        with SessionLocal() as db:
            row=db.scalars(select(UsageEvent).where(UsageEvent.user_id==pair['user']['id'],UsageEvent.kind=='provider.request')).one()
            assert row.meta['status']=='failed'


def test_provider_usage_survives_local_storage_failure(provider,monkeypatch):
    provider(lambda request:httpx.Response(200,json={'data':[{'b64_json':base64.b64encode(png()).decode()}],'usage':USAGE}))
    def fail(*args): raise OSError('Private storage details')
    monkeypatch.setattr('app.routes.storage_put_bytes',fail)
    with TestClient(app) as client:
        pair,headers=register(client)
        response=client.post('/api/v1/images/generate',headers=headers,json={'prompt':'Fixture'})
        assert response.status_code==500 and 'Private storage details' not in response.text
        with SessionLocal() as db:
            row=db.scalars(select(UsageEvent).where(UsageEvent.user_id==pair['user']['id'],UsageEvent.kind=='provider.request')).one()
            assert row.meta['total_tokens']==120 and row.meta['error_code']=='local_persistence_failed'
        assert client.get('/api/v1/chats',headers=headers).json()==[]


def test_zero_storage_and_disabled_model_cannot_be_bypassed():
    with TestClient(app) as client:
        pair,headers=register(client)
        with SessionLocal() as db:
            plan=Plan(code='zero-'+pair['user']['id'],name='Zero storage',limits={'storage_mb':0,'max_file_mb':1})
            db.add(plan);db.flush();db.scalar(select(Subscription).where(Subscription.user_id==pair['user']['id'])).plan_code=plan.code;db.commit()
        assert client.post('/api/v1/files',headers=headers,files={'upload':('test.txt',b'hello','text/plain')}).status_code==413
        with SessionLocal() as db:
            model=db.get(AiModelConfig,'uvms-1-fast');model.is_enabled=False;db.commit()
        try:
            assert client.post('/api/v1/chat/complete',headers=headers,json={'content':'Bypass','model_id':'uvms-1-fast'}).status_code==422
        finally:
            with SessionLocal() as db:
                db.get(AiModelConfig,'uvms-1-fast').is_enabled=True;db.commit()


def test_rejected_stream_context_does_not_accept_or_charge_message(monkeypatch):
    import app.context_budget as context
    monkeypatch.setattr(context,'settings',replace(settings,context_tokens=8192,output_tokens=4096))
    with TestClient(app) as client:
        pair,headers=register(client)
        response=client.post('/api/v1/chat/stream',headers=headers,json={'content':'x'*4000})
        assert response.status_code==413
        assert client.get('/api/v1/chats',headers=headers).json()==[]
        with SessionLocal() as db:
            assert not db.scalars(select(UsageEvent).where(UsageEvent.user_id==pair['user']['id'],UsageEvent.kind.in_(['message.user','provider.request']))).all()


def test_complete_retry_reuses_failed_stream_prompt(provider):
    provider(lambda request:httpx.Response(500,json={'error':'fixture'}))
    with TestClient(app) as client:
        _,headers=register(client)
        failed=client.post('/api/v1/chat/stream',headers=headers,json={'content':'Original prompt'})
        assert 'event: error' in failed.text
        provider(lambda request:httpx.Response(200,content=completed()))
        payload={'chat_id':failed.headers['X-UVMS-Chat-Id'],'retry_message_id':failed.headers['X-UVMS-Message-Id'],'content':'Original prompt'}
        retry=client.post('/api/v1/chat/complete',headers=headers,json=payload)
        assert retry.status_code==200,retry.text
        messages=client.get('/api/v1/chats/'+payload['chat_id'],headers=headers).json()['messages']
        assert [m['role'] for m in messages]==['user','assistant']
        assert client.post('/api/v1/chat/complete',headers=headers,json=payload).status_code==409
