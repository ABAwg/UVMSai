# UVMS AI Public Beta — production deployment

Local HTTPS validation is not a public deployment. This release has no supplied server IP, SSH access or public domain.

## External inputs

- Linux server IP, SSH username and credential reference; permission to install Docker and open TCP 80/443. Restrict SSH to operator IPs where possible.
- Domain and DNS access: A record to that server; AAAA only with working IPv6. An operator email for certificate notices.
- Provision the existing Groq credential through a server secret channel. **Never upload the development `.env`.** Generate fresh JWT, metrics and database secrets on the server.

SMTP is optional while reset is disabled. S3 and payments are not launch requirements for this single-server Beta.

## Server setup

Use supported Linux Docker Engine + Compose 2.24.4 or newer (`!override`). Start with 4 GB RAM / 2 CPUs and sufficient persistent disk; measure before raising concurrency. Verify the clean release ZIP SHA-256 and extract to `/opt/uvms-ai`.

```bash
cd /opt/uvms-ai
umask 077
python3 - <<'PY'
from pathlib import Path
import getpass, secrets, re
p = Path('.env')
if p.exists(): raise SystemExit('Existing .env preserved')
domain = input('Public DNS hostname: ').strip().lower()
if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', domain): raise SystemExit('Invalid hostname')
key = getpass.getpass('Groq backend key (hidden): ').strip()
if not key or '\n' in key or '\r' in key: raise SystemExit('Invalid credential')
text = Path('.env.production.example').read_text()
for old, new in {
    'ai.example.com': domain,
    'CHANGE_ME_RANDOM_48_PLUS_CHARACTERS': secrets.token_urlsafe(48),
    'CHANGE_ME_RANDOM_32_PLUS_CHARACTERS': secrets.token_urlsafe(32),
    'CHANGE_ME_RANDOM_DATABASE_PASSWORD': secrets.token_urlsafe(36),
    'CHANGE_ME_SERVER_SECRET_ONLY': key,
}.items(): text = text.replace(old, new)
with p.open('x') as f: f.write(text)
p.chmod(0o600)
print('Server environment written; no secrets displayed.')
PY
python3 ops/production_preflight.py .env
docker compose --project-name uvms-ai -f docker-compose.prod.yml config --quiet
docker compose --project-name uvms-ai -f docker-compose.prod.yml build
```

Only nginx publishes ports. PostgreSQL and Redis have persistent volumes on an internal network. API has outbound Groq access on a separate network, without a host port. API runs non-root with two workers, graceful termination and bounded logs. Redis uses AOF and `noeviction`; Redis failure closes production AI admission.

## HTTPS bootstrap

Start the temporary HTTP stack only for ACME validation. Secure cookies make it unsuitable for public login until HTTPS is enabled.

```bash
docker compose --project-name uvms-ai -f docker-compose.prod.yml up -d --wait
read -r -p 'Public hostname: ' UVMS_DOMAIN
read -r -p 'Certificate contact email: ' CERT_EMAIL
export UVMS_DOMAIN
docker compose --project-name uvms-ai -f docker-compose.prod.yml -f docker-compose.https.yml --profile tls run --rm certbot certonly --webroot -w /var/www/certbot --agree-tos --non-interactive --email "$CERT_EMAIL" -d "$UVMS_DOMAIN"
docker compose --project-name uvms-ai -f docker-compose.prod.yml -f docker-compose.https.yml up -d --wait
docker compose --project-name uvms-ai -f docker-compose.prod.yml -f docker-compose.https.yml exec -T nginx nginx -t
docker compose --project-name uvms-ai -f docker-compose.prod.yml -f docker-compose.https.yml exec -T api alembic upgrade head
docker compose --project-name uvms-ai -f docker-compose.prod.yml -f docker-compose.https.yml exec -T api alembic check
docker compose --project-name uvms-ai -f docker-compose.prod.yml -f docker-compose.https.yml --profile tls run --rm certbot renew --dry-run
```

Schedule renewal daily: the last command without `--dry-run`, followed on success by `docker compose --project-name uvms-ai -f docker-compose.prod.yml -f docker-compose.https.yml exec -T nginx nginx -s reload`. Scheduler working directory: `/opt/uvms-ai`. Keep logs private. See [Certbot Docker installation](https://eff-certbot.readthedocs.io/en/stable/install.html) and [renewal documentation](https://eff-certbot.readthedocs.io/en/stable/using.html).

HTTP redirects to HTTPS except ACME challenges. SSE buffering/cache/gzip are disabled for `/api/`. API/Web/Redis/PostgreSQL remain private. Public `/metrics` returns 404; internal API metrics still require a bearer token. `/live` and `/ready` remain accessible. nginx overwrites untrusted forwarded IP headers. Configure trusted real-IP CIDRs explicitly if adding an external proxy.

## Admin and optional demo account

```bash
docker compose --project-name uvms-ai -f docker-compose.prod.yml -f docker-compose.https.yml exec api python -m app.cli create-admin --email admin@your-domain
docker compose --project-name uvms-ai -f docker-compose.prod.yml -f docker-compose.https.yml exec api python -m app.cli create-demo --email demo@your-domain --name 'Workshop Demo'
```

Passwords use hidden prompts. Demo CLI also accepts `UVMS_DEMO_PASSWORD` from a private environment and refuses existing accounts. Store credentials outside source/reports. It creates an ordinary user, synthetic Workshop project, one example user prompt and preference Memory. No fabricated assistant answer. Sign in, ask for a workshop checklist, upload synthetic text and request a chart; real Groq and normal quota apply.

## Backup and disposable restore

Uploads use the persistent `uvms_uploads` volume. Never run `down -v` on deployed data. Announce brief maintenance: backup drains/stops API writes, dumps PostgreSQL, archives uploads, verifies both and restarts API even after failure.

```bash
python3 ops/backup_production.py --env-file .env --project-name uvms-ai --compose-file docker-compose.https.yml --output /srv/private-uvms-backups
```

Keep both archives and the checksum manifest together, with private permissions and an operator-controlled off-server copy. Monitor retention and disk space.

For a drill restore **only to a new disposable database/directory**, never over serving data:

```bash
read -r -p 'Verified backup directory: ' BACKUP_DIR
docker compose --project-name uvms-ai -f docker-compose.prod.yml -f docker-compose.https.yml exec -T postgres sh -ec 'createdb -U "$POSTGRES_USER" uvms_restore_drill'
docker compose --project-name uvms-ai -f docker-compose.prod.yml -f docker-compose.https.yml exec -T postgres sh -ec 'pg_restore --exit-on-error -U "$POSTGRES_USER" -d uvms_restore_drill' < "$BACKUP_DIR/postgres.dump"
docker compose --project-name uvms-ai -f docker-compose.prod.yml -f docker-compose.https.yml exec -T postgres sh -ec 'psql -U "$POSTGRES_USER" -d uvms_restore_drill -c "SELECT version_num FROM alembic_version"'
mkdir -m 700 /srv/uvms-upload-restore-drill
tar -xzf "$BACKUP_DIR/uploads.tar.gz" -C /srv/uvms-upload-restore-drill
```

Use fresh names if these already exist. Compare restored file hashes and row counts. Do not connect the live API to the drill. Disaster recovery must restore DB and uploads from the same backup while API writes are stopped; older DB-only scripts do not constitute full local-storage recovery.

## Public opening gate

Use the actual domain from outside the server, with a clean browser:

- Trusted certificate, HTTP redirect, live/ready HTTP 200.
- Register/login; RU/EN, progressive SSE, Stop/Retry, Project/Memory, file/chart/history, logout/login, 390/360 px layout.
- Secure/HttpOnly refresh cookie; no provider key in network payloads/bundles; no critical console errors or unexpected server tracebacks.
- Normal user denied Admin; Admin displays safe Groq usage, errors, request IDs and rate-limit snapshots.
- Vision, image generation, search and checkout unavailable; password reset hidden without SMTP. Uzbek UI retained; Uzbek AI not certified.
- Current backup and verified disposable restore.

Only then classify **PUBLIC BETA LIVE**. Self-signed local HTTPS verifies the stack only.

## Beta limits

Observed account headers inform budgets; provider quotas can change. Shared Redis admission allows 10 AI operations/user/UTC day, 5/minute and 3 active globally. Failed admitted attempts count. 429 creates a shared model cooldown using Retry-After/reset headers; no automatic retry or provider switching. Capacity leases are unique and expire after abandoned work.

Normal output: 1536 tokens including reasoning. Coding/Deep: up to 2048 only with a recent successful snapshot showing sufficient tokens. Context: 12000 estimated tokens. Long answers may end at the cap with a readable shorter-request suggestion. AI remains fallible. Paid controls stay disabled; free accounts use Fast/Smart. Physical native apps remain uncertified.
