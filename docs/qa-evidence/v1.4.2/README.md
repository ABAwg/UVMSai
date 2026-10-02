# v1.4.2 QA evidence

Final review: 2026-09-28. Read [the full report](../../../UVMS_AI_FINAL_LIVE_QA_REPORT.md) for scope and failed AI attempts.

- [Test and acceptance summary](summary.json)
- [Production architecture probe](production-final-result.json): isolated synthetic staging, **demo edge SSE**, not live AI certification.
- [Live Stop / Regenerate](stop-retry-result.json)

## Critical screenshots

- [Live progressive answer](long-stream.png), [stopped partial](stop-partial.png), [cross-tab logout](multitab-logout.png).
- [Math / physics](advanced-physics.png), [programming](programming-corrected.png), [vision](vision.png), [documents](documents.png), [long document conclusion](long-document-acceptance.png).
- [Project context](project-context-final.png), [Library](library-desktop.png), [Admin](admin.png).
- Charts: [desktop bar](chart-desktop-0.png), [pie](chart-desktop-1.png), [scatter](chart-desktop-2.png); [mobile bar](chart-mobile-0.png), [pie](chart-mobile-1.png), [scatter](chart-mobile-2.png). Mobile plots scroll inside the card and expose a complete value table.
- Mobile pages: [chat](final-mobile-chat.png), [Projects](final-mobile-projects.png), [Memory](final-mobile-memory.png), [Library](final-mobile-library.png), [Settings](final-mobile-settings.png), [Billing](final-mobile-billing.png).

## Reproduction

From `services/api`: `..\..\.venv\Scripts\python.exe -m pytest -q`, `python -m compileall -q app migrations`, `python -m pip check`, `python -m alembic check`.

From `apps/web`: `npm test`, `npm run typecheck`, `npm run build`; set `UVMS_E2E_WEB_PORT=3110` and `UVMS_E2E_API_PORT=8010`, then `npx playwright test`. The cancellation fixture is paced only in `services/api/tests/browser_server.py`, which refuses a non-demo provider.

From `apps/mobile`: `npm run typecheck`, `npm test`, `npx expo-doctor`, and Expo export for each platform with an explicit API URL. Native devices remain unverified.

From root: `python ops/release_verify.py --mode working-tree`; use `--mode archive` against a clean release source copy. Credentials, browser profiles, runtime DBs and `.qa` are excluded from that copy.

No image in this directory is proof of physical-device QA or production-provider certification.
