# UVMS AI v1.4.3 Public Beta

Groq `openai/gpt-oss-120b` powers chat, RU/EN, coding, math, physics, documents, Projects, Memory and charts. Voice uses `whisper-large-v3-turbo`. Keys stay on the backend. No automatic provider switching.

**APPLICATION READY — PUBLIC DEPLOYMENT REQUIRES SERVER/DOMAIN CREDENTIALS.**

The local production stack was built and checked with PostgreSQL, Redis, two API workers, Web and nginx HTTPS. Real Groq streaming and critical browser flows passed. No public URL was deployed or certified.

- [Final live QA and limitations](UVMS_AI_FINAL_LIVE_QA_REPORT.md)
- [Production deployment, HTTPS and backup runbook](PRODUCTION_DEPLOY.md)
- [Release report](V1_4_3_RELEASE_REPORT.md)
- [Current status](PROJECT_STATUS.md)
- [Windows local setup](START_HERE_RU.md)
- [Provider configuration](docs/GROQ_PROVIDER.md)

## Public Beta scope

Vision/Qwen, image generation, search and billing are disabled. Uzbek UI remains available; Uzbek AI quality is not certified. Physical native apps are not production-certified. Password reset is hidden when unavailable; SMTP is optional for launch.

Limits: 10 AI operations/user/UTC day, 5/minute and 3 active globally, shared in Redis. Failed admitted operations count. Quota errors preserve history and offer manual Retry; there are no automatic multi-provider retries. AI can make mistakes; users should verify important answers.

## Verification

202 unique backend tests passed across a full 201-test run and the subsequent 45-test affected suite including one added diagnostic test. Web unit 16/16; browser E2E 25/25; Mobile SSE 2/2; Expo Doctor 21/21. Web/Mobile TypeScript, Web production build, Android/iOS exports, compile/pip, actual PostgreSQL Alembic, Docker and backup/restore passed. See the final report for exact scope, retained initial model failures and mobile tooling advisories.

## Source layout

`services/api` — shared FastAPI gateway and data layer. `apps/web` — Next.js UI. `apps/mobile` — Expo client. `ops` and `deploy` — deployment, verification and recovery. Production uses `.env.production.example`; generate fresh server secrets and provision Groq privately. The clean ZIP intentionally contains no environment secrets, databases, dependencies, backups, browser profiles or QA working directories.

Earlier reports and [the old README](docs/HISTORICAL_README_v1.4.2.md) are historical evidence. Their candidate blockers and provider experiments do not describe the v1.4.3 release scope. OpenRouter Free is not a production provider.
