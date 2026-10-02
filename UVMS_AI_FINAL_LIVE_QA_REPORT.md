# FINAL LIVE QA REPORT — UVMS AI v1.4.3 Public Beta

Final scope and release gates: **2026-10-02**. Live text acceptance began 2026-09-30 and resumed from saved results. Application and isolated production stack **PASS**. Public deployment **BLOCKED BY EXTERNAL CREDENTIALS**: no supplied server/SSH/domain/DNS target. Localhost with a self-signed test certificate is not a public URL or Let's Encrypt validation.

## Provider and scope

Only **Groq**, text **openai/gpt-oss-120b**, voice **whisper-large-v3-turbo**. Actual upstream endpoint/own credential use observed in native backend, and safe provider HTTP/usage persisted in PostgreSQL in the production stack. No demo, Gemini, OpenRouter or Qwen fallback in live acceptance. Fast=low, Smart/Balanced=medium; both observed. Deep=high remains mapped but locked for free users and was not newly live-certified in this Beta scope.

Qwen/Vision, image generation, search and paid billing are disabled. UZ UI retained; UZ AI not certified. Physical native apps not certified. SMTP is not required for registration/login; unavailable password reset is hidden and the API does not pretend to send email.

## Live results (quality reviewed, not merely HTTP 200)

| Case | Result / evidence |
|---|---|
| READY | PASS, exact READY through browser; production Admin READY probe also completed |
| RU / basic coding | PASS, natural Russian explanation and correct generator-aware Python average, empty-input ValueError; five assertions actually executed in isolated verifier |
| EN / integral | Final PASS in Smart: integration by parts gives 1/4; Simpson ≈0.2507, valid bound. **Initial Fast combined answer was wrong** (0.5966); retained as FAIL for that part, not hidden |
| Bayes | PASS: 95 true positives / (95+495 flags) = 16.101694915%; independent 10000-item table |
| Physics | Final PASS: a=3.205858 m/s², v=5.66203 m/s, slope friction work=-16.9914 J, stop=6.53590 m; returned rounded values agree. Initial 1024 completion cap produced incomplete answer; raised normal cap to1536 and one controlled retry passed |
| Files | PASS: TXT/DOCX migration17min, ownerMira, amber; PDF retention73%; CSV/XLSX revenues120,150,-20,310 total560 |
| Charts | PASS: line/bar/pie/scatter cards and underlying data checked, including negative bar and scatter x/y |
| Projects | PASS: persisted instructions prefix and file facts/citation; reload preserved project context |
| Memory | PASS: active memory recalled, disabled memory absent, deletion confirmed |
| SSE | PASS: increasing DOM measurements during generation, e.g. coding38; production HTTPS105 paints, first provider token≈529ms |
| Stop / Regenerate | PASS: Stop409ms; partial240chars persisted; real regenerated answer completed and survived reload |
| Retry / error fixtures | PASS: readable 429/timeout/provider errors, spinner ends, Retry succeeds with one user message. Initial harness expected exactly RETRY-OK but active Project instructions required GROQ-CHECK-527 prefix; response correctly honored project context. Original harness FAIL retained with review explanation |
| History / two tabs | PASS: reload/history, rename/archive/restore, separate chats with ALFA703 and BETA320; no crossed histories |
| Voice | PASS: real Whisper HTTP200, non-demo transcript “The access code is 742. Testing speech transcription.” |
| Auth / UX | PASS: register/login/logout/session restore; production Secure+HttpOnly refresh cookie rotation; 390/360px no horizontal overflow and working drawer; code Copy; unavailable backend readable Retry |

Initial model failures are not counted as successful answers. The final Public Beta critical flow gate passed after the documented bounded correction/budget adjustment; this is not a promise of error-free AI. The earlier strict React and UZ quality failures remain historical model limitations under the user's revised release scope.

### Test harness corrections

An initial EN/math DOM capture was empty during a development HMR update; raw SSE completed and its wrong integral was reviewed. This capture is not streaming evidence. Resizing a desktop page retained the open drawer state; narrow-screen checks subsequently used a fresh page load and captured the settled animation. A repeated screenshot run reused previously renamed/archived QA data and failed a Restore selector; the earlier full lifecycle passed and the independent 25-test E2E suite passed. No provider calls were repeated for those screenshot issues.

## Actual quota observations

**18 real HTTP requests, all200; 0 observed real429, 0 observed5xx** in this final Beta round: 16 native observations (15text+1voice), plus2 production GPT-OSS requests. HTTP success did not erase the incomplete/wrong-answer failures above. Observer usage callbacks can appear twice; they are deduplicated by request ID for accounting review.

Latest production text snapshot: remaining requests **999/1000**, tokens **7537/8000**, reset requests1m26.4s, tokens3.472s. Whisper snapshot:1999/2000 requests. These are recorded header snapshots, not a current balance or SLA. Historical Qwen429 and OpenRouter Integral/Bayes timeouts remain in archived reports; they are provider limitations outside the disabled features of this release.

Product protection: atomic shared Redis admission10/user/UTC day,5/minute and3 globally. Failed admitted calls count. Three of eight concurrent cross-process reservations admitted; five rejected busy, zero provider calls. Daily/minute/lease cleanup checks passed. Unique capacity leases prevent repeated client request IDs from bypassing the cap. Production Redis failure closes admission. Provider429 creates shared cooldown from Retry-After/reset headers; no automatic retries or provider switching. Normal output1536; coding/Deep up to2048 only with a recent successful sufficient-quota snapshot. Context12000 estimated tokens.

## Regression and security

| Gate | Result |
|---|---|
| Backend | **202 distinct tests PASS**: full201/201, followed by affected45/45 including one newly added Admin-admission test. Full first attempt exposed10 environment-dependent fixture failures; fixtures now explicitly configure their demo capabilities independently of private `.env`. No assertions were weakened |
| Web | Unit16/16; TypeScript PASS; production build PASS |
| Browser E2E | **25/25 PASS**, including refresh dedup/rotation, logout, IDOR/auth flows, safe rendering, SSE/Stop, error recovery and multi-tab; explicit isolated demo fixtures, not counted as live Groq |
| Mobile | TypeScript PASS; SSE2/2; Expo Doctor21/21 after compatible SDK57 patch updates; dependency check, public config and Android/iOS Hermes exports PASS |
| Python | Compile PASS; pip check no broken requirements |
| Alembic | Actual PostgreSQL upgrade/check PASS;20 public tables, revision e2c7c0d4a4b1 |
| Docker | Both images build; five services healthy; nginx config PASS; API UID10001, two workers; no DB/Redis/API/Web host ports |
| Production security | Explicit HTTPS origin/CORS/trusted hosts, Secure/HttpOnly cookie rotation, ordinary-user Admin403, backend-only keys, upload validation/owner checks, safe Markdown/XSS/request IDs covered; debug false; no unexpected traceback in production logs |
| Health / metrics | live/ready PASS; public metrics404; internal metrics401 anonymous and200 with bearer; `.env` inaccessible |
| Data recovery | Quiesced PostgreSQL + uploads backup, manifest hashes/archive reads PASS; restored into disposable DB, matching counts/revision; upload SHA-256 unchanged after API restart |
| Secret scan / release verifier | **PASS**: 316 source files, 94 native Web production assets, 92 Docker Web assets, 4 Mobile export files and Expo public config; zero matches for private keys/QA credentials or forbidden public credential fields. Working-tree and clean archive verifier PASS; ZIP CRC and forbidden-path checks PASS. [Machine-readable summary](docs/qa-evidence/public-beta/summary.json) |

Production stack was checked at local HTTPS with a test certificate, using PostgreSQL/Redis, not SQLite. Real RU/EN response, progressive SSE105paints, reload and Admin rate-limit diagnostic passed with zero page errors. No Internet deployment, domain validation or Certbot issuance is claimed.

### Mobile tooling audit boundary

`npm audit` reports13 entries (4high/9moderate) propagated from two transitive Expo build-tool dependencies: `node-forge` and old `uuid` via `xcode`. These are not installed in the serving API/Web images; the mobile application imports neither, and OTA code-signing is not configured. The [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv) currently lists no patched release. The [uuid advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq) concerns v3/v5/v6 with supplied buffers; this xcode call site uses v4 without a buffer. This is a documented tooling limitation, not a clean dependency-audit claim. Do not use untrusted signing certificates/build inputs. Native distribution remains uncertified; no forced Expo major downgrade or audit suppression was applied.

## Release classification

Known **P0=0**, known **P1=0 within public Web/API scope**. Remaining product limitations: disabled Vision/images/search/billing, uncertified Uzbek AI/native devices, fallible generated answers, free provider quotas, single-server uploads. No SMTP/S3/payment/Qwen upgrade is a requirement for today's Web Beta.

**APPLICATION READY — PUBLIC DEPLOYMENT REQUIRES SERVER/DOMAIN CREDENTIALS.**

Needed externally: target server IP/SSH access, domain/DNS control and secure server-side provisioning. Fresh JWT/DB/metrics secrets are generated by the runbook; the Groq key already exists locally and must be supplied separately on the server. See [PRODUCTION_DEPLOY.md](PRODUCTION_DEPLOY.md) for exact commands, certificate email, DNS, backups and public smoke.

Artifact: **UVMS-AI-v1.4.3-public-beta-production.zip**, SHA-256 in adjacent `.zip.sha256`. No private env, DB/dumps, profiles, dependencies, caches, QA accounts or runtime logs are included. [Cases](docs/qa-evidence/public-beta/cases.json), [HTTP observations](docs/qa-evidence/public-beta/provider-http.json), [production evidence](docs/qa-evidence/public-beta/production-ai-evidence.json). Historical [Qwen report](UVMS_AI_GROQ_QUALITY_QA_REPORT_v1.4.2.md) and [initial Groq report](UVMS_AI_GROQ_INITIAL_LIVE_QA_REPORT_v1.4.2.md) remain unchanged.
