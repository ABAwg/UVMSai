"""Shared Chat Completions wire format; lifecycle/SSE remain in ai_gateway."""
import json
import time

from .provider_usage import usage_received


def chat_messages(history, instructions):
    from .ai_gateway import ProviderError
    messages = [{'role': 'system', 'content': instructions}]
    for item in history:
        role, content = item.get('role'), item.get('content', '')
        if role not in {'system', 'developer', 'user', 'assistant'}:
            raise ProviderError('malformed_response')
        if role == 'developer': role = 'system'
        if isinstance(content, list):
            parts = []
            for part in content:
                if part.get('type') in {'input_text', 'output_text'}:
                    parts.append({'type': 'text', 'text': part.get('text', '')})
                elif part.get('type') == 'input_image':
                    image = {'url': part['image_url']}
                    if part.get('detail'): image['detail'] = part['detail']
                    parts.append({'type': 'image_url', 'image_url': image})
                else:
                    raise ProviderError('capability')
            content = parts
        messages.append({'role': role, 'content': content})
    return messages


def stream_deltas(lines, trace, deadline, *, provider='gemini'):
    from .ai_gateway import ProviderError
    finished = None
    done = False
    text_received = False
    for line in lines:
        if time.perf_counter() > deadline: raise ProviderError('timeout')
        if not line.startswith('data:'): continue
        raw = line[5:].strip()
        if raw == '[DONE]':
            done = True
            break
        try:
            event = json.loads(raw)
        except (ValueError, TypeError):
            raise ProviderError('malformed_response') from None
        if not isinstance(event, dict): raise ProviderError('malformed_response')
        if 'error' in event:
            error = event['error'] if isinstance(event['error'], dict) else {}
            code = str(error.get('code', error.get('status', '')))
            raise ProviderError({'401':'authentication','403':'authentication','429':'rate_limit',
                                 'UNAUTHENTICATED':'authentication','PERMISSION_DENIED':'authentication',
                                 'RESOURCE_EXHAUSTED':'rate_limit'}.get(code, 'upstream_error'))
        model = event.get('model')
        if trace is not None and isinstance(model, str): trace['resolved_provider_model'] = model[:200]
        usage = event.get('usage')
        if provider == 'groq' and not isinstance(usage, dict) and isinstance(event.get('x_groq'), dict):
            usage = event['x_groq'].get('usage')
        if isinstance(usage, dict):
            prompt, completion, total = (usage.get(key) for key in
                                         ('prompt_tokens', 'completion_tokens', 'total_tokens'))
            # Gemini's completion_tokens excludes thinking; total_tokens includes it.
            # Preserve the gateway's billable output-token semantics without estimating
            # missing usage. Live example: prompt=310, completion=908, total=2614.
            valid = lambda value: isinstance(value, int) and not isinstance(value, bool) and value >= 0
            if provider == 'gemini' and valid(prompt) and valid(total) and total >= prompt and (not valid(completion) or total - prompt >= completion):
                completion = total - prompt
            usage_received(trace, {'input_tokens': prompt, 'output_tokens': completion,
                                   'total_tokens': total})
        choices = event.get('choices')
        if not isinstance(choices, list) or len(choices) > 1:
            raise ProviderError('malformed_response')
        if not choices:
            if not isinstance(usage, dict): raise ProviderError('malformed_response')
            continue
        choice = choices[0]
        if not isinstance(choice, dict) or choice.get('index', 0) != 0:
            raise ProviderError('malformed_response')
        delta = choice.get('delta')
        if not isinstance(delta, dict): raise ProviderError('malformed_response')
        if delta.get('tool_calls') or delta.get('refusal'):
            raise ProviderError('capability')
        content = delta.get('content')
        if content is not None and not isinstance(content, str): raise ProviderError('malformed_response')
        if content:
            if finished is not None: raise ProviderError('malformed_response')
            text_received = True
            if trace is not None and trace['first_token_ms'] is None:
                trace['first_token_ms'] = round((time.perf_counter() - trace['started']) * 1000, 2)
            yield {'type': 'delta', 'delta': content}
        reason = choice.get('finish_reason')
        if reason is not None:
            if finished is not None or reason not in {'stop', 'length', 'content_filter', 'tool_calls'}:
                raise ProviderError('malformed_response')
            finished = reason
    if not done or finished is None: raise ProviderError('interrupted')
    if finished == 'length': raise ProviderError('incomplete')
    if finished != 'stop': raise ProviderError('capability')
    if not text_received: raise ProviderError('malformed_response')
