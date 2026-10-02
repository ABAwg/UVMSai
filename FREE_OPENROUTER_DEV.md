# OpenRouter free development: live verification

Date: 2026-09-18. Scope: the existing development OpenRouter Responses adapter. This is **not production model identity or completion of Stage 1.1 paid OpenAI acceptance**. Configuration details: [docs/OPENROUTER_DEVELOPMENT.md](docs/OPENROUTER_DEVELOPMENT.md).

## Current result

The locally configured separate `OPENROUTER_API_KEY` successfully authenticated real generation. The API was restarted in OpenRouter development mode. All aliases request `openrouter/free` at `https://openrouter.ai/api/v1`; OpenAI configuration remains preserved. Keys were never printed or sent to Web/Mobile.

Real text, visible browser streaming, previous-turn continuity, Retry, active Stop, and manually reviewed PNG/JPEG vision succeeded. Free routing also produced unusable answers and a timeout; these are retained below. Image generation and voice remain explicitly **demo**, Search is disabled, and none counts as live evidence.

The headed Chrome Web UI was exercised at `http://localhost:3001`, through the real Next proxy and API on port 8002. Dedicated ordinary Free QA accounts were used. Deep was visibly locked with PLUS required; the user's own subscription was not inspected or changed. Deep succeeded only in the smoke runner's isolated Plus QA account.

## Opt-in live smoke

From repository root:

```powershell
$env:UVMS_LIVE_PROVIDER_TESTS='1'
.\.venv\Scripts\python.exe ops/live_provider_smoke.py --vision
```

All four cases passed: Fast, Balanced, Deep text and a vision request containing PNG/JPEG/WEBP. These are real Responses API calls, not demo output. Smoke vision acceptance establishes transport only; browser answer inspection below establishes understanding for PNG/JPEG.

| Alias / smoke case | Resolved model returned privately | Input / output / total tokens | Gateway first text (ms) |
| --- | --- | --- | --- |
| Fast | `cohere/north-mini-code:free` | 75 / 116 / 191 | 5592.14 |
| Balanced | `nvidia/nemotron-3.5-lightning:free` | 93 / 393 / 486 | 16221.05 |
| Deep | `poolside/laguna-s-2.1:free` | 91 / 15 / 106 | 2471.67 |
| Balanced vision | `dots-studio/dots-3-note-preview:free` | 118 / 206 / 324 | 3879.39 |

Evidence: `.qa/openrouter-live-smoke.log`, `.qa/openrouter-live-smoke-results.json`. The latter is a dedicated copy because the generic `live-provider-results.json` is overwritten by each smoke run. These gateway measurements are **not browser latency**.

## Browser observations

First visible text was measured from the Send/Retry button click with browser `performance.now()`, a MutationObserver and animation-frame observations of the rendered assistant text. This includes application/network/rendering work; vision also includes upload. Counts are distinct visible text updates, not provider token counts. These are individual observations under local QA load, not a latency SLA.

| Real browser request | First visible text (ms) | Visible updates | Result |
| --- | ---: | ---: | --- |
| Fast, English explanation after streaming fix | 4195.6 | 14 | Progressive text; chlorophyll explanation coherent |
| Balanced, Russian explanation + project code | 4441.2 | 58 | Progressive Russian; minor grammatical error |
| Balanced, previous-turn recall | 1810.7 | 2 | Exactly `RIVER-73` |
| Balanced, PNG question | 2996.5 | 1 | Correct shapes, colors and order |
| Balanced, JPEG question | 4992.6 | 1 | Correct count, colors and left shape |
| Balanced, successful Retry | 3019.2 | 1 | Real English answer, one user message |
| Balanced, actively stopped story after accounting fix | 10586.6 | 4 | Cancelled; partial answer persisted and accounted |
| Balanced, final Stop after serialized cleanup | 2196.9 | 2 | Cancelled; reload and private accounting verified |

Short answers delivered in one visible update are not used as progressive-streaming proof. Fast and Balanced above supply that proof. Before the gzip fix, Fast/English, Balanced/Russian and Balanced/Uzbek each appeared in one buffered update at 4301.1, 3954.3 and 4429.5 ms respectively. Those failed streaming observations are excluded from the successful evidence.

- **Russian:** the rainbow explanation was understandable. The later leaves response preserved the project code but contained an agreement error ("отражённое зелёное свет"). Transport and continuity pass; language polish is imperfect.
- **Uzbek:** a real Uzbek response to a Tashkent spring-walk prompt arrived, but several tips were unnatural or incorrect, including "namoz vaqtlarida ichishingiz lozim". Language delivery is verified; answer quality is **not accepted as consistently good**. Resolved model: `inclusionai/ling-3.0-flash-fin:free`.
- **English:** simple plant/vocabulary answers were coherent. A longer plant-facts answer also invented etymology and other facts. Successful transport does not certify factual accuracy.
- **Retry:** a single browser network request was deliberately aborted (`connectionreset`). UI showed "Could not connect. Check your connection and try again." with Retry, without provider JSON or a blank assistant. Retry reached the real router and answered successfully without duplicating the prompt. This is a controlled network-failure test, not an observed upstream authentication failure. A backend-restart 503 also produced a safe temporary-unavailable message and Retry.
- **Stop:** one story was stopped after 101 visible characters, with in-flight deltas leaving 170 characters. After the final cleanup serialization, another story was stopped after 326 visible characters, leaving 384. UI exited generation; reload showed the partial answers with STOPPED. Both private events are `cancelled`. An earlier long request produced no first token and timed out; it does not count as active-stream Stop evidence.
- **Plans:** Fast and Balanced were available on the QA Free plan. Deep's browser test is not performed because it is locked; no elevation was used to bypass plan enforcement.

### Vision answer quality

Two neutral-named, real image files were uploaded with questions that did not disclose their content. Their pixels were visually inspected against the returned answers:

- `.qa/live-vision/scene-a.png`: blue square on the left, red circle on the right. Answer: "Left to right: a blue square, then a red circle." Correct. Resolved `nex-agi/nex-n2.5-pro:free`.
- `.qa/live-vision/scene-b.jpg`: green triangle on the left and three yellow circles on the right. Answer reported three yellow/gold circles and a green triangle on the left. Correct. Resolved `inclusionai/ling-3.0-flash-vl:free`. Completed answer survived reload.

These verify image + text understanding for these simple images only. Browser WEBP quality was not separately examined. No live unsupported-vision response occurred in these calls; safe capability errors remain covered by deterministic adapter tests, not claimed as a live failure observation.

## Failures and narrow fixes

1. **Next proxy buffered gzip-compressed SSE.** Before the fix, CDP showed `content-encoding: gzip`, one response body chunk and one visible update despite many SSE deltas. Added `Cache-Control: no-cache, no-transform` to the stream response. Afterward encoding was absent and both Fast/Balanced visibly updated repeatedly. A browser regression uses the actual Next proxy.
2. **Silent provider exceeded the total timeout.** A real request resolved to `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`, produced no text and recorded 270742 ms with `timeout` despite the 120-second setting. The consumer now checks its own deadline even when no SSE line arrives; HTTP cleanup is bounded so a socket-reader lock cannot hold completion. Silent-stream and slow-close fixtures verify this; no claim is made that a second 120-second live stall was intentionally induced.
3. **Browser disconnect delayed cancellation accounting.** A stopped answer could persist while its synchronous generator remained suspended and UsageEvent finalization was delayed/missing at restart. The stream now explicitly closes the generator under cancellation shielding. A new actual-browser regression checks the resulting `cancelled` database event. A full intermediate run exposed a cleanup race (`generator already executing`, followed by SQLite lock errors; 14 passed / 4 failed). Read/close operations are now serialized, and disconnect signals cancellation before cleanup. The affected streaming/Stop/attachment cases then passed. Real OpenRouter story cancellation confirmed `cancelled` accounting. Earlier missing rows were not fabricated or backfilled. Intermediate failure evidence: `.qa/openrouter-e2e-generator-close-race.log`.
4. **Router output quality remains variable.** Several requests resolved to `nvidia/nemotron-3.5-content-safety:free` and returned only "User Safety: safe" instead of the requested answer. Other models returned questionable Uzbek/factual content. These are unsuccessful task answers despite successful provider transport. No silent model substitution or output rewriting was introduced.

No provider architecture rewrite, unrelated redesign, paid fallback, or changed production model identity was made.

## Private accounting

Read the QA users' `UsageEvent(kind='provider.request')` rows directly. Every completed live row inspected records `provider=openrouter`, `provider_model=openrouter/free`, the UVMS alias, resolved provider model when returned, duration, gateway first-token time, operation, status, and returned input/output/total usage. Token totals match input + output in the observed completed rows. Vision currently uses the existing `operation=text` classification because it runs through the text/vision Responses path; no separate vision-operation label is claimed.

For example, Fast after the streaming fix resolved `nex-agi/nex-n2.5-mini:free`, returned 823 / 301 / 1124 tokens, and recorded first-token 3710.23 ms / duration 4656.95 ms. Russian Balanced resolved `inclusionai/ling-3.0-flash-vl:free`, returned 1014 / 448 / 1462 tokens, and recorded 4025.30 / 5094.06 ms. These gateway timings differ from browser observations as expected.

Active Stop request `866d8e8d-6ba4-4b6d-8c12-6d815139dd85` resolved `nvidia/nemotron-3.5-lightning:free`, status `cancelled`, first-token 10054.08 ms and duration 10209.04 ms. The final request after serialized cleanup, `477ca651-66e3-4bbb-8332-4279a466908c`, resolved `liquid/lfm-2.5-2.6b:free`, status `cancelled`, first-token 1845.82 ms / duration 2280.87 ms. Tokens remain null / `usage_complete=false` because cancellation prevented final provider usage. This is not zero-token usage.

Final browser-account export contains 17 rows: 13 completed, 3 cancelled, 1 failed. Assertions confirmed router identity for all rows, input + output = total for all completed rows, and unknown cost for every unpriced request. These counts exclude the smoke runner's isolated database.

Provider-reported: resolved model and returned token usage. UVMS-measured: duration and gateway first-token time. Config-derived: provider/requested alias and operation. Local status: completed/failed/cancelled. Cost is a local estimate only when configured rates exist. This environment has no router price entry, so `estimated_cost_usd` remains **null (unknown)**. No invoice reconciliation or live cost estimate is claimed; deterministic tests cover configured zero router rates.

Additional resolved browser models included `poolside/laguna-xs-2.1:free`, `nvidia/nemotron-3-ultra-550b-a55b:free`, `poolside/laguna-s-2.1:free`, and `liquid/lfm-2.5-2.6b:free`. These private QA identities are not displayed in normal chat UI.

Local evidence: `.qa/openrouter-browser-usage.json`, `.qa/openrouter-browser-transcript.json`, `.qa/openrouter-active-stop.json`, `.qa/openrouter-stop-final.json`, `.qa/openrouter-stop-final.png`, `.qa/openrouter-stop-mutex-final.json`, `.qa/openrouter-stop-mutex-final.png`. Earlier latency/update observations above were transcribed from the browser automation results; no HAR or complete first-session observer dump was retained after an automation runtime reset. Saved QA transcripts corroborate answers but do not independently encode rendering latency.

## Regression gates

Affected checks first: provider/OpenRouter/stabilization tests **72 passed**; actual Next-proxy progressive streaming, disconnected Stop accounting and attachment/image lifecycle **3 passed**. Final backend: **92 passed**, one existing Starlette/AnyIO deprecation warning. Final browser suite: **18 passed** (2.0 minutes), with no generator-executing or SQLite-lock errors. Web API/session: **7 passed**. Web/Mobile TypeScript, Python compile and clean SQLite Alembic upgrade to `d71b2e41aa11` passed. Web production build **passed**, with all 13 pages generated and exit code 0.

Commands (Windows):

```powershell
# services/api
..\..\.venv\Scripts\python.exe -m pytest -q
..\..\.venv\Scripts\python.exe -m compileall -q app migrations
# UVMS_DATABASE_URL pointed at a NEW isolated .qa database for these:
..\..\.venv\Scripts\python.exe -m alembic upgrade head
..\..\.venv\Scripts\python.exe -m alembic current
# apps/web
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
# apps/mobile
npx.cmd tsc --noEmit
```

Final logs: `.qa/openrouter-live-final-{backend,e2e,web-tests,web-types,build,mobile-types,migrations}.log`. An intermediate concurrent TypeScript run collided with Next E2E regeneration of `.next-e2e/types` (TS6053 missing generated files); the succeeding check was run after E2E finished. A later E2E startup hit Windows EBUSY on a generated manifest before tests began; the generated cache was moved within the workspace and rebuilt. Evidence: `.qa/openrouter-e2e-windows-cache-lock.log`. Neither failure was suppressed by weakening tests.

## Remaining limits

- Free-router model availability, latency, task quality and capabilities vary; it is unsuitable as a promised production model identity. A successful vision call does not ensure the next route supports the same task.
- Deep browser acceptance remains plan-gated; only the isolated Plus API smoke covers it.
- No live search, generated images, transcription or physical-microphone acceptance is claimed in this mode. Images/voice are visibly demo and Search disabled.
- The original full Stage 1.1 OpenAI acceptance remains incomplete, including paid media/search/voice, extended context and invoice-independent cost verification. OpenRouter development results do not close those production items.
