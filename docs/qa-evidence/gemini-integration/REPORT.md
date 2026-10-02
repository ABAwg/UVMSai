# UVMS AI FINAL LIVE QA REPORT

**Дата:** 2026-09-29. **База:** v1.4.2. **Изменения:** Gemini integration candidate, без повышения версии.

## Итог

**LOCAL REGRESSION: PASS. GEMINI LIVE ACCEPTANCE: BLOCKED.** Реальный `GEMINI_API_KEY` в локальном `.env` не задан. В headed Chrome отправлен запрос «Ответь одним словом: READY». Backend вернул SSE error `configuration`, читаемое сообщение и Retry; пустое сообщение assistant не сохранено. В accounting записана одна неуспешная Gemini-попытка приложения с **0 обращений к upstream**.

Gemini production-ready не объявляется. HTTP 200 у SSE означает открытый транспорт, а не успешный ответ модели. Patch version и финальный production-релиз отложены до реального live acceptance. Текущий ZIP — **integration candidate**, не сертифицированный Gemini release.

## 1. Реализация

- Добавлены `UVMS_AI_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_BASE_URL`, `GEMINI_MODEL_FAST/BALANCED/DEEP`.
- Официальный endpoint: `https://generativelanguage.googleapis.com/v1beta/openai/`; Chat Completions adapter внутри существующего gateway. Fast/Balanced/Deep → `gemini-3.8-flash`, reasoning `low/medium/high`.
- Gemini использует только свой backend credential. Старые model routes в БД и `UVMS_MODEL_*` не меняют Gemini aliases; reasoning не понижается незаметно. Фактический acceptance всех трёх effort ещё не проверен.
- Сохранены API-контракты, provider-neutral SSE, общий deadline/Stop, request IDs, complete/regenerate/history, context из Projects/Memory/Files, Vision image input, charts/math/Markdown/code renderers и accounting.
- Usage нормализуется из prompt/completion/total tokens; неизвестные usage/cost остаются неизвестными. Новый provider label Gemini присутствует в Web, Mobile, Admin и группировке usage.
- Admin показывает модель, available/unavailable либо отсутствие свежей проверки, последнюю безопасную ошибку и время. Admin-only Check provider выполняет READY через gateway и accounting; неправильный ответ при HTTP 200 — ошибка проверки. Ни ключ, ни его часть не показываются.
- Gemini adapter не реализует native search, image generation и audio transcription: эти возможности выключены без скрытого перехода на другой ключ или demo. **Vision PNG/JPEG — отдельная поддерживаемая возможность входного контекста.**

Контракт сверялся с [официальной документацией Google](https://ai.google.dev/gemini-api/docs/openai). Документация и synthetic tests не заменяют live validation.

## 2. Regression

| Gate | Итог |
|---|---|
| Backend full pytest | **155 PASS**; 27 Gemini-specific tests, 2 новых disconnect regressions; одно upstream Starlette/AnyIO deprecation warning |
| Python compile / pip check | **PASS / PASS** |
| Alembic на новой SQLite DB | **PASS**, `e2c7c0d4a4b1`, no drift |
| Web unit | **16 PASS** |
| Web TypeScript / production build | **PASS / PASS** |
| Browser E2E | **25 PASS**, включая Gemini UI/Admin/quota fixtures, progressive SSE, Stop/accounting, Retry, reload/history, two tabs |
| Mobile TypeScript / SSE | **PASS / 2 PASS** |
| Expo dependency check / Doctor | **PASS / 21 из 21 PASS** |
| Android + iOS Hermes export | **PASS**, оба production JS bundles; физические устройства не тестировались |
| Gemini production preflight | **PASS**: настроенный synthetic credential принимается; отсутствие Gemini key и неверный endpoint отклоняются |
| Release verifier / final secret scan | Результат и число просканированных файлов — [evidence summary](docs/qa-evidence/gemini-integration/summary.json); обязательные gates перед ZIP |

PostgreSQL schema не менялась; подтверждённый v1.4.2 PostgreSQL migration pass сохранён в [историческом отчёте](UVMS_AI_OPENROUTER_LIVE_QA_REPORT_v1.4.2.md). Docker staging, billing и прочие несвязанные подсистемы повторно не изменялись.

### Исправленные результаты первых прогонов

1. Три OpenRouter regression assertions ожидали старую формулировку capability error. Она сохранена для OpenRouter; повторный affected suite 14/14 PASS.
2. Первый E2E: 21 PASS / 4 FAIL. Disconnect мог оставлять async-generator cleanup до GC, вызывая `generator already executing` и временную блокировку SQLite. Добавлен явный ASGI-owned iterator lifecycle с сериализацией next/close, отменой ожидающего provider worker и ровно одним accounting. Новый полный pytest 155/155 и E2E 25/25 PASS. Ошибки первого прогона не выданы за успешные результаты.

## 3. Gemini live acceptance matrix

`BLOCKED` означает, что реальный ответ Gemini не получен из-за отсутствия backend key. Качество модели не оценивается по mock/demo ответам.

| Проверка | Реальный Gemini |
|---|---|
| READY | **BLOCKED**; приложение корректно показало configuration error и Retry |
| Fast low / Balanced medium / Deep high | **BLOCKED**; официальный mapping реализован, live contract pending |
| RU естественный диалог | **BLOCKED** |
| O‘zbek, естественный сложный запрос | **BLOCKED** |
| English reasoning | **BLOCKED** |
| Python / FastAPI debugging | **BLOCKED** |
| React / TypeScript | **BLOCKED** |
| Integral | **BLOCKED** |
| Bayes | **BLOCKED** |
| Многоэтапная физика | **BLOCKED** |
| Vision PNG / JPEG | **BLOCKED** |
| Files PDF / DOCX / XLSX / CSV | **BLOCKED** |
| Project instructions | **BLOCKED** |
| Memory | **BLOCKED** |
| Charts line / bar / pie / scatter | **BLOCKED** |
| Long answer / progressive DOM | **BLOCKED** |
| Stop / Retry / regenerate | **BLOCKED** для Gemini live; локальный regression PASS |
| Reload/history / two tabs | **BLOCKED** для Gemini live; локальный regression PASS |

**Наблюдавшиеся Gemini free-tier quota errors: 0.** Это не свидетельство доступной квоты: реальных запросов к Google было 0. Без live READY последующие платные/квотные acceptance tasks не запускались.

## 4. Ошибки и безопасность

MockTransport + реальные API/SSE routes проверили 401, 403, 429, 503/unavailable, timeout, network disconnect, malformed chunks, EOF без terminal frame, empty answer, length truncation и content filtering. Проверены отсутствие raw JSON/секрета в сообщениях, bounded cancellation, request ID и usage/accounting. Отдельные browser fixtures подтвердили quota message, остановку spinner и Retry. Это synthetic fault injection, не реальные ошибки Google.

В текущем Chrome с реальным backend подтверждены Gemini label, отсутствующий credential, читаемая ошибка, Retry и Admin diagnostic `Gemini: unavailable`, `gemini-3.8-flash`, последняя configuration error. Учётная запись локального QA временно получила Admin только для проверки и восстановлена.

Ключи не добавлялись в frontend config. Финальный scan проверяет исходники candidate и оба frontend export на точные значения локальных secrets и распространённые Google/provider key patterns; private `.env`, DB, profiles, caches и `.qa` исключены из ZIP.

## 5. Исторические provider limitations

Предыдущие Integral/Bayes timeout/error/classifier ответы относятся к **development OpenRouter Free**. Приложение корректно завершало ожидание, показывало ошибку и Retry. Это **provider limitation**, а не доказательство ошибки вычислений Gemini. Бесплатный OpenRouter не является production-моделью и не используется как Gemini fallback.

UZ, coding, Integral/Bayes, charts и long-answer задачи с прежними FAIL/PARTIAL остаются первыми кандидатами на повтор после успешного Gemini READY. Их старые результаты сохранены [в отдельном отчёте](UVMS_AI_OPENROUTER_LIVE_QA_REPORT_v1.4.2.md).

## 6. Реально оставшиеся external requirements

Для завершения **этой Gemini-интеграции** требуется рабочий backend `GEMINI_API_KEY`, доступ к `gemini-3.8-flash` и достаточная квота в Google project. После появления ключа агент должен выполнить live matrix, оценить правильность ответов и только затем решить вопрос patch release. Эти тесты — оставшаяся работа, а не обязанность пользователя проводить QA самостоятельно.

Для последующего публичного/mobile выпуска сохраняются отдельные target-environment требования: production domain/TLS/server и capacity/restore drill; реальные Android/iPhone и signing toolchains. SMTP, S3 и платёжная сертификация требуются только при включении соответствующих production-функций; к Gemini acceptance они не добавлялись. Billing не менялся.

## 7. Evidence и candidate

- [READY screenshot](docs/qa-evidence/gemini-integration/ready.png), [persisted request](docs/qa-evidence/gemini-integration/ready.json), [Admin](docs/qa-evidence/gemini-integration/admin.png), [summary](docs/qa-evidence/gemini-integration/summary.json).
- Запуск: `QUICK_RUN_WINDOWS.bat`. Текущие Web/API — `http://localhost:3002` / `http://localhost:8003`. При отсутствии Gemini key `/ready` корректно возвращает 503, `/live` — 200.
- Чистый snapshot: `UVMS-AI-v1.4.2-gemini-integration-candidate.zip`; SHA-256 находится в соседнем `.zip.sha256` файле. **Live acceptance BLOCKED; не production-certified.**
- Ранее созданный `UVMS-AI-v1.4.2-final-live-qa.zip` сохранён как старый OpenRouter QA artifact и не содержит этих изменений Gemini.
