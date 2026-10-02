# Historical snapshot — superseded by v1.4.3 Public Beta

# UVMS AI

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

## Historical v1.4.0 — Production Release Candidate

v1.4.0 is the hardened release candidate built on v1.3. It removes the last avoidable “looks production but silently falls back” behaviors: a production deployment now requires a real AI provider unless an explicit staging override is used, demo billing is rejected, safe free-only billing can be selected with `UVMS_BILLING_PROVIDER=disabled`, oversized requests are rejected before application work, API responses are non-cacheable, and Web/Mobile receive truthful billing capability state.

Verified in this handoff: **111 backend tests passed**, Python compile passed, **7 Web API/session tests passed**, production preflight passed on a synthetic safe configuration, shell backup/restore scripts parse, and the release self-verifier passes. Full clean Web/Mobile npm installation remains blocked in this sandbox by registry access and must be rerun on the target machine/CI; this is documented rather than reported as a false PASS. See [`V1_4_RELEASE_REPORT.md`](V1_4_RELEASE_REPORT.md).

### v1.4 production invariants

- no silent demo AI in production;
- no demo payment path in production;
- paid-plan buttons are disabled when billing is intentionally disabled;
- request envelope is bounded independently of per-file quota;
- exact HTTPS origins and clean public URL are required;
- request IDs are sanitized before structured logging;
- API data receives `Cache-Control: no-store` and `X-Frame-Options: DENY`;
- release archive is checked for generated/private files and common provider-secret patterns.

## v1.3.0 — Production Hardening

v1.3.0 hardens the existing v1.2 product for a real single-server production deployment without replacing the Web/Mobile feature set. The release fixes multi-worker startup and observability, strengthens production configuration validation, makes the API container non-root, adds service health ordering, protects reverse-proxy client IP handling, repairs PostgreSQL backup/restore behavior with custom credentials, and adds production preflight/load/SSE verification tools.

Verification in this handoff: **109 backend tests passed** (99 incoming + 10 production-hardening checks), Python compile passed and existing Web API/session tests remain **7/7**. Full Web/Mobile dependency install is environment-blocked in this sandbox by registry access, so final Web production build and Mobile TypeScript/physical-device checks remain target-machine gates rather than falsely reported PASS. See [`V1_3_RELEASE_REPORT.md`](V1_3_RELEASE_REPORT.md).

### v1.3 production highlights

- production rejects SQLite, missing Redis, HTTP public origins, insecure refresh cookies and weak/missing metrics token;
- PostgreSQL URLs are built safely from credentials, including passwords containing URL-special characters;
- migrations and reference seeding run once before the Uvicorn multi-worker pool starts;
- API container runs as unprivileged UID/GID 10001;
- Redis/API/Web/Nginx healthchecks gate startup order;
- backend network is internal; only Nginx exposes a host port;
- Nginx now routes `/metrics` correctly, prevents spoofed forwarding chains and explicitly disables SSE buffering/cache/gzip;
- request counters aggregate through Redis across workers, with process-local fallback;
- backup archives are validated before publication; restore requires an explicit destructive-action gate and creates a pre-restore backup by default;
- production preflight, smoke, load and SSE probes are included in `ops/`;
- CI validates production config/Compose, builds the production API image and uses reproducible `npm ci`.

## v1.2.0 — Mobile Experience

v1.2.0 is the first release focused on making the physical iPhone client feel like a real UVMS product rather than a technical preview. It keeps the v1.1 Conversation Power feature set, upgrades the current Mobile baseline to Expo SDK 57 / React Native 0.86 / React 19.2, fixes OpenRouter auto-provider selection, and substantially cleans up the Mobile chat UI, Markdown presentation, composer/actions and provider visibility.

**Important fix:** in development, `UVMS_AI_PROVIDER=auto` now uses OpenRouter when `OPENROUTER_API_KEY` is the only configured AI key. This fixes the observed case where Mobile reached the backend correctly but still received the built-in demo answer. Provider keys remain backend-only.

Verification for this handoff: **99 backend tests**, Python compile, clean Alembic upgrade/current/check, **7 Web API/session tests**, Web + Mobile TypeScript, and iOS/Android production + development Expo exports passed. The Linux handoff container cannot complete the Next production build because the source archive contains a Windows SWC binary and npm registry access is unavailable; run `QUICK_SETUP_WINDOWS.bat` on the target Windows checkout for that final gate. Full details: [`V1_2_RELEASE_REPORT.md`](V1_2_RELEASE_REPORT.md).

### v1.2 Mobile highlights

- compact chat header with live/demo provider state and model selector;
- clean document-style assistant answers instead of oversized cards;
- common Markdown rendered natively instead of showing raw `**markers**`;
- compact `+` action sheet for photo, camera, file, Library and capability actions;
- long-press message actions for Share, Regenerate, Branch from here and reuse-as-draft;
- responsive press feedback and tighter spacing/touch targets;
- existing real SSE streaming, Stop/Retry, camera/gallery/file attachments, Projects, Memory, Library, Temporary Chat and Shared Links preserved;
- About/version surfaces synchronized to **1.2.0**.

## v1.1.0 — Conversation Power

This release is a large conversation/workflow upgrade on top of the stabilized Stage 1 foundation. Web and Mobile now include **pinned chats, Temporary Chat, conversation branching, immutable public share snapshots, share revocation/management and conversation export**. Temporary chats are hidden from history, skip Memory/Project context and expire automatically. Public share bearer tokens are stored only as SHA-256 digests; the database never stores the recoverable public URL.

Backend verification for this release: **98 tests passed**, Python compile passed, and a clean Alembic database upgraded to head `e2c7c0d4a4b1`. Frontend source was statically parsed in this build environment; the final Windows setup script remains the authoritative full Web/Mobile dependency/type/build gate because this container cannot complete npm dependency download reliably.

### Headline additions

- Pin/unpin chats with a dedicated Pinned section on Web and long-press pinning on Mobile.
- Temporary Chat with 24-hour expiry, no history listing, no Memory and no Project context.
- Branch an entire conversation or branch from a specific message without mutating the source chat.
- Create immutable public read-only conversation snapshots.
- Dedicated **Shared links** control center on Web and Mobile to review/revoke snapshots.
- Share tokens are hashed at rest and cannot be recovered from list APIs.
- Export conversations as Markdown; JSON export remains available through the authenticated API.
- Mobile native share sheet for newly created public links.
- Runtime-isolated Windows launchers from v1.0.3 are preserved.

**v1.0.3 runtime isolation:** the Windows launcher now avoids stale checkouts on 3000/8000, opens the current build on isolated ports (normally 3001/8002), and includes `QUICK_STOP_WINDOWS.bat`.

Latest verified Web/backend/OpenRouter baseline (2026-09-18): **92 backend tests**, **18 browser E2E**, **7 Web API/session tests**, Web production build, Web/Mobile TypeScript, Python compile and Alembic passed. Details and the development-provider limitations are documented in [FREE_OPENROUTER_DEV.md](FREE_OPENROUTER_DEV.md).

**Stage 1 / Production Candidate — v1.4.2**

UVMS AI is a unified AI assistant for **Web + iOS/Android**. One account owns the same chats, files, projects, memory, plan and usage state everywhere. The interface follows the supplied UVMS green/cyan brand system.

## Fastest Windows start

If this is your first run, you do **not** need any older ZIP.

1. Extract this folder.
2. Double-click **`QUICK_SETUP_WINDOWS.bat`** once. It creates a local `.env`, generates a JWT secret, installs dependencies, runs backend tests/migrations and verifies the Web build.
3. Double-click **`QUICK_RUN_WINDOWS.bat`**. The launcher opens the exact runtime URL for this checkout (normally `http://localhost:3001`; it automatically chooses free ports if needed).
4. For free development AI, configure `UVMS_AI_PROVIDER=openrouter` plus a local `OPENROUTER_API_KEY`; for OpenAI acceptance use the existing OpenAI variables. Provider keys belong only in root `.env`, never in Web/Mobile variables.

Русская инструкция: **`START_HERE_RU.md`**. Full instructions: **`docs/RUN_WINDOWS.md`**.

## Stage 1.2 mobile-ready handoff

The Mobile client is now prepared for physical-device QA instead of relying on the earlier non-streaming completion path. Notable changes:

- real `/chat/stream` SSE consumption on Expo/React Native;
- progressive deltas, Stop and accepted-message Retry;
- foreground capability/session refresh and safer network errors;
- server-backed model availability/plan locks;
- camera/gallery/document attachments plus shared Library;
- project detail editing, project files/chats and Memory controls;
- native recording start/timer/stop/cancel UX;
- LAN-aware diagnostics and `QUICK_RUN_MOBILE_WINDOWS.bat`;
- no provider secrets or developer LAN IP hardcoded into the app.

Local handoff checks pass: **92 backend tests**, Python compile, Mobile TypeScript, an SSE parser smoke and Expo/Metro export bundles for both Android and iOS. Physical evidence is still required. Use [`docs/MOBILE_PHYSICAL_QA.md`](docs/MOBILE_PHYSICAL_QA.md) and record results in [`MOBILE_PHYSICAL_QA_REPORT.md`](MOBILE_PHYSICAL_QA_REPORT.md).

## Stage 1 feature set

### AI + chat

- UVMS-1 Fast / Balanced / Deep model aliases
- Streaming Web responses + reliable Stop generation
- Chat history, rename, archive, search and delete
- Edit + regenerate / regenerate answer
- Safe Markdown basics + fenced code blocks with copy on Web
- Web Search with persisted citations
- Vision/image attachments
- Image generation saved to the conversation
- DEMO AI mode for local product testing

### Files, Projects and Memory

- Images, PDF, DOCX, XLSX, TXT, MD, CSV, JSON and code uploads
- Extracted document context with safety/size bounds
- Web Library
- Projects with instructions, files and chats
- User-managed Memory
- Local or S3/R2/MinIO object storage

### Web + Mobile account security

- Rotating refresh sessions
- Web refresh token in **HttpOnly cookie**, not browser localStorage
- Mobile credentials in **Expo SecureStore**
- Automatic access-token refresh
- Session list/revoke/logout-all
- Password change
- One-time password-reset links with SMTP production delivery
- JSON data export
- Permanent account deletion

### Mobile

- Shared chats/account
- Model selection
- plan/capability-aware Search and image controls
- Camera, gallery and document upload
- Native voice recording UX → server transcription when the selected provider supports it
- Projects / Memory / Plans
- Profile/password/sessions/delete-account settings

### Plans + admin

- Free / Plus / Pro entitlements and quotas
- Shared plan state across Web/Mobile
- Provider-neutral checkout model; local `demo` provider only for testing
- Admin users, plans, subscriptions, model routing, audit and usage/provider-token stats

### Operations

- FastAPI + PostgreSQL/SQLite + Redis
- Alembic
- Rate limiting
- Structured request logs + request IDs
- Liveness/readiness + protected metrics
- Nginx + production Docker Compose
- S3-compatible storage
- PostgreSQL backup/restore
- Windows setup/run scripts
- Smoke test + release checklist
- PWA/mobile production icon assets

## Repository map

```text
UVMS-AI-v1.4.2-live-qa/
├─ apps/
│  ├─ web/                 # Next.js Web + Admin + Billing + Settings
│  └─ mobile/              # Expo / React Native
├─ services/
│  └─ api/                 # FastAPI + SQLAlchemy + Alembic
├─ packages/design-tokens/
├─ deploy/nginx/
├─ ops/                    # setup/run/backup/restore/doctor/smoke
├─ brand/
├─ docs/
├─ docker-compose.yml
├─ docker-compose.prod.yml
└─ .env.example
```

## Verified snapshot

Latest incoming regression baseline before this mobile handoff: **92 backend tests**, **18 browser E2E**, **7 Web API/session tests**, Web production build, Web/Mobile TypeScript, Python compile and Alembic all passed during the OpenRouter live QA workspace. See `FREE_OPENROUTER_DEV.md` for that evidence.

This handoff additionally upgrades the Mobile client for real SSE streaming, Stop/Retry, Library, richer Projects/Memory/Account flows and physical-phone LAN startup. Mobile TypeScript was rerun after these changes and passes. Physical iPhone/Android behavior is intentionally **not** claimed until it is exercised on the target devices.

## Live AI

Root `.env`:

```env
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.6
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

## Password recovery in production

Local development shows a debug reset link when SMTP is absent. Production never exposes reset tokens and requires SMTP when password reset is enabled:

```env
UVMS_PASSWORD_RESET_ENABLED=true
UVMS_SMTP_HOST=smtp.example.com
UVMS_SMTP_PORT=587
UVMS_SMTP_USERNAME=...
UVMS_SMTP_PASSWORD=...
UVMS_SMTP_FROM=UVMS AI <no-reply@example.com>
UVMS_SMTP_STARTTLS=true
```

## Production

Stage 1.1 provider implementation and QA are documented in [LIVE_AI_QA_REPORT.md](LIVE_AI_QA_REPORT.md). OpenAI acceptance remains incomplete because live generation was rejected for exhausted credits. Temporary [OpenRouter free development mode](docs/OPENROUTER_DEVELOPMENT.md) now has real text, browser streaming and PNG/JPEG vision evidence; variable answer quality and remaining limits are recorded in [FREE_OPENROUTER_DEV.md](FREE_OPENROUTER_DEV.md). See [AI provider data flow](docs/AI_PROVIDER_PRIVACY.md) for external content and logging details.

Read these before public deployment:

- `docs/DEPLOY_PRODUCTION.md`
- `docs/BACKUP_RECOVERY.md`
- `docs/RELEASE_CHECKLIST.md`

Production Web calls same-domain `/api/v1` through Nginx. Mobile uses the full HTTPS API URL from EAS environment variables. Real payments stay disabled until a real provider/webhook adapter is integrated.
