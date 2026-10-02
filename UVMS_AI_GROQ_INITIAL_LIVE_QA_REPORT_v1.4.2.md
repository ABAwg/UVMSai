# UVMS AI FINAL LIVE QA REPORT — Groq

**Дата:** 2026-09-30. **Версия:** 1.4.2, без patch bump. **Groq LIVE: FAIL строгого quality acceptance.**

## Решение

На текущем наборе задач **нельзя считать UVMS AI на Groq Free проверенным продуктом для реальных пользователей**. Транспорт и основные UX-функции работают, но обязательные проверки качества UZ, React/TypeScript и Vision провалены. Ошибки не связаны с квотой или HTTP 5xx. Это вывод по ограниченному реальному acceptance, не общий рейтинг моделей и не обещание доступности Free Tier.

API и Web перезапущены с новым `.env`, выбран `provider=groq`. Текст: `openai/gpt-oss-120b`; изображения: `qwen/qwen3.8-27b`; transcription: `whisper-large-v3-turbo`. Ключ существует только на backend и не выводился. OpenAI/Gemini/OpenRouter fallback не использовался. Groq подключён через существующий Chat Completions adapter, общий SSE/lifecycle/accounting сохранён; production billing не менялся.

## READY и транспорт

| Проверка | Реальный результат |
|---|---|
| Backend READY | PASS, точный READY; HTTP 200; usage 305 input + 18 output = 323 tokens; 2140 ms |
| Browser READY | PASS, точный READY; HTTP 200; usage 305 + 19 = 324 tokens; provider/model подтверждены наблюдаемым upstream request |
| Backend READY rate headers | remaining requests 999, tokens 7567; limits 1000 / 8000 |
| Browser READY rate headers | remaining requests 999, tokens 7424; limits 1000 / 8000 |
| Progressive SSE | PASS: 116 растущих DOM обновлений в RU planning, 103 в Python, 62 в React, 42 в RU technical; реальные delta до terminal done |

**Всего 22 real upstream requests, все HTTP 200**: 20 через Web/backend, два прямых gateway probes (READY и Whisper). В БД 20 request accounting rows: 19 completed, 1 cancelled после Stop; 19 GPT-OSS и 1 Qwen. Каждая browser-попытка имеет один upstream attempt. HTTP 200 не равен quality PASS.

## Live acceptance

| Категория | Итог | Проверка качества |
|---|---|---|
| GPT-OSS-120B overall | **FAIL** | READY и многие задачи PASS, но React/UZ не прошли |
| RU technical | **PASS** | Верно объяснены event loop, asyncio.sleep, поток для sync I/O, process pool для CPU. Пример демонстрационный, без lifecycle/HTTP timeout hardening |
| Дополнительный RU planning | **FAIL** | Python в расписании 8.5h вместо заявленных 6h, English 4h вместо 3h; 128/7 не равно 21h20m; подъём в выходные не соответствует 07:00 |
| UZ | **FAIL** | Электрические расчёты верны, но `energiya (quvvat)` смешивает энергию и мощность; заголовок `Q value`, неестественные обороты и приглашения не проходят языковой gate |
| Python/FastAPI | **PASS** | Исправленный average поддерживает generator/empty; 4 предложенных unittest и 3 независимые проверки реально выполнены. Ownership condition возвращает одинаковый 404 для чужого/отсутствующего документа; schema/dependency imports остаются application placeholders |
| React/TypeScript | **FAIL** | Фактический TSX не компилируется: TS1005, `'}' expected`. Также empty term не инвалидирует старый requestId; mounted ref не восстанавливается после StrictMode cleanup |
| Integral | **PASS** | По частям и разложение x²/(1+x)=x−1+1/(1+x), итог 1/4. Независимый Simpson: 0.2499999999999996 |
| Bayes | **PASS чисел** | 95/(95+495)=19/118≈16.101694915254235%; 100 дефектных, 95 TP, 495 FP, 590 positives на 10000 |
| Bayes math rendering | **PARTIAL** | Один model-generated LaTeX block содержит неэкранированный `%` и не парсится; приложение показывает безопасный исходный текст. Остальные формулы отображаются |
| Physics | **PASS** | Независимо: a=3.2058581578 m/s², v=5.6620298107 m/s, Wfr=−16.9914184223 J, d=6.5358983849 m; округлённые ответы совпали |
| Vision PNG/JPEG | **FAIL** | Qwen увидел реальные фигуры и DELTA 42, но выдумал повторную нижнюю панель и обрезанные фрагменты. Их нет в обоих файлах; использованы непрозрачные имена sample-7c91.png / sample-b8e2.jpg |
| Files PDF/DOCX/XLSX/CSV/TXT | **PASS** | 17 минут, Mira, amber; PDF 73%; обе таблицы 120,150,−20,310 → 560, с верными filename citations |
| Charts | **PASS** | Четыре реальных line/bar/pie/scatter cards; все JSON values и координаты совпадают с входными, отрицательные line/bar сохранены |
| Projects | **PASS** | Prefix GROQ-CHECK-527, file facts 17/Mira/amber, citation notes.txt, project сохранён после reload |
| Memory | **PASS** | Enabled → Copper Cedar 826; Disabled в новом чате → UNKNOWN; QA memory удалена. Узкий NBSP вызвал только первоначальный false FAIL harness |
| Stop | **PASS** | Во время длинной генерации: остановка 1305 ms; partial 1390 символов сохранён; accounting cancelled |
| Retry / Regenerate | **PASS flow** | После controlled UI error реальный Retry → RETRY-OK с одним user message; Regenerate получил полный ответ, reload сохранил его |
| Reload/history | **PASS** | Regenerated answer и оба concurrent chats восстановлены |
| Two tabs | **PASS** | Одновременно ALFA=703 и BETA=320; разные chat IDs, независимая история |
| Transcription | **PASS** | Реальный Whisper: “The access code is 742. Testing speech transcription.”; reported duration 5.243687424s |

Ответы с ошибками не перегенерировались ради получения PASS. Первичные ответы, исходный React Markdown, цифры и screenshots сохранены [в evidence](docs/qa-evidence/groq-live/README.md). Initial project harness устанавливал file input до окончания create busy state; ожидание enabled исправлено и выполнен первый реальный project request. Это не retry провайдера. Результат Memory пересмотрен по сохранённому ответу, без нового запроса.

## Quota / ошибки

**Наблюдавшиеся 429: 0. Наблюдавшиеся 5xx: 0.** Controlled browser fixtures rate_limit/timeout/upstream_error ясно отделены от реальных ответов Groq. UI показывает понятную ошибку и Retry без JSON/traceback; реальный rate-limit response не наблюдался. `retry-after` отсутствовал во всех реальных ответах. Ни одного 5xx retry не потребовалось.

Тесты шли последовательно с паузами по remaining-tokens/reset-tokens и минимум 15 секунд между ответами; исключение — требуемые две вкладки. Не выполнялся stress/load test. По [документации Groq](https://console.groq.com/docs/rate-limits) лимиты общие для организации; эти headers не доказывают вместимость при одновременной работе многих реальных пользователей.

### Последние наблюдавшиеся headers по модели

| Модель | UTC snapshot | Remaining requests | Remaining tokens | Limit requests/tokens | Reset requests / tokens |
|---|---|---:|---:|---|---|
| GPT-OSS-120B | 2026-09-30 11:37:01 | 991 | 7518 | 1000 / 8000 | 12m57.599s / 3.615s |
| Qwen Vision | 2026-09-30 07:19:50 | 999 | 3036 | 1000 / 8000 | 1m26.4s / 37.23s |
| Whisper | 2026-09-30 11:37:15 | 1999 | header отсутствует | 2000 / отсутствует | 43.2s / отсутствует |

Это снимки на время ответов, не текущий остаток на момент чтения отчёта. Новых запросов только ради обновления остатка не сделано.

## Regression / release

Пользователь потребовал открыть regression/release gates только после успешного основного live acceptance. Gate не пройден, поэтому **новые targeted/full backend, Web unit/E2E, TypeScript/build, Expo/Mobile, Alembic и release verifier не запускались**. Перед READY выполнена только Python compile проверка изменённого backend.

Последний сохранённый полный baseline **до Groq**: 155 backend, 16 Web unit, 25 browser E2E, 2 Mobile SSE, Expo Doctor 21/21. После Gemini usage fix до Groq отдельно были 29 affected backend PASS. Эти counts не сертифицируют текущую Groq integration. Проверки code answers в этом проходе: 4 Python unit + 3 edge checks PASS; React compilation FAIL. Финальный focused scan source/runtime на реальный private key и ключевые patterns публикуется в [summary](docs/qa-evidence/groq-live/summary.json); нового production build для него не делалось.

Обычный API `app.main` и Web восстановлены после metadata observer, provider остаётся Groq. Billing и существующие данные не менялись. Production health — connectivity diagnostic, а не оценка качества модели.

**Patch version: не повышена. Final ZIP: не создан. SHA-256: отсутствует.** Старые ZIP Gemini/OpenRouter остаются историческими и не являются Groq release. Следующий шаг — исправление/повторная оценка проваленных quality cases, затем открытие regression gate; ещё один ключ или обход квоты для этого не требуется.
