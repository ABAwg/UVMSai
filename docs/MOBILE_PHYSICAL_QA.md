# UVMS AI — Physical Mobile QA

This guide is for **Stage 1.2 physical-device testing** of the Expo / React Native app. It does not claim that Android or iPhone has already passed physical QA.

## 1. Prerequisites

- Run `QUICK_SETUP_WINDOWS.bat` once.
- PC and phone must be on the same Wi-Fi network.
- The Windows network should be marked **Private**, not Public.
- Install **Expo Go** on the phone for the fastest first check. If a feature is unsupported in Expo Go, use the existing EAS development profile from `apps/mobile/eas.json`.

The mobile app never receives OpenAI/OpenRouter provider keys. It talks only to the UVMS backend.

## 2. Fastest launch

From the repository root, double-click:

```text
QUICK_RUN_MOBILE_WINDOWS.bat
```

The script:

1. detects the PC LAN IPv4 address;
2. checks the UVMS API on port `8000`;
3. starts FastAPI on `0.0.0.0:8000` when needed;
4. sets `EXPO_PUBLIC_API_URL=http://<PC-LAN-IP>:8000/api/v1` for that Expo process;
5. starts Expo in LAN mode and prints the QR code.

Do **not** put a developer-specific LAN IP into source control.

### Manual equivalent

```powershell
ipconfig
cd apps\mobile
$env:EXPO_PUBLIC_API_URL="http://192.168.1.50:8000/api/v1"
npm.cmd start -- --lan --clear
```

Replace the example address with the current PC IPv4 address.

`localhost` on a real phone means the phone itself, so `http://localhost:8000` cannot reach the PC.

## 3. OpenRouter development mode

For the current free demo provider, configure the **backend root `.env`** locally:

```dotenv
UVMS_ENV=development
UVMS_AI_PROVIDER=openrouter
OPENROUTER_API_KEY=YOUR_LOCAL_SECRET
```

Never add the key to `EXPO_PUBLIC_*`, mobile source code, screenshots, Git or support messages.

Current OpenRouter-development behavior:

- text chat: live;
- streaming: live;
- image understanding / vision: live when the routed free model supports it;
- Search: disabled;
- generated images: explicit demo mode;
- transcription: explicit demo mode.

Free-router quality and latency can vary between requests. It is development/demo routing, not a promised production model identity.

## 4. Physical-device acceptance checklist

Record the exact phone model and OS version. Test each item on the physical device rather than assuming TypeScript success means runtime success.

### Account and session

- register/login;
- kill and reopen app;
- session restored from SecureStore;
- logout;
- logout-all / revoked session;
- expired-session recovery does not show raw JSON.

### Chat

- new chat;
- `UVMS-1 Fast`;
- `UVMS-1 Balanced`;
- `UVMS-1 Deep` shows the correct plan lock when unavailable;
- progressive live streaming, not one buffered final answer;
- Stop during a long answer;
- Retry after a forced network failure;
- previous-turn context survives;
- Russian, Uzbek and English;
- reopen a saved conversation.

### Camera / gallery / files

- grant camera permission;
- take a real photo;
- ask a question that requires seeing the photo;
- select a real gallery image and repeat;
- choose PDF and TXT from the document picker;
- upload progress/state is visible;
- remove a pending attachment before send;
- uploaded assets appear in Library;
- image preview works after app reopen.

### Voice

The OpenRouter development mode intentionally uses **demo transcription**. Verify only the native recording UX now:

- microphone permission;
- recording starts;
- timer moves;
- Stop;
- Cancel;
- no fabricated live transcript is inserted;
- demo status is clearly labelled.

Live speech-to-text acceptance belongs to a provider that actually supplies transcription.

### Projects and Memory

- create/edit/delete project;
- save project instructions;
- upload project file;
- create project chat;
- use a unique project instruction and verify a live answer sees it;
- add/toggle/delete Memory;
- verify an enabled memory affects a live answer.

### Library

- list assets shared from Web and Mobile;
- image preview;
- reuse a stored asset in a new chat;
- delete an asset;
- empty/loading/error states.

### Network and lifecycle

- disable Wi-Fi during a request;
- restore Wi-Fi and Retry;
- restart backend during a request;
- background the app and return;
- kill/reopen the app;
- ensure no duplicate prompt is sent automatically.

### Cross-device sync

With the same account open on Web and Mobile:

- send a message on Mobile and see the chat on Web;
- upload a file on Mobile and see it in Web Library;
- change profile display name on Mobile and verify Web;
- create Memory/Project on one device and verify the other.

## 5. Troubleshooting

### API shows offline on the phone

From the phone browser, try:

```text
http://<PC-LAN-IP>:8000/live
```

Expected response is the API liveness result. If it cannot connect:

- confirm both devices are on the same Wi-Fi;
- disable VPN temporarily if it isolates LAN traffic;
- allow Python through Windows Firewall on **Private networks only**;
- ensure the API terminal says it is listening on `0.0.0.0:8000`;
- guest Wi-Fi / client isolation may block device-to-device traffic.

### QR opens but app cannot load

Run Expo again with cache cleared:

```powershell
cd apps\mobile
npm.cmd start -- --lan --clear
```

### Expo Go cannot support a native behavior

Use the EAS `development` profile rather than weakening the feature. Expo Go is a quick QA surface, not the final release runtime.

## 6. Evidence to keep

For sign-off, keep:

- screenshots of login/home/chat/project/library/account;
- one short screen recording showing progressive streaming + Stop;
- one photo-vision question and answer;
- device model + OS version;
- any error text and backend request ID;
- pass/fail notes for the checklist above.

Update `MOBILE_PHYSICAL_QA_REPORT.md` with actual observations. Never mark an untested platform as PASS.
