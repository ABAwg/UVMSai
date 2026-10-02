from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv_file() -> None:
    candidates = [Path.cwd() / ".env"]
    candidates.extend(parent / ".env" for parent in Path.cwd().parents[:4])
    for candidate in candidates:
        if not candidate.is_file():
            continue
        for raw in candidate.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
        break


_load_dotenv_file()


def _csv(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


def _bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    env: str = os.getenv("UVMS_ENV", "development")
    database_url: str = os.getenv("UVMS_DATABASE_URL", "sqlite:///./uvms_ai.db")
    jwt_secret: str = os.getenv("UVMS_JWT_SECRET", "dev-only-change-me-please-replace-32chars-minimum")
    access_token_minutes: int = int(os.getenv("UVMS_ACCESS_TOKEN_MINUTES", "30"))
    refresh_token_days: int = int(os.getenv("UVMS_REFRESH_TOKEN_DAYS", "30"))
    refresh_cookie_name: str = os.getenv("UVMS_REFRESH_COOKIE_NAME", "uvms_refresh")
    refresh_cookie_secure: bool = _bool("UVMS_REFRESH_COOKIE_SECURE", "false")
    refresh_cookie_domain: str = os.getenv("UVMS_REFRESH_COOKIE_DOMAIN", "")
    db_pool_size: int = int(os.getenv("UVMS_DB_POOL_SIZE", "10"))
    db_max_overflow: int = int(os.getenv("UVMS_DB_MAX_OVERFLOW", "20"))
    redis_url: str = os.getenv("UVMS_REDIS_URL", "")
    rate_limit_enabled: bool = _bool("UVMS_RATE_LIMIT_ENABLED", "true")
    rate_limit_default_per_minute: int = int(os.getenv("UVMS_RATE_LIMIT_DEFAULT_PER_MINUTE", "180"))
    rate_limit_auth_per_minute: int = int(os.getenv("UVMS_RATE_LIMIT_AUTH_PER_MINUTE", "30"))
    rate_limit_ai_per_minute: int = int(os.getenv("UVMS_RATE_LIMIT_AI_PER_MINUTE", "60"))
    cors_origins: tuple[str, ...] = tuple(_csv("UVMS_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"))
    trusted_hosts: tuple[str, ...] = tuple(_csv("UVMS_TRUSTED_HOSTS", "localhost,127.0.0.1,testserver"))
    bootstrap_admin_email: str = os.getenv("UVMS_BOOTSTRAP_ADMIN_EMAIL", "admin@uvms.uz").lower()
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openrouter_api_key: str = os.getenv('OPENROUTER_API_KEY', '')
    openrouter_base_url: str = 'https://openrouter.ai/api/v1'
    gemini_api_key: str = os.getenv('GEMINI_API_KEY', '')
    gemini_base_url: str = os.getenv('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/openai/').rstrip('/')
    gemini_model_fast: str = os.getenv('GEMINI_MODEL_FAST', 'gemini-3.8-flash')
    gemini_model_balanced: str = os.getenv('GEMINI_MODEL_BALANCED', 'gemini-3.8-flash')
    gemini_model_deep: str = os.getenv('GEMINI_MODEL_DEEP', 'gemini-3.8-flash')
    groq_api_key: str = os.getenv('GROQ_API_KEY', '')
    groq_base_url: str = os.getenv('GROQ_BASE_URL', 'https://api.groq.com/openai/v1').rstrip('/')
    groq_model: str = os.getenv('GROQ_MODEL', 'openai/gpt-oss-120b')
    groq_model_fast: str = os.getenv('GROQ_MODEL_FAST', os.getenv('GROQ_MODEL', 'openai/gpt-oss-120b'))
    groq_model_balanced: str = os.getenv('GROQ_MODEL_BALANCED', os.getenv('GROQ_MODEL', 'openai/gpt-oss-120b'))
    groq_model_deep: str = os.getenv('GROQ_MODEL_DEEP', os.getenv('GROQ_MODEL', 'openai/gpt-oss-120b'))
    public_beta: bool = _bool('UVMS_PUBLIC_BETA', 'true')
    beta_daily_requests: int = int(os.getenv('UVMS_BETA_DAILY_REQUESTS', '10'))
    beta_minute_requests: int = int(os.getenv('UVMS_BETA_MINUTE_REQUESTS', '5'))
    beta_global_concurrency: int = int(os.getenv('UVMS_BETA_GLOBAL_CONCURRENCY', '3'))
    beta_context_tokens: int = int(os.getenv('UVMS_BETA_CONTEXT_TOKENS', '12000'))
    beta_output_tokens: int = int(os.getenv('UVMS_BETA_OUTPUT_TOKENS', '1536'))
    beta_extended_output_tokens: int = int(os.getenv('UVMS_BETA_EXTENDED_OUTPUT_TOKENS', '2048'))
    groq_vision_model: str = os.getenv('GROQ_VISION_MODEL', 'qwen/qwen3.8-27b')
    groq_coding_output_tokens: int = int(os.getenv('GROQ_CODING_OUTPUT_TOKENS', '4096'))
    # Public launch remains disabled until the factual Vision acceptance passes.
    groq_vision_enabled: bool = _bool('GROQ_VISION_ENABLED', 'false')
    groq_transcription_model: str = os.getenv('GROQ_TRANSCRIPTION_MODEL', 'whisper-large-v3-turbo')
    ai_provider: str = os.getenv('UVMS_AI_PROVIDER', 'auto').lower()
    model_fast: str = os.getenv('UVMS_MODEL_FAST', '')
    model_balanced: str = os.getenv('UVMS_MODEL_BALANCED', '')
    model_deep: str = os.getenv('UVMS_MODEL_DEEP', '')
    context_tokens: int = int(os.getenv('UVMS_CONTEXT_TOKENS', '32768'))
    output_tokens: int = int(os.getenv('UVMS_OUTPUT_TOKENS', '4096'))
    provider_timeout: float = float(os.getenv('UVMS_PROVIDER_TIMEOUT_SECONDS', '120'))
    image_timeout: float = float(os.getenv('UVMS_IMAGE_TIMEOUT_SECONDS', '240'))
    provider_prices: str = os.getenv('UVMS_PROVIDER_PRICES_JSON', '{}')
    search_enabled: bool = _bool('UVMS_SEARCH_ENABLED', 'true')
    images_enabled: bool = _bool('UVMS_IMAGES_ENABLED', 'true')
    voice_enabled: bool = _bool('UVMS_VOICE_ENABLED', 'true')
    vision_max_images: int = int(os.getenv('UVMS_VISION_MAX_IMAGES', '4'))
    vision_max_pixels: int = int(os.getenv('UVMS_VISION_MAX_PIXELS', '25000000'))
    openai_base_url: str = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-5.6")
    openai_image_model: str = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
    openai_transcription_model: str = os.getenv("OPENAI_TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe")
    require_live_ai: bool = _bool("UVMS_REQUIRE_LIVE_AI", "false")
    allow_demo_in_production: bool = _bool("UVMS_ALLOW_DEMO_IN_PRODUCTION", "false")
    storage_dir: str = os.getenv("UVMS_STORAGE_DIR", "./storage")
    storage_backend: str = os.getenv("UVMS_STORAGE_BACKEND", "local")
    s3_endpoint_url: str = os.getenv("UVMS_S3_ENDPOINT_URL", "")
    s3_region: str = os.getenv("UVMS_S3_REGION", "auto")
    s3_bucket: str = os.getenv("UVMS_S3_BUCKET", "")
    s3_access_key_id: str = os.getenv("UVMS_S3_ACCESS_KEY_ID", "")
    s3_secret_access_key: str = os.getenv("UVMS_S3_SECRET_ACCESS_KEY", "")
    s3_force_path_style: bool = _bool("UVMS_S3_FORCE_PATH_STYLE", "false")
    max_upload_mb: int = int(os.getenv("UVMS_MAX_UPLOAD_MB", "20"))
    max_request_mb: int = int(os.getenv("UVMS_MAX_REQUEST_MB", "105"))
    max_audio_mb: int = int(os.getenv("UVMS_MAX_AUDIO_MB", "25"))
    max_extracted_text_chars: int = int(os.getenv("UVMS_MAX_EXTRACTED_TEXT_CHARS", "120000"))
    public_web_url: str = os.getenv("UVMS_PUBLIC_WEB_URL", "http://localhost:3000").rstrip("/")
    billing_provider: str = os.getenv("UVMS_BILLING_PROVIDER", "demo").lower()
    release_version: str = os.getenv("UVMS_RELEASE_VERSION", "1.4.3")
    billing_webhook_secret: str = os.getenv("UVMS_BILLING_WEBHOOK_SECRET", "")
    password_reset_enabled: bool = _bool("UVMS_PASSWORD_RESET_ENABLED", "true")
    password_reset_minutes: int = int(os.getenv("UVMS_PASSWORD_RESET_MINUTES", "30"))
    smtp_host: str = os.getenv("UVMS_SMTP_HOST", "")
    smtp_port: int = int(os.getenv("UVMS_SMTP_PORT", "587"))
    smtp_username: str = os.getenv("UVMS_SMTP_USERNAME", "")
    smtp_password: str = os.getenv("UVMS_SMTP_PASSWORD", "")
    smtp_from: str = os.getenv("UVMS_SMTP_FROM", "UVMS AI <no-reply@localhost>")
    smtp_starttls: bool = _bool("UVMS_SMTP_STARTTLS", "true")
    metrics_token: str = os.getenv("UVMS_METRICS_TOKEN", "")
    seed_on_startup: bool = _bool("UVMS_SEED_ON_STARTUP", "true")


settings = Settings()


def effective_ai_provider(config: Settings | None = None) -> str:
    """Resolve the provider actually used for text requests.

    ``auto`` historically only considered ``OPENAI_API_KEY`` even though the
    project also supports OpenRouter for development.  That made a perfectly
    configured local OpenRouter key silently fall back to demo responses on
    mobile. Keep explicit choices authoritative; auto prefers OpenAI, then
    Gemini, then Groq, and only selects OpenRouter in non-production
    environments where free routing is allowed.
    """
    config = config or settings
    provider = config.ai_provider
    if provider != "auto":
        return provider
    if config.openai_api_key:
        return "openai"
    if config.gemini_api_key:
        return "gemini"
    if config.groq_api_key:
        return "groq"
    if config.openrouter_api_key and config.env.lower() in {"development", "demo", "test"}:
        return "openrouter"
    return "demo"


def provider_api_key(config: Settings | None = None) -> str:
    """Backend only; never serialize this value in diagnostics."""
    config = config or settings
    return {'gemini': config.gemini_api_key, 'groq': config.groq_api_key, 'openrouter': config.openrouter_api_key,
            'openai': config.openai_api_key, 'openai-compatible': config.openai_api_key}.get(effective_ai_provider(config), '')
