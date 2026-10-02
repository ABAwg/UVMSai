# UVMS AI Architecture — Stage 1 v1.4

```text
                           ┌────────────────────────┐
Web / Next.js ─────────────┤                        │
Mobile / Expo ─────────────┤     FastAPI API        ├──── PostgreSQL
Admin / Billing / Settings ┤                        ├──── Redis
                           └──────────┬─────────────┘
                                      │
                  ┌───────────────────┼────────────────────┐
                  │                   │                    │
             Object Storage       AI Gateway          SMTP adapter
          Local / S3 / R2 / MinIO     │
                                      └── OpenAI-compatible provider
```

## Product invariants

1. One UVMS account owns one shared set of chats, files, Projects, Memory, plan and usage across Web/Mobile.
2. AI/payment/storage credentials never ship to browser or mobile clients.
3. Clients select UVMS model aliases; provider routing stays server-controlled.
4. Subscription/plan limits are server-authoritative.
5. Uploaded/generated assets are user-owned and require authenticated access.
6. Production schema changes are migration-first through Alembic.
7. Web keeps the long-lived refresh credential in an HttpOnly cookie; Mobile keeps its refresh credential in Expo SecureStore.
8. Refresh tokens rotate and consumed tokens cannot be replayed.
9. Production requires Redis for multi-worker cancellation/rate limits; local fallback is a development/resilience path, not the production readiness target.
10. Production demo billing is blocked; real charging requires a real provider + verified webhooks.

## Request path

```text
Browser / Mobile
      │ access token
      ▼
Auth / rate limits / entitlements
      │
      ├── chat history + project + memory context
      ├── authenticated attachments
      └── AI Gateway
             ├── streaming text
             ├── web search citations
             ├── vision
             ├── image generation
             └── transcription
```

## Operations

- `/live` process liveness
- `/ready` DB/Redis/storage/AI configuration readiness
- `/metrics` protected Prometheus-style counters; HTTP totals aggregate through Redis across API workers
- structured request logs + request IDs
- PostgreSQL backup/restore helpers
- Nginx + Docker Compose production baseline with internal backend network, health-gated startup and non-root API runtime
- `docs/RELEASE_CHECKLIST.md` is the sign-off gate for the actual target environment

## Production startup invariant

The production container does not let every Uvicorn worker migrate/seed independently. `app.prod_start` builds the PostgreSQL URL safely from `POSTGRES_*`, applies Alembic, performs idempotent reference seeding once, then `exec`s the configured Uvicorn worker pool. Nginx is the only published service in the included Compose topology.
