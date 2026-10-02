# Stage 1.1 — AI provider QA

## v1.4.2 — Final Live QA · 2026-09-28

Текущая версия: **1.4.2**. Backend **126/126**, Web unit **16/16**, browser E2E **23/23**, Mobile SSE **2/2**, Expo Doctor **21/21**. Web build/TypeScript, mobile typecheck/exports, PostgreSQL и SQLite migrations, Docker staging проверены.

**CODE/LOCAL PRODUCTION READY:** технический release candidate в проверенном scope. **EXTERNAL CERTIFICATION REMAINING; PHYSICAL DEVICE QA REQUIRED.** Бесплатный OpenRouter — только development QA route, не production-модель. Live quality остаётся PARTIAL: были timeouts, safety-classifier output, ошибки кода и плохой UZ.

Integral/Bayes: **provider limitation**; приложение завершает ожидание читаемой ошибкой и предлагает Retry. Успешное live-решение этой задачи не подтверждено. Повторять уже пройденные локальные тесты для этого не требуется.

Полные актуальные результаты: [UVMS AI FINAL LIVE QA REPORT](UVMS_AI_FINAL_LIVE_QA_REPORT.md). Ниже сохранена история предыдущих проходов; старые counts и ограничения окружения не описывают текущую проверку.

## Current status — 2026-09-18

**Stage 1.1 live acceptance is not complete.** The OpenAI key is now configured and authenticated model catalog requests succeeded (HTTP 200). Generation did not succeed: a minimal real request returned HTTP 429, type `insufficient_quota`, code `credit_balance_exhausted`. The earlier missing-OpenAI-key result below is historical, not the current diagnosis. No successful OpenAI text, vision, search, image or transcription acceptance is claimed.

The requested full opt-in smoke (`--extended --vision --search --images`) was run against OpenAI. All AI-generation cases failed; local project/memory/file creation succeeded but does not count as provider evidence. Three stream routes returned HTTP 200 with SSE errors, not successful answers. Private usage records contain failed attempts, no returned token totals and no first-token observations. Evidence: `.qa/live-acceptance-smoke.log` and `.qa/live-provider-results.json`.

Model lookup also returned HTTP 404 / `model_not_found` for `gpt-5.6`, with message `The model 'gpt-5.6' does not exist`. Lookup of `gpt-5.6-sol`, `gpt-image-2` and `gpt-4o-mini-transcribe` returned HTTP 200. The local Fast/Balanced/Deep environment mappings were explicitly changed to `gpt-5.6-sol` after this finding; successful inference with it remains unverified. These account observations are recorded in `.qa/live-model-access.json`; they take precedence over assumptions about an alias's availability.

The user then requested temporary free development operation instead of paid OpenAI acceptance. The existing adapter now supports explicit `demo`, `openai`, `openrouter` and `openai-compatible` modes (legacy `auto` retained). In OpenRouter mode every UVMS text alias is forced to `openrouter/free` at `https://openrouter.ai/api/v1`, using only `OPENROUTER_API_KEY`. OpenAI settings remain intact. Production use of this free-router mode is rejected. Image generation and speech are explicitly demo, and paid/native search is disabled.

**OpenRouter development live calls now succeed.** The missing separate-key block is removed for this mode only. Real smoke passed Fast/Balanced/Deep and a vision payload. Headed Chrome confirmed Fast/Balanced progressive streaming, Russian/Uzbek/English delivery, previous-turn recall, Retry, active Stop and correct PNG/JPEG understanding. Deep browser testing remained locked on the dedicated Free QA account; isolated Plus smoke is not proof of the user's current plan.

The full record is [FREE_OPENROUTER_DEV.md](FREE_OPENROUTER_DEV.md), including observed browser timings (Fast 4195.6 ms / Balanced 4441.2 ms for successful progressive examples), exact private resolved models/token counts, real vision answers, cancellation accounting, regressions and remaining limits. Text quality was inconsistent: some routes returned a safety-classifier label instead of an answer, and Uzbek/factual errors occurred. A real no-token timeout and browser disconnect/accounting issues were found and addressed; unsuccessful observations are retained in that report.

Final regressions after the live fixes: **92 backend, 7 Web API/session, 18 browser tests passed**. Web/Mobile TypeScript, Web production build (13 pages), Python compile and clean Alembic head `d71b2e41aa11` passed. Intermediate failures and their fixes remain recorded in the development report.

OpenRouter image generation and voice remain demo, and Search is disabled. No live search, image-generation, physical-microphone transcription or provider-invoice reconciliation is claimed. The original paid Stage 1.1 acceptance remains incomplete. Historical OpenAI evidence above does not establish successful OpenAI generation; the generic live-provider-results.json is overwritten by later smoke runs, so use the dedicated OpenRouter evidence file for the current run. Neither configured credential was printed or replaced with an invalid key.

## Historical local-only pass — 2026-09-17

Date: 2026-09-17. Workspace: existing UVMS-AI-Stage1-v1.0.1. The prior stabilization record is retained in [QA_REPORT.md](QA_REPORT.md).

**Status: local implementation and deterministic QA passed; live provider certification is blocked.** The backend has no configured `OPENAI_API_KEY`. The opt-in live runner stopped before sending any provider requests. No real provider/model, real microphone transcription, live answer quality, invoice amount or live first-token latency is certified by this report.

## Final verification

| Gate | Previous baseline | This pass |
| --- | --- | --- |
| Backend tests | 38 | **77 passed**, including 39 new adapter/accounting/context/control cases |
| Web API/session tests | 7 | **7 passed** |
| Browser E2E | 16 | **16 passed** in the full final run; 2 affected image scenarios passed again after the last quota transaction fix |
| Web TypeScript | PASS | PASS |
| Web production build | PASS | PASS, all 13 pages generated |
| Mobile TypeScript | PASS | PASS |
| Python compile | PASS | PASS |
| Alembic | c64f1f9a1a10 | PASS: empty SQLite → previous head → **d71b2e41aa11** |
| Python dependencies | — | `pip check`: no broken requirements |
| Optional live runner, flag unset | — | SKIPPED; no provider calls |
| Optional live runner, flag enabled | — | BLOCKED: missing backend key; no provider calls |

The unchanged Starlette/AnyIO BlockingPortal deprecation warning remains (one warning). Initial browser run: 15 passed, one file-preview assertion timed out while showing Loading. The isolated scenario passed without changing its assertion or timeout; the subsequent full run passed all 16. This transient timeout is retained here rather than omitted from the QA history.

The last backend run passed all 77 after the image quota transaction change. Production build and both TypeScript checks passed; the final change after those checks was backend-only. Existing tests were preserved and browser scenarios were extended with recording timer, codec failure, no automatic transcript sending and admin feature availability checks.

## Provider architecture and model mapping

Source audit confirms Web/Mobile → UVMS API → backend gateway → configured provider. No direct provider endpoint calls or provider API-key references were found in application client source. Provider IDs are private configuration/admin data; ordinary model selection uses UVMS aliases. Authentication and ownership checks remain enforced by the backend.

| UVMS function | Default mapping in code | Actual verification |
| --- | --- | --- |
| UVMS-1 Fast | gpt-5.6; optional reasoning field omitted | Demo/API coverage and mocked Responses adapter; **not live** |
| UVMS-1 Balanced | gpt-5.6; medium reasoning | Demo/API coverage and mocked Responses adapter; **not live** |
| UVMS-1 Deep | gpt-5.6; high reasoning, Plus or higher | Plan/access checks and adapter behavior; **not live** |
| Image generation | gpt-image-2 | Mocked byte response and demo browser flow; **not live** |
| Transcription | gpt-4o-mini-transcribe | Mocked multipart adapter and fake-device browser flow; **not live** |

These existing defaults were preserved. Each text alias can be overridden independently on the backend. Nonblank alias environment overrides take precedence over admin database mapping; otherwise the database mapping applies, initially seeded from the default text model. Confirm actual model access and supported reasoning settings with the target provider before live acceptance.

Provider modes are explicit demo, auto, OpenAI and an OpenAI-compatible adapter. Compatible services must implement the Responses streaming contract and any enabled media endpoints; Chat Completions compatibility alone is insufficient. Explicit live configuration cannot silently become demo after an upstream failure.

The adapter uses the documented [Responses streaming events](https://developers.openai.com/api/docs/guides/streaming-responses), [inline vision inputs](https://developers.openai.com/api/docs/guides/images-vision), [image generation](https://developers.openai.com/api/docs/guides/image-generation) and [speech-to-text multipart interface](https://developers.openai.com/api/docs/guides/speech-to-text). Documentation review establishes the intended contract, not successful calls using this account.

## Failures found and fixes

- Streaming now requires a completion event. Malformed JSON, failed/incomplete responses, socket interruption and a missing final event fail safely instead of becoming successful partial answers. Events are consumed progressively. Stop can interrupt waiting for the first token and closes the available upstream response; no blank assistant is persisted.
- Context now has a configurable total budget, output reserve, trusted instructions, bounded project/memory/document context and a contiguous recent conversation suffix. Large current prompts are rejected before acceptance or quota charging. Document shortening is marked. The estimate uses UTF-8 bytes and a conservative low-detail image allowance, not a model-specific tokenizer.
- Vision now sends decoded image pixels as normalized inline data. PNG/JPEG/WEBP fixtures verify real pixel content, multi-image payloads and vision-disabled rejection. Image verification enforces size/dimensions and rejects invalid/animated input. EXIF metadata is removed and the image is resized. Sending private storage URLs is avoided.
- Search exposes searching, reading and completed phases. Unsafe/malformed citation URLs are rejected. No-result responses have no invented citations. A failed search can retry plain generation once, only before text starts and excluding authentication/rate/configuration failures. Failed-attempt citations are cleared from fallback results.
- Added private provider accounting, safe failures and admin aggregates. Missing usage or rates is unknown, not a fabricated zero. Successful upstream work remains recorded even if subsequent local image persistence fails.
- Enforced quotas on edit, regenerate and Retry as well as ordinary messages. Retrying a failed stream can reuse its accepted prompt without duplication through either completion route. Zero storage allowance now actually blocks uploads. Quota checks are serialized; image quota units commit with the image/message, closing a gap between persistence and usage accounting.
- Added database-backed admin availability controls for search/images/voice, alongside existing model controls. Direct requests cannot bypass disabled features, model access or configured plan limits. Client capability state refreshes on focus and periodically; no frontend redeploy is needed.
- Voice recording shows elapsed time, checks supported WebM/Opus or MP4 codecs, releases media tracks on errors/cancellation and keeps transcripts in the composer for review. Blocking provider transcription runs outside the event loop. Ogg was removed from the accepted codec path.
- Provider errors become safe UVMS messages, including distinct timeout copy. HTTPX informational logs are suppressed. Unhandled failures log the exception class and request ID without upstream response bodies or sensitive database parameters.
- Isolated Playwright output into `.next-e2e`, separate from the running preview and production build output.

## Exercised coverage and its limits

| Area | Actually exercised | Still requires live acceptance |
| --- | --- | --- |
| Text and context | Progressive HTTP response fixtures; Unicode/Cyrillic/Uzbek/English and Markdown/code payloads; project, memory and document assembly; long-context regression | Response quality in all languages, genuine multi-turn/project/memory understanding for each alias |
| Stream and history | Stop-before-first-token fixture; demo Stop in Chrome; failed partial discard; accepted-message Retry; edit/regenerate rollback; duplicate retry rejection | Real network chunk timing and Stop against a running remote generation |
| Search | Mock tool phases, real-safe versus malicious citation URLs, no sources, upstream failure and bounded fallback | Fresh real sources and live search quality/latency |
| Vision | Actual PNG/JPEG/WEBP decoding, normalized pixels, invalid input, limits, multiple images | Real model understanding of image plus text |
| Images | Mock base64 response, refusal of remote URL-only response, demo generation state/storage/download; timeout/malformed/500 fixtures; local storage failure accounting | Genuine generated output, real provider charges and persistence after a paid call |
| Speech | Chrome fake audio device, MediaRecorder timer/start/stop/cancel, multipart upload path, mocked returned transcript, unsupported codec/permission errors, API size validation and timeout fixtures | Physical browser microphone, real WebM/Opus and provider transcription accuracy in Russian/Uzbek/English |
| Failures | Mock 401/403/429/500/502, network errors, timeout and malformed/incomplete Responses/media responses | Account-specific provider quota/key/access behavior |
| Plans/admin | Backend direct-API bypass attempts, zero quotas/storage, model restrictions; browser admin changes and ordinary-user denial | Quotas and operational costs reconciled against paid real usage |

The browser suite runs installed Chrome headlessly against actual Next.js and FastAPI, with deterministic demo AI and explicit failure/transcription fixtures. Mobile received TypeScript verification, not physical-device live AI QA. No external live feature passed during this session.

## Usage and cost accounting

Private `UsageEvent` records of kind `provider.request` store provider, UVMS model, upstream model, input/output/total tokens when returned, estimated USD cost, duration, first-token time when observed, status, user/chat/request identifiers, plan, operation, safe error code, attempt count and usage completeness. Ordinary chat responses do not expose these private fields. Admin views show UTC requests/tokens/known cost today, cost by model, usage by plan and top users by reported tokens, with explicit unknown counts.

The regression fixture returns 100 input and 20 output tokens. Artificial test rates of USD 2/8 per million produce **USD 0.00036**, checked in the persisted record and admin endpoint. These are test rates, not market prices or actual spending. Missing pricing and missing usage remain unknown. Search fees require a configured rate; fallback attempts are conservatively incomplete if any attempt lacks usage. One UVMS operation counts as one request even when its fallback makes two upstream attempts.

Supported configured estimates use input/output per-million rates and optional search, image or audio-second rates. They are estimates, not invoices: cached-input discounts, multimodal token categories, quality/size tiers and provider-specific billing rules are not modeled separately. Operators must set appropriate rates and reconcile real invoices. Failed/cancelled work may still be billed externally.

**Average observed live first-token latency: not measured (no key, no live calls).** Fixture timing only verifies instrumentation and progressive consumption; it is not a performance result. After actual live requests, the admin aggregate and optional smoke artifact expose observed gateway timings.

## Environment variables (names only)

Existing backend database/auth/storage configuration remains required as before. Provider configuration is documented in [.env.example](.env.example); no credentials were added to it or printed.

| Purpose | Names |
| --- | --- |
| Provider and authentication | `UVMS_AI_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `UVMS_REQUIRE_LIVE_AI` |
| Models | `OPENAI_MODEL`, `UVMS_MODEL_FAST`, `UVMS_MODEL_BALANCED`, `UVMS_MODEL_DEEP`, `OPENAI_IMAGE_MODEL`, `OPENAI_TRANSCRIPTION_MODEL` |
| Context and timeout bounds | `UVMS_CONTEXT_TOKENS`, `UVMS_OUTPUT_TOKENS`, `UVMS_PROVIDER_TIMEOUT_SECONDS`, `UVMS_IMAGE_TIMEOUT_SECONDS` |
| Vision/files/audio | `UVMS_VISION_MAX_IMAGES`, `UVMS_VISION_MAX_PIXELS`, `UVMS_MAX_UPLOAD_MB`, `UVMS_MAX_AUDIO_MB`, `UVMS_MAX_EXTRACTED_TEXT_CHARS` |
| Accounting | `UVMS_PROVIDER_PRICES_JSON` |
| Initial feature availability | `UVMS_SEARCH_ENABLED`, `UVMS_IMAGES_ENABLED`, `UVMS_VOICE_ENABLED` |
| Opt-in live runner | `UVMS_LIVE_PROVIDER_TESTS` |

Feature environment settings are defaults; database overrides persist after admin changes. The live runner gate is read from the process environment, so enable it explicitly in the shell. Store the provider key locally in backend configuration; do not send it in chat.

## Commands run

PowerShell; paths relative to this repository. Logging redirection is omitted where it does not affect the test command. Tests use isolated databases; normal CI makes no paid AI calls.

```powershell
# services/api
..\..\.venv\Scripts\python.exe -m pytest -q
..\..\.venv\Scripts\python.exe -m compileall -q app migrations ../../ops/live_provider_smoke.py

# apps/web
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run test:e2e -- --grep 'chat lifecycle'
npm.cmd run test:e2e -- --grep 'attachments, demo image|late transcription'

# apps/mobile
npx.cmd tsc --noEmit

# repository root
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe -m compileall -q services/api/app services/api/migrations ops/live_provider_smoke.py
.\.venv\Scripts\python.exe ops/live_provider_smoke.py
$env:UVMS_LIVE_PROVIDER_TESTS='1'
.\.venv\Scripts\python.exe ops/live_provider_smoke.py --extended --vision --search --images
```

Clean migration check from `services/api`:

```powershell
$env:UVMS_DATABASE_URL='sqlite:///'+((Join-Path (Resolve-Path ../..).Path ('.qa/live-migration-'+[guid]::NewGuid().ToString('N')+'.db')).Replace('\','/'))
..\..\.venv\Scripts\python.exe -m alembic upgrade c64f1f9a1a10
..\..\.venv\Scripts\python.exe -m alembic upgrade head
..\..\.venv\Scripts\python.exe -m alembic current
```

The same new migration was applied to the local preview database after making a SQLite backup in ignored `.qa/`. The preview API was restarted on 8002; `/live` and Web at `http://localhost:3001` returned HTTP 200. The other checkout on ports 3000/8000 was not changed. No deployment or publication was performed.

Evidence logs: `.qa/provider-tests-final.log`, `.qa/live-e2e-final.log`, `.qa/live-e2e-lifecycle.log`, `.qa/live-e2e-image-final.log`, `.qa/live-web-build.log`. These local ignored files, database backups and browser artifacts can contain private test/account identifiers and are not public deliverables.

## Remaining acceptance work

1. Configure a valid backend key, provider model access and verified pricing. Run the opt-in smoke tests. It uses disposable users/storage and small generated prompts, with optional longer context/media cases. Inspect actual returned content; transport success alone does not establish answer quality.
2. Exercise real browser streaming, first-token timing, Stop, Retry and edit/regenerate for all three aliases. Verify context behavior with real responses. The smoke runner records gateway timing; its buffered API test client does not establish browser arrival latency.
3. Exercise real search and vision, genuine image persistence/private downloads and provider invoice/usage reconciliation. Image upstream cancellation is not implemented or advertised; the UI displays a disabled generating state.
4. Record actual microphone audio in Russian, Uzbek and English through the browser and confirm transcript accuracy and composer review. `--audio PATH` can test a supplied recording through the API, but is not a substitute for physical browser microphone QA.
5. Validate the configured context reserve with the selected provider/model. The conservative estimator intentionally omits older content and reduces image detail. PostgreSQL concurrency, Redis multiworker cancellation and production reverse-proxy streaming were not exercised in this SQLite/local pass.

External content disclosure and logging details are documented in [AI_PROVIDER_PRIVACY.md](docs/AI_PROVIDER_PRIVACY.md). Stage 1.1 remains open until the required live and physical-microphone checks have actual evidence.
