# UVMS AI 1.4.2 release report

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

Date: 2026-09-28. Patch release retaining Next.js, Expo, FastAPI, SQLAlchemy and Alembic.

- Backend 126/126, Web unit 16/16, browser E2E 23/23.
- Web TypeScript/build, Mobile TypeScript/Expo validation/iOS+Android JS exports PASS.
- Real headed Chrome live OpenRouter QA, PostgreSQL/Redis/nginx staging, safe backup/restore and graceful-stop checks completed.
- Synchronized API defaults, VERSION, Web/Mobile manifests and locks, Expo version and Compose fallback to 1.4.2.
- Details, all failed live attempts and external gates: [UVMS AI FINAL LIVE QA REPORT](UVMS_AI_FINAL_LIVE_QA_REPORT.md).
- Evidence: [summary/screenshots](docs/qa-evidence/v1.4.2/README.md).

**CODE/LOCAL PRODUCTION READY:** technical release candidate in the tested scope. **LIVE AI ACCEPTANCE: PARTIAL. EXTERNAL CERTIFICATION REMAINING. PHYSICAL DEVICE QA REQUIRED.**

No public deployment, production restore, live payment or physical-device pass is claimed. `.env`, runtime databases and browser profiles are not release artifacts.

## Provider limitation

Integral/Bayes did not produce an accepted live answer: provider error, classifier output and timeout were observed. The application ends the wait with a readable error and Retry. Free OpenRouter is a development QA route, **not a production model**.

## Package

`UVMS-AI-v1.4.2-final-live-qa.zip`, with a separate `.zip.sha256` checksum. The package excludes private environments, databases/dumps, browser profiles, caches, logs, node_modules and local `.qa` credentials. Release verifier and exact-secret scan gate package creation; results are in `docs/qa-evidence/v1.4.2/summary.json`.
