# UVMS AI v1.4.3 Public Beta — project status

Updated 2026-10-02. **APPLICATION READY — PUBLIC DEPLOYMENT REQUIRES SERVER/DOMAIN CREDENTIALS.**

| Area | Current result |
|---|---|
| Code / critical flows | PASS for Public Beta scope |
| Groq GPT-OSS-120B | PASS, real HTTP and answer review; 18 real requests in final round including Whisper and production smoke; 0 observed 429/5xx |
| Production stack | PASS locally: nginx HTTPS, Web, non-root API with two workers, PostgreSQL, Redis |
| Data / recovery | PostgreSQL upgrade/check PASS, 20 tables; database + upload backup verified; disposable restore and upload hash after restart PASS |
| Browser | Auth, chat, SSE, Stop, Retry/Regenerate, history/rename/archive, files, Projects, Memory, charts, two tabs, 390/360 px PASS |
| Regression | Backend 202 unique PASS (201 full + 45 affected, one new test); Web16; E2E25; Mobile SSE2; Expo21 |
| Public deployment | BLOCKED only by absent target server/SSH and domain/DNS values |

Provider scope: all text stays on `openai/gpt-oss-120b`; Whisper voice enabled. No Qwen calls, Vision, image generation, search or billing in Public Beta. UZ AI and physical native apps remain uncertified. SMTP absent is supported with reset disabled. Local persistent uploads are supported for one server.

Known P0: **0**. Known P1 in public Web/API release scope: **0**. AI remains fallible: the initial Fast integral answer was wrong and the first physics answer hit an undersized cap; final bounded checks passed with original failures retained. Mobile build tooling has unresolved upstream audit advisories, documented in the QA report; it is outside the public serving stack.

Quota: shared atomic 10/day, 5/min/user and global3; conservative context/output; shared 429 cooldown; no automatic retries. Provider rate values and errors are visible only as safe diagnostics/accounting. No keys are displayed.

Remaining deployment inputs and exact commands: [PRODUCTION_DEPLOY.md](PRODUCTION_DEPLOY.md). SMTP, S3, paid billing, Qwen quota and native store credentials are not requirements for this Web Public Beta launch.

Artifact: `UVMS-AI-v1.4.3-public-beta-production.zip`; SHA-256 is in the adjacent `.zip.sha256` file. Final secret scan and release verifier details are recorded in [evidence summary](docs/qa-evidence/public-beta/summary.json).

[Final live report](UVMS_AI_FINAL_LIVE_QA_REPORT.md) · [Release report](V1_4_3_RELEASE_REPORT.md) · [Historical status](docs/HISTORICAL_PROJECT_STATUS_v1.4.2.md)
