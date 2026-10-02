# Gemini provider

Integration is implemented on the v1.4.2 baseline. **Live acceptance is pending; this is not a Gemini production certification.**

## Backend configuration

Set these values only in the private root `.env` used by FastAPI:

```dotenv
UVMS_AI_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
GEMINI_MODEL_FAST=gemini-3.8-flash
GEMINI_MODEL_BALANCED=gemini-3.8-flash
GEMINI_MODEL_DEEP=gemini-3.8-flash
```

Fill the key locally; never paste it into a report, frontend setting, screenshot or command argument. Restart the backend after changing `.env`. The base URL must be Google's official HTTPS endpoint. No OpenAI/OpenRouter credential is used or retried when Gemini is selected.

| UVMS mode | Default model | `reasoning_effort` |
|---|---|---|
| Fast | gemini-3.8-flash | low |
| Balanced / Smart | gemini-3.8-flash | medium |
| Deep | gemini-3.8-flash | high |

Gemini-specific environment aliases override old database routes and `UVMS_MODEL_*`. Admin displays the effective values as read-only. Entitlements, alias names, Vision permissions and model availability remain under their existing controls. Reasoning is not silently omitted or downgraded on failure.

The implementation follows Google's [OpenAI compatibility documentation](https://ai.google.dev/gemini-api/docs/openai): Chat Completions, streamed deltas, image URL content and reasoning effort. All three efforts returned exactly READY in real requests with the configured account on 2026-09-30. Full live acceptance remains incomplete because of upstream 503 responses, an interrupted stream and HTTP 429.

## Contract and capabilities

The existing gateway owns timeouts, cancellation, request IDs and provider-neutral events. The adapter changes only the upstream message/chunk format. Existing `/chat/stream`, complete/regenerate, history, Projects, Memory, Files, Vision, Markdown/math and chart JSON paths remain in place.

Usage maps `prompt_tokens` to input and preserves `total_tokens`. When both are available and consistent, billable output is `total_tokens - prompt_tokens`, including thinking. Real Gemini responses excluded thinking from `completion_tokens` (observed 310 prompt + 908 visible completion + 1396 thinking = 2614 total). This matches Google's [thinking pricing semantics](https://ai.google.dev/gemini-api/docs/generate-content/thinking#pricing). Missing usage/cost remains unknown; partial usage is preserved as reported. Configure verified backend rates in `UVMS_PROVIDER_PRICES_JSON` only after checking the actual model/account price. Existing pre-fix QA accounting is historical and was not rewritten.

Native web search, image generation and audio transcription are unavailable in this Gemini adapter. These are separate from **Vision image input**, which is supported. Unsupported endpoints do not fall back to another provider or demo media.

A terminal `stop` plus text and `[DONE]` is required for a successful stream. EOF, malformed chunks, truncation and filtered/unsupported output produce safe errors. HTTP 429 shows a quota message and Retry; raw provider JSON and credential fragments are never returned.

## Admin diagnostic

`GET /admin/stats` adds `provider_health` and usage grouping by provider. `POST /admin/provider-health/check` is admin-only and performs a real one-word READY check through the gateway, recording usage. A 200 response with the wrong answer fails that probe.

The panel displays Gemini, the configured models, availability, check time and the last normalized error. It contains no key value or prefix. Availability reflects a completed/failed provider request within 15 minutes; without a recent request it says not checked recently. It is a connectivity check, not a quality score or an SLA.

## Live acceptance gate

First obtain exactly READY through the browser, then observe multiple increasing DOM updates before completion. Verify low/medium/high with actual API calls; if rejected, inspect the documented supported contract and record the real result before changing the mapping.

Then assess RU, natural complex Uzbek, English reasoning, Python/FastAPI, React/TypeScript, Integral, Bayes, multi-stage physics, PNG/JPEG Vision, PDF/DOCX/XLSX/CSV, Project instructions, Memory, line/bar/pie/scatter, long answers, Stop, Retry/regenerate, reload/history and two tabs. A successful HTTP response is not a quality PASS.

The previous OpenRouter Integral/Bayes timeouts remain historical **provider limitations**, with readable errors and Retry verified in the app. They are not Gemini results. Free OpenRouter is not a production model and is not a fallback for Gemini.
