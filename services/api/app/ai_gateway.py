from __future__ import annotations

import base64
import json
import struct
import time
import zlib
import threading
import queue
from urllib.parse import urlparse
from collections.abc import Iterable, Iterator
from typing import Any

import httpx

from .config import effective_ai_provider, settings
from .context_budget import SYSTEM_INSTRUCTIONS, budget_history
from .provider_usage import usage_received

class ProviderError(RuntimeError):
    def __init__(self, code='unavailable', retry_after=None):
        self.code = code
        self.retry_after = retry_after
        messages = {
            'timeout': 'The response took too long. Try again.',
            'capability': 'The AI provider cannot handle this request. Try a different request or contact the administrator.',
            'configuration': 'AI service is not configured. Please contact the administrator.',
            'authentication': 'AI service credentials need attention. Please contact the administrator.',
            'rate_limit': 'AI has temporarily reached its free quota. Please try again later.',
            'daily_limit': f'Your {min(10, settings.beta_daily_requests)} daily AI requests have been used. Please return tomorrow.',
            'busy': 'AI is busy right now. Please try again shortly.',
            'network': 'Could not reach the AI service. Please try again.',
            'upstream_error': 'The AI service returned an error. Please try again.',
            'malformed_response': 'The AI service returned an invalid response. Please retry.',
            'interrupted': 'The AI connection was interrupted. Please retry.',
            'incomplete': 'The answer reached the provider limit before it finished. Please retry with a shorter request.',
        }
        if code == 'capability' and effective_ai_provider(settings) == 'openrouter':
            messages[code] = 'The development model cannot handle this request right now. Try a text-only message or retry later.'
        super().__init__(messages.get(code, 'AI service is temporarily unavailable. Please try again.'))


def provider_error(exc):
    if isinstance(exc, ProviderError): return exc
    if isinstance(exc, httpx.TimeoutException): return ProviderError('timeout')
    if isinstance(exc, httpx.HTTPStatusError):
        if exc.response.status_code == 429:
            from .beta_quota import retry_seconds
            return ProviderError('rate_limit', retry_seconds(exc.response.headers))
        if effective_ai_provider(settings) == 'openrouter' and exc.response.status_code in {400,404,422}:
            return ProviderError('capability')
        return ProviderError({401:'authentication',403:'authentication',429:'rate_limit'}.get(exc.response.status_code,'upstream_error'))
    if isinstance(exc, httpx.RequestError): return ProviderError('network')
    return ProviderError('malformed_response')


def is_demo(operation='text'):
    provider = effective_ai_provider(settings)
    if provider == 'demo': return True
    if provider == 'openrouter': return operation != 'text'
    if provider not in {'openai','openai-compatible','gemini','groq'}: raise ProviderError('configuration')
    return False


def provider_connection():
    provider = effective_ai_provider(settings)
    if provider == 'openrouter':
        if settings.env.lower() not in {'development','demo','test'}: raise ProviderError('configuration')
        base_url, key = settings.openrouter_base_url, settings.openrouter_api_key
    elif provider == 'gemini':
        base_url, key = settings.gemini_base_url, settings.gemini_api_key
    elif provider == 'groq':
        base_url, key = settings.groq_base_url, settings.groq_api_key
    else:
        base_url, key = settings.openai_base_url, settings.openai_api_key
    if not key: raise ProviderError('configuration')
    return base_url, key


def _router_stream_error(payload):
    """Classify untrusted upstream errors without returning their message to clients."""
    error = payload.get('error') if isinstance(payload,dict) else None
    if not isinstance(error,dict): error = payload if isinstance(payload,dict) else {}
    code = str(error.get('code',''))
    if code in {'401','403'}: return ProviderError('authentication')
    if code == '429': return ProviderError('rate_limit')
    hint = str(error.get('message','')).lower()
    if code in {'400','404','422'} or any(term in hint for term in ('not support','unsupported','no endpoints','no available model','modality','vision')):
        return ProviderError('capability')
    return ProviderError('upstream_error')


def _begin_attempt(trace):
    if trace is not None: trace['attempts'].append({})


MODEL_REGISTRY = {
    "uvms-1-fast": {
        "name": "UVMS-1 Fast",
        "description": "Fast everyday assistant",
        "tier": "free",
        "reasoning_effort": "none",
    },
    "uvms-1-balanced": {
        "name": "UVMS-1 Balanced",
        "description": "Best balance of speed and quality",
        "tier": "free",
        "reasoning_effort": "medium",
    },
    "uvms-1-deep": {
        "name": "UVMS-1 Deep",
        "description": "Higher-effort reasoning for hard tasks",
        "tier": "plus",
        "reasoning_effort": "high",
    },
}


def upstream_model(uvms_model: str, runtime: dict[str, Any] | None = None) -> str:
    # Temporary development identity: never inherit a paid model from old DB/env aliases.
    if effective_ai_provider(settings) == 'openrouter': return 'openrouter/free'
    if effective_ai_provider(settings) == 'gemini':
        return getattr(settings, 'gemini_model_' + uvms_model.removeprefix('uvms-1-'), settings.gemini_model_balanced)
    if effective_ai_provider(settings) == 'groq':
        return getattr(settings, 'groq_model_' + uvms_model.removeprefix('uvms-1-'), settings.groq_model)
    if runtime and runtime.get("provider_model"):
        return str(runtime["provider_model"])
    return getattr(settings, 'model_' + uvms_model.removeprefix('uvms-1-'), '') or settings.openai_model


def reasoning_effort(uvms_model: str, runtime: dict[str, Any] | None = None) -> str:
    if effective_ai_provider(settings) in {'gemini', 'groq'}:
        return {'uvms-1-fast':'low', 'uvms-1-balanced':'medium', 'uvms-1-deep':'high'}.get(uvms_model, 'medium')
    if runtime and runtime.get("reasoning_effort"):
        return str(runtime["reasoning_effort"])
    info = MODEL_REGISTRY.get(uvms_model, MODEL_REGISTRY["uvms-1-balanced"])
    return str(info.get("reasoning_effort", "medium"))


def _last_user_text(history: list[dict[str, Any]]) -> str:
    for item in reversed(history):
        if item.get("role") != "user":
            continue
        content = item.get("content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            texts = [str(part.get("text", "")) for part in content if part.get("type") == "input_text"]
            return "\n".join(texts)
    return ""


def _normalize_citation(annotation: dict[str, Any]) -> dict[str, Any] | None:
    """Normalize Responses API URL annotations into UVMS-owned metadata.

    The Responses API has used both flattened URL citation objects and a
    nested url_citation shape across API surfaces. Supporting both keeps the
    gateway resilient while exposing one stable frontend contract.
    """
    if not isinstance(annotation, dict):
        return None

    payload = annotation
    if annotation.get("type") == "url_citation" and isinstance(annotation.get("url_citation"), dict):
        payload = annotation["url_citation"]

    ann_type = annotation.get("type") or payload.get("type")
    if ann_type not in {"url_citation", "web_search_url_citation"} and not payload.get("url"):
        return None

    url = str(payload.get("url") or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in {'http','https'} or not parsed.hostname or parsed.username or parsed.password or any(ord(c)<32 for c in url):
        return None

    title = str(payload.get("title") or url).strip()[:500]
    citation: dict[str, Any] = {"type": "url_citation", "url": url, "title": title}
    for key in ("start_index", "end_index"):
        value = payload.get(key)
        if isinstance(value, int):
            citation[key] = value
    return citation


def _citations_from_output_item(item: dict[str, Any]) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    if not isinstance(item, dict) or item.get("type") != "message":
        return citations
    for part in item.get("content") or []:
        if not isinstance(part, dict) or part.get("type") != "output_text":
            continue
        for annotation in part.get("annotations") or []:
            normalized = _normalize_citation(annotation)
            if normalized:
                citations.append(normalized)
    return citations


def _transport_stream_events(
    history: list[dict[str, Any]],
    uvms_model: str,
    *,
    web_search: bool = False,
    runtime: dict[str, Any] | None = None,
) -> Iterator[dict[str, Any]]:
    """Yield provider-neutral events for text, tools and citations.

    Event types:
      - delta: {delta}
      - tool: {tool, status}
      - citation: {citation}

    Routes translate these into SSE frames, while non-streaming callers can
    aggregate them without having to understand provider-specific event names.
    """
    if is_demo():
        prompt = _last_user_text(history)
        if web_search:
            yield {"type": "tool", "tool": "web_search", "status": "demo"}
        demo = (
            "**Welcome to the UVMS AI demo.**\n\n"
            f"Your idea: {prompt[:260]}\n\n"
            "This is a sample response so you can explore conversations, organize projects and try attachments. "
            "Live answers, file analysis and web results are not available in this preview.\n\n"
            "Try creating a project for your next idea, or save a preference in Memory."
        )
        for part in demo.split(" "):
            yield {"type": "delta", "delta": part + " "}
            time.sleep(0.005)
        return

    runtime = runtime if runtime is not None else {}
    if time.perf_counter() >= runtime.get('_deadline', float('inf')):
        raise ProviderError('timeout')
    provider = effective_ai_provider(settings)
    if provider in {'openrouter', 'gemini', 'groq'} and web_search:
        raise ProviderError('capability')  # Native search/plugins may charge; free chat only.
    trace = runtime.get('_trace')
    base_url, api_key = provider_connection()
    _begin_attempt(trace)
    url = f"{base_url}/responses"
    payload = {
        'model': upstream_model(uvms_model, runtime), 'instructions': SYSTEM_INSTRUCTIONS,
        'input': budget_history(history, runtime), 'stream': True, 'store': False,
        'max_output_tokens': int(runtime.get('output_tokens', settings.output_tokens)),
    }
    effort = reasoning_effort(uvms_model, runtime)
    # 'none' omits this optional field for compatible non-reasoning models.
    if effort != 'none' and effective_ai_provider(settings) != 'openrouter': payload['reasoning'] = {'effort': effort}
    if provider in {'gemini', 'groq'}:
        from .gemini_adapter import chat_messages
        url = f'{base_url}/chat/completions'
        payload = {'model': upstream_model(uvms_model, runtime),
                   'messages': chat_messages(budget_history(history, runtime), SYSTEM_INSTRUCTIONS),
                   'stream': True, 'stream_options': {'include_usage': True},
                   'max_tokens': int(runtime.get('output_tokens', settings.output_tokens)),
                   'reasoning_effort': effort}
        if provider == 'groq':
            images = sum(part.get('type') == 'image_url' for message in payload['messages']
                         if isinstance(message.get('content'), list) for part in message['content'])
            if images > 3: raise ProviderError('capability')
            if images: raise ProviderError('capability')  # Public Beta has no Vision provider.
            from .groq_routing import CODING_INSTRUCTIONS, is_coding
            if is_coding(runtime.get('_routing_prompt', _last_user_text(history))):
                payload['messages'][0]['content'] += '\n' + CODING_INSTRUCTIONS
            payload['max_completion_tokens'] = payload.pop('max_tokens')
            payload['include_reasoning'] = False
            if trace is not None: trace['provider_model'] = payload['model']
    if web_search:
        payload["tools"] = [{"type": "web_search", "search_context_size": "medium"}]
        # Request the tool's source list when supported. URL annotations on the
        # generated text remain the canonical citation source for the UI.
        payload["include"] = ["web_search_call.action.sources"]

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    seen_citations: set[tuple[str, str]] = set()
    completed = False
    deadline = runtime.get('_deadline', time.perf_counter() + settings.provider_timeout)

    with httpx.Client(timeout=httpx.Timeout(settings.provider_timeout, connect=10)) as client:
        with client.stream("POST", url, json=payload, headers=headers) as response:
            if provider == 'groq':
                from .beta_quota import observe_response
                observe_response(response, trace, payload['model'])
            response.raise_for_status()
            runtime['_close'] = response.close
            if provider in {'gemini', 'groq'}:
                from .gemini_adapter import stream_deltas
                yield from stream_deltas(response.iter_lines(), trace, deadline, provider=provider)
                return
            for line in response.iter_lines():
                if time.perf_counter() > deadline: raise ProviderError('timeout')
                if not line or not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if raw == "[DONE]":
                    break
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    raise ProviderError('malformed_response')
                if not isinstance(event, dict): raise ProviderError('malformed_response')

                event_type = event.get("type")
                response_info = event.get('response')
                if trace is not None and isinstance(response_info,dict) and isinstance(response_info.get('model'),str):
                    trace['resolved_provider_model'] = response_info['model'][:200]
                if event_type == "response.output_text.delta":
                    delta = event.get("delta")
                    if delta:
                        if trace is not None and trace['first_token_ms'] is None: trace['first_token_ms'] = round((time.perf_counter()-trace['started'])*1000,2)
                        yield {"type": "delta", "delta": str(delta)}
                    continue

                if event_type in {"response.web_search_call.in_progress", "response.web_search_call.searching"}:
                    yield {"type": "tool", "tool": "web_search", "status": "searching"}
                    continue

                if event_type == "response.web_search_call.completed":
                    if trace is not None: trace['search_calls'] = trace.get('search_calls',0) + 1
                    yield {"type": "tool", "tool": "web_search", "status": "reading"}
                    continue

                if event_type == 'response.completed':
                    completed = True
                    usage_received(trace, (event.get('response') or {}).get('usage'))
                    if web_search: yield {'type':'tool','tool':'web_search','status':'completed'}
                    continue
                if event_type in {'response.failed','response.incomplete'}:
                    usage_received(trace, (event.get('response') or {}).get('usage'))
                    if effective_ai_provider(settings) == 'openrouter' and event_type == 'response.failed':
                        raise _router_stream_error(event.get('response'))
                    raise ProviderError('incomplete')

                if event_type == "response.output_text.annotation.added":
                    normalized = _normalize_citation(event.get("annotation") or {})
                    if normalized:
                        key = (normalized["url"], normalized.get("title", ""))
                        if key not in seen_citations:
                            seen_citations.add(key)
                            yield {"type": "citation", "citation": normalized}
                    continue

                # Some provider versions expose final annotations on the
                # completed output item instead of emitting annotation events.
                if event_type == "response.output_item.done":
                    for citation in _citations_from_output_item(event.get("item") or {}):
                        key = (citation["url"], citation.get("title", ""))
                        if key not in seen_citations:
                            seen_citations.add(key)
                            yield {"type": "citation", "citation": citation}
                    continue

                if event_type == "error":
                    if effective_ai_provider(settings) == 'openrouter': raise _router_stream_error(event)
                    raise ProviderError('upstream_error')
    if not completed: raise ProviderError('interrupted')


def _provider_stream_events(history, uvms_model, *, web_search=False, runtime=None):
    from .beta_quota import provider_slot, apply_budget
    runtime = runtime if runtime is not None else {}
    if effective_ai_provider(settings) == 'groq':
        apply_budget(runtime, uvms_model, history)
    with provider_slot(runtime.get('_trace'), enabled=settings.public_beta and effective_ai_provider(settings) == 'groq'):
        yield from _transport_stream_events(history, uvms_model, web_search=web_search, runtime=runtime)


def _cancellable_events(history, uvms_model, *, web_search, runtime):
    runtime = runtime if runtime is not None else {}
    cancel = runtime.get('_cancel')
    if is_demo() or (not cancel and not runtime.get('_enforce_deadline')):
        yield from _provider_stream_events(history, uvms_model, web_search=web_search, runtime=runtime)
        return
    cancel = cancel or (lambda: False)
    events = queue.Queue(maxsize=16); halt = threading.Event()
    def put(value):
        while not halt.is_set():
            try: events.put(value,timeout=.1); return
            except queue.Full: pass
    def producer():
        try:
            for event in _provider_stream_events(history,uvms_model,web_search=web_search,runtime=runtime):
                if halt.is_set(): break
                put(event)
        except Exception as error: put(error)
        finally: put(None)
    deadline = runtime.get('_deadline', time.perf_counter() + settings.provider_timeout)
    if time.perf_counter() >= deadline:
        raise ProviderError('timeout')
    worker = threading.Thread(target=producer, daemon=True); worker.start()
    try:
        while not cancel():
            # A silent upstream may send no complete line on which the reader
            # can check its deadline. Bound the consumer's wait independently.
            if time.perf_counter() >= deadline:
                raise ProviderError('timeout')
            try: event = events.get(timeout=.1)
            except queue.Empty: continue
            if event is None: return
            if isinstance(event, Exception): raise event
            yield event
    finally:
        halt.set()
        close = runtime.pop('_close',None)
        if close:
            def close_response():
                try: close()
                except Exception: pass
            # HTTP cleanup can wait behind a reader's socket lock. It must not
            # delay cancellation/timeout accounting or hold the SSE consumer.
            closer = threading.Thread(target=close_response, daemon=True)
            closer.start()
            closer.join(timeout=.1)


def stream_events(history, uvms_model, *, web_search=False, runtime=None):
    """If search fails before text starts, transparently try a plain answer."""
    runtime = runtime if runtime is not None else {}
    runtime.setdefault('_deadline', time.perf_counter() + settings.provider_timeout)
    started = False
    try:
        for event in _cancellable_events(history, uvms_model, web_search=web_search, runtime=runtime):
            if event.get('type') == 'delta' and event.get('delta'):
                started = True
            yield event
    except Exception as exc:
        from fastapi import HTTPException
        if isinstance(exc, HTTPException): raise
        error = provider_error(exc)
        if not web_search or started or error.code in {'authentication','rate_limit','configuration','capability'}:
            raise error from None
        yield {'type': 'tool', 'tool': 'web_search', 'status': 'failed'}
        try:
            yield from _cancellable_events(history, uvms_model, web_search=False, runtime=runtime)
        except Exception as exc:
            raise provider_error(exc) from None


def stream_answer(history: list[dict[str, Any]], uvms_model: str, *, web_search: bool = False, runtime: dict[str, Any] | None = None) -> Iterable[str]:
    runtime = runtime if runtime is not None else {}
    runtime['_enforce_deadline'] = True
    for event in stream_events(history, uvms_model, web_search=web_search, runtime=runtime):
        if event.get("type") == "delta" and event.get("delta"):
            yield str(event["delta"])


def complete_answer(history: list[dict[str, Any]], uvms_model: str, *, web_search: bool = False, runtime: dict[str, Any] | None = None) -> str:
    return "".join(stream_answer(history, uvms_model, web_search=web_search, runtime=runtime)).strip()


def complete_answer_with_meta(
    history: list[dict[str, Any]],
    uvms_model: str,
    *,
    web_search: bool = False,
    runtime: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    runtime = runtime if runtime is not None else {}
    runtime['_enforce_deadline'] = True
    chunks: list[str] = []
    citations: list[dict[str, Any]] = []
    search_used = False
    search_status = "idle"
    for event in stream_events(history, uvms_model, web_search=web_search, runtime=runtime):
        if event.get("type") == "delta":
            chunks.append(str(event.get("delta") or ""))
        elif event.get("type") == "citation" and isinstance(event.get("citation"), dict):
            citations.append(event["citation"])
        elif event.get("type") == "tool" and event.get("tool") == "web_search":
            search_status = event.get('status', 'idle')
            if search_status == 'failed': citations.clear()
            search_used = search_status in {'reading','completed'}
    return "".join(chunks).strip(), {
        "web_search": bool(web_search),
        "web_search_used": search_used,
        "web_search_status": search_status,
        "demo": is_demo(),
        "citations": citations,
    }


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def _demo_image_png(size: str) -> bytes:
    """Dependency-free branded gradient PNG for local/demo mode."""
    width, height = (int(part) for part in size.split("x", 1))
    rows: list[bytes] = []
    for y in range(height):
        progress = y / max(1, height - 1)
        base = (
            int(7 + 8 * progress),
            int(17 + 18 * progress),
            int(15 + 10 * progress),
        )
        row = bytearray(base * width)
        # UVMS neon horizon and two accent rails make demo output obvious on
        # both React Native and browsers without Pillow or other image libs.
        if int(height * 0.62) <= y <= int(height * 0.66):
            for x in range(width):
                offset = x * 3
                blend = x / max(1, width - 1)
                row[offset:offset+3] = bytes((int(41 + 124 * blend), int(209 + 26 * blend), int(150 - 90 * blend)))
        rail = max(4, width // 90)
        if int(height * 0.16) < y < int(height * 0.84):
            for center, color in ((int(width * 0.13), (41, 209, 150)), (int(width * 0.18), (165, 235, 61))):
                left = max(0, center - rail)
                right = min(width, center + rail)
                for x in range(left, right):
                    offset = x * 3
                    row[offset:offset+3] = bytes(color)
        rows.append(b"\x00" + bytes(row))
    raw = b"".join(rows)
    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return signature + _png_chunk(b"IHDR", ihdr) + _png_chunk(b"IDAT", zlib.compress(raw, 9)) + _png_chunk(b"IEND", b"")


def generate_image_bytes(
    prompt: str,
    *,
    size: str = "1024x1024",
    quality: str = "medium",
    trace: dict | None = None,
) -> tuple[bytes, str, str, bool]:
    """Generate an image and return bytes, MIME type, extension and demo flag."""
    if effective_ai_provider(settings) in {'gemini', 'groq'}: raise ProviderError('capability')
    if is_demo('image'):
        return _demo_image_png(size), "image/png", ".png", True

    _begin_attempt(trace)
    url = f"{settings.openai_base_url}/images/generations"
    payload = {
        "model": settings.openai_image_model,
        "prompt": prompt,
        "size": size,
        "quality": quality,
        "n": 1,
    }
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=httpx.Timeout(settings.image_timeout, connect=10)) as client:
        response = client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        body = response.json()
        usage_received(trace, body.get('usage'))
        items = body.get("data") or []
        if not items:
            raise RuntimeError("Image provider returned no image")
        item = items[0]
        encoded = item.get("b64_json")
        if encoded and isinstance(encoded,str) and len(encoded) <= 40 * 1024 * 1024:
            data = base64.b64decode(encoded, validate=True)
            from .vision import validate_image
            mime = validate_image(data)
            return data, mime, {'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif'}[mime], False
        # Never fetch arbitrary URLs supplied by an upstream (SSRF / expiring assets).
        raise ProviderError('unsupported_image_response')


def transcribe_audio_bytes(filename: str, data: bytes, mime_type: str = "application/octet-stream", *, trace: dict | None = None) -> tuple[str, bool]:
    """Transcribe a short voice recording. Returns text and demo flag."""
    if effective_ai_provider(settings) == 'gemini': raise ProviderError('capability')
    if is_demo('voice'):
        return "Demo recording received. Live transcription is unavailable in this preview.", True

    groq = effective_ai_provider(settings) == 'groq'
    base_url, key = provider_connection()
    url = f"{base_url}/audio/transcriptions"
    headers = {"Authorization": f"Bearer {key}"}
    files = {"file": (filename, data, mime_type)}
    form = {"model": settings.groq_transcription_model if groq else settings.openai_transcription_model}
    if groq: form['response_format'] = 'verbose_json'
    from .beta_quota import provider_slot, observe_response
    with provider_slot(trace, enabled=settings.public_beta and groq):
        _begin_attempt(trace)
        with httpx.Client(timeout=httpx.Timeout(settings.provider_timeout, connect=10)) as client:
            response = client.post(url, headers=headers, files=files, data=form)
            if groq: observe_response(response, trace, form['model'])
            response.raise_for_status()
            payload = response.json()
    usage_received(trace, payload.get('usage'))
    if groq and isinstance(payload.get('duration'), (int, float)):
        usage_received(trace, {'seconds': payload['duration']})
    text = str(payload.get("text") or "").strip()
    if not text:
        raise RuntimeError("Transcription provider returned no text")
    return text, False
