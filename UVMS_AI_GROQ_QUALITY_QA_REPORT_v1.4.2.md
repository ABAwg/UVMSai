# UVMS AI — FINAL LIVE QA REPORT

Date: 2026-09-30. Base version **1.4.2**, unchanged. Provider **Groq**, same backend credential; no new services or fallback.

## Verdict

**Public launch gate remains closed: quality acceptance FAIL / BLOCKED.** The new routing and quality instructions are implemented, but a real Qwen output-token quota prevents completing the required acceptance. No patch bump or certified final release. A clean candidate source ZIP is supplied only as a saved handoff.

| Gate | Current result |
|---|---|
| UZ ×5 | **FAIL / incomplete**. Everyday answer contains malformed words; IT hit quota; two revised attempts exhausted reasoning budget. Three categories remain unrun. |
| Python ×2 executed | **BLOCKED**, 0/2 generated/executed in this round. Previous GPT-OSS Python PASS is historical. |
| React/TS compile ×3 | **BLOCKED**, 0/3 compiled. Qwen high-effort hook request got HTTP 429; no code returned. No compiler repair attempt was possible. |
| Vision ×5 | **DISABLED FOR LAUNCH**. Previous critical hallucination preserved; improved evidence path has not passed live revalidation. Five fixtures prepared and inspected. |
| GPT-OSS smoke | **NOT RUN this round**, as the UZ/coding quality gate did not pass. Historical math/physics/files/charts/SSE/Stop/Retry evidence is retained. |
| Qwen smoke | **FAIL / BLOCKED**; transport success is not a quality pass. |

## Actual requests and quota

Five real backend/browser attempts used `qwen/qwen3.8-27b` through Groq: three upstream HTTP200, two rate-limit failures, zero observed 5xx. All five are persisted in accounting with request IDs and resolved/requested models. The initial two requests preceded the metadata observer: the first 429 is proved by backend `rate_limit`/SSE and UI, but its raw upstream headers/message were not captured. This instrumentation gap is not hidden. After a pause, subsequent calls were serial and spaced by at least 65 seconds.

The captured 429 at **12:56:42.980487 UTC** reports `rate_limit_exceeded`, type `tokens`:

> output tokens per minute (OTPM): Limit 1000, Requested 4096.

The outgoing request was **high reasoning, temperature 0.6, max_completion_tokens=8192**; 4096 is Groq's estimated output reservation reported in the error. Headers simultaneously showed **999/1000 requests and 8000/8000 total tokens remaining**. No `retry-after`; token reset 1 ms, request reset 1m26.4s. This is a hard expected-output limit, not evidence that another immediate retry will work. No further live provider calls were made after this captured limit. Remaining counts are snapshots, not a current balance.

The two earlier high-effort UZ attempts each consumed exactly **4096 reasoning tokens**, returned no visible text and finished by token limit. Accounting captured 4696 and 4702 total tokens; UI showed a readable incomplete-answer error and Retry. The initial completed UZ answer had 450 input +1874 output =2324 tokens but failed manual language review (`Ovqat yashlang`, `nima yalayman?`, malformed invitation wording). Initial failures remain in [cases](docs/qa-evidence/groq-quality/cases.json).

## Scoped implementation

- Default GPT-OSS remains for ordinary RU/EN dialogue, reasoning, math, physics, extracted Files, Projects/Memory and charts.
- Uzbek and coding route to Qwen using the same Groq connection. Language detection uses several lexical signals or explicit output-language intent. Routing sees original user text, not instructions/code inside uploaded files or project resources.
- Coding forces `reasoning_effort=high`, temperature 0.6 and a configurable completion budget. Final default restored to 4096 after the rejected larger-budget probe; it is **not certified sufficient** for coding. UZ final configuration uses `none` reasoning and temperature 0.6 plus Uzbek proofreading instructions; this revision remains **not live validated** after quota stop.
- [Explicit local code verification](ops/verify_generated_code.py) compiles strict React/TypeScript fixtures with emitted JS and executes reviewed Python tests in a temporary work directory without inherited application secrets. No generated code executes automatically in the public backend. The workflow allows at most one repair with exact compiler diagnostics and retains both results.
- Optional Vision path: private strict JSON evidence, validated before use, followed by the existing SSE answer. Two provider attempts are accounted together; cancellation/deadline remains shared. Raw evidence is not shown. This path is offline-tested only.
- **GROQ_VISION_ENABLED=false** by default. Backend denies image analysis, Web/Mobile label it unavailable/Beta and reject image selection. TXT/PDF/DOCX/XLSX/CSV workflows retain their existing paths. The real headed browser confirmed disabled badge, rejected image and available document attachment with zero provider calls.

## Verification actually performed

| Check | Result |
|---|---|
| Targeted backend | **58 PASS**: 55 routing/shared-adapter checks plus 3 added Vision gate/evidence checks; 29 new Groq tests in total. No full-suite claim. |
| Web TypeScript | PASS |
| Mobile TypeScript | PASS |
| Python compile / pip check | PASS / no broken requirements |
| Targeted real browser | **1 PASS**: Vision disabled and document attachment available; zero provider requests |
| Browser live attempts | 5, failures retained; completed UZ stream had 20 increasing DOM paints |
| Full regression / production build / Expo | NOT RUN: user-required live quality gate remains closed |
| Alembic | Normal launcher `upgrade head` succeeded; dedicated drift/full gate not rerun |
| Secret scan / release verifier | See [machine-readable final packaging result](docs/qa-evidence/groq-quality/summary.json). Packaging checks do not certify production quality. |

Historical baseline **155 backend /16 Web unit /25 E2E /2 Mobile SSE /21 Expo checks** predates these changes; not presented as current regression results. The existing managed SSE lifecycle was preserved. Groq 401/403/429/503 contracts and shared timeout/disconnect/malformed handling are covered by labeled offline tests; the two quota errors above were real. Production billing unchanged. Disposable QA account plan restored; ordinary API/Web launcher restored, provider Groq.

## Remaining work and external requirement

External blocker observed now: **sufficient Qwen output-token quota on the existing Groq account for required high-reasoning requests**. No new API key/provider/service is requested. This alone does not certify quality: UZ, coding execution/compilation and the general smoke must still pass, then the full regression and release gates. Vision stays disabled until its five factual cases pass. These unfinished checks and language defects are project work, not external requirements.

Prior independent deployment requirements (actual target HTTPS/domain/runtime and physical-device QA when distributing Mobile) are retained in historical deployment reports; they were not rechecked in this round. Billing/search/image generation remain outside the enabled free-text launch scope.

## Preserved history

- [Initial Groq live QA: 22 HTTP200, UZ/React/Vision quality failures](UVMS_AI_GROQ_INITIAL_LIVE_QA_REPORT_v1.4.2.md)
- [Gemini live QA](UVMS_AI_GEMINI_LIVE_QA_REPORT_v1.4.2.md)
- [OpenRouter QA](UVMS_AI_OPENROUTER_LIVE_QA_REPORT_v1.4.2.md): Integral/Bayes timeouts remain historical **provider limitations**, not a current Groq math failure. Free OpenRouter is never a production model or fallback.
