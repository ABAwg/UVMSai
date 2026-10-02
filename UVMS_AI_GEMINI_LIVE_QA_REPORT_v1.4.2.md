# UVMS AI FINAL LIVE QA REPORT

**Дата:** 2026-09-30. **База:** v1.4.2. **Артефакт:** Gemini live QA candidate, без повышения patch version.

## Итог

**GEMINI LIVE ACCEPTANCE: FAIL; оставшаяся часть BLOCKED внешней квотой/доступностью.** API и Web перезапущены с локальным `.env`. Provider — **Gemini**, модель — **gemini-3.8-flash**. Реальный ключ загружен только backend; его значение и фрагменты нигде не публикуются.

Первый реальный gateway-запрос «Ответь одним словом: READY» вернул **READY**. Затем READY прошёл через headed Chrome. Наблюдались обращения только к `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, с Gemini credential; demo/OpenRouter/fallback не использовались. Fast `low`, Smart/Balanced `medium`, Deep `high` отдельно приняты Google API с ответом READY. Менять reasoning mapping не потребовалось.

Полный live acceptance **не пройден**: 11 подтверждённых HTTP 503, один исходный upstream error без сохранённого HTTP-статуса, один оборванный Vision stream и один реальный HTTP 429. После 429 новые обращения к провайдеру остановлены. Ни production-ready, ни выпуск 1.4.3 не объявляются. Успешный HTTP 200 у SSE не трактуется как качественный ответ.

## 1. Реальная live matrix

| Проверка | Результат и доказательство |
|---|---|
| READY | **PASS** через gateway и Web; точный ответ, Gemini accounting, одна попытка |
| Fast / Smart / Deep | **PASS контракта**: low / medium / high → gemini-3.8-flash; READY во всех трёх. Это не сертификат качества каждого режима |
| RU сложный естественный запрос | **FAIL**, upstream HTTP 503; ответа нет |
| UZ технический и естественный запрос | **FAIL**, upstream HTTP 503; качество языка не оценено |
| English reasoning | **FAIL**, upstream HTTP 503 |
| Python/FastAPI debugging | **FAIL**, upstream HTTP 503 |
| React/TypeScript | **PASS**: типизированный fetch, response.ok, AbortController + проверки signal.aborted, empty term, unmount, pending/error UI. Пять отдельных поведенческих проверок фактического кода PASS |
| Integral ∫₀¹ x·ln(1+x) dx | **FAIL**, HTTP 503; эталон 1/4, вычислительного ответа нет |
| Bayes 1% / 95% / 5% | **FAIL**, HTTP 503; эталон 95/(95+495) ≈ 16.1017%, ответа нет |
| Многоэтапная physics | **FAIL**, HTTP 503 |
| Vision PNG/JPEG | **FAIL**: HTTP 200, 4 промежуточных delta/DOM updates, затем stream без требуемого terminal contract. Безопасная interrupted error и Retry; качество не принято |
| TXT/PDF/DOCX/XLSX/CSV | **FAIL**: файлы загружены, но запрос к Gemini получил 503 |
| JSON/source code/long TXT | **FAIL**, HTTP 503 |
| Project instructions + file context | **PARTIAL**: сохранность файла после reload/reselection PASS; Gemini context не выполнен до остановки по квоте |
| Memory | **PASS**: активная память → Amber Quasar 907; после Disable в новом чате → UNKNOWN. Проверены reload и удаление только созданной QA-записи |
| Charts line/bar/pie/scatter | **FAIL**, HTTP 503, chart JSON не получен |
| Long response | **FAIL** в обеих сохранённых попытках; вторая — подтверждённый 503 |
| Progressive SSE | **PASS** на реальном React-ответе: 35 растущих DOM обновлений за 3453 ms, 3588 символов финального видимого ответа |
| Stop во время Gemini generation | **BLOCKED** квотой до live выполнения; прежний controlled regression PASS не заменяет Gemini live |
| Retry | **PARTIAL**: реальный повтор отправлен, одно user message; Gemini вернул 429. Восстановление ответа не подтверждено |
| Regenerate | **BLOCKED** до live выполнения |
| Reload/history | **PASS**: реальный React-ответ полностью восстановлен после reload |
| Две вкладки с одновременной генерацией | **BLOCKED** квотой; новый live запрос не отправлялся |
| Client disconnect во время Gemini generation | **BLOCKED**; отдельно реально наблюдался provider-side interrupted stream |

Итого **21 реальное upstream обращение**: 18 через Web/backend с persisted request IDs + 3 прямых gateway READY probes. 7 завершённых ответов и 14 ошибок. HTTP-статусы: 8 × 200 (один из них оборван), 11 × 503, 1 × 429; статус первого long-answer error не был записан. Все 18 accounting rows — provider=gemini, model=gemini-3.8-flash, attempts=1. Полные первичные результаты и обзоры: [evidence](docs/qa-evidence/gemini-live/README.md).

## 2. Provider limitations и обработка ошибок

**Реальный quota error:** 2026-09-30 06:18:55 UTC (11:18:55 Asia/Tashkent), HTTP **429**, request ID `3a33a454-5a72-4491-bbfe-211e2951e638`, upstream `/v1beta/openai/chat/completions`, model `gemini-3.8-flash`, effort `low`. Backend code `rate_limit`, одна попытка, usage неизвестен. UI: “The AI quota is temporarily exhausted. Please try again later.”, Retry доступен, spinner остановлен, raw JSON/traceback отсутствуют.

В перехваченном ответе нет разобранных error details/quota metric/RetryInfo. Поэтому точная область ограничения (RPM, daily, free или paid tier) и время сброса **не установлены**. Это один реально наблюдавшийся provider 429, а не установленный дневной free-tier лимит. Квота не обходилась; ключ/модель/провайдер не подменялись.

11 HTTP 503 — **provider unavailable limitation**. Приложение корректно выдаёт безопасную ошибку и Retry. Integral/Bayes в текущем Gemini проходе получили именно 503, **не timeout**. Предыдущие OpenRouter Integral/Bayes timeout/error результаты остаются отдельной **provider limitation**, поскольку приложение корректно завершало ожидание. Они не превращены в Gemini PASS. [Исторический отчёт](UVMS_AI_OPENROUTER_LIVE_QA_REPORT_v1.4.2.md).

Текущий affected backend suite проверил controlled 401/403, 429, 503, timeout, network disconnect, malformed/empty response, EOF без terminal, length/content filtering, Stop/cancellation и отсутствие fallback/сырой ошибки. Browser fixtures отдельно подтвердили quota/timeout/upstream error и Retry. Это fault injection, а не утверждение о реальных Google 401/403/timeout.

Admin в настоящем браузере показал **Gemini: unavailable**, все модели, последнюю безопасную rate_limit error и время. Значение/префикс ключа не отображались. Локальная QA роль Admin восстановлена. Availability определяется последним запросом в течение 15 минут; `/ready` проверяет локальную готовность, а не наличие внешней квоты.

## 3. Единственное новое изменение после live

Исправлена нормализация Gemini usage в существующем adapter. Реальный ответ имел 310 prompt, 908 visible completion, 2614 total: разница 1396 — thinking tokens. Billable output теперь определяется как **total − prompt = 2304**, если оба значения доступны и согласованы. Иначе сохраняется доступное reported usage; отсутствующий usage не выдумывается. Без настроенных тарифов стоимость остаётся unknown.

Это соответствует [официальному учёту thinking tokens](https://ai.google.dev/gemini-api/docs/generate-content/thinking#pricing). Добавлены два regression tests, включая оценку стоимости по наблюдавшейся numeric usage shape. Исторические QA accounting rows не переписаны; они отражают состояние до исправления. Нового live запроса после исправления нет из-за 429. Общий gateway, SSE/API контракты и production billing не переписывались.

## 4. Regression и release gates

Полный regression уже был успешно пройден до этого live прохода. Повторён только affected suite и финальные gates; Web/Mobile код не менялся.

| Gate | Результат / актуальность |
|---|---|
| Backend full pytest | **155 PASS**, сохранённый полный baseline |
| Gemini backend suite после usage fix | **29 PASS**, в том числе 2 новых tests; не суммировать с 155 как число выполненных уникальных тестов |
| Python compile / pip check | **PASS / PASS**, повторены после изменения |
| Alembic | Сохранённый **PASS**, SQLite head e2c7c0d4a4b1, no drift; schema не менялась |
| Web unit | **16 PASS**, сохранённый baseline |
| Web TypeScript / production build | **PASS / PASS**, сохранённый baseline |
| Browser E2E | **25 PASS**, сохранённый controlled regression; реальные live результаты перечислены выше |
| Mobile TypeScript / SSE | **PASS / 2 PASS**, baseline |
| Expo checks / Doctor | **PASS / 21 из 21 PASS**, baseline |
| iOS + Android Hermes exports | **PASS**, baseline; физические устройства не сертифицированы |
| React model-answer behavioral checks | **5 PASS**, текущая отдельная проверка качества ответа, не Web unit count |
| Secret scan / release verifier | Обязательные финальные gates; точные результаты и counts в [summary](docs/qa-evidence/gemini-live/summary.json) |

Один Starlette/AnyIO deprecation warning сохранён в pytest log. Исправленные ранние harness ошибки: Projects после reload требует выбора проекта; history assertion должен сравнивать innerText с innerText. Повторены только эти read-only проверки, обе PASS. Эти ошибки не приписаны приложению.

## 5. Артефакт и продолжение

Новый snapshot: **UVMS-AI-v1.4.2-gemini-live-qa-candidate.zip**. Это проверенный кандидат с честно незавершённым Gemini acceptance, **не финальный production-релиз**. SHA-256 публикуется рядом в `.zip.sha256` и в итоговом сообщении. ZIP не содержит private `.env`, DB/dumps, browser profiles, caches, node_modules, `.qa` и QA credentials. `.env*.example` остаются безопасными шаблонами.

Временно включённое наблюдение HTTP снято: используется обычный `app.main`, а не QA observer. Web/API текущей папки: `http://localhost:3002` / `http://localhost:8003`.

**Реально оставшиеся external requirements для Gemini gate:** доступная квота текущего Google project/model и стабильная работа Gemini endpoint. Backend key, правильный endpoint, доступ к модели и все три reasoning effort уже подтверждены; повторно просить ключ не требуется. После восстановления провайдера агент должен выполнить только failed/blocked acceptance, проверить правильность и затем решить вопрос patch release. Отдельные требования публичного hosting/physical mobile deployment остаются за рамками этого Gemini прохода; billing не менялся.

**OpenRouter Free остаётся development-only и не является production-моделью или fallback.**
