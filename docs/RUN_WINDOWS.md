# Run UVMS AI on Windows

For the shortest Russian guide, read `START_HERE_RU.md` in the project root.

## Fast path

1. Install **Python 3.11+** and **Node.js 20+ LTS**.
2. Extract the v1.0 ZIP to a normal folder such as `C:\Projects\UVMS-AI`.
3. Double-click `QUICK_SETUP_WINDOWS.bat` once.
4. When it finishes with **All setup checks passed**, double-click `QUICK_RUN_WINDOWS.bat`.
5. Use the exact URL opened by `QUICK_RUN_WINDOWS.bat` (normally `http://localhost:3001`; the launcher chooses free ports automatically).

The first setup creates `.env`, generates a random local JWT secret, creates `.venv`, installs API/Web/Mobile dependencies, runs all backend tests, applies Alembic migrations, type-checks Web/Mobile and builds Next.js.

## Live AI

Without a provider key the product can run in explicit **DEMO mode**. For the current no-cost development path, use the already-tested OpenRouter development adapter in root `.env`:

```env
UVMS_ENV=development
UVMS_AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_local_key
```

OpenRouter mode is development/demo only: live text streaming and vision are available when the routed free model supports them; Search is disabled and images/transcription remain explicit demo behavior.

For final OpenAI acceptance, switch `UVMS_AI_PROVIDER=openai` and configure the existing OpenAI variables. Restart API after changing provider configuration. Never expose provider keys through `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*`.

## Mobile on a real phone

The easiest Stage 1.2 path is to run **`QUICK_RUN_MOBILE_WINDOWS.bat`** from the repository root. It detects the active LAN IPv4 address, ensures the API is reachable on `0.0.0.0:8000`, sets `EXPO_PUBLIC_API_URL` for the Expo process and starts Expo with `--lan --clear`. See `docs/MOBILE_PHYSICAL_QA.md` for the full acceptance checklist.

Your phone cannot use `localhost` to reach the PC. Find the PC LAN IP with `ipconfig`, for example `192.168.1.50`, then run in `apps/mobile`:

```powershell
$env:EXPO_PUBLIC_API_URL="http://192.168.1.50:8000/api/v1"
npm start
```

The quick run script binds the API to `0.0.0.0` in development so a phone on the same Wi‑Fi can reach it. The local `.env.example` uses `UVMS_TRUSTED_HOSTS=*` only for this development use. If Windows asks for Firewall access, allow it only on **Private networks**. For a real public beta use HTTPS and explicit production hosts; production startup intentionally rejects wildcard trusted hosts.

## Admin

Development convenience: registering `admin@uvms.uz` becomes admin only when `UVMS_ENV` is not `production`.

Production admin creation is explicit:

```powershell
cd services\api
..\..\.venv\Scripts\python.exe -m app.cli create-admin --email you@company.com --name "UVMS Admin"
```

## Useful checks

```powershell
.venv\Scripts\python.exe ops\doctor.py
.venv\Scripts\python.exe ops\smoke_test.py http://localhost:8000
```

API docs: `http://localhost:8000/docs`.
