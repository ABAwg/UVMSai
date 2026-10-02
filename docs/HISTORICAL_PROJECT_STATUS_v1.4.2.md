# Historical snapshot — superseded by v1.4.3 Public Beta

# UVMS AI — Production Candidate

## Groq quality repair — current saved state, 2026-09-30

**v1.4.2 unchanged; public release gate FAIL / BLOCKED.** Qwen routing for Uzbek/coding and private Vision evidence are implemented. UZ naturalness still failed; two revised requests exhausted 4096 reasoning tokens; coding high-effort probe hit real output quota (**1000 OTPM, expected 4096**). Five new provider attempts, **2 quota errors /0×5xx**. No further live calls after the captured hard limit; no provider/key substitution.

**Vision DISABLED FOR LAUNCH** in backend/Web/Mobile; document attachment remains available. **58 targeted backend PASS**, Web/Mobile TypeScript PASS, compile/pip PASS, **1 targeted browser PASS**. Full regression and remaining live acceptance are not complete. No patch bump. **UVMS-AI-v1.4.2-groq-quality-candidate.zip** is a clean source handoff, not a certified production release. [Current QA report](UVMS_AI_FINAL_LIVE_QA_REPORT.md), [evidence](docs/qa-evidence/groq-quality/summary.json). Required external change: adequate output quota for required Qwen high reasoning on the existing Groq account; remaining quality fixes/tests are internal work.

## Groq live acceptance — 2026-09-30

**База 1.4.2; Groq LIVE / GPT-OSS strict quality: FAIL.** Реальные READY backend/browser PASS. Provider groq; text openai/gpt-oss-120b, Vision qwen/qwen3.8-27b, transcription whisper-large-v3-turbo. 22 actual requests, все HTTP200, без 429/5xx. UZ, React code и Vision провалили проверку качества; API 200 не превращён в PASS.

RU technical, Python tests, Integral/Bayes/Physics, files, four charts, Projects/Memory, progressive SSE, Stop/Retry/Regenerate, reload/history, two tabs и Whisper прошли в указанном scope. Один malformed model LaTeX block показан через safe fallback. Ключ backend-only, fallback отсутствует. [Полный отчёт](UVMS_AI_FINAL_LIVE_QA_REPORT.md), [evidence](docs/qa-evidence/groq-live/summary.json), [Groq configuration](docs/GROQ_PROVIDER.md).

По условию пользователя regression/release gates не открыты: **нет нового full regression, patch bump или final ZIP**. Старый baseline 155 backend / 16 Web / 25 E2E относится к состоянию до Groq. Ниже сохранена история; предыдущие Gemini/OpenRouter ZIP не являются Groq release.

## Gemini live QA candidate — 2026-09-30

База **1.4.2**, без patch bump: **Gemini LIVE acceptance FAIL / remaining BLOCKED**. Реальный ключ загружен backend; Gemini `gemini-3.8-flash` вернул READY в браузере и отдельно с low/medium/high. React/TypeScript, progressive SSE (35 DOM updates), Memory, reload/history и Admin diagnostic прошли. Остальные задачи получили 503/обрыв stream либо не были выполнены после реального 429. Production-ready не заявляется; OpenRouter Free не используется как fallback и не является production-моделью.

Исправлен учёт thinking tokens в Gemini output usage. **Текущий affected backend: 29 PASS** (2 новых tests); compile/pip check PASS. Сохранённый полный baseline: **155 backend / 16 Web unit / 25 E2E**, Web/Mobile TS/build/exports, Expo 21/21. Полный regression без необходимости не повторялся.

Результаты: [FINAL LIVE QA REPORT](UVMS_AI_FINAL_LIVE_QA_REPORT.md), [evidence и release gates](docs/qa-evidence/gemini-live/summary.json), [настройка](docs/GEMINI_PROVIDER.md). Новый snapshot: **UVMS-AI-v1.4.2-gemini-live-qa-candidate.zip**. Внешний blocker — квота/доступность Gemini; ключ и модель уже подтверждены. Ниже сохранена история предыдущего v1.4.2 релиза.

## v1.4.2 — Final Live QA · 2026-09-28

Текущая версия: **1.4.2**. Backend **126/126**, Web unit **16/16**, browser E2E **23/23**, Mobile SSE **2/2**, Expo Doctor **21/21**. Web build/TypeScript, mobile typecheck/exports, PostgreSQL и SQLite migrations, Docker staging проверены.

**CODE/LOCAL PRODUCTION READY:** технический release candidate в проверенном scope. **EXTERNAL CERTIFICATION REMAINING; PHYSICAL DEVICE QA REQUIRED.** Бесплатный OpenRouter — только development QA route, не production-модель. Live quality остаётся PARTIAL: были timeouts, safety-classifier output, ошибки кода и плохой UZ.

Integral/Bayes: **provider limitation**; приложение завершает ожидание читаемой ошибкой и предлагает Retry. Успешное live-решение этой задачи не подтверждено. Повторять уже пройденные локальные тесты для этого не требуется.

Полные актуальные результаты: [UVMS AI FINAL LIVE QA REPORT](UVMS_AI_FINAL_LIVE_QA_REPORT.md). Ниже сохранена история предыдущих проходов; старые counts и ограничения окружения не описывают текущую проверку.

## v1.4.0 Production Release Candidate — 2026-09-23

v1.4.0 continues directly from v1.3.0 and tightens the final code-level production boundary. Real production no longer permits an implicit demo AI fallback; demo billing is rejected and a safe `disabled` billing mode keeps the product usable without exposing broken upgrade actions. Request sizes are bounded before application processing, production origin/URL validation is stricter, request IDs are sanitized, API responses are explicitly non-cacheable, and provider failures have safer user-facing messages. Web/Mobile receive truthful billing capability state. Release metadata is synchronized to 1.4.0 and the backend suite now passes **111 tests**.

The codebase is now a **production release candidate**, but external certification still cannot be truthfully manufactured inside this sandbox: final HTTPS/domain, real provider credentials and live paid feature acceptance, SMTP/S3 if enabled, physical iPhone/Android, server load evidence, and legal/payment certification require the actual target environment. Paid subscriptions are intentionally safe-disabled until a real payment adapter is selected and implemented.

## v1.3.0 Production Hardening — 2026-09-22

This release hardens the real v1.2.0 codebase instead of creating a parallel overlay. Production startup now uses PostgreSQL + Redis as mandatory shared infrastructure, validates HTTPS/CORS/trusted-host/cookie/metrics requirements, safely handles special characters in PostgreSQL credentials, runs Alembic and reference seeding once before starting multiple Uvicorn workers, and runs the API container without root privileges. Docker healthchecks now gate Redis → API → Web/Nginx startup and the backend network is internal.

Nginx now explicitly proxies protected `/metrics`, replaces client-supplied forwarding chains at the public ingress, disables cache/buffering/gzip for API SSE and removes `unsafe-eval` from the production CSP. HTTP counters aggregate through Redis across workers with a process-local fallback. PostgreSQL backup/restore now respects custom Compose DB values, validates custom-format dumps, writes SHA-256 evidence, requires an explicit restore gate, creates a pre-restore backup by default, and restores with public/application services stopped.

New operations tools: `ops/production_preflight.py`, `ops/load_probe.py`, `ops/sse_probe.py`, strengthened `ops/smoke_test.py`, and CI production-config validation. Incoming backend baseline was **99 tests**; the v1.3 handoff is **109 tests passed**. Web API/session remains **7/7**. Full npm install/build and physical-device acceptance remain target-environment gates because registry/device access is not available in this sandbox.

This is still not final commercial certification: physical iPhone/Android, final HTTPS domain, live paid Search/Image/Voice/provider cost reconciliation, SMTP/S3 production credentials, load thresholds on the chosen server, legal text and real payment webhooks must still receive actual evidence before the final production sign-off.

## v1.2.0 Mobile Experience — 2026-09-21

This release focuses on the real iPhone experience instead of adding another parallel feature layer. The backend now correctly resolves `UVMS_AI_PROVIDER=auto` to OpenRouter in development when only `OPENROUTER_API_KEY` is configured, fixing the observed Mobile demo-response issue while keeping keys backend-only. Mobile received a compact chat header, provider state, cleaner document-style assistant answers, a new `+` action sheet, long-press message actions, branch/regenerate/share flows, native tactile feedback and a dependency-free Markdown renderer for common rich-answer structures. Existing streaming/Stop/Retry, vision upload, Projects, Memory, Library, Temporary Chat and shared-link behavior remains intact.

Current handoff verification: **99 backend tests passed**, Python compile passed, a clean Alembic database reached `e2c7c0d4a4b1` and `alembic check` reports no pending operations. Mobile TypeScript passed; iOS and Android production Hermes exports and development exports passed on the SDK 57 code. Web API/session tests are **7/7** and Web TypeScript passed. The Web production build cannot be certified inside this Linux sandbox because the user's Windows `node_modules` contains only the Windows Next.js SWC binary and the sandbox cannot reach npm to download the Linux binary. The target Windows `QUICK_SETUP_WINDOWS.bat` remains the final Web build gate. See `V1_2_RELEASE_REPORT.md`.

Physical v1.2 acceptance remains intentionally open. The supplied SDK 57 base had already opened on the user's physical iPhone, but the new v1.2 UI/provider changes must be tested as one final build rather than inferred from bundle success.

## v1.1.0 Conversation Power — 2026-09-19

Large conversation-management release implemented on top of the stabilized v1.0.3 runtime. Added pinned conversations, hidden/expiring Temporary Chat, conversation branching (including branch-from-message), immutable public share snapshots with SHA-256 token storage, authenticated share-management APIs, Web/Mobile share control surfaces, Markdown/JSON conversation export and mobile share-sheet support. Shared snapshots contain message text and safe attachment metadata only; they do not expose private authenticated file URLs. Temporary chats deliberately bypass Memory/Projects and never appear in normal history.

Verification in this handoff: **98 backend tests passed**, Python compile passed and a clean SQLite Alembic upgrade reached `e2c7c0d4a4b1`. The new conversation-power regression file covers pin sorting/archive behavior, Temporary Chat hiding/expiry/share prohibition, non-destructive branching, immutable/revocable public snapshots, global owner-scoped share management and Markdown export. Full npm dependency installation is not available in this build container, so final Web/Mobile TypeScript/production build remains a required `QUICK_SETUP_WINDOWS.bat` gate on the target Windows checkout.

## v1.0.3 runtime isolation hotfix — 2026-09-19

A live screenshot showed `localhost:3000` serving an older checkout: the UI still displayed `Library NEXT` and raw `{detail: Invalid or expired token}` errors that are absent from the stabilized source. The Windows launcher now isolates the current checkout (default Web 3001 / API 8002, with automatic free-port fallback), opens the actual selected URL, injects the matching proxy/CORS origin, records its wrapper PIDs in `.uvms-runtime.json`, and ships `QUICK_STOP_WINDOWS.bat`. Web visibly marks **v1.0.3** so stale instances are obvious. No auth/security behavior was weakened.

## Stage 1.2 mobile-ready handoff — 2026-09-18

The current source is **v1.0.2-stage1-mobile-ready**. The Expo client now uses the real backend streaming endpoint, supports progressive deltas, Stop/Retry, plan-backed model selection, shared Library, richer Project/Memory/Account flows, camera/gallery/document attachments, native recording UX and foreground/network recovery. `QUICK_RUN_MOBILE_WINDOWS.bat` detects the PC LAN address and starts Expo in LAN mode without hardcoding a developer IP.

After these changes: backend **92 tests passed**, Python compile passed, Mobile TypeScript passed, and Expo/Metro export bundles passed for both Android and iOS. Physical iPhone/Android certification remains open because this build environment cannot exercise real device permissions, LAN/firewall behavior, background lifecycle or camera/microphone hardware. See `docs/MOBILE_PHYSICAL_QA.md` and `MOBILE_PHYSICAL_QA_REPORT.md`.

The existing OpenRouter development boundary is unchanged: live text/streaming and vision are suitable for demo QA; Search is disabled and generated images/transcription remain explicit demo behavior.

## OpenRouter development mode — 2026-09-18

Temporary free routing has real OpenRouter evidence for all three aliases in the isolated API smoke, Fast/Balanced browser streaming, PNG/JPEG understanding, continuity, Retry and active Stop accounting. Deep remains locked on the browser QA Free plan. Router quality is variable; unusable safety-classifier answers and a timeout were observed. Search is disabled and media remains demo. OpenAI support remains intact and its paid acceptance is incomplete. See [live results and final gates](FREE_OPENROUTER_DEV.md), [configuration](docs/OPENROUTER_DEVELOPMENT.md) and [Stage 1.1 status](LIVE_AI_QA_REPORT.md).


## Stage 1.1 provider QA — 2026-09-17

Local provider implementation and deterministic QA passed: 77 backend tests, 7 web API tests, 16 browser scenarios, web build, web/mobile TypeScript, Python compile and Alembic head `d71b2e41aa11`. Live certification remains pending: no backend provider key is configured and physical microphone QA has not been performed. See [LIVE_AI_QA_REPORT.md](LIVE_AI_QA_REPORT.md) for tested scope, evidence and remaining acceptance work.


**Historical v1.0.1 Web polish:** the first real browser launch succeeded and drove the UI/auth stabilization pass.

### v1.0.1 QA fixes
- polished desktop chat shell and composer
- fixed desktop sidebar collapse
- improved user/assistant message hierarchy
- visible runtime states (thinking/search/upload/listening)
- plan + daily usage shown from the real backend
- upgraded subscription/profile surfaces
- improved Demo Mode presentation
- responsive/mobile chat refinements


## Stage 1 Public Beta

Historical Stage 1 foundation snapshot: **v1.0.0-stage1 — Public Beta Candidate**

### Core product implemented

- One shared account across Web + iOS/Android
- Shared chats, files, projects, memory, plan and usage state
- UVMS-branded Web + Mobile UI
- UVMS-1 Fast / Balanced / Deep aliases with server-side provider routing
- Web streaming, Stop generation, edit + regenerate, regenerate, chat rename/archive/search/delete
- Web Search with persisted citations
- Image generation persisted into chat history
- Vision + image/file attachments
- PDF, DOCX, XLSX, TXT/MD/CSV/JSON/code extraction
- Projects with instructions, files and project chats
- User-managed Memory
- Free / Plus / Pro entitlements and quotas
- Provider-neutral billing foundation + local demo checkout
- Web Library
- Mobile camera/gallery/document upload
- Mobile native microphone recording + server transcription
- Mobile model selector, Projects, Memory, Plans and Account settings

### Security/account layer

- JWT access tokens + rotating refresh sessions
- **Web refresh token only in HttpOnly / SameSite cookie**; browser JS keeps only short-lived access state in sessionStorage
- Mobile refresh credentials in Expo SecureStore
- Automatic token refresh on Web/Mobile
- Browser Origin checks on cookie-backed auth routes
- Active-session list, revoke and logout-all
- Password change revokes previous sessions
- **Forgot-password flow with one-time, expiring reset token + SMTP adapter**
- Resetting password revokes every previous signed-in session
- Generic reset-request response prevents production account enumeration
- Profile edit, user-data export and permanent account deletion
- Argon2 password hashing
- Redis-aware rate limiting
- File signature/Office archive checks, bounded extraction and untrusted-document prompt hardening
- Authenticated file access; S3 objects can remain private
- Safe Markdown/citation URL handling
- Production CSP/security headers and trusted-host controls

### Production/operations layer

- PostgreSQL / SQLite persistence with Alembic migrations
- Redis-backed cross-worker generation cancellation
- Local storage + S3/R2/MinIO adapter
- Request IDs + structured JSON logs
- `/live`, `/ready`, protected optional `/metrics`
- DB / Redis / storage / AI-provider readiness checks
- Nginx + Web + API + PostgreSQL + Redis production Compose stack
- PostgreSQL backup/restore helpers
- Admin bootstrap CLI
- Admin users/plans/subscriptions/model routing/audit/stats
- Provider token accounting in admin stats
- PWA manifest + proper square UVMS icons
- Expo/EAS profiles + square/adaptive mobile icons
- One-click-ish Windows setup/run scripts
- Smoke-test, doctor and release-checklist tooling
- Public Beta Privacy / Terms pages (still require final legal review before broad paid release)

### Verified stabilization pass (2026-09-16)

- Backend: **38 tests passed** (20 baseline tests plus regression coverage)
- Python compile: **PASS**
- Clean Alembic SQLite migration: **PASS**, head `c64f1f9a1a10`
- Web TypeScript and production build: **PASS**
- Mobile TypeScript: **PASS**
- Web API/session regression suite: **7 passed**
- Chrome integration: **16 passed**, plus a final auth/logout regression rerun **1 passed**; responsive screenshots and source-control audit: see [QA_REPORT.md](QA_REPORT.md)
- Web npm dependency audit: **0 reported vulnerabilities**

The full report distinguishes actual backend/browser checks from provider fixtures and includes exact commands, defects fixed and local preview details.

### Must still be verified on the real target environment

1. Android + iPhone physical-device QA for camera/mic/SecureStore/deep links
2. Live AI chat/search/images/transcription and real microphone checks across browsers
3. Real SMTP delivery and private S3/R2 storage
4. Production PostgreSQL/Redis, multi-worker cancellation and load testing
5. Domain + HTTPS deployment
6. Production payment provider and signed webhooks before charging users
7. External log/error alerts
8. Final Privacy/Terms legal review and business/support/refund information

### Stage 1 sign-off rule

Do **not** call the build production-ready until `docs/RELEASE_CHECKLIST.md` is completed on the actual Windows/server/mobile environment. The code is a strong Public Beta candidate, but real-device and real-provider QA are still required.

### Later stages

Realtime conversational voice, Deep Research, agent/computer-use workflows, plugin marketplace, scheduled tasks, team workspaces, richer conversation branching, enterprise SSO and broader collaboration remain later stages.
