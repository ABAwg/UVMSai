# UVMS AI v1.2.0 — Mobile Experience release report

Date: 2026-09-21

## Scope

v1.2.0 is a focused Mobile Experience release on top of the v1.1.0 Conversation Power backend. It keeps the shared Web/Mobile account, chats, Projects, Memory, Library, pinned chats, Temporary Chat, branching, shared snapshots and exports, while upgrading the physical-phone experience and fixing the OpenRouter auto-provider path that caused a configured iPhone client to receive demo answers.

## Main changes

### Live text provider routing

- Added one provider resolver for backend text requests.
- `UVMS_AI_PROVIDER=auto` now selects OpenAI when an OpenAI key exists, or OpenRouter in development/demo/test when OpenRouter is the only configured provider key.
- A configured OpenRouter key is no longer silently ignored by `auto`, which was the root cause of Mobile showing demo answers despite a valid backend key.
- Explicit provider choices remain authoritative.
- OpenRouter remains text/vision development routing only: Search is disabled and image generation / speech transcription stay demo in this mode.
- `/capabilities` now exposes non-secret `provider` and `text_live` status for the clients.
- Provider secrets remain backend-only.

### Mobile UI / interaction pass

- Version bumped to 1.2.0 on Expo SDK 57 / React Native 0.86 / React 19.2.
- Chat header simplified around back, title, provider state, model selector and overflow actions.
- Branch / Share / New chat actions moved out of the crowded header into a conversation action sheet.
- The old horizontal tool strip was replaced by a compact `+` action sheet for Photo, Camera, File, Library, Voice, Search and Image.
- Added clearer live/demo provider indication inside chat and Account/About.
- User bubbles and assistant messages were rebalanced: assistant answers are now document-style instead of large empty cards.
- Added long-press message actions for Share, Regenerate, Branch from here and reuse-as-draft.
- Added clearer press/scale feedback to high-value actions; Android also receives short vibration feedback.
- Improved spacing, touch targets, typography, composer sizing, modal/action-sheet layout and safe-area use.

### Markdown / code presentation

Mobile no longer shows common Markdown markers as raw text. The renderer now handles:

- paragraphs;
- bold / italic;
- H1-H3 headings;
- ordered and unordered lists;
- blockquotes;
- inline code;
- fenced code blocks with language label and selectable code;
- links;
- separators;
- simple table-like rows with horizontal scrolling.

### Streaming and existing Mobile features preserved

The existing real `/chat/stream` path, progressive deltas, Stop/cancel, Retry, camera/gallery/document uploads, Library, Projects, Memory, account/session handling, Temporary Chat, branching and share snapshots remain in the same client rather than being replaced by a second parallel implementation.

## Verification performed in this handoff

### Backend

- Python compile: **PASS**
- Full pytest suite: **99 passed**
- Clean SQLite Alembic upgrade: **PASS**
- Alembic current: **e2c7c0d4a4b1 (head)**
- Alembic check: **PASS — no new upgrade operations detected**
- Provider resolver smoke: `auto + development + OpenRouter key + no OpenAI key` -> `openrouter`; text live; image/voice demo: **PASS**

No external provider call was made from this build sandbox, so this report does not claim a new live-network OpenRouter acceptance run. Previous project QA already contains live OpenRouter evidence; v1.2 changes specifically repair provider selection before that existing adapter is invoked.

### Mobile

- `package.json`: Expo `~57.0.24`, React Native `0.86.3`, React `19.2.3`
- Installed Expo CLI used for QA: `57.0.26`
- Expo config resolves SDK: `57.0.0`
- Mobile TypeScript: **PASS**
- iOS production Hermes export: **PASS**
- Android production Hermes export: **PASS**
- iOS development export: **PASS**
- Android development export: **PASS**

`expo-doctor` is not installed in this sandbox and package registry access is unavailable here, so it was not re-run for this v1.2 handoff. The supplied fresh base had previously reported 21/21 doctor checks after the SDK 57 upgrade; v1.2 does not downgrade those SDK dependencies.

### Web

- Web API/session tests: **7 passed**
- Web TypeScript: **PASS**
- Production build started but the Linux sandbox has only the Windows SWC binary from the user's Windows archive. Next.js attempted to download `@next/swc-linux-x64-gnu` and registry DNS was unavailable (`EAI_AGAIN`). Therefore the build is **environment-blocked, not recorded as PASS** in this report.
- `QUICK_SETUP_WINDOWS.bat` remains the target-machine production-build gate.

## Physical device status

The earlier SDK 57 base was opened successfully by the user on a physical iPhone through Expo Go. The v1.2.0 UI/provider changes in this release have **not yet been physically certified** on the user's iPhone. That is intentionally the next user-visible gate: test one complete final build rather than intermediate versions.

Recommended v1.2 iPhone acceptance:

1. launch with `QUICK_RUN_MOBILE_WINDOWS.bat`;
2. confirm header says `OpenRouter live` when the root `.env` contains the OpenRouter key in development;
3. ask normal Russian questions and verify real answers instead of the old demo template;
4. verify Markdown, long answer scrolling, Stop, Retry/Regenerate and model switching;
5. test gallery + camera image understanding;
6. background/foreground the app and reopen the same chat;
7. verify Projects, Memory, Library, Shared Links and Temporary Chat still work;
8. verify Voice/Image/Search labels match actual availability.

## Known boundaries

- OpenRouter free routing is development-only and its upstream model/quality can vary.
- Search remains disabled in OpenRouter development mode.
- Image generation and voice transcription remain demo in OpenRouter development mode.
- v1.2 physical iPhone acceptance is still pending.
- Android physical-device acceptance is still pending.

