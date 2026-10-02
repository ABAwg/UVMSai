from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def truthy(value: str | None) -> bool:
    return (value or "").lower() in {"1", "true", "yes", "on"}


def exact_https_origin(value: str) -> bool:
    try:
        parsed = urlparse(value)
        return (
            parsed.scheme == "https"
            and bool(parsed.hostname)
            and parsed.path in {"", "/"}
            and not (parsed.username or parsed.password or parsed.query or parsed.fragment)
            and parsed.port != 0
        )
    except ValueError:
        return False


def main() -> int:
    env_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / ".env"
    file_values = load_env(env_path)
    values = {**file_values, **os.environ}
    failures: list[str] = []
    warnings: list[str] = []

    def fail(message: str) -> None:
        failures.append(message)

    def warn(message: str) -> None:
        warnings.append(message)

    if values.get("UVMS_ENV", "").lower() != "production":
        fail("UVMS_ENV must be production")

    jwt_secret = values.get("UVMS_JWT_SECRET", "")
    if len(jwt_secret) < 32 or jwt_secret.startswith("CHANGE_ME") or jwt_secret.startswith("dev-only"):
        fail("UVMS_JWT_SECRET must be a unique 32+ character secret")

    pg_password = values.get("POSTGRES_PASSWORD", "")
    if len(pg_password) < 16 or pg_password.startswith("CHANGE_ME"):
        fail("POSTGRES_PASSWORD must be a strong non-placeholder value (16+ characters recommended)")

    try:
        workers = max(1, int(values.get("UVMS_API_WORKERS", "2")))
        pool_size = max(1, int(values.get("UVMS_DB_POOL_SIZE", "10")))
        overflow = max(0, int(values.get("UVMS_DB_MAX_OVERFLOW", "20")))
    except ValueError:
        fail("UVMS_API_WORKERS / DB pool settings must be integers")
    else:
        max_api_connections = workers * (pool_size + overflow)
        if max_api_connections > 80:
            warn(
                f"API can open up to {max_api_connections} DB connections; verify PostgreSQL max_connections/reserve"
            )

    if not exact_https_origin(values.get("UVMS_PUBLIC_WEB_URL", "")):
        fail("UVMS_PUBLIC_WEB_URL must be a clean https:// origin")

    origins = [item.strip() for item in values.get("UVMS_CORS_ORIGINS", "").split(",") if item.strip()]
    if not origins or any(not exact_https_origin(item) for item in origins):
        fail("UVMS_CORS_ORIGINS must contain exact https:// origins")

    hosts = [item.strip() for item in values.get("UVMS_TRUSTED_HOSTS", "").split(",") if item.strip()]
    if not hosts or "*" in hosts or any("://" in item for item in hosts):
        fail("UVMS_TRUSTED_HOSTS must contain explicit hostnames without schemes")

    if not truthy(values.get("UVMS_REFRESH_COOKIE_SECURE")):
        fail("UVMS_REFRESH_COOKIE_SECURE must be true")

    if not values.get("UVMS_REDIS_URL", ""):
        fail("UVMS_REDIS_URL is required for shared production state")

    metrics_token = values.get("UVMS_METRICS_TOKEN", "")
    if len(metrics_token) < 24:
        fail("UVMS_METRICS_TOKEN must be a strong 24+ character token")

    if truthy(values.get("UVMS_PASSWORD_RESET_ENABLED", "true")) and not values.get("UVMS_SMTP_HOST"):
        fail("SMTP must be configured while password reset is enabled")

    storage = values.get("UVMS_STORAGE_BACKEND", "local").lower()
    if storage not in {"local", "s3"}:
        fail("UVMS_STORAGE_BACKEND must be local or s3")
    if storage == "s3" and not values.get("UVMS_S3_BUCKET"):
        fail("UVMS_S3_BUCKET is required for S3 storage")
    if storage == "local":
        warn("Local upload storage is single-server only; use private S3/R2 for horizontal scaling")

    try:
        max_upload_mb = int(values.get("UVMS_MAX_UPLOAD_MB", "20"))
    except ValueError:
        fail("UVMS_MAX_UPLOAD_MB must be an integer")
    else:
        if max_upload_mb > 100:
            fail("UVMS_MAX_UPLOAD_MB exceeds the included Nginx 105 MB multipart proxy allowance")
    try:
        max_request_mb = int(values.get("UVMS_MAX_REQUEST_MB", "105"))
    except ValueError:
        fail("UVMS_MAX_REQUEST_MB must be an integer")
    else:
        if 'max_upload_mb' in locals() and max_request_mb < max_upload_mb:
            fail("UVMS_MAX_REQUEST_MB must be >= UVMS_MAX_UPLOAD_MB")
        if max_request_mb > 105:
            fail("UVMS_MAX_REQUEST_MB exceeds the included Nginx 105 MB request allowance")

    if not truthy(values.get("UVMS_REQUIRE_LIVE_AI", "true")) and not truthy(values.get("UVMS_ALLOW_DEMO_IN_PRODUCTION")):
        fail("UVMS_REQUIRE_LIVE_AI must be true for a production release")

    provider = values.get("UVMS_AI_PROVIDER", "auto").lower()
    if provider not in {"auto", "demo", "openai", "openai-compatible", "gemini", "groq"}:
        fail("UVMS_AI_PROVIDER must select a production-supported provider")
    openai_key = values.get("OPENAI_API_KEY", "")
    gemini_key = values.get('GEMINI_API_KEY', '')
    groq_key = values.get('GROQ_API_KEY', '')
    if provider == 'auto':
        provider = 'openai' if openai_key else 'gemini' if gemini_key else 'groq' if groq_key else 'demo'
    key = groq_key if provider == 'groq' else gemini_key if provider == 'gemini' else openai_key
    if provider == 'groq' and values.get('GROQ_BASE_URL', 'https://api.groq.com/openai/v1').rstrip('/') != 'https://api.groq.com/openai/v1':
        fail('GROQ_BASE_URL must be the official HTTPS endpoint')
    if truthy(values.get('UVMS_PUBLIC_BETA','true')):
        if provider != 'groq': fail('Public Beta requires Groq')
        if any(values.get('GROQ_MODEL_'+mode, values.get('GROQ_MODEL','openai/gpt-oss-120b')) != 'openai/gpt-oss-120b' for mode in ('FAST','BALANCED','DEEP')):
            fail('Public Beta text modes must all use openai/gpt-oss-120b')
        if any(truthy(values.get(name,'false')) for name in ('GROQ_VISION_ENABLED','UVMS_IMAGES_ENABLED','UVMS_SEARCH_ENABLED')):
            fail('Public Beta Vision, image generation and search must be disabled')
        try:
            if not all(1<=int(values.get(name,str(limit)))<=limit for name,limit in
                       [('UVMS_BETA_DAILY_REQUESTS',10),('UVMS_BETA_MINUTE_REQUESTS',5),('UVMS_BETA_GLOBAL_CONCURRENCY',3)]):
                fail('Public Beta request limits exceed the release safety envelope')
        except ValueError: fail('Public Beta limits must be integers')
    if provider == 'gemini' and values.get('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/openai/').rstrip('/') != 'https://generativelanguage.googleapis.com/v1beta/openai':
        fail('GEMINI_BASE_URL must be the official HTTPS OpenAI-compatible endpoint')
    if provider in {"openai", "openai-compatible", "gemini", "groq"} and (not key or key.startswith("CHANGE_ME")):
        fail("Configured production AI provider requires a real credential")
    if truthy(values.get("UVMS_REQUIRE_LIVE_AI", "true")):
        if provider == "demo" or not key or key.startswith("CHANGE_ME"):
            fail("UVMS_REQUIRE_LIVE_AI=true requires a configured production AI credential")

    billing = values.get("UVMS_BILLING_PROVIDER", "disabled").lower()
    if billing == "demo":
        fail("Demo billing is not allowed in production; set UVMS_BILLING_PROVIDER=disabled")
    elif billing == "disabled":
        warn("Paid subscriptions are disabled; deployment is safe but free-only until a payment adapter is certified")
    else:
        fail("No certified production payment adapter is bundled; use UVMS_BILLING_PROVIDER=disabled")

    for message in warnings:
        print(f"WARN: {message}")
    for message in failures:
        print(f"FAIL: {message}")

    if failures:
        print(f"Production preflight FAILED ({len(failures)} blocking issue(s))")
        return 1

    print("Production preflight PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
