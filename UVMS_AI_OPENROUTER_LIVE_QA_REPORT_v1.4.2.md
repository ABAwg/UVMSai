# UVMS AI FINAL LIVE QA REPORT

**Версия:** 1.4.2 · **Проверки:** 24–28 сентября 2026 · Windows, Chrome, Docker Desktop.

## Итог

**CODE/LOCAL PRODUCTION READY:** технический release candidate; результаты проверок перечислены ниже. В проверенном локальном scope не осталось известных воспроизводимых P0/P1 дефектов приложения.

**LIVE AI ACCEPTANCE: PARTIAL.** Настроенный `openrouter/free` действительно использовался только как development QA route. Бесплатный OpenRouter не считается production-моделью. Его нестабильность, служебные ответы `User Safety: safe`, ошибки программирования и плохой узбекский текст не позволяют сертифицировать качество AI. Успешный HTTP/SSE не засчитывался как правильное решение.

**EXTERNAL CERTIFICATION REMAINING.** Полная готовность к публичному production и физическим мобильным устройствам не заявляется.

## 1. Что было запущено

- Текущая папка проекта: Web **http://localhost:3002**, API **http://localhost:8003**, версия `/live` — **1.4.2**. `/live`, `/ready`, Web — HTTP 200.
- Использован существующий backend `.env`; live-провайдер сохранён. Секреты не включены в отчёт, screenshots или release copy.
- Основные live-сценарии выполнены в **headed Google Chrome** через Playwright; отдельные профили для параллельных QA-сессий.
- Детерминированные E2E: отдельные Web 3110 / API 8010, disposable SQLite и явно заданный demo-провайдер. Это regression приложения, не доказательство live AI.
- Production architecture: изолированный Compose-проект `uvmsqa142bea08730`, PostgreSQL 16, Redis 7, API Python 3.13, Web и nginx, вход на loopback 3188. Синтетические секреты, явное staging-исключение для demo AI, billing disabled. Production-секреты и чужие контейнеры не использовались.
- Web dev, E2E и production build разделены по каталогам сборки. Работавшие ранее сторонние сервисы не останавливались.

## 2. Regression и сборки

| Gate | Результат |
|---|---|
| Backend full pytest | **126 passed**, одно upstream deprecation warning Starlette/AnyIO |
| Python compile / pip check | PASS / No broken requirements |
| Чистые SQLite migrations | PASS, head `e2c7c0d4a4b1`, `alembic check` без drift |
| PostgreSQL migrations / drift | PASS на реальном контейнере, тот же head |
| Web unit tests | **16/16 PASS** |
| Web TypeScript / production build | PASS / PASS; основной route First Load JS около 227 kB |
| Browser E2E | **23/23 PASS** |
| Mobile TypeScript / SSE tests | PASS / **2/2 PASS** |
| Expo Doctor | **21/21 PASS** |
| Expo public / introspect config | PASS |
| Android / iOS Hermes export | PASS, оба production JS bundles; это не native device certification |
| Docker API / Web build, nginx config | PASS |
| Production preflight | PASS на staging-конфигурации с явными staging/free-only ограничениями |
| Release verifier | **working-tree PASS; strict source archive PASS** |
| Frontend secret scan | **0 совпадений** настроенных provider/JWT секретов в 94 файлах production static bundle |

Mobile audit: 11 moderate transitive advisories в Expo/xcode/uuid, 0 high/critical в выполненном проходе. Автоматическая замена на несовместимые major-версии не применялась. Это остаётся dependency maintenance item.

## 3. Browser flows

Проверены регистрация, login/logout, восстановление cookie-only сессии, reload, новая вкладка, истёкший access token и refresh, logout-all, смена пароля, удаление тестового аккаунта, новый чат, история, поиск, переименование, archive/restore/delete, copy/edit/regenerate, Settings, Projects, Memory, Library и Billing.

Также проверены Back/Forward, быстрый двойной Send, отсутствие дубликата после Retry, отмена сразу после Send и во время потока, запоздалые результаты image/transcription, смена чата, временная 503, ошибка провайдера, недоступный формат файла и безопасные ссылки. Две вкладки проверяются на независимые сообщения/историю. Выход в одной вкладке убирает приватный UI во второй.

Повторные проверки делались после reload. Автоматические сценарии проверяют реальные API и БД; специально внедрённые ошибки и rendering fixtures явно относятся к deterministic regression.

## 4. Streaming, Stop, Retry

- Live длинный ответ: **105 различных изменений текста в DOM**, 3512 символов; первое видимое обновление примерно через **21.2 s**. Это реальное постепенное отображение в браузере.
- Live Stop: до нажатия 75 символов, после завершения отмены 142; reload восстановил те же **142** символа. Regenerate вернул HTTP 200 и ответ 5115 символов, один assistant.
- В одной более ранней попытке не было текста за 90 s. Эта попытка не засчитана как Stop PASS.
- Browser E2E сопоставляет `X-UVMS-Request-Id` и chat ID с **cancelled** accounting event. Только cancellation fixture demo-сервера замедлен, чтобы Stop гарантированно попадал в активный поток; live runtime не менялся.
- Убрано ожидание сетевой отмены до локального abort; cancel/history запросы ограничены по времени, UI имеет общий deadline 140 s. Backend deadline общий для streaming, complete и search fallback.
- Учёт фиксируется до терминального `done`/`error`, а disconnect сохраняет непустой partial и ровно один trace. Есть отдельные backend regression tests.

## 5. Reasoning и программирование

| Задача | Проверка качества |
|---|---|
| Несовместимые расписания трёх людей | PASS: пустое пересечение, минимальное изменение одной доступности |
| Длинный ответ о React race conditions | Форматирование и progressive delivery PASS; не независимая сертификация каждого архитектурного совета |
| Ошибочный `average(values)` | Первый ответ **FAIL**: неверное объяснение делителя, неподдерживаемый обещанный generator, неправильный ожидаемый результат теста |
| Исправленный `average(iterable)` | PASS на обещанных случаях: код просмотрен, затем выполнены предложенные тесты и 3 независимых случая, включая generator |
| FastAPI owner-scoped запрос | Правильно выявлен IDOR и добавлен `Chat.user_id == user.id` с 404 |
| Redis/DB idempotency | PARTIAL: полезный sketch; утверждение о безусловной гарантии Redis TTL слишком сильное. Этот код не принят как готовая production-реализация |

Добавлены инструкции проверять edge cases, числа и единицы и не заявлять о запуске тестов без фактического выполнения. Это уменьшает риск, но не заменяет проверку ответа модели.

Code fences, selective syntax highlighting, escaped HTML в коде, copy, длинные ответы, таблицы, inline code, Stop и Regenerate проверены. Неизвестные языки остаются безопасным plain text.

## 6. Математика

- Система уравнений: `x=4`, `y=3` — проверено подстановкой.
- Вероятность: `3/10 = 0.3` — корректно.
- `f(x)=x³−3x`: максимум `(-1,2)`, минимум `(1,-2)` — корректно.
- Прямоугольный треугольник 6/8: гипотенуза 10, площадь 24, вписанный радиус 2 — корректно.
- Данные `[2,4,4,4,5,5,7,9]`: среднее 5, population variance 4, standard deviation 2; sample variance отличается — проверено.
- Интеграл `∫₀¹ x ln(1+x) dx` и Bayes sensitivity task: ранние попытки **FAIL** из-за provider error / safety-classifier ответа. Последняя попытка завершилась timeout. **Provider limitation:** приложение показало читаемое сообщение и Retry, spinner завершился. Успешное live-решение не подтверждено; эталон — 1/4 и 95/590 ≈ 16.10%.
- KaTeX поддерживает `$…$`, `$$…$$`, `\(…\)`, `\[…\]`; формулы и таблицы просмотрены в Chrome. HTML trust выключен, длина/расширения ограничены; некорректная формула показывается как текст.

## 7. Физика

Числовая проверка выполнена независимо от факта получения ответа:

| Область | Задача и результат |
|---|---|
| Динамика, силы, трение | Наклон 30°, μ=0.2: `a ≈ 3.21 m/s²` |
| Кинематика и энергия | 2 kg, путь 5 m: скорость `≈5.66 m/s`, работа трения `≈−16.99 J` |
| Второй этап движения | Горизонтальное μ=0.25: остановочный путь `≈6.54 m`; проверка энергией согласуется |
| Импульс | Неупругое столкновение 2 kg × 3 m/s с 1 kg: общая скорость 2 m/s, потеря 3 J |
| Волны | 343 m/s и 440 Hz: длина волны около 0.780 m |
| Оптика | f=10 cm, предмет 30 cm: изображение 15 cm, увеличение −0.5, перевёрнутое |
| Термодинамика | 1 mol monoatomic gas, ΔT=100 K, constant volume: W=0, Q=ΔU≈1247.1 J |
| Электричество | 18 V / 9 Ω = 2 A; предыдущая последовательная цепь тоже дала правильные числа |

Числа и единицы перечисленных задач PASS. Узбекское объяснение электричества не прошло языковую проверку.

## 8. Графики

Реализован ограниченный JSON chart format с SVG-rendering для **line, bar, pie, scatter**. Невалидные данные остаются code block, не исполняются. Лимит 40 точек, 16 секторов pie, конечные числа, запрет отрицательных pie values, доступная таблица значений и SVG titles.

- Live line с отрицательным значением PASS.
- Финальный live ответ дал **3 реальных графика**: bar `12/−4/8`, pie `50/30/20`, scatter `(1,2),(2,5),(3,4)`. Все значения подтверждены раскрытой таблицей.
- Desktop/mobile screenshots просмотрены. На узком экране область графика прокручивается внутри карточки; документ не переполняется, таблица показывает все значения.
- Rendering regression включает большие/маленькие значения и длинные labels.
- Ранние простые chart-запросы дали raw tool-call text, safety-classifier output и timeout: **качество маршрутизации FAIL**, исправный renderer этого не скрывает.
- Продукт предоставляет UVMS dark theme. Light theme отсутствует; её QA PASS не заявляется.

## 9. Creative / Vision / файлы

**Creative:** первоначальный дизайн-запрос завис на провайдере; повторный краткий landing-page brief для repair café вернулся с секциями, типографикой, цветами, CTA и mobile UX. Форматирование просмотрено. Реальная image generation в текущем provider mode не доступна.

**Vision:** PNG и JPEG с неописательными именами: красный треугольник, синий круг и `DELTA42` распознаны. Вторая проверка объединяла JPEG и структурированные файлы. Preview, Library, download и reload проверены. Физическая камера не сертифицирована.

**Файлы:** реальные TXT, PDF, DOCX, XLSX, CSV, JSON и Python source. AI находил 17 минут, Mira, retention 73%, сопоставлял CSV/XLSX total 560 и анализировал buggy code. XLSX после download побайтно совпал с исходником. Повреждённый PDF дал читаемое `Invalid PDF signature`, без traceback.

**Длинный документ:** обнаружена потеря заключения при обрезке только начала. Теперь ограниченный excerpt включает начало и конец с явным маркером пропуска середины. После явного restart и provider retry live AI корректно извлёк Salima, proposed 65%, final 78%. Все факты из произвольной пропущенной середины этим механизмом не гарантируются.

## 10. Projects и Memory

**Projects:** создание, instructions, upload `notes.txt`, редактирование и reload PASS. Первый live чат выполнил уникальное правило `NACRE-731` и назвал 17 минут / amber. Следующий успешный live чат вернул `NACRE-731, Mira`; проект сохранился после reload. Одна промежуточная попытка получила provider error. Удаление проверено E2E.

**Memory:** уникальное `Velora-77` использовано в новом live чате. После Disable другой новый чат честно сообщил, что не знает этот факт. Toggle/delete и ownership/isolation проверены regression/security smoke. Temporary Chat исключает долгосрочную память и проектный контекст.

## 11. Search, языки, Billing и Admin

- **Search:** в OpenRouter development mode выключен и UI сообщает недоступность. Safe citation URLs и ошибки/fallback проверены fixtures/backend tests; live Search не засчитан.
- **RU:** система уравнений, математика, технические ответы; Unicode сохраняется. **EN:** reasoning, coding, physics, design и файлы работают в успешных ответах.
- **UZ:** числовой ответ может быть верным, но естественность и терминология **FAIL**; один ответ содержит бессмысленные определения. Нельзя объявлять узбекский AI production-ready на этом free route.
- **Billing:** demo checkout только development; UI явно предупреждает, что live payments недоступны. Production с demo billing отклоняется; staging использовал disabled. Реальные платежи не выполнялись.
- **Admin:** users, plans/subscriptions, routing, capabilities/features, usage/accounting/audit проверены локально. Изменения сохранялись; обычный пользователь получает отказ от Admin API.

## 12. UI, responsive, accessibility и performance

- Просмотрены auth, chat, история, Settings, Projects, Memory, Library, Billing и Admin. Сохранены screenshots основных и критических сценариев.
- Размеры: 1920×1080, 1440×900, 1366×768, 390×844, 393×852, 360×800; отдельный ранний проход также 768 и 320 px.
- Финальные **36 комбинаций страниц/размеров: 0 document overflow**, 0 page errors. Навигация dev runtime: median 849 ms, p95 1673 ms; это локальный smoke, не production SLO.
- Формы получили доступные labels; keyboard activation, Tab внутри native preview dialog, Escape и возврат фокуса проверены. Исправлен потерянный focus после unmount preview. Увеличены 7–8 px account labels и touch controls; reduced motion работает.
- XSS через HTML/Markdown/code и `javascript:` ссылки не исполняется в browser fixture. Native dialog сохраняет modal focus.
- Live first-token latency существенно менялась; один запрос молчал более 90 s. Низкая задержка free provider не сертифицирована.
- Полный WCAG/screen-reader audit и длительный memory soak не заявляются как выполненные.

## 13. Security и infrastructure

Defensive smoke: auth/admin denial, owner-scoped chats/files/projects/memory, CORS, CSRF-sensitive refresh, refresh replay и logout revocation, validation/unsupported uploads, safe Markdown, header/request-ID handling. Полный backend suite включает ограничение размеров и безопасные provider errors. Секреты остаются на backend.

Production-architecture evidence:

| Проверка | Наблюдение |
|---|---|
| Healthchecks | Все пять сервисов healthy; `/`, `/live`, `/ready` HTTP 200 |
| API runtime | non-root uid 10001, **2 Uvicorn workers** |
| Redis | PONG; общий runtime/accounting infrastructure проверен |
| `/metrics` | без credentials 401, с синтетическим token 200 |
| nginx SSE | 50 deltas, terminal done, no content-encoding, `no-cache, no-transform`, `X-Accel-Buffering: no` |
| Edge load smoke | **100/100**, p95 **20.03 ms**, max 29.9 ms на `/live` |
| Backup/restore | pg_dump custom archive проверен и восстановлен в отдельную disposable БД, данные сверены |
| Restore safety | обязательный explicit restore gate / pre-restore backup и stop-app порядок сохранены; production restore не выполнялся |
| Graceful stop | API остановился примерно за 1.09 s |
| API outage | `/ready` вернул 504 примерно за 2.01 s; после restart — 200 |
| nginx health timeout | добавлены короткие connect/read bounds вместо долгого зависания health endpoint |

Это HTTP staging на localhost. Public TLS, реальные edge policies и нагрузка целевого сервера остаются внешними gates.

## 14. Исправленные дефекты

1. Windows launcher мог принять занятый wildcard-порт за свободный и показать старую копию — exclusive wildcard bind и версия из `VERSION`.
2. Dev и build портили общий `.next` — отдельные каталоги runtime/E2E/build.
3. Send/upload/image races — синхронный lock, обязательный AbortSignal, stale-view guards.
4. Stop ожидал сетевую отмену; не было полного UI deadline — локальный abort, ограниченные follow-up requests, watchdog.
5. Non-streaming и search fallback обходили/перезапускали deadline — общий бюджет запроса.
6. Завершение SSE могло опередить accounting — commit до terminal event плюс проверка disconnect.
7. Logout не очищал соседнюю вкладку — безопасный broadcast без токенов.
8. Browser Back/Forward не восстанавливал нужный чат — push/pop navigation и guards.
9. Нет полноценного chart/table/math rendering — добавлены безопасные ограниченные renderers и highlighting.
10. Library object URLs освобождались слишком рано; preview терял keyboard focus — исправлено.
11. Project error мог попадать в уже другой view — version guard.
12. Billing copy не отличал demo — честное capability-based описание.
13. Длинные документы теряли заключение — bounded head/tail excerpt с disclosure.
14. PostgreSQL `alembic check` находил лишний unique constraint — model metadata согласована с существующей migration, без удаления ограничения.
15. Preflight пропускал неподходящие live credentials/origins — validation усилена.
16. Release verifier смешивал source archive и рабочую папку — явные archive/working-tree режимы и исключение runtime trees.
17. Mobile: stale responses, double Send/Stop, SecureStore ordering, draft/lifecycle reset, late transcription, EOF без done, picker source files и offline handling исправлены.

## 15. Открытые ограничения и внешние gates

| Пункт | Статус |
|---|---|
| Стабильное качество/доступность production AI, включая UZ, complex coding и reasoning | **NOT VERIFIED — EXTERNAL/PHYSICAL REQUIREMENT**; free-router quality failures реально наблюдались |
| Live OpenAI Search, citations/no-results/error и provider billing reconciliation | **NOT VERIFIED — EXTERNAL/PHYSICAL REQUIREMENT** |
| Реальная image generation и transcription | **NOT VERIFIED — EXTERNAL/PHYSICAL REQUIREMENT**; текущий UI явно описывает demo |
| Физические iPhone и Android: camera/gallery/mic, permissions, LAN, lifecycle/offline | **NOT VERIFIED — EXTERNAL/PHYSICAL REQUIREMENT** — **PHYSICAL DEVICE QA REQUIRED** |
| Native signed Android/iOS build и store distribution | **NOT VERIFIED — EXTERNAL/PHYSICAL REQUIREMENT**; Android SDK/Java и Mac/Xcode отсутствуют |
| Public domain/TLS, целевой production server/load/backup restore drill | **NOT VERIFIED — EXTERNAL/PHYSICAL REQUIREMENT** |
| Production SMTP и S3 с реальными аккаунтами | **NOT VERIFIED — EXTERNAL/PHYSICAL REQUIREMENT** |
| Real payments/webhooks/refunds и legal/payment certification | **NOT VERIFIED — EXTERNAL/PHYSICAL REQUIREMENT** |

Неисправимые настройкой UI ошибки free-router качества и его нестабильность остаются release acceptance blockers для публичного AI-сервиса. Необходим отдельный acceptance pass выбранного production provider. Light theme, полнотекстовый document retrieval и exhaustive accessibility certification в этом релизе не реализованы/не заявлены.

## 16. Evidence и запуск

- [Сводка и screenshots](docs/qa-evidence/v1.4.2/README.md)
- [Release report](V1_4_2_RELEASE_REPORT.md)
- Запуск: `QUICK_RUN_WINDOWS.bat`; остановка только процессов этой папки: `QUICK_STOP_WINDOWS.bat`.
- `.qa` содержит локальные рабочие результаты и тестовые аккаунты; **в source release они не включаются**. Отобранные публичные evidence не содержат credentials.

## Release package

Чистый пакет: `UVMS-AI-v1.4.2-final-live-qa.zip`. SHA-256 опубликован в соседнем `.zip.sha256` файле и финальном сообщении; hash самого ZIP не может быть помещён внутрь него. Исключены `.env`, приватные env-файлы, DB/dumps, browser profiles, runtime logs, caches, node_modules и `.qa`.
