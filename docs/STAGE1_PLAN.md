# Stage 1 — Public Beta Plan

## Foundation — COMPLETE
Monorepo, UVMS brand, FastAPI, SQLAlchemy/Alembic, shared Web/Mobile identity, Docker.

## Core chat — COMPLETE FOR PUBLIC BETA
History, rename/archive/delete/search, streaming, Stop, edit/regenerate, model routing, synchronized conversations.

## Files + vision — COMPLETE FOR PUBLIC BETA
Uploads, authenticated Library, PDF/DOCX/XLSX/text extraction, image attachments, signature/archive checks, storage limits, local/S3-compatible backends.

## Search + images + Projects + Memory — COMPLETE FOR PUBLIC BETA
Web Search citations, generated images persisted to conversations, Projects with instructions/files/chats, user-controlled Memory.

## Mobile parity — COMPLETE FOR PUBLIC BETA
Shared chats, model selection, documents/photos/camera, search, image creation, Projects, Memory, plans, microphone transcription, account/security settings, SecureStore refresh sessions.

## Plans + admin — COMPLETE AS PLATFORM FOUNDATION
Free/Plus/Pro limits, usage, demo checkout for local testing, Admin users/plans/subscriptions/model routing/audit/stats. Real commercial payment adapters remain intentionally out of Stage 1.

## Production hardening — COMPLETE IN CODE / REQUIRES TARGET QA
Rotating refresh credentials, Web HttpOnly refresh cookie, sessions/password/reset/export/delete controls, Redis cancellation/rate limits, readiness/metrics/logging, Nginx/production Compose, backups, Windows quick setup, PWA/Expo assets and release checklist.

## Current build
**v1.0.0-stage1 — Public Beta Candidate**

The code stage is complete. Real-domain, real-provider and physical-device checks are explicitly tracked in `docs/RELEASE_CHECKLIST.md` and are required before production sign-off.
