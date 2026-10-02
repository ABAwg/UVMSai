"""Free development routing must never call a paid OpenAI credential/endpoint."""
import json
from dataclasses import replace
import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.config import settings
from app import ai_gateway as gateway, provider_usage, routes, services, ai_features, main, ops
from app.database import SessionLocal
from app.models import UsageEvent
from test_stabilization import register


@pytest.fixture
def router(monkeypatch):
    config = replace(settings, ai_provider='openrouter', openrouter_api_key='router-fixture', openai_api_key='must-never-be-used', model_fast='paid-old-model', model_balanced='paid-old-model', model_deep='paid-old-model', provider_prices='{"openrouter/free":{"input_per_million":0,"output_per_million":0}}')
    for module in (gateway,provider_usage,routes,services,ai_features,main,ops): monkeypatch.setattr(module,'settings',config)
    original=httpx.Client
    def install(handler): monkeypatch.setattr(gateway.httpx,'Client',lambda **kwargs:original(transport=httpx.MockTransport(handler),**kwargs))
    return config,install


def stream(*events):
    return ''.join('data: '+json.dumps(event)+'\n\n' for event in events).encode()


@pytest.mark.parametrize('alias',['uvms-1-fast','uvms-1-balanced','uvms-1-deep'])
def test_aliases_use_only_free_router_and_preserve_progressive_stream(router,alias):
    _,install=router
    consumed=[]
    class Body(httpx.SyncByteStream):
        def __iter__(self):
            for delta in ('First ','second'):
                consumed.append(delta); yield stream({'type':'response.output_text.delta','delta':delta})
            yield stream({'type':'response.completed','response':{'model':'resolved/free-model','usage':{'input_tokens':10,'output_tokens':2,'total_tokens':12}}})
    def respond(request):
        assert str(request.url)=='https://openrouter.ai/api/v1/responses'
        assert request.headers['authorization']=='Bearer router-fixture'
        body=json.loads(request.content)
        assert body['model']=='openrouter/free' and body['store'] is False and body['stream'] is True
        assert 'reasoning' not in body and 'tools' not in body and 'plugins' not in body
        return httpx.Response(200,stream=Body())
    install(respond)
    trace=provider_usage.new_trace(alias,'text')
    events=gateway.stream_events([{'role':'user','content':'Hello'}],alias,runtime={'provider_model':'paid-db-model','_trace':trace})
    assert next(events)['delta']=='First ' and len(consumed)==1
    assert next(events)['delta']=='second'
    assert list(events)==[] and trace['resolved_provider_model']=='resolved/free-model'


def test_vision_pixels_are_forwarded_to_free_router(router):
    from test_provider_adapter import png
    from app.vision import vision_part
    _,install=router
    def respond(request):
        body=json.loads(request.content)
        image=body['input'][0]['content'][1]
        assert image['image_url'].startswith('data:image/jpeg;base64,')
        return httpx.Response(200,content=stream({'type':'response.output_text.delta','delta':'Red square'},{'type':'response.completed','response':{}}))
    install(respond)
    history=[{'role':'user','content':[{'type':'input_text','text':'What is shown?'},vision_part(png())]}]
    assert gateway.complete_answer(history,'uvms-1-fast')=='Red square'


@pytest.mark.parametrize('http_status',[400,404,422])
def test_capability_failure_is_safe_and_stream_can_retry(router,http_status):
    _,install=router
    install(lambda request:httpx.Response(http_status,json={'error':{'message':'secret provider URL and router-fixture unsupported image'}}))
    with TestClient(main.app) as client:
        pair,headers=register(client)
        failed=client.post('/api/v1/chat/stream',headers=headers,json={'content':'Describe image'})
        assert '"code": "capability"' in failed.text and 'text-only' in failed.text
        assert 'router-fixture' not in failed.text and 'secret provider URL' not in failed.text
        messages=client.get('/api/v1/chats/'+failed.headers['X-UVMS-Chat-Id'],headers=headers).json()['messages']
        assert [x['role'] for x in messages]==['user']
        install(lambda request:httpx.Response(200,content=stream({'type':'response.output_text.delta','delta':'Retried'},{'type':'response.completed','response':{'model':'resolved/free-model','usage':{'input_tokens':10,'output_tokens':2,'total_tokens':12}}})))
        retry=client.post('/api/v1/chat/stream',headers=headers,json={'chat_id':failed.headers['X-UVMS-Chat-Id'],'retry_message_id':messages[0]['id'],'content':'Describe image'})
        assert 'event: done' in retry.text and 'Retried' in retry.text and 'resolved/free-model' not in retry.text
        with SessionLocal() as db:
            usage=db.scalars(select(UsageEvent).where(UsageEvent.user_id==pair['user']['id'],UsageEvent.kind=='provider.request')).all()
            completed=[x.meta for x in usage if x.meta['status']=='completed'][0]
            assert completed['provider']=='openrouter' and completed['provider_model']=='openrouter/free'
            assert completed['resolved_provider_model']=='resolved/free-model' and completed['estimated_cost_usd']==0


def test_demo_media_and_search_never_use_openai_or_openrouter(router):
    _,install=router
    def unexpected(request): raise AssertionError('No network calls allowed for demo media or disabled search')
    install(unexpected)
    with TestClient(main.app) as client:
        pair,headers=register(client)
        capabilities=client.get('/api/v1/capabilities',headers=headers).json()
        assert capabilities['ai_mode']=='development' and capabilities['images_mode']==capabilities['voice_mode']=='demo'
        assert capabilities['provider']=='openrouter' and capabilities['text_live'] is True
        assert capabilities['search'] is False
        assert client.post('/api/v1/chat/complete',headers=headers,json={'content':'Search','web_search':True}).status_code==422
        voice=client.post('/api/v1/audio/transcribe',headers=headers,files={'audio':('voice.webm',b'fixture','audio/webm')})
        assert voice.status_code==200 and voice.json()['demo'] is True
        image=client.post('/api/v1/images/generate',headers=headers,json={'prompt':'Test sample'})
        assert image.status_code==201 and image.json()['demo'] is True
        with SessionLocal() as db:
            usage=db.scalars(select(UsageEvent).where(UsageEvent.user_id==pair['user']['id'],UsageEvent.kind=='provider.request')).all()
            assert len(usage)==2 and all(x.meta['provider']=='demo' and x.meta['estimated_cost_usd']==0 for x in usage)


def test_missing_router_key_never_reuses_openai_key_or_becomes_demo(router,monkeypatch):
    config,install=router
    monkeypatch.setattr(gateway,'settings',replace(config,openrouter_api_key=''))
    install(lambda request:pytest.fail('Missing key must not send HTTP'))
    assert gateway.is_demo() is False and gateway.is_demo('voice') is True
    with pytest.raises(gateway.ProviderError) as error: list(gateway.stream_events([{'role':'user','content':'Hi'}],'uvms-1-fast'))
    assert error.value.code=='configuration'


def test_openrouter_is_rejected_in_production(router,monkeypatch):
    config,_=router
    monkeypatch.setattr(main,'settings',replace(config,env='production'))
    with pytest.raises(RuntimeError,match='restricted to development'):
        main._validate_runtime_settings()


def test_auto_mode_uses_openrouter_when_it_is_the_only_development_key(monkeypatch):
    config = replace(
        settings,
        env='development',
        ai_provider='auto',
        openai_api_key='',
        openrouter_api_key='router-fixture',
    )
    for module in (gateway, provider_usage, routes, services, ai_features, ops):
        monkeypatch.setattr(module, 'settings', config)
    assert gateway.is_demo() is False
    assert gateway.is_demo('image') is True
    assert gateway.upstream_model('uvms-1-balanced') == 'openrouter/free'
    assert provider_usage.new_trace('uvms-1-balanced', 'text')['provider'] == 'openrouter'


@pytest.mark.parametrize('upstream_code,safe_code',[(404,'capability'),(429,'rate_limit'),(401,'authentication')])
def test_in_band_router_errors_are_safe_and_not_success(router,upstream_code,safe_code):
    _,install=router
    install(lambda request:httpx.Response(200,content=stream({'type':'response.output_text.delta','delta':'Partial'}, {'type':'error','error':{'code':upstream_code,'message':'private router-fixture upstream detail'}})))
    with pytest.raises(gateway.ProviderError) as error:
        list(gateway.stream_events([{'role':'user','content':'Hello'}],'uvms-1-fast'))
    assert error.value.code==safe_code and 'router-fixture' not in str(error.value)
