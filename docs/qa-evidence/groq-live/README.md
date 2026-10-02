# Groq live evidence — 2026-09-30

Real HTTP metadata, persisted accounting and browser answers; credentials/headers outside the rate-limit allowlist are excluded. `summary.json` contains the manual quality reviews and exact last observed rate-limit headers per model. See [FINAL LIVE QA REPORT](../../../UVMS_AI_FINAL_LIVE_QA_REPORT.md).

All 22 upstream responses were HTTP 200. Quality failures remain failures. `flow-memory.json` corrects a harness comparison that rejected a narrow nonbreaking space; the answer was not regenerated. Project upload was resumed after correcting the harness's creation-busy race; the first attempt never uploaded a file or called Groq. Neither harness error is attributed to the application.

`flow-retry-errors.json` labels controlled browser SSE error fixtures; its recovered answer is a real Groq reply. No actual Groq 429/5xx occurred. `coding-react-raw.md` proves the missing closing brace was in persisted provider output, not introduced by rendering. `bayes-render-check.json` records malformed model LaTeX handled by the existing safe fallback.

The full regression/release gates were not run because the user required a successful live acceptance first. No final ZIP or patch version was produced. Older Gemini/OpenRouter artifacts are historical and do not represent this Groq source state.
