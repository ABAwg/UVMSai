# Changelog

## 1.4.3 — Public Beta — 2026-10-02

- Restricted public scope to Groq GPT-OSS-120B text and Whisper voice; Qwen/Vision/images/search/billing disabled. No provider fallback; UZ UI retained without AI certification.
- Added shared Redis daily/minute/concurrency admission, 429 cooldown, observed-quota output budgets and safe Admin rate diagnostics. Fixed Admin probe admission and unique capacity leases.
- Polished disabled capabilities, public Beta messaging and truthful password-reset availability; optional synthetic demo CLI.
- Verified production PostgreSQL/Redis and nginx HTTPS, API egress/non-root workers, persistent uploads and database+uploads backup with disposable restore.
- Updated Expo SDK57 patches; all required functional/build/regression gates passed in documented scope. Preserved initial AI failures and mobile tooling advisories.
- Release1.4.3 metadata synchronized. Clean ZIP and SHA-256 supplied; actual public deployment awaits server/SSH/domain/DNS.

## Unreleased — Groq quality routing, quota-blocked acceptance

- Route original Uzbek/programming prompts to Qwen; preserve GPT-OSS default, same Groq credential and public API. Add natural Uzbek, complete-code and grounded-Vision instructions.
- Add private structured Vision evidence and summed accounting; disable public Vision by default until factual revalidation, with Web/Mobile unavailable/Beta UI and backend enforcement.
- Add explicit local Python/strict TypeScript verification command; no automatic execution of model code on the API server.
- Preserve all five actual attempts: Uzbek language failure, two reasoning-token exhaustion failures, two real quota errors. Hard Qwen output quota 1000 OTPM blocks high-effort acceptance. No 5xx and no further provider calls after captured quota.
- 58 targeted backend checks, Web/Mobile TypeScript, compile/pip, one targeted browser check pass. Full regression/quality gate remains incomplete. Base 1.4.2 unchanged; clean candidate source ZIP is not a final public release.


## Unreleased — Groq acceptance on v1.4.2

- Added explicit backend Groq credentials/models, official Chat Completions route, Qwen image-input routing and Whisper transcription using the existing gateway lifecycle.
- Added Groq UI/Admin/usage identity, environment-managed routing, capability restrictions, production configuration validation and Groq secret patterns.
- Completed real backend/browser READY and 22 live calls. Transport had no 429/5xx; strict UZ, React code and Vision quality failed. Preserve all failures and rate-limit snapshots.
- Regression/release gate remains closed as requested; no patch bump or final Groq ZIP. Existing Gemini/OpenRouter archives remain historical.

## Unreleased — Gemini integration on v1.4.2

- Added backend-only Gemini configuration, official Chat Completions adapter and low/medium/high alias mapping without rewriting the AI gateway.
- Preserve streaming, context/Vision, accounting and safe provider errors; expose Gemini identity, usage groups and admin-only health probe without key disclosure.
- Disabled unsupported Gemini native search/image-generation/transcription endpoints without credential or demo fallback.
- Fixed SSE disconnect cleanup ownership and serialized iterator shutdown, including disconnect before the first frame.
- Verified 155 backend, 16 Web unit and 25 browser E2E; Web/Mobile TypeScript/build/exports and Expo checks pass.
- Real Gemini READY passed with low/medium/high; React quality, progressive DOM, Memory and reload/history passed. Overall acceptance failed/blocked: upstream 503, interrupted Vision stream and one real 429. No further provider calls after quota, no fallback and no production certification/version bump.
- Corrected Gemini billable output accounting to include thinking tokens from consistent total minus prompt usage. Added two regressions; affected provider suite 29 PASS. Historical QA accounting is retained.
- Updated live report/status/release evidence and created a clean v1.4.2 Gemini live QA candidate. Final secret scan includes the actual private Gemini key value without outputting it. OpenRouter Integral/Bayes timeouts remain historical provider limitations.


## 1.4.2 — Final live QA and reliability

- Fixed Windows occupied-port detection and version reporting; isolated dev/E2E/build artifacts.
- Hardened Send/Stop, request deadlines, SSE accounting, stale views, navigation and cross-tab logout.
- Added bounded line/bar/pie/scatter rendering, Markdown tables, KaTeX and selective code highlighting.
- Fixed preview object URL lifetime and keyboard focus; improved Settings labels/touch targets and honest demo billing copy.
- Preserve the start and conclusion of long file excerpts with explicit omission markers.
- Match PostgreSQL unique-constraint metadata; bound nginx health timeouts; strengthen preflight and release verification.
- Fixed mobile session/storage ordering, streaming EOF, lifecycle/drafts/attachments/picker and transcription races.
- Verified 126 backend, 16 Web unit and 23 browser tests; mobile automated checks and iOS/Android JS exports pass.
- Recorded real OpenRouter failures as failures; no production-provider, payment or physical-device certification claimed.

See [the final live QA report](UVMS_AI_FINAL_LIVE_QA_REPORT.md).


## 1.4.1 — Live Runtime QA Hotfix

- fixed a live-discovered SSE regression where the global API cache middleware overwrote `Cache-Control: no-cache, no-transform` on `/api/v1/chat/stream`;
- preserved endpoint-specific cache directives while retaining `no-store` as the default for other API responses;
- added a regression assertion for the SSE `no-transform` contract;
- verified the packaged app as a real local HTTP service: `/live`, `/ready`, registration, auth, models/capabilities/plans/usage, Projects, Memory, file upload, chat/history, public share and refresh rotation/replay protection all passed;
- live SSE probe passed with progressive deltas and terminal `done`; local load probe completed 100/100 successful requests with 0% errors;
- retained the production boundary: external AI provider, public HTTPS edge, PostgreSQL/Redis production cluster and physical iOS/Android remain environment-specific acceptance gates.

## 1.4.0 — Production Release Candidate

- made live AI mandatory for real production by default; accidental demo-AI startup is rejected unless an explicit staging override is set;
- made billing state explicit: production safely supports `disabled` until a real payment adapter is implemented and certified, while demo billing is rejected in production;
- added `billing_enabled` capability so Web/Mobile no longer present a broken paid-upgrade action when billing is disabled;
- added a global request-envelope guard and production validation for upload/request limits;
- hardened production URL/origin validation and request-ID sanitization;
- added no-store API cache headers and explicit frame denial at the API layer;
- improved safe user-facing provider errors for auth, rate-limit, network, upstream and malformed-response failures;
- added `.env.production.example` with safe production defaults and a release self-verifier (`ops/release_verify.py`);
- production account deletion now fails closed if object storage cleanup is unavailable, preventing the API from claiming deletion while user files remain orphaned;
- synchronized Web/Mobile/Expo/API release metadata to **1.4.0**;
- expanded backend regression coverage to **111 passing tests**.

## 1.3.0 — Production Hardening

- hardened production runtime validation for PostgreSQL, Redis, HTTPS origins, secure cookies, storage and protected metrics;
- added a production entrypoint that safely constructs PostgreSQL URLs, runs Alembic + reference seeding once, then `exec`s the multi-worker Uvicorn server with graceful shutdown/proxy settings;
- removed the multi-worker seed race from production startup;
- changed the API image to an unprivileged runtime user;
- added Web/API `.dockerignore` boundaries and switched the Web image to reproducible `npm ci`, preventing host Windows `node_modules`/caches/secrets from contaminating Linux builds;
- added Redis/API/Web/Nginx healthchecks and an internal backend Docker network;
- fixed `/metrics` routing through Nginx and cross-worker HTTP request aggregation through Redis;
- hardened Nginx forwarding/SSE behavior and removed production `unsafe-eval` from the CSP;
- repaired PostgreSQL backup/restore for custom DB users/names, archive validation, checksum, maintenance-mode restore and pre-restore safety backup;
- added dependency-free production preflight, HTTP load and SSE streaming probes;
- expanded backend regression coverage from **99 to 109 passing tests**;
- upgraded CI to Python 3.13, `pip check`, `alembic check`, reproducible `npm ci`, production preflight/Compose validation and production API image build.

## 1.2.0 — Mobile Experience

- upgraded the physical-phone baseline to Expo SDK 57 / React Native 0.86 / React 19.2;
- fixed `UVMS_AI_PROVIDER=auto` so a development OpenRouter key actually enables live text instead of silently falling back to demo;
- exposed non-secret provider/text-live capability status to clients;
- redesigned the Mobile chat header, composer and action surfaces for a cleaner UVMS product feel;
- replaced the overflowing Mobile tool row with a compact attachment/action sheet;
- added Mobile Markdown rendering for headings, emphasis, lists, quotes, links, inline/fenced code and simple table rows;
- added message long-press actions, branch-from-message, regenerate, share and reuse-as-draft flows;
- added responsive press feedback on key actions and tightened typography, spacing, touch targets and safe-area behavior;
- preserved the existing streaming/Stop/Retry, vision uploads, Projects, Memory, Library, Temporary Chat and sharing architecture;
- synchronized visible Web/Mobile/API release version to **1.2.0**;
- verification: **99 backend tests**, Alembic head/check, **7 Web API tests**, Web/Mobile TypeScript, iOS/Android production + development Expo exports. Web production build is environment-blocked in this Linux handoff because the Windows archive does not contain Linux Next SWC and registry DNS is unavailable.

## 1.1.0 — Conversation Power

- added pinned chats with pinned-first backend ordering and dedicated Web grouping;
- added 24-hour Temporary Chat that is hidden from history and excludes Memory/Project context;
- added full-chat and branch-from-message conversation forks;
- added immutable public conversation snapshots with hashed bearer tokens;
- added owner-scoped share listing, per-link revoke and revoke-all controls;
- added Web Shared Links control center and Mobile shared-snapshot management;
- added Markdown conversation export plus authenticated JSON export API;
- added native Mobile share-sheet flow for newly created links;
- retained v1.0.3 isolated Windows runtime launch behavior;
- expanded backend suite to **98 passing tests** and Alembic head `e2c7c0d4a4b1`.

## 1.0.2 — Stage 1.2 mobile-ready

- switched the Expo client from non-streaming chat completion to real SSE chat streaming;
- added mobile Stop, accepted-message Retry and progressive tool/status handling;
- expanded server-backed model/plan/capability handling;
- added shared Mobile Library, richer Project detail/files/chats and Memory controls;
- improved camera/gallery/document attachment flow and native recording UX;
- added foreground/network recovery and physical-device API diagnostics;
- added `QUICK_RUN_MOBILE_WINDOWS.bat`, LAN helper and physical mobile QA documentation;
- preserved the existing OpenRouter development boundary and backend/Web architecture.

## v1.0.1 — Live QA UI polish

- Reworked the live Web chat layout after first real browser QA.
- Added a functional desktop sidebar collapse state.
- Improved message hierarchy, contrast and user-message presentation.
- Added clearer Thinking / Searching / Uploading / Listening runtime states.
- Added visible Web Search mode state inside the composer.
- Added real plan/usage summary from `/usage/me` to the main shell.
- Improved top bar profile/plan controls and sidebar subscription card.
- Added DEMO / STOPPED message badges.
- Reworked the Demo Mode response to be user-facing instead of developer-facing.
- Tightened responsive behavior and mobile chat spacing.
- Kept Library marked LIVE in the primary navigation.

## 1.0.0-stage1 — Public Beta candidate

- Unified Web/Mobile UVMS AI Stage 1 product foundation.
- Chat streaming, Stop, history, edit/regenerate, archive/search/delete and server-side model routing.
- Web Search citations, file/document context, vision and image generation.
- Projects, Memory, Library and Free/Plus/Pro entitlements.
- Mobile camera/gallery/docs, model selection and native voice transcription.
- Admin users/plans/subscriptions/model config/audit/usage and provider-token stats.
- Rotating refresh sessions and automatic Web/Mobile token refresh.
- Web long-lived refresh credential moved to HttpOnly/SameSite cookie; browser JS stores only tab-scoped access state.
- HttpOnly cookie-backed session recovery now restores login after reload/new tab without exposing refresh credentials to JavaScript.
- Mobile credentials stored in Expo SecureStore.
- Web cookie-auth Origin checks and production trusted-host/CORS validation.
- Active-session revoke/logout-all, password change, data export and permanent account deletion.
- Added one-time, expiring forgot-password flow with SMTP adapter; successful reset revokes old sessions.
- Production observability: request IDs, structured logs, liveness/readiness and protected metrics.
- S3/R2/MinIO storage adapter; private objects proxied through authenticated API downloads.
- Redis-backed cross-worker generation cancellation and rate-limiting foundation.
- File signature/archive validation, bounded model context and untrusted-document prompt hardening.
- Safe dependency-free Markdown basics, fenced code blocks/copy, citation links + Nginx CSP/security headers.
- Production Web Docker image, production Compose and Nginx proxy.
- PostgreSQL backup/restore + smoke/release tooling.
- Production admin bootstrap CLI; public registration cannot auto-promote admin in production.
- Production billing defaults disabled until a real adapter is configured.
- Public Beta Privacy/Terms/error/not-found pages.
- PWA metadata/icons and square/adaptive Expo app icons.
- Windows quick setup/run scripts; setup runs tests, migrations, Web typecheck/build and Mobile typecheck.
- Fixed SQLite timezone interaction in stale refresh-session pruning discovered by the final test pass.
- Backend release suite expanded to **20 tests**.

## 0.9.0

- Mobile voice transcription, SecureStore sessions, S3-compatible storage and distributed rate-limit foundation.
