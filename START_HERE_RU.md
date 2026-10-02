# UVMS AI v1.4.3 — НАЧНИ ОТСЮДА

Актуальные результаты: [FINAL LIVE QA REPORT](UVMS_AI_FINAL_LIVE_QA_REPORT.md). Бесплатный OpenRouter используется для development QA; production provider и физические устройства ещё требуют внешней проверки.

Это актуальная сборка **Stage 1 / Production Candidate — v1.4**. Она сохраняет весь v1.2 Mobile Experience и Conversation Power, но этот проход посвящён серверу и надёжности: безопасный PostgreSQL/Redis multi-worker startup, non-root API container, healthchecks, Nginx/SSE, защищённые metrics, backup/restore, preflight и production QA. Старые ZIP не нужны.

## 1. Первый запуск на Windows

Нужно заранее установить:

- Python 3.11 или новее
- Node.js 20 или новее

После распаковки архива:

1. Дважды нажми `QUICK_SETUP_WINDOWS.bat`.
2. Дождись строки `All setup checks passed.`
3. Дважды нажми `QUICK_RUN_WINDOWS.bat`.
4. Скрипт сам откроет **правильный адрес текущей копии** (обычно `http://localhost:3001`). Не вводи старый `localhost:3000` вручную: используй адрес, который сам откроет `QUICK_RUN_WINDOWS.bat`.


### Важно: защита от старой копии

Начиная с v1.0.3 launcher **не переиспользует случайно старые сервисы на 3000/8000**. Он запускает текущую папку на изолированных портах (по умолчанию Web `3001`, API `8002`, а если заняты — выберет следующие свободные), сам открывает правильный URL и записывает `.uvms-runtime.json`. В верхней панели Web отображается **Public Beta**; `/live` возвращает version **1.4.3**.

Чтобы остановить именно процессы этой папки, используй `QUICK_STOP_WINDOWS.bat`.

Первый setup сам:

- создаёт `.env` из `.env.example`;
- генерирует случайный JWT secret;
- создаёт Python virtualenv;
- ставит backend/Web/Mobile зависимости;
- запускает backend tests;
- применяет Alembic migrations;
- запускает Web typecheck + production build;
- запускает Mobile typecheck.

Если setup остановился на ошибке — не продолжай вслепую. Скопируй весь текст ошибки и отправь его мне.

## 2. Live AI

Для бесплатного dev/demo режима используется OpenRouter Free. В v1.2 можно оставить `UVMS_AI_PROVIDER=auto`: если в development указан только `OPENROUTER_API_KEY`, backend сам выберет OpenRouter и Mobile больше не должен получать demo-текст из-за режима `auto`. Явный `UVMS_AI_PROVIDER=openrouter` тоже поддерживается.

```env
UVMS_ENV=development
UVMS_AI_PROVIDER=auto
OPENROUTER_API_KEY=...
```

Ключ не отправляй во frontend, `EXPO_PUBLIC_*`, GitHub или скриншоты. В этом режиме настоящий text streaming и vision работают через бесплатный router; Search выключен, а генерация изображений и transcription остаются честно помеченным demo.

Для финальной OpenAI acceptance сохрани поддержку OpenAI:

```env
UVMS_AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.6
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

После изменения `.env` перезапусти API.

## 3. Админ

В локальном development для быстрого теста регистрация с email `admin@uvms.uz` создаёт администратора.

В production публичная регистрация **никогда** не выдаёт admin. Создай его CLI-командой:

```powershell
cd services\api
..\..\.venv\Scripts\python.exe -m app.cli create-admin --email you@company.com --name "UVMS Admin"
```

## 4. Мобильное приложение на реальном телефоне

`localhost` на телефоне — это сам телефон, а не твой ПК. `QUICK_RUN_WINDOWS.bat` запускает API на LAN-интерфейсе и показывает IP компьютера.

На ПК и телефоне должна быть одна Wi‑Fi сеть. Самый простой вариант — дважды нажми **`QUICK_RUN_MOBILE_WINDOWS.bat`**. Он сам определит LAN IP компьютера, проверит/запустит API и откроет Expo в LAN mode с QR-кодом.

Ручной вариант:

```powershell
cd apps\mobile
$env:EXPO_PUBLIC_API_URL="http://192.168.1.50:8000/api/v1"
npm.cmd start -- --lan --clear
```

Замени IP на адрес своего ПК. Не записывай локальный IP прямо в исходный код. Если Windows спросит разрешение Firewall — разрешай только для **Private network**.

Для настоящей Public Beta нужен HTTPS-домен; LAN HTTP — только для локального тестирования. Полный физический чек-лист: `docs/MOBILE_PHYSICAL_QA.md`.

## 5. Что обязательно проверить перед реальными пользователями

Открой `docs/RELEASE_CHECKLIST.md` и пройди его на реальных Windows/Android/iPhone и сервере. Особенно:

- настоящий AI key;
- Android/iPhone camera/mic/SecureStore;
- SMTP reset-password;
- S3/R2, если включаем cloud storage;
- HTTPS/domain;
- backup/restore;
- финальные Privacy/Terms;
- настоящий payment provider до приёма денег.

## 6. Где что находится

- `apps/web` — Next.js Web + Admin
- `apps/mobile` — Expo / React Native
- `services/api` — FastAPI backend
- `deploy/nginx` — production reverse proxy
- `ops` — setup/run/doctor/smoke/backup scripts
- `docs` — запуск, архитектура, production и release checklist
- `brand` — UVMS logo/brand

Полная информация: `README.md` и `PROJECT_STATUS.md`.
