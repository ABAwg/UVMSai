# UVMS AI v1.4.1 — Live Runtime QA Hotfix

Date: 2026-09-24

## Scope

This hotfix was created after running the packaged v1.4.0 candidate as a real local HTTP service, not only through unit tests.

## Defect found and fixed

The global API cache/security middleware overwrote the chat SSE response header `Cache-Control: no-cache, no-transform` with `no-store`. This could allow an upstream reverse proxy to buffer the event stream and make live answers appear only after generation completed.

The middleware now applies its default `no-store` policy only when an endpoint has not already supplied a cache policy. A regression assertion was added to the structured SSE test.

## Runtime evidence

- Backend regression suite: 111/111 PASS after the fix.
- Alembic clean upgrade through `e2c7c0d4a4b1`: PASS.
- `/live`: HTTP 200, service version reported.
- `/ready`: HTTP 200 with database and storage ready.
- SSE probe: PASS, first event 35.9 ms, 55 delta events, terminal `done` event present.
- Load probe against `/live`: 100/100 HTTP 200, 0% errors, p95 22.4 ms in the local QA environment.
- Real HTTP account flow: register, authenticated profile, models, capabilities, plans, usage, project, memory, file upload, chat completion, chat history, public share, refresh rotation and refresh replay rejection all PASS.

The latency figures above are local QA observations, not a production SLA.

## Environment boundary

The live HTTP run used SQLite, local storage and the deterministic demo AI provider. It proves application/runtime behavior but does not certify a paid external AI provider, production PostgreSQL/Redis cluster, public HTTPS edge, physical iOS/Android devices, SMTP, S3, billing provider or production-scale traffic.

Web `npm ci` could not be completed in the execution environment because registry access timed out. This is recorded as an environment blocker rather than a PASS or product failure.
