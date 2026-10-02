from __future__ import annotations

from contextlib import asynccontextmanager
import time
import uuid
import logging
import json
import math
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .account_routes import router as account_router
from .config import effective_ai_provider, provider_api_key, settings
from .database import Base, SessionLocal, engine
from .ops import configure_logging, log_request, metrics_text, readiness
from .rate_limit import check_rate_limit, identity_key
from .routes import router
from .seed import seed_models, seed_plans


def _validate_runtime_settings() -> None:
    if settings.ai_provider not in {'auto','demo','openai','openrouter','openai-compatible','gemini','groq'}:
        raise RuntimeError('Unsupported UVMS_AI_PROVIDER')
    if settings.ai_provider == 'openrouter' and settings.env.lower() not in {'development','demo','test'}:
        raise RuntimeError('OpenRouter free routing is restricted to development/demo/test environments')
    if effective_ai_provider(settings) == 'groq':
        if settings.groq_base_url != 'https://api.groq.com/openai/v1':
            raise RuntimeError('GROQ_BASE_URL must be the official HTTPS endpoint')
        if not all((settings.groq_model_fast, settings.groq_model_balanced, settings.groq_model_deep, settings.groq_transcription_model)):
            raise RuntimeError('All GROQ models must be configured')
        if not 64 <= settings.groq_coding_output_tokens <= 16384 or settings.context_tokens < settings.groq_coding_output_tokens + 2048:
            raise RuntimeError('Invalid Groq coding output budget')
    if settings.public_beta:
        if not (1 <= settings.beta_daily_requests <= 10 and 1 <= settings.beta_minute_requests <= 5 and 1 <= settings.beta_global_concurrency <= 3):
            raise RuntimeError('Public Beta request limits must stay within 10/day, 5/minute and 3 concurrent')
        if not (256 <= settings.beta_output_tokens <= 1536 and settings.beta_output_tokens <= settings.beta_extended_output_tokens <= 2048
                and settings.beta_extended_output_tokens + 3072 <= settings.beta_context_tokens <= 12000):
            raise RuntimeError('Invalid Public Beta input/output budgets')
        if settings.env.lower() == 'production':
            if effective_ai_provider(settings) != 'groq' or any(model != 'openai/gpt-oss-120b' for model in
                    (settings.groq_model_fast, settings.groq_model_balanced, settings.groq_model_deep)):
                raise RuntimeError('Public Beta requires Groq GPT-OSS-120B for all text modes')
            if settings.billing_provider != 'disabled' or settings.groq_vision_enabled or settings.images_enabled or settings.search_enabled:
                raise RuntimeError('Public Beta billing, Vision, image generation and search must be disabled')
    if effective_ai_provider(settings) == 'gemini':
        if settings.gemini_base_url != 'https://generativelanguage.googleapis.com/v1beta/openai':
            raise RuntimeError('GEMINI_BASE_URL must be the official HTTPS OpenAI-compatible endpoint')
        if not all((settings.gemini_model_fast, settings.gemini_model_balanced, settings.gemini_model_deep)):
            raise RuntimeError('All GEMINI_MODEL aliases must be configured')
    if settings.context_tokens < settings.output_tokens + 2048 or settings.output_tokens < 64:
        raise RuntimeError('Invalid AI input/output token budget')
    if settings.provider_timeout <= 0 or settings.image_timeout <= 0:
        raise RuntimeError('Provider timeouts must be positive')
    if settings.max_upload_mb <= 0 or settings.max_request_mb <= 0:
        raise RuntimeError('Upload/request limits must be positive')
    if settings.max_request_mb < settings.max_upload_mb:
        raise RuntimeError('UVMS_MAX_REQUEST_MB must be >= UVMS_MAX_UPLOAD_MB')
    if settings.access_token_minutes < 5 or settings.access_token_minutes > 240:
        raise RuntimeError('UVMS_ACCESS_TOKEN_MINUTES must be between 5 and 240')
    if settings.refresh_token_days < 1 or settings.refresh_token_days > 180:
        raise RuntimeError('UVMS_REFRESH_TOKEN_DAYS must be between 1 and 180')
    try:
        prices = json.loads(settings.provider_prices)
        if not isinstance(prices,dict): raise ValueError()
        allowed = {'input_per_million','output_per_million','per_search','per_image','per_second'}
        for rates in prices.values():
            if not isinstance(rates,dict) or set(rates)-allowed: raise ValueError()
            if any(isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<0 for value in rates.values()): raise ValueError()
    except (ValueError, TypeError):
        raise RuntimeError('Invalid UVMS_PROVIDER_PRICES_JSON: use nonnegative finite USD rates') from None
    if settings.env.lower() != "production":
        return
    if settings.database_url.lower().startswith("sqlite"):
        raise RuntimeError("SQLite is not allowed for UVMS_ENV=production; configure PostgreSQL")
    if not settings.redis_url:
        raise RuntimeError("UVMS_REDIS_URL is required in production for shared rate limits and cancellation")
    if settings.jwt_secret == "dev-only-change-me-please-replace-32chars-minimum" or len(settings.jwt_secret) < 32:
        raise RuntimeError("UVMS_JWT_SECRET must be a unique 32+ character secret in production")
    if any(origin == "*" for origin in settings.cors_origins):
        raise RuntimeError("Wildcard CORS is not allowed in production")
    if not settings.trusted_hosts or "*" in settings.trusted_hosts:
        raise RuntimeError("UVMS_TRUSTED_HOSTS must list explicit hosts in production")
    if not settings.refresh_cookie_secure:
        raise RuntimeError("UVMS_REFRESH_COOKIE_SECURE=true is required in production")
    public_url = urlparse(settings.public_web_url)
    if public_url.scheme != "https" or not public_url.hostname or public_url.username or public_url.password or public_url.query or public_url.fragment:
        raise RuntimeError("UVMS_PUBLIC_WEB_URL must be a clean https:// URL in production")
    for origin in settings.cors_origins:
        parsed = urlparse(origin)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            raise RuntimeError("Every UVMS_CORS_ORIGINS entry must be an exact https:// origin")
    if settings.storage_backend.lower() not in {"local", "s3"}:
        raise RuntimeError("UVMS_STORAGE_BACKEND must be local or s3")
    if settings.storage_backend.lower() == "s3" and not settings.s3_bucket:
        raise RuntimeError("UVMS_S3_BUCKET is required when UVMS_STORAGE_BACKEND=s3")
    provider = effective_ai_provider(settings)
    if provider in {"openai", "openai-compatible", "gemini", "groq"} and (
        not provider_api_key(settings) or provider_api_key(settings).startswith("CHANGE_ME")
    ):
        raise RuntimeError("Configured live AI provider requires a real backend credential")
    if settings.require_live_ai and provider == "demo":
        raise RuntimeError("UVMS_REQUIRE_LIVE_AI=true but no live AI provider is configured")
    if provider == "demo" and not settings.allow_demo_in_production:
        raise RuntimeError("Production requires a live AI provider; set UVMS_ALLOW_DEMO_IN_PRODUCTION=true only for an intentional staging/demo deployment")
    if settings.billing_provider not in {"disabled", "demo"}:
        raise RuntimeError("No production payment adapter is installed; set UVMS_BILLING_PROVIDER=disabled until one is implemented and certified")
    if settings.billing_provider == "demo":
        raise RuntimeError("Demo billing is not allowed in production; use UVMS_BILLING_PROVIDER=disabled")
    if settings.password_reset_enabled and not settings.smtp_host:
        raise RuntimeError("UVMS_SMTP_HOST is required in production when password reset is enabled")
    if not settings.metrics_token or len(settings.metrics_token) < 24:
        raise RuntimeError("UVMS_METRICS_TOKEN must be a strong 24+ character token in production")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_logging()
    _validate_runtime_settings()
    if settings.env.lower() != "production":
        Base.metadata.create_all(bind=engine)
    if settings.seed_on_startup:
        with SessionLocal() as db:
            seed_plans(db)
            seed_models(db)
    yield


app = FastAPI(
    title="UVMS AI API",
    version=settings.release_version,
    description="Shared backend for UVMS AI Web + Mobile",
    lifespan=lifespan,
)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=list(settings.trusted_hosts) or ["localhost", "127.0.0.1", "testserver"],
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-UVMS-Chat-Id", "X-UVMS-Request-Id", "X-UVMS-Message-Id", "X-Request-ID", "X-Total-Count"],
)

app.include_router(router)
app.include_router(account_router)


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    message = str(exc.detail) if exc.status_code < 500 else 'The service is temporarily unavailable. Please try again.'
    if exc.status_code == 504: message = 'The response took too long. Try again.'
    response = JSONResponse(status_code=exc.status_code, content={'detail': message, 'error': {'code': f'http_{exc.status_code}', 'message': message}}, headers=exc.headers)
    if request.url.path.endswith('/auth/refresh') and exc.status_code == 401:
        response.delete_cookie(settings.refresh_cookie_name, path='/api/v1/auth', domain=settings.refresh_cookie_domain or None)
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    message = 'Please check the information you entered.'
    return JSONResponse(status_code=422, content={'detail': message, 'error': {'code': 'validation_error', 'message': message}})


@app.middleware("http")
async def request_size_guard(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH"}:
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                size = int(content_length)
            except ValueError:
                return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length header", "error": {"code": "invalid_content_length", "message": "Invalid request size header."}})
            if size < 0:
                return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length header", "error": {"code": "invalid_content_length", "message": "Invalid request size header."}})
            if size > settings.max_request_mb * 1024 * 1024:
                message = f"Request exceeds the {settings.max_request_mb} MB server limit."
                return JSONResponse(status_code=413, content={"detail": message, "error": {"code": "request_too_large", "message": message}})
    return await call_next(request)


@app.middleware("http")
async def request_rate_limit(request: Request, call_next):
    path = request.url.path
    if path in {"/health", "/live", "/ready", "/metrics"} or not path.startswith("/api/v1"):
        return await call_next(request)

    if path.startswith("/api/v1/auth/"):
        limit = settings.rate_limit_auth_per_minute
    elif any(token in path for token in ("/chat/", "/images/", "/audio/")):
        limit = settings.rate_limit_ai_per_minute
    else:
        limit = settings.rate_limit_default_per_minute

    client_ip = request.client.host if request.client else "unknown"
    identity = identity_key(client_ip, None if path.startswith('/api/v1/auth/') else request.headers.get("authorization"))
    result = check_rate_limit(f"{identity}:{path}", limit, 60)
    if not result.allowed:
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Please retry shortly.", "error": {"code": "rate_limited", "message": "Too many requests. Please retry shortly."}},
            headers={
                "Retry-After": str(result.retry_after),
                "X-RateLimit-Limit": str(result.limit),
                "X-RateLimit-Remaining": "0",
            },
        )
    response = await call_next(request)
    response.headers["X-RateLimit-Limit"] = str(result.limit)
    response.headers["X-RateLimit-Remaining"] = str(result.remaining)
    return response


@app.middleware("http")
async def platform_headers_and_logging(request: Request, call_next):
    supplied_request_id = (request.headers.get("X-Request-ID") or "").strip()
    request_id = supplied_request_id if 1 <= len(supplied_request_id) <= 64 and all(ch.isalnum() or ch in "-_." for ch in supplied_request_id) else uuid.uuid4().hex
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as exc:
        logging.getLogger('uvms.api').error('Unhandled request error; type=%s request_id=%s', type(exc).__name__, request_id)
        message = 'The service is temporarily unavailable. Please try again.'
        response = JSONResponse(status_code=500, content={'detail': message, 'error': {'code': 'internal_error', 'message': message}})
    duration = (time.perf_counter() - started) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=(self), geolocation=()"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith("/api/v1") and "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-store"
    if settings.env.lower() == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    log_request(
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        duration_ms=duration,
        client_ip=request.client.host if request.client else "unknown",
    )
    return response


@app.get("/health")
@app.get("/live")
def live():
    return {"status": "ok", "service": "uvms-ai-api", "version": app.version}


@app.get("/ready")
def ready():
    result = readiness()
    if result["status"] != "ready":
        return JSONResponse(status_code=503, content=result)
    return result


@app.get("/metrics")
def metrics(request: Request):
    return PlainTextResponse(metrics_text(request), media_type="text/plain; version=0.0.4")
