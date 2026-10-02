# UVMS AI v1.0.1 — Internal verification

This build is the first live-QA polish pass after the Web app was successfully launched in a real browser.

## Verified in the build environment

- Backend test suite: **20 passed**
- Python compile: **PASS**
- JSON configuration parse: **PASS**
- Web CSS brace/structure sanity: **PASS**
- Web TSX parser sanity: **PASS** (offline dependency resolution skipped)
- No `.env`, database files, `node_modules`, pytest cache or Python bytecode are shipped in the archive

## Live-QA changes

- desktop sidebar now truly collapses and expands
- message layout/contrast reworked
- user messages use a clearer right-aligned bubble
- assistant processing state is visible
- Web Search mode is visible in the composer
- upload/listening/thinking states are visible
- main shell now reads actual plan/usage from `/usage/me`
- plan and profile controls were upgraded
- Demo Mode copy is user-facing and marked in stored messages
- responsive chat/composer spacing was tightened

## Still requires the user's machine/device

- `npm install` / full Next.js production build (package download is network-limited in this environment)
- physical Android/iPhone visual QA
- live OpenAI provider test with the user's key
- production domain / TLS / S3-R2 / Redis integration test
