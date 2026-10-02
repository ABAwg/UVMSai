# UVMS AI Stage 1 — Release checklist

Mark every item on the **actual target environment** before calling the Public Beta production-ready. A local/unit test may support an item but must not replace a real-device/provider/domain test where that item explicitly requires one.

## Build / reproducibility

- [ ] `services/api`: `python -m pytest -q` passes
- [ ] `services/api`: `python -m compileall -q app migrations` passes
- [ ] `services/api`: clean `alembic upgrade head` + `alembic check` pass
- [ ] `services/api`: `pip check` passes
- [ ] `apps/web`: clean `npm ci`, `npm test`, `npm run typecheck`, `npm run build` pass
- [ ] `apps/mobile`: clean `npm ci`, `npm run typecheck` pass
- [ ] `python ops/release_verify.py` returns PASS on the clean release tree
- [ ] CI production-config job is green
- [ ] Production API Docker image builds
- [ ] `docker compose -f docker-compose.prod.yml config` passes with production env
- [ ] No secrets, `.env`, private QA DB/logs or provider keys are inside release archive/repository

## Production preflight

- [ ] `python ops/production_preflight.py .env` returns PASS
- [ ] PostgreSQL is used; no SQLite production URL survives startup
- [ ] Redis is healthy and shared by all API workers
- [ ] Unique JWT secret and strong PostgreSQL password are installed
- [ ] HTTPS public URL + explicit HTTPS CORS origins + explicit trusted hosts
- [ ] Secure refresh cookie enabled
- [ ] Strong protected metrics token installed
- [ ] Live AI is configured; production cannot silently fall back to demo
- [ ] SMTP configured or password-reset feature deliberately disabled
- [ ] Billing is deliberately `disabled` or backed by a certified real provider (never `demo`)
- [ ] Storage backend choice documented (local single-server or private S3/R2)

## Product QA — Web + account

- [ ] Register/login/logout and HttpOnly-cookie refresh on Web
- [ ] Reload/new-tab session recovery
- [ ] Logout-all and per-session revoke
- [ ] Password change revokes expected sessions
- [ ] Password-reset email arrives; token is one-time and expires
- [ ] Profile update, data export and account deletion
- [ ] Free/Plus/Pro limits enforced
- [ ] Admin users/plans/models/audit views work with non-admin denial verified

## Chat / conversation power

- [ ] Start Web chat, continue the same chat on Mobile
- [ ] Real progressive streaming through final HTTPS proxy
- [ ] Stop during active generation; partial state is correct after reload
- [ ] Retry after controlled network/provider failure without duplicate prompt
- [ ] Edit/regenerate/rename/archive/delete chat
- [ ] Pin/unpin chat and verify Pinned ordering
- [ ] Temporary Chat stays out of normal history, ignores Memory/Projects and expires
- [ ] Branch full conversation and branch from a specific message
- [ ] Create public shared snapshot, open signed-out, then revoke it
- [ ] Shared Links management is owner-scoped on Web/Mobile
- [ ] Markdown/JSON conversation export contains only expected data

## Files / Projects / Memory

- [ ] PDF/DOCX/XLSX/TXT/image upload, preview/download/delete
- [ ] Per-plan/global upload limits match UI and reverse proxy behavior
- [ ] Project instructions + files reach the live model
- [ ] Enabled Memory affects answer; disabled Memory does not
- [ ] Library sync works across Web/Mobile
- [ ] Private S3/R2 objects cannot be fetched unauthenticated when S3 is used

## Live AI certification

- [ ] Final production text provider/model identity approved
- [ ] Fast/Balanced/Deep behavior and plan locks verified
- [ ] Russian, Uzbek and English live answer quality reviewed
- [ ] Previous-turn/project/memory context verified live
- [ ] Vision with real PNG/JPEG/phone photo
- [ ] Web Search returns fresh real sources/citations
- [ ] Generated image persists and is privately downloadable
- [ ] Real transcription works with physical microphone in required languages
- [ ] Provider timeout/rate/auth/capability failures map to safe user messages
- [ ] Usage/token/cost records reconcile with provider/invoice evidence
- [ ] No provider key is present in Web/Mobile bundles or logs

## Physical mobile

- [ ] iPhone install/open
- [ ] Android install/open
- [ ] SecureStore session restore on both platforms
- [ ] Streaming/Stop/Retry on both platforms
- [ ] Camera, gallery and document picker
- [ ] Background/foreground + kill/reopen
- [ ] Wi-Fi interruption/recovery
- [ ] Projects, Memory, Library, shared links, Temporary Chat
- [ ] Recording permission/timer/cancel/transcription path
- [ ] Deep link / final app link behavior if used

## Infrastructure / security

- [ ] HTTPS certificate valid on final domain; HTTP redirects correctly
- [ ] HSTS visible over HTTPS
- [ ] Only Nginx/edge is publicly exposed; DB/Redis/API are not published directly
- [ ] If CDN/LB is used, Nginx trusts forwarded client IP only from documented proxy CIDRs
- [ ] `/live` returns 200
- [ ] `/ready` returns ready
- [ ] `/metrics` rejects missing/bad token and accepts the monitoring token
- [ ] Rate limiting verified from real client IPs
- [ ] Multi-worker cancellation verified through Redis
- [ ] Graceful restart does not corrupt accepted/stopped chat state
- [ ] `python ops/sse_probe.py ...` passes through the real HTTPS edge
- [ ] Load/capacity test completed on chosen server size with CPU/RAM/DB/Redis/provider measurements
- [ ] External error/log alert destination configured and test alert received

## Backup / disaster recovery

- [ ] `./ops/backup_postgres.sh` produces a verified non-empty dump + checksum
- [ ] Local upload volume backed up, or S3/R2 versioning/lifecycle protection enabled
- [ ] Restore drill completed on a disposable production-like environment
- [ ] Restored `/ready`, login, chats/projects and a stored file verified
- [ ] Recovery time and recovery point objectives documented
- [ ] Rollback procedure tested for the current release

## Commercial / legal

- [ ] Real payment provider integrated with signed webhooks before charging anyone
- [ ] Replay/idempotency/payment failure/refund flows verified
- [ ] Apple/Google billing requirements reviewed for mobile subscriptions
- [ ] Privacy/Terms replaced with legally reviewed final text
- [ ] Support contact, legal entity, jurisdiction, refund/cancellation wording finalized

## Sign-off

- Release version:
- Git commit / archive SHA-256:
- Server/environment:
- Web build evidence:
- iPhone model / iOS:
- Android model / Android version:
- Provider/model configuration (no secrets):
- Backup dump/checksum used in restore drill:
- Load-test evidence location:
- Approver/date:
