# Gemini live evidence — 2026-09-30

Current result: **overall FAIL / remaining tasks blocked by provider availability and quota**. These are real Google requests; no fallback was used. See [FINAL LIVE QA REPORT](../../../UVMS_AI_FINAL_LIVE_QA_REPORT.md).

- `http-observation.jsonl`: allowlisted endpoint, model, effort, HTTP status and numeric usage from the real transport; no headers, credentials or prompt bodies.
- Task JSON files distinguish transport completion from reviewed quality. Initial failures are retained.
- `accounting.json`: persisted request IDs and Gemini provider/model/attempt status, collected before the thinking-token normalization fix. Historical rows were not rewritten.
- `probe-*.json`: low/medium/high real READY probes. `coding-react-check.json`: behavioral checks of the actual returned code.
- `flow-retry-errors.json`: three controlled UI error fixtures are explicitly labeled; its final `recovered` section is a real Gemini HTTP 429.
- `browser-readonly.json`: actual reload/history, project-file persistence and Admin quota diagnostic; zero provider requests during that check.
- Project live prompt was not submitted: the first harness expected a selected project after reload. Correctly reselecting it verified persistence. The Gemini context check remains blocked.
- No live Stop/regenerate or simultaneous two-tab acceptance is claimed. Previous automated fixture evidence remains separate.

The older `../gemini-integration` directory is historical pre-key evidence dated 2026-09-29, superseded by this directory.
