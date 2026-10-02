"""Admission guarantees without spending live provider quota."""
from contextlib import ExitStack
from dataclasses import replace
import httpx
import pytest
from app import beta_quota as quota, ai_gateway as gateway


@pytest.fixture
def clock(monkeypatch):
    config = replace(quota.settings, public_beta=True, ai_provider='groq', redis_url='', env='development',
                     beta_daily_requests=10, beta_minute_requests=5, beta_global_concurrency=3,
                     beta_output_tokens=1536, beta_extended_output_tokens=2048, output_tokens=4096)
    monkeypatch.setattr(quota, 'settings', config)
    monkeypatch.setattr(gateway, 'settings', config)
    for mapping in (quota._active,quota._daily,quota._minute,quota._cooldown,quota._observations): mapping.clear()
    now=[1790800000.0];monkeypatch.setattr(quota.time,'time',lambda:now[0])
    return now


def trace(user='one'):
    return {'user_id':user,'provider_model':'openai/gpt-oss-120b','request_id':'client-repeated-id'}


def test_daily_limit_counts_failures_and_resets_at_utc_day(clock):
    for _ in range(10):
        with pytest.raises(RuntimeError), quota.provider_slot(trace(),enabled=True): raise RuntimeError('upstream')
        clock[0]+=61
    assert not quota._active and quota.used_today('one') == 10
    with pytest.raises(gateway.ProviderError) as error:
        with quota.provider_slot(trace(),enabled=True): pytest.fail('admitted over daily limit')
    assert error.value.code == 'daily_limit' and error.value.retry_after > 0
    clock[0]+=86400
    with quota.provider_slot(trace(),enabled=True): pass
    assert quota.used_today('one') == 1


def test_minute_limit_has_retry_after_and_no_extra_reservation(clock):
    for _ in range(5):
        with quota.provider_slot(trace(),enabled=True): pass
    with pytest.raises(gateway.ProviderError) as error:
        with quota.provider_slot(trace(),enabled=True): pytest.fail('admitted too soon')
    assert error.value.code == 'rate_limit' and error.value.retry_after == 60
    assert quota.used_today('one') == 5
    clock[0]+=61
    with quota.provider_slot(trace(),enabled=True): pass


def test_global_three_slots_and_cancel_release(clock):
    with ExitStack() as stack:
        for i in range(3): stack.enter_context(quota.provider_slot(trace(str(i)),enabled=True))
        with pytest.raises(gateway.ProviderError) as error:
            with quota.provider_slot(trace('four'),enabled=True): pytest.fail('over concurrency')
        assert error.value.code == 'busy' and quota.used_today('four') == 0
    assert not quota._active
    with pytest.raises(GeneratorExit), quota.provider_slot(trace('four'),enabled=True): raise GeneratorExit()
    assert not quota._active


def test_production_redis_failure_is_closed(clock,monkeypatch):
    monkeypatch.setattr(quota,'settings',replace(quota.settings,env='production'))
    with pytest.raises(gateway.ProviderError) as error:
        with quota.provider_slot(trace(),enabled=True): pytest.fail('fallback opened production')
    assert error.value.code == 'busy' and not quota._daily
    class BrokenRedis:
        def eval(self,*args): raise ConnectionError('private redis connection details')
    monkeypatch.setattr(quota,'client',lambda:BrokenRedis())
    with pytest.raises(gateway.ProviderError,match='busy'):
        with quota.provider_slot(trace(),enabled=True): pytest.fail('admitted with failed Redis')


def test_quota_cooldown_prevents_retry_spending_and_redacts_headers(clock):
    t=trace();response=httpx.Response(429,headers={'retry-after':'20','x-ratelimit-remaining-tokens':'0',
        'x-ratelimit-remaining-requests':'secret-value','authorization':'secret-value'})
    quota.observe_response(response,t,t['provider_model'])
    assert t['rate_limits']=={'retry-after':'20','x-ratelimit-remaining-tokens':'0'}
    with pytest.raises(gateway.ProviderError) as error:
        with quota.provider_slot(trace('new'),enabled=True): pytest.fail('cooldown bypass')
    assert error.value.retry_after == 20 and quota.used_today('new') == 0
    clock[0]+=21
    with quota.provider_slot(trace('new'),enabled=True): pass


def test_extended_budget_requires_recent_observed_quota(clock):
    history=[{'role':'user','content':'Fix Python function'}];runtime={}
    quota.apply_budget(runtime,'uvms-1-fast',history)
    assert runtime['output_tokens']==1536 and runtime['context_tokens']==12000
    quota.observe_response(httpx.Response(200,headers={'x-ratelimit-remaining-tokens':'7000'}),None,'openai/gpt-oss-120b')
    quota.apply_budget(runtime,'uvms-1-fast',history);assert runtime['output_tokens']==2048
    quota.apply_budget(runtime,'uvms-1-fast',[{'role':'user','content':'Hello'}]);assert runtime['output_tokens']==1536
    clock[0]+=61
    quota.apply_budget(runtime,'uvms-1-deep',history);assert runtime['output_tokens']==1536


@pytest.mark.parametrize('changes', [
    {'groq_model_fast':'qwen/qwen3.8-27b'}, {'groq_vision_enabled':True},
    {'images_enabled':True}, {'search_enabled':True}, {'billing_provider':'demo'},
    {'beta_daily_requests':11}, {'beta_minute_requests':6}, {'beta_global_concurrency':4},
])
def test_production_beta_rejects_scope_or_quota_expansion(monkeypatch,changes):
    from app import main
    from test_production_hardening import production_settings
    baseline=production_settings(public_beta=True,ai_provider='groq',groq_api_key='private-test-groq',
        images_enabled=False,search_enabled=False,groq_vision_enabled=False)
    monkeypatch.setattr(main,'settings',baseline);main._validate_runtime_settings()
    monkeypatch.setattr(main,'settings',replace(baseline,**changes))
    with pytest.raises(RuntimeError): main._validate_runtime_settings()


def test_disabled_password_reset_is_honest(monkeypatch):
    from fastapi.testclient import TestClient
    from app import account_routes,main
    monkeypatch.setattr(account_routes,'settings',replace(account_routes.settings,password_reset_enabled=False))
    with TestClient(main.app) as client:
        assert client.get('/api/v1/auth/options').json()['password_reset'] is False
        response=client.post('/api/v1/auth/password-reset/request',json={'email':'nobody@example.com'})
        assert response.status_code==503 and 'sent' not in response.text.lower()


def test_admin_diagnostic_obeys_same_user_admission(clock,monkeypatch):
    from fastapi.testclient import TestClient
    from app import routes,provider_usage,provider_health
    from app.main import app
    from app.database import SessionLocal
    from app.models import User
    from test_stabilization import register
    config=replace(quota.settings,groq_api_key='private-test-groq')
    for module in (gateway,routes,provider_usage,provider_health): monkeypatch.setattr(module,'settings',config)
    def answer(history,model,*,runtime):
        with quota.provider_slot(runtime['_trace'],enabled=True): return 'READY'
    monkeypatch.setattr(routes,'complete_answer',answer)
    with TestClient(app) as client:
        pair,headers=register(client)
        assert client.post('/api/v1/admin/provider-health/check',headers=headers).status_code==403
        with SessionLocal() as db: db.get(User,pair['user']['id']).role='admin';db.commit()
        result=client.post('/api/v1/admin/provider-health/check',headers=headers)
        assert result.json()['status']=='available' and quota.used_today(pair['user']['id'])==1
