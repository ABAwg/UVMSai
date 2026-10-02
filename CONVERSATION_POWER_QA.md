# UVMS AI v1.1.0 — Conversation Power QA

Date: 2026-09-19.

## Scope

This pass adds conversation-management features without replacing the stabilized Stage 1 auth/provider architecture:

- pinned chats;
- Temporary Chat;
- conversation branching;
- immutable public share snapshots;
- owner share management/revocation;
- Markdown/JSON conversation export;
- Web/Mobile surfaces for the new features.

## Security / privacy design

- Temporary chats are omitted from normal history and receive an automatic expiry timestamp.
- Temporary chats do not consume long-term Memory or Project context.
- Temporary chats cannot be shared publicly.
- Public shares are detached immutable snapshots; later source-chat edits do not mutate what was shared.
- The public bearer token is generated with `secrets.token_urlsafe(32)` and only its SHA-256 digest is stored in the database.
- Share-list APIs never return the raw bearer token.
- Shared attachment data contains safe metadata only (name/type/category/size), not authenticated storage URLs or extracted private document text.
- Share management is owner-scoped; another signed-in user cannot enumerate or revoke another owner's records.

## Backend verification

Commands run from `services/api`:

```text
python -m pytest -q
python -m compileall -q app migrations
UVMS_DATABASE_URL=sqlite:////mnt/data/uvms-big-progress/migration-v110.db python -m alembic upgrade head
UVMS_DATABASE_URL=sqlite:////mnt/data/uvms-big-progress/migration-v110.db python -m alembic current
```

Results:

- backend: **98 passed**;
- Python compile: **PASS**;
- clean SQLite migration: **PASS**, head `e2c7c0d4a4b1`.

The dedicated conversation-power regression coverage verifies:

1. pinned-first ordering and automatic unpin when archived;
2. Temporary Chat hidden from normal history, expiry handling and share prohibition;
3. fork copies the selected conversation prefix without mutating the source;
4. shared snapshots remain immutable after source edits and can be revoked;
5. raw public tokens are not stored/recoverable from management APIs;
6. global share management is owner-scoped and revoke-all does not affect another user;
7. Markdown export includes expected roles/content.

## Web checks in this build environment

`apps/web` API/session Node tests still run without downloading the full frontend dependency tree:

```text
npm test
```

Result: **7 passed**.

A syntax-oriented TypeScript parse of the modified Web/Mobile sources found no syntax-class errors. Full `npm ci` could not complete in this container because external dependency download timed out; therefore a fresh `npm run typecheck`, `npm run build`, Expo typecheck and physical-device run are **not claimed** by this report. `QUICK_SETUP_WINDOWS.bat` remains the required full dependency/type/build gate on the user's Windows checkout.

## Target-environment acceptance still required

- Web `npm run typecheck` + production build after dependency install;
- Mobile `npx tsc --noEmit` and Expo bundle on the target checkout;
- Web click-through of Pin / Temporary / Branch / Share / Shared Links / Export;
- physical iPhone/Android verification of pinning, Temporary Chat, branching and native share-sheet flow;
- public share URL opened in a signed-out browser and then revoked;
- existing OpenRouter text/vision and Stage 1 regression baseline must remain green.
