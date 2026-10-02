# Groq — v1.4.3 Public Beta

Production configuration is in `.env.production.example`; use [deployment runbook](../PRODUCTION_DEPLOY.md). Select `UVMS_AI_PROVIDER=groq`, supply `GROQ_API_KEY` only on backend, keep `GROQ_BASE_URL=https://api.groq.com/openai/v1`. Fast/Balanced/Deep aliases all use `openai/gpt-oss-120b`, with low/medium/high reasoning mapping. Whisper transcription uses `whisper-large-v3-turbo`.

All text, including programming and Uzbek requests, stays on the same GPT-OSS model. No Qwen routing, cross-provider fallback or automatic provider retries. Uzbek UI is retained; Uzbek AI is not certified. Vision always fails closed for Groq even with a stale legacy enable flag. Search/images/billing are disabled. Extracted text documents, Projects, Memory and chart JSON retain the existing gateway/API path.

Redis protects10AI operations/user/UTC day,5/minute and3global active calls. Failed admitted calls count. Production fails closed without Redis. Shared429cooldown uses Retry-After/reset headers. Context12000, normal output1536 including reasoning; coding/Deep2048 only with recent sufficient observed token quota. Free users have Fast/Smart; Deep remains a disabled paid-tier control.

Existing managed SSE lifecycle preserves progressive delivery, Stop/disconnect cleanup, Retry, Regenerate, history and accounting. Output usage includes reasoning tokens; interrupted calls may have unknown usage, never fabricated zero. Provider health and usage identify **Groq** and expose only safe rate snapshots/errors/request IDs, never any key fragment.

Final live round:18realHTTP200,0observed429/5xx; answer quality reviewed, initial errors retained. This is Public Beta, not an accuracy guarantee or provider SLA. [Final live QA](../UVMS_AI_FINAL_LIVE_QA_REPORT.md).
