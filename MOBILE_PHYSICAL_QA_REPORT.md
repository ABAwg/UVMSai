# UVMS AI v1.2.0 — Physical Mobile QA status

## v1.4.2 automated pass — 2026-09-25

TypeScript PASS; SSE 2/2; Expo Doctor 21/21; public/introspect config PASS; Android and iOS Hermes production exports PASS. Native hardware and signed builds are **NOT VERIFIED — EXTERNAL/PHYSICAL REQUIREMENT**. **PHYSICAL DEVICE QA REQUIRED**. See the [final report](UVMS_AI_FINAL_LIVE_QA_REPORT.md) for mobile fixes and dependency caveats.


## Current v1.2 handoff

The supplied SDK 57 base had already opened successfully in Expo Go on the user's physical iPhone before this v1.2 pass. The new v1.2 source now bundles successfully for iOS/Android in both production and development export modes and passes Mobile TypeScript. **The changed v1.2 UI/provider flow itself has not yet been physically re-tested**, so the final device rows below remain an acceptance task rather than inferred PASS values.

Key v1.2 device checks: the chat header should show `OpenRouter live` when the root development backend has only `OPENROUTER_API_KEY`; a normal Russian prompt must produce a real provider answer rather than the old `Welcome to the UVMS AI demo` template; Markdown markers should render; Stop/Retry/Regenerate and branch/share actions should work; gallery/camera vision, keyboard/safe-area, background/resume and Web↔Mobile sync should be exercised.

---

# UVMS AI — Stage 1.2 Mobile Physical QA Report

Date: 2026-09-18

## Status

**Implementation/preflight ready; physical-device certification is still open.**

The mobile client was upgraded for Stage 1.2 and TypeScript validation passes in the prepared workspace. This environment cannot operate the user's physical iPhone/Android hardware, grant real device permissions, move the app between foreground/background, or prove LAN behavior on the user's network. Those items must be recorded after running `QUICK_RUN_MOBILE_WINDOWS.bat` on the target PC and phone.

## Implemented for physical QA

- Expo LAN API configuration through `EXPO_PUBLIC_API_URL`; no fixed developer IP in source.
- SecureStore-backed mobile session and selected-model persistence.
- access-token refresh and retry through the shared backend session model.
- real mobile SSE chat path using the backend `/chat/stream` endpoint.
- progressive assistant deltas, tool/search status, citations, Stop and accepted-message Retry.
- conversation restore and project-aware chat navigation.
- plan-backed model selector with unavailable-tier explanation.
- camera, gallery and document selection with upload/attachment state.
- image preview and shared Mobile Library list/delete/reuse flow.
- Projects create/edit/delete, instructions, project files and project chats.
- Memory add/toggle/delete.
- native recording timer/start/stop/cancel UX. OpenRouter development transcription remains explicitly demo.
- account/profile, usage/plan, session revoke/logout-all/password/delete account surfaces.
- foreground refresh, network/offline status and user-safe errors.
- subtle screen/messaging/recording/loading interaction states.

## Provider boundary during this QA

Current free OpenRouter development mode may be used for **real text streaming and vision**. Search remains disabled; generated images and transcription remain clearly labelled demo. Free-router model quality/capabilities vary and are not production identity.

## Local verification completed in this handoff

- Backend regression: **92 passed** (`python -m pytest -q` from `services/api`).
- Python compile: **PASS** for `services/api/app`, migrations and `ops`.
- Mobile TypeScript: **PASS** (`npm run typecheck`).
- Expo/Metro Android export bundle: **PASS**.
- Expo/Metro iOS export bundle: **PASS**.
- Mobile SSE parser smoke: **PASS** for CRLF, JSON frames, progressive rest buffering and multiline data.
- Mobile JSON configs/package lock: **PASS**.
- No provider key or root `.env` is included in the clean deliverable.
- Web source was not changed in this handoff, so the incoming **18 browser E2E / 7 Web API-session / Web production-build PASS** evidence from `FREE_OPENROUTER_DEV.md` is preserved rather than falsely reported as rerun here.

## Physical evidence required

Fill this section on real devices.

| Area | iPhone | Android | Notes |
| --- | --- | --- | --- |
| Install/open | NOT TESTED | NOT TESTED | |
| Login + session restore | NOT TESTED | NOT TESTED | |
| Live streaming | NOT TESTED | NOT TESTED | |
| Stop + Retry | NOT TESTED | NOT TESTED | |
| Camera | NOT TESTED | NOT TESTED | |
| Gallery | NOT TESTED | NOT TESTED | |
| Document picker | NOT TESTED | NOT TESTED | |
| Live vision | NOT TESTED | NOT TESTED | |
| Recording UX | NOT TESTED | NOT TESTED | OpenRouter transcription is demo |
| Projects | NOT TESTED | NOT TESTED | |
| Memory | NOT TESTED | NOT TESTED | |
| Library | NOT TESTED | NOT TESTED | |
| Background/foreground | NOT TESTED | NOT TESTED | |
| Wi-Fi interruption + Retry | NOT TESTED | NOT TESTED | |
| Web ↔ Mobile sync | NOT TESTED | NOT TESTED | |

## Physical test instructions

See `docs/MOBILE_PHYSICAL_QA.md`.

## Release boundary

Do not call Stage 1.2 physically certified until at least the target iPhone and Android release path have actual evidence. If only one platform is available, keep the other platform explicitly `NOT TESTED` rather than inferring success from shared React Native code.
