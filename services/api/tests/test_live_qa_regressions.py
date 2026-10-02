import asyncio
import threading
import anyio
from dataclasses import replace
from fastapi.testclient import TestClient
from sqlalchemy import select
from app import routes, services
from app.main import app
from app.database import SessionLocal
from app.models import User, UsageEvent, Message, FileAsset
from app.schemas import ChatPromptIn
from test_stabilization import register


def test_asgi_disconnect_finalizes_while_worker_is_waiting():
    from app.streaming import ManagedStreamingResponse
    cancelled = threading.Event()
    waiting = threading.Event()
    cleanup = []
    def frames():
        try:
            yield 'event: meta\ndata: {}\n\n'
            waiting.set()
            assert cancelled.wait(2)
            yield 'event: delta\ndata: {"delta":"late"}\n\n'
        finally:
            cleanup.append('closed')
    response = ManagedStreamingResponse(frames(), cancelled.set)
    async def exercise():
        async def receive():
            await anyio.to_thread.run_sync(waiting.wait)
            # Model a transport disconnect while the provider worker is reading.
            return {'type':'http.disconnect'}
        async def send(message): pass
        await response({'type':'http','asgi':{'spec_version':'2.3'}}, receive, send)
        assert cleanup == ['closed']
        await response.body_iterator.aclose()
        assert cleanup == ['closed']
    asyncio.run(exercise())


def test_disconnect_before_first_frame_still_accounts(monkeypatch):
    with TestClient(app) as client:
        pair, _ = register(client)
        with SessionLocal() as db:
            response = routes.chat_stream(ChatPromptIn(content='Leave before meta'), db.get(User, pair['user']['id']), db)
        asyncio.run(response.body_iterator.aclose())
        with SessionLocal() as db:
            rows = db.scalars(select(UsageEvent).where(UsageEvent.kind=='provider.request')).all()
            assert [r.meta['status'] for r in rows if r.meta.get('request_id') == response.headers['X-UVMS-Request-Id']] == ['cancelled']

def test_long_file_keeps_start_and_conclusion_with_explicit_gap(monkeypatch):
    monkeypatch.setattr(services, 'settings', replace(services.settings, context_tokens=4096))
    file = FileAsset(category='text', original_name='report.txt', extracted_text='Owner: Salima.\n' + 'Ж'*5000 + '\nFinal retention: 78%.')
    result = services._file_content_for_model(file)[0]['text']
    assert 'Owner: Salima.' in result and 'Final retention: 78%.' in result
    assert '[Middle of document omitted to fit context]' in result
    assert len(result.split('<document>\n')[1].split('\n</document>')[0].encode()) <= 512

def test_terminal_stream_event_has_committed_accounting(monkeypatch):
    monkeypatch.setattr(routes, 'stream_events', lambda *a, **k: iter([{'type':'delta','delta':'Ready'}]))
    with TestClient(app) as client:
        pair, _ = register(client)
        with SessionLocal() as db:
            response = routes.chat_stream(ChatPromptIn(content='Accounting before done'), db.get(User, pair['user']['id']), db)
        request_id = response.headers['X-UVMS-Request-Id']
        async def consume():
            async for frame in response.body_iterator:
                if frame.startswith('event: done'):
                    with SessionLocal() as check:
                        rows = check.scalars(select(UsageEvent).where(UsageEvent.kind=='provider.request')).all()
                        assert [r.meta['status'] for r in rows if r.meta.get('request_id') == request_id] == ['completed']
                    break
            await response.body_iterator.aclose()
        asyncio.run(consume())

def test_stream_disconnect_persists_partial_and_exactly_one_trace(monkeypatch):
    monkeypatch.setattr(routes, 'stream_events', lambda *a, **k: iter([{'type':'delta','delta':'Partial'}, {'type':'delta','delta':' later'}]))
    with TestClient(app) as client:
        pair, _ = register(client)
        with SessionLocal() as db:
            response = routes.chat_stream(ChatPromptIn(content='Disconnect early'), db.get(User, pair['user']['id']), db)
        request_id = response.headers['X-UVMS-Request-Id']
        async def consume():
            async for frame in response.body_iterator:
                if frame.startswith('event: delta'):
                    break
            await response.body_iterator.aclose()
        asyncio.run(consume())
        with SessionLocal() as check:
            rows = check.scalars(select(UsageEvent).where(UsageEvent.kind=='provider.request')).all()
            assert [r.meta['status'] for r in rows if r.meta.get('request_id') == request_id] == ['cancelled']
            messages = check.scalars(select(Message).where(Message.chat_id == response.headers['X-UVMS-Chat-Id'], Message.role=='assistant')).all()
            assert len(messages) == 1 and messages[0].content == 'Partial' and messages[0].meta['stopped'] is True
