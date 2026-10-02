# UVMS AI v1.3.0 — Production Hardening release report

Date: 2026-09-22

## Scope

v1.3.0 starts from the actual `UVMS-AI-Stage1-v1.2.0-mobile-experience` source. It does not remove the v1.2 Mobile Experience or v1.1 Conversation Power features. The objective is to remove avoidable single-server production defects and make the remaining external acceptance work measurable.

## Production defects fixed

### PostgreSQL startup and multi-worker safety

The previous Compose built `UVMS_DATABASE_URL` by string interpolation. A strong password containing URL-special characters could make the SQLAlchemy URL invalid. `app.prod_start` now builds the URL with SQLAlchemy `URL.create`, so credentials are escaped correctly.

The previous Uvicorn worker pool also ran reference-data seeding from every worker lifespan. On a fresh production database two workers could race to insert the same unique plans/model IDs. Production now performs:

1. safe PostgreSQL URL construction;
2. `alembic upgrade head`;
3. idempotent plan/model seed once;
4. `exec uvicorn ... --workers N` with per-worker lifespan seeding disabled.

Development retains convenient startup seeding.

### Production configuration contract

`UVMS_ENV=production` now refuses to start when any of these are unsafe/missing:

- SQLite instead of PostgreSQL;
- Redis URL absent;
- weak/default JWT secret;
- wildcard CORS or trusted hosts;
- insecure refresh cookie;
- non-HTTPS public Web URL or CORS origin;
- unsupported storage backend / missing S3 bucket;
- enabled password reset without SMTP host;
- missing/weak protected metrics token;
- `UVMS_REQUIRE_LIVE_AI=true` without a usable live provider credential.

OpenRouter free routing remains development/demo/test only.

### Containers and service ordering

- Web/API Docker contexts now have `.dockerignore` files so local Windows `node_modules`, Next caches, Python caches, local DBs and `.env` files cannot overwrite/contaminate Linux image builds.
- Web Docker build uses reproducible `npm ci` instead of `npm install`.
- API runtime user is unprivileged UID/GID 10001.
- Redis has a real `PING` healthcheck.
- API/Web/Nginx have healthchecks.
- Compose gates startup on dependency health instead of merely container start.
- API gets a 45-second stop grace period and Uvicorn graceful-shutdown settings.
- PostgreSQL/Redis/API/Web live on an internal backend network; Nginx is the only service with a published host port.

### Reverse proxy and SSE

- `/metrics` is now explicitly routed to the API rather than accidentally falling through to Next.js.
- Nginx replaces the public client's `X-Forwarded-For` chain with `$remote_addr`; this prevents a direct client from spoofing IP-based auth rate-limit identity in the included single-ingress topology.
- API streaming explicitly disables proxy buffering/cache/gzip and retains long SSE read/send timeouts.
- production CSP no longer contains `unsafe-eval`.
- Nginx upload allowance is above the largest application plan limit, leaving the backend as the authoritative plan/global upload gate.

If a CDN/TLS proxy is placed in front of this Nginx, configure Nginx `real_ip` only for that provider's trusted proxy CIDRs before relying on forwarded client IPs.

### Metrics

The old in-process counter was incomplete under `--workers 2+` because `/metrics` could land on any one worker. When Redis is configured, HTTP totals/status counters are now aggregated in Redis across workers, with process-local fallback during Redis failure. Metrics Bearer-token comparison uses constant-time comparison.

### Backup and restore

The old shell helpers expanded `POSTGRES_USER/POSTGRES_DB` on the host shell, which could silently fall back to `uvms/uvms_ai` even when Compose used custom `.env` values. The scripts now expand those variables inside the PostgreSQL container.

Backup now:

- writes to a temporary file;
- validates it with `pg_restore --list`;
- publishes only a non-empty valid custom-format dump;
- writes a SHA-256 sidecar when available.

Restore now:

- refuses to run without `UVMS_ALLOW_RESTORE=YES`;
- validates the supplied archive before downtime;
- creates a pre-restore backup by default;
- stops Nginx/Web/API during destructive restore;
- strips dump owner/ACL metadata;
- restarts the application, where normal production startup applies migrations and reference seed.

## New production verification tools

- `python ops/production_preflight.py .env` — fail-fast config audit without printing secrets.
- `python ops/smoke_test.py https://your-domain` — `/live`, `/ready`, and protected metrics smoke.
- `python ops/load_probe.py https://your-domain/live --requests 500 --concurrency 25` — dependency-free HTTP concurrency/latency gate.
- `python ops/sse_probe.py https://your-domain --bearer <DISPOSABLE_QA_ACCESS_TOKEN>` — verifies public reverse-proxy SSE arrives progressively rather than as a buffered final response.

## Verification completed in this handoff

- Incoming backend baseline before v1.3 edits: **99 passed**.
- Final backend suite after hardening: **109 passed**.
- Python compile for API + migrations + new ops tooling: **PASS**.
- Existing Web API/session tests: **7/7 PASS**.
- PostgreSQL URL regression includes a password containing `@ : / ? # [ ] !` and whitespace: **PASS**.
- Production runtime config positive/negative regression cases: **PASS**.
- Docker Compose CLI is not installed in this sandbox, so local `docker compose config/build` is **NOT CLAIMED**. CI now has explicit gates for both Compose config and the API production image.
- Full Web/Mobile npm dependency installation is blocked in this sandbox by external registry access. Web production build and Mobile TypeScript are therefore **NOT CLAIMED as rerun here**; use the target Windows setup/CI gates.

## Remaining external acceptance before final production release

1. Run `QUICK_SETUP_WINDOWS.bat` on the actual Windows checkout and record Web build + Mobile typecheck.
2. Physical iPhone and Android QA for login/SecureStore, streaming/Stop/Retry, camera/gallery/files, background/foreground, Projects/Memory/Library and recording UX.
3. Deploy the chosen HTTPS domain and run preflight, smoke, SSE and load probes through the real edge path.
4. Real paid/provider acceptance for production model identity, Search, generated images, transcription and cost/invoice reconciliation.
5. Real SMTP delivery and private S3/R2 if used.
6. Backup restore drill with checksum/evidence on a disposable production-like environment.
7. External logs/alerts and server resource monitoring.
8. Real payment-provider signed webhook certification before charging users.
9. Final Privacy/Terms/support/refund/legal review.

v1.3.0 is therefore a **production-hardened Public Beta codebase**, not a claim that the external production environment has already been certified.
