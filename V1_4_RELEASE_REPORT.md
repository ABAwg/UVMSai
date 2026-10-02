# UVMS AI v1.4.0 — Production Release Candidate

Date: 2026-09-23

## What changed after v1.3

v1.3 already supplied the major production infrastructure: PostgreSQL/Redis multi-worker startup, non-root API container, Nginx SSE handling, protected metrics, backup/restore safety, healthchecks, preflight/load/SSE tooling and stricter production configuration.

v1.4 closes additional code-level failure modes that could otherwise produce a misleading deployment:

- Production rejects an implicit/demo AI provider unless `UVMS_ALLOW_DEMO_IN_PRODUCTION=true` is deliberately set for staging. The production Compose forces `UVMS_REQUIRE_LIVE_AI=true` and `UVMS_ALLOW_DEMO_IN_PRODUCTION=false`.
- The bundled billing implementation is no longer allowed to look “live” when it is not. Production supports `UVMS_BILLING_PROVIDER=disabled` as the safe default. Demo billing is rejected in production, and any unknown real provider is rejected until an adapter/webhook implementation exists.
- `/capabilities` exposes `billing_enabled` / `billing_provider`; Web and Mobile disable upgrade actions rather than letting a user reach a dead checkout.
- `UVMS_MAX_REQUEST_MB` bounds the HTTP request envelope independently of per-plan file quotas. Oversized requests with a declared body size receive HTTP 413 before route work.
- Production URL validation now rejects credentials/query/fragment in the public URL and rejects CORS values that are not exact HTTPS origins.
- Client-supplied request IDs are accepted only when short and log-safe; otherwise the API generates its own ID.
- API responses receive `Cache-Control: no-store` and `X-Frame-Options: DENY` in addition to the existing security headers.
- Provider authentication/rate/network/upstream/malformed-response failures now map to safe, useful user messages rather than raw provider details.
- Added `.env.production.example` and `ops/release_verify.py` for release consistency/private-file/secret-shape checks.
- production account deletion now fails closed if object storage cleanup is unavailable, preventing the API from claiming deletion while user files remain orphaned;

## Verification completed here

- Backend: **111 passed**.
- Python compile for API/migrations/ops: **PASS**.
- Web API/session regression: **7/7 PASS**.
- Production preflight with a synthetic safe configuration: **PASS**.
- `ops/release_verify.py`: **PASS** after cleanup.
- `bash -n ops/backup_postgres.sh ops/restore_postgres.sh`: **PASS**.
- JSON package/Expo manifests parse and release versions are synchronized to **1.4.0**.

A clean `npm ci` for the full Web/Mobile dependency trees cannot complete in this sandbox because external npm registry access times out. Therefore Web production build and Mobile TypeScript are deliberately **not claimed as rerun here**. Their existing source remains in the release, and `QUICK_SETUP_WINDOWS.bat` / CI retain those gates.

## Production mode supported by this release

A safe real deployment can run today as:

- real live AI provider;
- PostgreSQL + Redis;
- Nginx edge behind final TLS/CDN/reverse proxy;
- Free-plan/product usage with billing intentionally disabled;
- local single-server storage or private S3/R2;
- password reset disabled, or enabled with real SMTP.

Paid subscriptions are **not** called production-ready because no real payment provider was selected/implemented by the project. This is intentionally visible and blocked rather than simulated.

## Evidence still requiring the target environment

1. Clean Web `npm ci` + unit/type/build and Mobile `npm ci` + typecheck/Expo/EAS build.
2. Real HTTPS domain, certificate/renewal, HSTS and HTTP→HTTPS behavior.
3. Live provider QA for Fast/Balanced/Deep, Search, Vision, generated images and transcription using the final account/models.
4. Physical iPhone + Android QA, including SecureStore, camera/gallery/docs, recording and lifecycle/network interruption.
5. SMTP delivery and private S3/R2 verification if those features are enabled.
6. Production-like backup restore drill and server capacity/load measurements.
7. External alert/log destination.
8. Payment provider + signed webhook/refund/idempotency certification if paid plans are enabled later.
9. Final Privacy/Terms/support/refund/legal review.

These are environmental/commercial certification gates, not hidden code TODOs. The release is designed to fail closed or disable an unavailable feature rather than silently pretend those gates have passed.
