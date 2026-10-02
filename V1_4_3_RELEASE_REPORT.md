# UVMS AI v1.4.3 Public Beta release report

2026-10-02. **APPLICATION READY — PUBLIC DEPLOYMENT REQUIRES SERVER/DOMAIN CREDENTIALS.**

- Groq GPT-OSS-120B only for all text; Whisper voice. Existing gateway/SSE/API contracts retained. Qwen/Vision/images/search/billing disabled; UZ localization retained without AI certification.
- Shared Redis admission10/day/user,5/minute/user,3 globally; unique expiring leases, production fail-closed, provider cooldown, conservative context/output and no automatic retries.
- Admin shows safe HTTP/rate snapshots/errors/accounting; diagnostic probe uses the same quota admission. Voice starts accounting after admission.
- Public Beta UX removes unsupported starter actions and hides unavailable reset. Paid plans coming soon; no production fake checkout. Safe optional synthetic demo CLI, no embedded password or fabricated AI answer.
- Production Compose retains nginx/Web/API/PostgreSQL/Redis; API outbound access fixed, internal data services, persistent volumes, non-root API, bounded resources/logging. TLS overlay with ACME/Certbot runbook. Alembic and CLI initialize the actual production DB safely, including escaped credentials.
- Database+uploads backup and disposable restore verified. Local production HTTPS real Groq SSE105DOMpaints, secure cookie rotation and Admin diagnostic passed.

Verification: backend202 unique PASS (201full then45affected including1new); Web16/16; browserE2E25/25; MobileSSE2/2; Expo21/21; Python compile/pip, Web/MobileTypeScript, production Web build, Android/iOS exports, actual PostgreSQL Alembic and Docker PASS. Final secret-scan/verifier details: [summary](docs/qa-evidence/public-beta/summary.json).

Known P0=0; P1=0 in public scope. Retained initial Fast integral mistake and physics output truncation; final bounded checks passed. Mobile tooling npm audit remains13 propagated findings outside serving runtime; see [full QA report](UVMS_AI_FINAL_LIVE_QA_REPORT.md). AI is fallible; native physical apps and UZ AI are uncertified. Provider snapshots do not guarantee future free quota.

ZIP: `UVMS-AI-v1.4.3-public-beta-production.zip`; checksum file: `UVMS-AI-v1.4.3-public-beta-production.zip.sha256`. Server secrets, private data and QA working artifacts are excluded.

External gate: real server/SSH and domain/DNS, followed by server-side secret provisioning and public HTTPS acceptance. [Exact deployment steps](PRODUCTION_DEPLOY.md). No public URL is claimed.
