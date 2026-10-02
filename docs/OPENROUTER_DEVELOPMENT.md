# Free OpenRouter development mode

Date: 2026-09-18. This temporary mode is for development/demo, not production model identity or Stage 1.1 OpenAI acceptance.

## Provider switching

| `UVMS_AI_PROVIDER` | Text endpoint / credential | Image generation and transcription |
| --- | --- | --- |
| `demo` | No external provider | Explicit demo samples / demo receipt |
| `openai` | `OPENAI_BASE_URL`, `OPENAI_API_KEY` | Existing OpenAI media endpoints |
| `openrouter` | Fixed `https://openrouter.ai/api/v1`, **`OPENROUTER_API_KEY` only** | Always demo, no external media requests |
| `openai-compatible` | `OPENAI_BASE_URL`, `OPENAI_API_KEY`; existing Responses-compatible adapter | Existing compatible media contracts |
| `auto` (legacy) | OpenAI when configured, otherwise demo unless live AI is required | Same legacy selection |

OpenRouter mode is rejected at startup outside `UVMS_ENV=development`, `demo` or `test`. It never reuses the OpenAI key or silently falls back to paid models. Both credentials remain backend-only. Selecting another provider and restarting the API restores its existing configuration without rewriting the adapter.

## Local setup

Set these names in the repository's local `.env`:

```dotenv
UVMS_ENV=development
UVMS_AI_PROVIDER=openrouter
OPENROUTER_API_KEY=
```

Fill the last value locally with an OpenRouter key. Do not add it to client environment variables or commit it. Restart the backend after changing environment configuration. The local workspace was switched to this provider mode; its OpenAI key and alias settings were preserved.

The mode deliberately fixes all three aliases to the free router:

| UVMS alias | Development request model |
| --- | --- |
| UVMS-1 Fast | `openrouter/free` |
| UVMS-1 Balanced | `openrouter/free` |
| UVMS-1 Deep | `openrouter/free` |

Existing paid model mappings in the database or alias environment variables cannot override this development routing. Public names and plan authorization stay unchanged. This means Deep retains its plan restriction but does not promise a stronger model in this temporary mode. Alias-specific reasoning fields are omitted because a random free model may not support them.

OpenRouter documents [the free router](https://openrouter.ai/openrouter/free) as randomly selecting free models and filtering for requested features such as image input. UVMS uses its existing streaming [Responses API contract](https://openrouter.ai/docs/api_reference/responses/overview), sends bounded history and inline normalized image bytes, and keeps `store: false`. Availability and output quality can vary between requests. This is not a fixed production identity or service guarantee.

## Capabilities and safe failures

- Text uses real Responses streaming when a valid OpenRouter key and routed model are available. Missing configuration is an explicit safe error with Retry; it does not fabricate a demo answer.
- Vision requests contain real normalized image pixels. If the router has no capable endpoint or rejects the modality, UVMS returns a safe capability message. Incomplete or interrupted streams are errors, not successful blank/partial answers.
- Native web search is disabled in this mode, including direct API attempts. UVMS does not enable paid search plugins or paid fallbacks.
- Image generation produces the existing labeled UVMS sample and stores `demo: true`. Speech accepts a demo recording receipt, not a live transcript. Web and Mobile do not insert that receipt into the composer as a transcript.
- Web/Mobile display a development notice describing variable model availability and demo media. Normal UI does not show private provider model IDs.
- Private accounting records `provider=openrouter` and the requested router identity; `resolved_provider_model` captures the actual returned model when the provider supplies it. It is not exposed in assistant metadata. Demo media records `provider=demo`, zero provider tokens/cost and demo model identities.

Pricing remains configurable through `UVMS_PROVIDER_PRICES_JSON`. OpenRouter currently documents free-router token pricing as zero; an optional corresponding entry is `"openrouter/free":{"input_per_million":0,"output_per_million":0}`. Missing pricing remains unknown; provider-reported usage is not fabricated. The request identity and resolved model are separate fields.

## Live verification on 2026-09-18

The separate local key is now configured and real OpenRouter calls succeeded. The missing-key block from the initial implementation pass is superseded. See [FREE_OPENROUTER_DEV.md](../FREE_OPENROUTER_DEV.md) for the complete live results, resolved models, browser timings, failures, fixes, final regression gates and limitations.

- All three aliases passed the opt-in real text smoke; its isolated Plus account also exercised Deep. A PNG/JPEG/WEBP request was accepted.
- Actual headed Web UI: Fast and Balanced progressively rendered real text after fixing proxy gzip buffering; Russian/Uzbek/English, previous-turn recall, Retry and active Stop were exercised. Deep was locked on the ordinary Free QA account.
- PNG/JPEG answers correctly identified shapes, colors, arrangement and count; this was checked against the actual images. The JPEG answer persisted after reload.
- Private records contain the router request identity, resolved model, returned tokens and local timing/status. Cancelled usage stays unknown where no final usage is returned. No cost estimate is invented when pricing is absent.
- A stalled response, cancellation finalization and variable-quality router answers were recorded. Several routes returned only a safety-classifier label; Uzbek/factual quality is not consistently acceptable.
- Search stays disabled; image generation and speech remain explicitly demo. These development results do not complete Stage 1.1 OpenAI acceptance.

The existing opt-in command remains (repository root):

```powershell
$env:UVMS_LIVE_PROVIDER_TESTS='1'
.\.venv\Scripts\python.exe ops/live_provider_smoke.py --vision
```

Deterministic adapter and browser regressions are separate from live provider evidence. No paid fallback or architecture rewrite was introduced.
