# UVMS AI stabilization and UX QA

## v1.4.2 — Final Live QA · 2026-09-28

Текущая версия: **1.4.2**. Backend **126/126**, Web unit **16/16**, browser E2E **23/23**, Mobile SSE **2/2**, Expo Doctor **21/21**. Web build/TypeScript, mobile typecheck/exports, PostgreSQL и SQLite migrations, Docker staging проверены.

**CODE/LOCAL PRODUCTION READY:** технический release candidate в проверенном scope. **EXTERNAL CERTIFICATION REMAINING; PHYSICAL DEVICE QA REQUIRED.** Бесплатный OpenRouter — только development QA route, не production-модель. Live quality остаётся PARTIAL: были timeouts, safety-classifier output, ошибки кода и плохой UZ.

Integral/Bayes: **provider limitation**; приложение завершает ожидание читаемой ошибкой и предлагает Retry. Успешное live-решение этой задачи не подтверждено. Повторять уже пройденные локальные тесты для этого не требуется.

Полные актуальные результаты: [UVMS AI FINAL LIVE QA REPORT](UVMS_AI_FINAL_LIVE_QA_REPORT.md). Ниже сохранена история предыдущих проходов; старые counts и ограничения окружения не описывают текущую проверку.

Date: 2026-09-16. Scope: this existing Stage 1 workspace, retaining Next.js/React, Expo, FastAPI, SQLAlchemy and Alembic.

## Baseline and results

| Gate | Before this pass | Verified result |
| --- | --- | --- |
| Backend tests | 20 passed | 38 passed |
| Python compile | Checked | PASS |
| Clean SQLite migration | Checked | PASS, `c64f1f9a1a10` |
| Web TypeScript | PASS | PASS |
| Web production build | FAIL: reset-password `useSearchParams` needed Suspense | PASS |
| Mobile TypeScript | FAIL: unsupported font weight and duplicate style key | PASS |
| Web API/session regression tests | Missing | 7 passed |
| Real browser integration tests | Missing | 16 passed; final logout refinement checked separately |
| Web dependency audit | Vulnerable Next.js dependency tree | 0 reported vulnerabilities |

Backend has one dependency deprecation warning about AnyIO's BlockingPortal import in Starlette TestClient. It does not fail tests. The test suite uses disposable databases and files, not user accounts.

## Bugs found and fixed

- **Session recovery:** centralized refresh, deduplicated simultaneous and delayed 401 retries, cookie recovery after reload/new tab, cross-tab rotation serialization where Web Locks is available, and invalid-session cleanup. Browser JavaScript does not receive or persist refresh credentials. Network failures no longer erase a potentially valid session. Logout cannot be undone by an in-flight refresh.
- **Backend session lifecycle:** refresh rotation uses an atomic conditional update. Access JWTs bind to a stable device session, allowing normal rotation without invalidating another tab while making revoke/logout-all/password change effective immediately. Old access JWTs recover through the refresh cookie. Invalid refresh clears its cookie. Origin validation remains enabled.
- **History integrity:** provider failure no longer commits destructive edit/regenerate operations. Failed streams discard failed partial output and never store blank assistants. Accepted user messages have a retry identifier, preventing duplicated prompts. Intentional Stop can preserve a nonempty response marked STOPPED. Completed uploads are reused when retrying an unaccepted message.
- **Race conditions:** chat loading/stream/image/edit/regeneration updates use view versions; late responses cannot replace a newly opened conversation. Cancelled transcription is ignored after New chat. Stop captures its own request/controller. Project loads and history searches ignore stale responses.
- **Settings:** the gear opens real profile/account/usage/preferences/memory/security/password/export/delete/logout controls. Initial hydration no longer overwrites an immediate profile edit. Preferences persist locally and apply to message size, motion, model and search defaults.
- **Voice:** replaced the browser-specific recognition path with MediaRecorder, actual permission acquisition and multipart transcription. Recording, stopping, cancelling, denied permission, unsupported browser, size/time limits and visible errors are handled. Demo transcription is explicitly identified and does not insert a fabricated transcript.
- **Sidebar/history:** immediate first-message refresh, active conversation URL restoration, archived view and real context actions. Count comes from the backend. Search includes message content, with escaped SQL wildcard input and pagination beyond 100 conversations.
- **Library/files/projects/memory:** authenticated previews/downloads/deletes, loading/empty/retry states, project editing and file upload, project-aware chat navigation, real enabled-memory context. Project instructions and file text are sent to the AI gateway. SQLite foreign keys now enforce account deletion cascades.
- **Errors/security:** shared error normalization and toasts avoid raw API JSON in the UI. HTTP, validation, rate-limit and unhandled server errors share a safe error envelope. Rate limits use verified stable user identity; forged bearer strings cannot create unlimited limiter identities, and refresh does not reset a user's budget.
- **Models/search/images:** plan restrictions remain enforced by the backend; locked choices explain availability. Search failure before any answer falls back to ordinary generation without claiming live sources. Citation URLs accept HTTP(S) only. Generated images load through authenticated downloads; demo copy explicitly describes a sample.
- **Responsive/motion:** retained the UVMS shield, dark graphite and lime/cyan palette; refined transitions, drawer, dropdown, message/tool states, recording pulse, upload status, focus, toasts and reduced motion. Mobile attachment/search/image controls are visible. Empty chat no longer automatically scrolls to the bottom; compact laptop spacing improves the welcome screen.
- **Build/dependencies:** reset-password is enclosed in Suspense. Mobile type errors fixed. Next.js updated to 15.5.24 with compatible React 18; PostCSS override removes the audited vulnerable version. [Next.js Windows advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36).

## Functional verification

| Area | Evidence |
| --- | --- |
| Auth | Actual login/logout/reload; deliberately expired signed access token; cookie-only recovery; revoked/expired refresh; refresh deduplication; concurrent backend rotation; logout-all/password/session revocation |
| Chat | Actual streaming, stop, copy, edit/regenerate, rename/archive/restore/delete, persisted reload; forced provider/HTTP failures; retry without duplicate message or file; server content search/count/pagination and ownership |
| Settings | Profile save, preference persistence, export download, password change, logout-all, permanent disposable-account deletion |
| Microphone | Chrome fake audio device exercises MediaRecorder and multipart request; transcription success response fixture; cancellation; denied/unsupported fixtures; backend demo endpoint |
| Attachments | Actual TXT upload/remove/send/download/delete; image display/download; backend PDF/DOCX/XLSX/TXT round trips, unsupported extension and invalid image rejection |
| Projects/memory | Create/edit/delete, instructions, file upload/preview, project chat, leave project; memory add/toggle/delete; captured gateway history proves instructions/file text/enabled memories are used |
| Search/models/images | Toggle state, safe source URL rendering, fallback contract, restricted model rejection, saved model selection, demo image persistence and browser download |
| Billing/admin | Browser demo checkout activation/reload; admin plan/model save, user plan change, disable/enable, refresh/audit; ordinary-user 403; backend regression coverage |
| Responsive | Actual Chrome screenshots at 1920×1080, 1366×768, 820×1180 and 390×844; no document horizontal overflow; drawer open/close and accessible composer actions |
| Console/logs | Lifecycle browser test asserts no uncaught errors or unexpected console errors. Expected 401/403/503 responses are deliberately exercised; API logs inspected. No claim of a clean console across untested providers/browsers. |
| Source controls | Reviewed buttons, handlers, links, disabled states, TODO/NEXT/placeholder/demo/mock/console patterns across Web routes and mobile. No empty primary handlers or `href="#"` found. Legal pages remain explicitly draft. |

Browser automation uses installed Google Chrome through Playwright against a real Next dev server and FastAPI server. Interactive computer-control integration was unavailable, so screenshots were inspected directly. Tests are under `apps/web/tests/browser/qa.spec.ts`; reports/screenshots/logs are local ignored `.qa/` artifacts. Provider-failure, transcription and unsafe-citation fixtures are deliberately mocked and are not evidence of live provider success.

## Commands run

PowerShell, from the repository root unless the block changes directory:

```powershell
# Baseline and final backend checks
Set-Location services/api
../../.venv/Scripts/python.exe -m pytest -q
../../.venv/Scripts/python.exe -m compileall -q app migrations

# Clean migration, in a new isolated database
$env:UVMS_DATABASE_URL='sqlite:///../../.qa/migration-final.db'
../../.venv/Scripts/python.exe -m alembic upgrade head
../../.venv/Scripts/python.exe -m alembic current
Remove-Item Env:UVMS_DATABASE_URL
Set-Location ../..

Set-Location apps/web
npm.cmd run typecheck
npm.cmd test
npm.cmd audit --audit-level=low
npm.cmd run build
npm.cmd run test:e2e
Set-Location ../..

Set-Location apps/mobile
npx.cmd tsc --noEmit
Set-Location ../..

# Visible-control/source audit (results also retained in .qa/source-controls.txt)
rg -n 'button|onClick|href|disabled|TODO|NEXT|placeholder|not implemented|console.log|mock|demo' apps/web/app apps/web/lib apps/mobile/App.tsx
```

Playwright starts `uvicorn app.main:app --host 127.0.0.1 --port 8001` and `next dev -p 3100` automatically. Its config explicitly sets `.qa/browser.db`, `.qa/storage`, demo providers, a test-only signing key and a high **test-only** auth threshold so repeated account setup does not exhaust normal login limits. Application defaults remain enforced outside tests. It requires the local `.venv` and installed Chrome on this Windows setup.

Dependency updates used `npm.cmd install next@15.5.24 --save-exact`, `npm.cmd install --save-dev @playwright/test`, and an install after adding the PostCSS override. Lockfile is included.

## Remaining limitations and release boundaries

- Live AI chat/search/image/transcription quality, real microphone audio and permissions on Safari/Firefox/iOS/Android still need target-provider/device QA. Chrome audio input in automation is synthetic.
- Mobile TypeScript passes, but no physical Android/iPhone build or camera/mic/SecureStore/deep-link session was available. Web drag/drop is implemented in the composer and source-reviewed; file-picker integration is the automated upload path.
- Production PostgreSQL, Redis multi-worker cancellation, S3/R2, SMTP delivery, HTTPS/domain deployment, payments and load testing are not certified by these SQLite/local tests. Demo checkout does not charge money.
- DOCX/XLSX offer download fallback instead of an embedded office renderer. PDF preview relies on browser PDF support. Current composer upload cap remains 20 MB even if a paid plan allows larger files elsewhere.
- Exact per-byte upload percentages are not available through fetch; UI reports the active file and completed-file count. Cancelled/failed uploads can remain legitimate Library assets.
- Native rename/delete confirmation dialogs remain in use. User-facing legal pages are draft and require actual business details and review.
- Web dependency audit reports the current known advisory result, not a comprehensive security certification. High-confidence credential scan checked 86 source/config/documentation files and found no matching credential files. This is not an exhaustive secret audit; local `.env` files and generated data are excluded from deliverable source.
- Existing services on 3000/8000 belong to another checkout. They were not stopped or edited. Use the separate preview URL recorded below to inspect this workspace's changes.

## Final verification

- Final full Chrome suite: **16 passed** (`.qa/e2e-final.log`). This includes late transcription/image responses and scrolling upward during an actual streamed answer.
- After the final logout error-handling refinement, the auth scenario was rerun: **1 passed** (`npm.cmd run test:e2e -- --grep 'session recovery'`, `.qa/e2e-auth-final.log`). It forces a failed logout, verifies visible Retry, then completes logout/login and expired-refresh cleanup.
- Final Web TypeScript and production build: **PASS** (`.qa/build-final.log`). Backend **38 passed**, Web API tests **7 passed**, Mobile TypeScript **PASS**. Clean migrations, Python compilation and dependency audit passed as described above.
- Updated local preview: **http://127.0.0.1:3001**. This workspace's API is **http://127.0.0.1:8002**, with `/live` = `ok` and `/ready` = `ready`. Existing 3000/8000 services remain untouched.
- Preview uses `NEXT_PUBLIC_API_URL=/api/v1`, `UVMS_API_INTERNAL_URL=http://127.0.0.1:8002`, and `UVMS_QA=1` only to keep dev output separate from the production build. The API uses this workspace's normal configuration/database, with preview CORS origins for port 3001 and cookie name `uvms_beta_refresh` so another localhost checkout's refresh cookie is not overwritten. Regression tests use their separate database.
- API preview logs are `.qa/preview-api.log` and `.qa/preview-api-error.log`. The API was launched hidden with PowerShell `Start-Process`; Web runs in a managed command session. Commands: `node node_modules/next/dist/bin/next dev -p 3001 -H 127.0.0.1` in `apps/web`, and `.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8002` in `services/api` (using the absolute Python executable path).

Local stabilization gates are met. Real-provider, production infrastructure and physical-device release checks above remain open; this report does not certify a production deployment.
