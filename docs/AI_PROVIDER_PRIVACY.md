# AI provider data flow

Reviewed 2026-09-17 for Stage 1.1. This describes the implementation, not a provider retention guarantee or a finalized legal policy.

## Where requests go

Update 2026-09-18: optional OpenRouter development mode sends text, selected history/context and image pixels to OpenRouter and its chosen free downstream model provider. It uses a separate backend-only `OPENROUTER_API_KEY`. Downstream selection can vary; OpenAI-specific retention descriptions do not govern these providers. OpenRouter mode does not send recordings or image-generation prompts to external media endpoints: those operations remain explicitly demo. See [OpenRouter development configuration](OPENROUTER_DEVELOPMENT.md).

Web and mobile call the UVMS API. Only the backend gateway authenticates to the configured external AI service. Provider credentials belong in backend environment configuration; they are not sent to the browser or mobile application. `OPENAI_BASE_URL` is administrator-controlled. The compatible-provider option requires the Responses, image generation and transcription contracts used by the gateway; arbitrary chat-completions providers are not automatically compatible.

Explicit demo mode makes no external AI requests. Auto mode uses demo when no key exists. Explicit live mode reports missing configuration as an error; a failed live request does not silently become a demo answer.

## Content sent when live AI is used

| Feature | External request content |
| --- | --- |
| Text | Current prompt, a bounded recent conversation suffix, UVMS instructions, linked project instructions, enabled saved memories, and bounded extracted text from selected attachments and project resources. Attachment names may accompany their contents. |
| Vision | Actual pixels from relevant images, decoded and normalized into inline JPEG data, plus associated text. EXIF metadata is removed, orientation corrected, and dimensions reduced to a maximum 1024-pixel edge. Original private storage URLs are not supplied to the model. |
| Search | The text context above and permission for the provider's native web-search tool. The provider generates search queries and may send them to its search infrastructure. UVMS displays only validated HTTP(S) URL annotations returned by the provider. |
| Generated images | The image prompt, selected size/quality and configured model. Returned image bytes are saved in UVMS storage and downloaded through authenticated UVMS endpoints. URL-only provider responses are rejected. |
| Speech-to-text | The recorded audio file, filename and configured transcription model, sent as multipart data. Audio can include background speech. The returned transcript enters the composer for review and is not automatically submitted as a chat message. |

Passwords, refresh cookies and UVMS authorization headers are not added to model input. If users put personal data or credentials in their own prompts/files/audio, those contents can still be transmitted as part of the requested feature. Normalization and context budgeting are not data-redaction systems.

The Responses payload sets `store: false`. This does not establish zero retention for every endpoint, provider, account or abuse-monitoring policy. Deployment owners must confirm their selected provider's data controls. OpenAI documents its controls in [Your data](https://developers.openai.com/api/docs/guides/your-data).

## Local records and logging

UVMS retains its ordinary chats, uploaded/generated files, memories and project data using the existing database/storage lifecycle. The transcription endpoint does not add a transcript to chat history; the user must send it. It reads audio for transcription without creating a persistent file asset.

Private `provider.request` usage records contain identifiers, model/provider mapping, operation, status, available token usage, configured cost estimate, timings, plan and a safe error code. They do not contain the full prompt, answer, file contents or audio. Request and usage identifiers can link operational records to a user's chat, so database access remains sensitive. Admin aggregate statistics require the admin role; ordinary chat metadata and usage responses do not expose private provider records.

Application HTTP logs include request IDs, method/path, status, duration and client IP. They do not log request bodies, cookies, authorization headers or upstream response bodies. HTTPX/httpcore informational logging is suppressed. Unhandled errors log the exception class and request ID instead of dumping database parameters or stack traces. Deployment proxies and external providers have independent logging policies.

## Limits relevant to privacy and reliability

Recent context is selected with a conservative byte-based estimate and an output reserve; this is not an exact provider tokenizer. Very large current prompts are rejected before acceptance, while older history and document excerpts may be omitted or shortened. Vision uses bounded image count, pixel dimensions and file size. This reduces transmitted content but can remove detail needed for a task.

Stop closes the local upstream response when available. Cancellation is best effort: content already sent cannot be recalled, and a provider may still charge for work performed. Missing final usage is recorded as unknown rather than zero.

The optional live smoke runner uses a disposable database and generated test prompts. An audio file is transmitted only when its path is explicitly supplied with `--audio`. Local `.qa/live-provider-results.json` includes private operational identifiers and should not be published as a public product artifact.
