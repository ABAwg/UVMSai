from dataclasses import replace
import os
from pathlib import Path
import subprocess
import sys

import pytest
from sqlalchemy.engine import make_url
from starlette.requests import Request

from app import main, ops, prod_start
from app.config import settings


def production_settings(**changes):
    base = replace(
        settings,
        env="production",
        database_url="postgresql+psycopg://uvms:secret@postgres:5432/uvms_ai",
        redis_url="redis://redis:6379/0",
        jwt_secret="j" * 48,
        cors_origins=("https://ai.example.com",),
        trusted_hosts=("ai.example.com",),
        refresh_cookie_secure=True,
        public_web_url="https://ai.example.com",
        storage_backend="local",
        password_reset_enabled=False,
        metrics_token="m" * 32,
        ai_provider="openai",
        openai_api_key="test-live-provider-key",
        require_live_ai=True,
        billing_provider="disabled",
    )
    return replace(base, **changes)


def test_production_runtime_accepts_hardened_baseline(monkeypatch):
    monkeypatch.setattr(main, "settings", production_settings())
    main._validate_runtime_settings()


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"database_url": "sqlite:///prod.db"}, "SQLite is not allowed"),
        ({"redis_url": ""}, "UVMS_REDIS_URL is required"),
        ({"refresh_cookie_secure": False}, "REFRESH_COOKIE_SECURE"),
        ({"public_web_url": "http://ai.example.com"}, "PUBLIC_WEB_URL"),
        ({"cors_origins": ("http://ai.example.com",)}, "CORS_ORIGINS"),
        ({"metrics_token": "short"}, "METRICS_TOKEN"),
    ],
)
def test_production_runtime_rejects_unsafe_configuration(monkeypatch, changes, message):
    monkeypatch.setattr(main, "settings", production_settings(**changes))
    with pytest.raises(RuntimeError, match=message):
        main._validate_runtime_settings()


def test_require_live_ai_rejects_demo(monkeypatch):
    monkeypatch.setattr(main, "settings", production_settings(ai_provider="demo", openai_api_key="", require_live_ai=True))
    with pytest.raises(RuntimeError, match="REQUIRE_LIVE_AI"):
        main._validate_runtime_settings()


def test_require_live_ai_rejects_example_credential(monkeypatch):
    monkeypatch.setattr(main, "settings", production_settings(openai_api_key="CHANGE_ME_PROVIDER_KEY"))
    with pytest.raises(RuntimeError, match="real backend credential"):
        main._validate_runtime_settings()


def test_explicit_live_provider_requires_key_even_with_staging_override(monkeypatch):
    monkeypatch.setattr(main, "settings", production_settings(openai_api_key="", require_live_ai=False, allow_demo_in_production=True))
    with pytest.raises(RuntimeError, match="real backend credential"):
        main._validate_runtime_settings()


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({}, "Production preflight PASS"),
        ({"UVMS_AI_PROVIDER": "demo"}, "requires a configured production AI credential"),
        ({"UVMS_AI_PROVIDER": "openrouter"}, "production-supported provider"),
        ({"UVMS_REQUIRE_LIVE_AI": "false", "UVMS_ALLOW_DEMO_IN_PRODUCTION": "true", "OPENAI_API_KEY": ""}, "Configured production AI provider requires a real credential"),
        ({"UVMS_REDIS_URL": ""}, "UVMS_REDIS_URL is required"),
        ({"UVMS_PUBLIC_WEB_URL": "https://ai.example.com/private"}, "clean https:// origin"),
        ({"UVMS_CORS_ORIGINS": "https://ai.example.com/private"}, "exact https:// origins"),
    ],
)
def test_production_preflight_rejects_false_passes(tmp_path, changes, message):
    values = {
        "UVMS_ENV": "production",
        "UVMS_PUBLIC_BETA": "false",  # Legacy provider validation, independent of public Beta policy.
        "UVMS_JWT_SECRET": "j" * 48,
        "POSTGRES_PASSWORD": "p" * 24,
        "UVMS_PUBLIC_WEB_URL": "https://ai.example.com",
        "UVMS_CORS_ORIGINS": "https://ai.example.com",
        "UVMS_TRUSTED_HOSTS": "ai.example.com",
        "UVMS_REFRESH_COOKIE_SECURE": "true",
        "UVMS_REDIS_URL": "redis://redis:6379/0",
        "UVMS_METRICS_TOKEN": "m" * 32,
        "UVMS_PASSWORD_RESET_ENABLED": "false",
        "UVMS_REQUIRE_LIVE_AI": "true",
        "UVMS_AI_PROVIDER": "openai",
        "OPENAI_API_KEY": "test-nonproduction-credential",
        "UVMS_BILLING_PROVIDER": "disabled",
    }
    values.update(changes)
    env_file = tmp_path / "preflight.env"
    env_file.write_text("\n".join(f"{key}={value}" for key, value in values.items()), encoding="utf-8")
    # The deploy preflight lives outside the API Docker build context. Exercise
    # it in the full checkout; the production image contains API code only.
    script = next(
        (parent / "ops" / "production_preflight.py" for parent in Path(__file__).resolve().parents
         if (parent / "ops" / "production_preflight.py").is_file()),
        None,
    )
    if script is None:
        pytest.skip("deployment preflight is not bundled in the API image")
    result = subprocess.run(
        [sys.executable, str(script), str(env_file)],
        capture_output=True,
        text=True,
        env={"SystemRoot": os.environ.get("SystemRoot", "C:\\Windows")},
        check=False,
    )
    assert (result.returncode == 0) is (not changes), result.stdout
    assert message in result.stdout


def test_prod_start_escapes_special_postgres_password(monkeypatch):
    raw = "p@ss:/?#[]! strong"
    monkeypatch.setenv("POSTGRES_USER", "uvms-user")
    monkeypatch.setenv("POSTGRES_PASSWORD", raw)
    monkeypatch.setenv("POSTGRES_DB", "uvms-ai")
    monkeypatch.setenv("POSTGRES_HOST", "postgres")
    monkeypatch.setenv("POSTGRES_PORT", "5432")
    monkeypatch.delenv("UVMS_DATABASE_URL", raising=False)
    prod_start.configure_database_url()
    parsed = make_url(__import__("os").environ["UVMS_DATABASE_URL"])
    assert parsed.username == "uvms-user"
    assert parsed.password == raw
    assert parsed.database == "uvms-ai"
    assert parsed.host == "postgres"


def test_metrics_use_redis_aggregate_and_require_token(monkeypatch):
    class FakeRedis:
        def get(self, key):
            assert key == "uvms:metrics:http_requests_total"
            return "42"

        def hgetall(self, key):
            assert key == "uvms:metrics:http_responses_total"
            return {"200": "40", "500": "2"}

    config = replace(settings, redis_url="redis://redis:6379/0", metrics_token="t" * 32)
    monkeypatch.setattr(ops, "settings", config)
    monkeypatch.setattr(ops, "_metrics_redis", lambda: FakeRedis())

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/metrics",
        "headers": [(b"authorization", b"Bearer " + (b"t" * 32))],
        "query_string": b"",
        "server": ("test", 80),
        "client": ("127.0.0.1", 12345),
        "scheme": "http",
    }
    body = ops.metrics_text(Request(scope))
    assert 'uvms_metrics_backend_info{backend="redis"} 1' in body
    assert "uvms_http_requests_total 42" in body
    assert 'uvms_http_responses_total{status="500"} 2' in body

    scope["headers"] = [(b"authorization", b"Bearer wrong")]
    with pytest.raises(Exception) as exc:
        ops.metrics_text(Request(scope))
    assert getattr(exc.value, "status_code", None) == 401


def test_production_demo_requires_explicit_override(monkeypatch):
    demo = production_settings(ai_provider="demo", openai_api_key="", require_live_ai=False, allow_demo_in_production=False)
    monkeypatch.setattr(main, "settings", demo)
    with pytest.raises(RuntimeError, match="Production requires a live AI provider"):
        main._validate_runtime_settings()

    monkeypatch.setattr(main, "settings", replace(demo, allow_demo_in_production=True))
    main._validate_runtime_settings()


def test_request_size_guard_rejects_oversized_content_length(monkeypatch):
    import asyncio
    from starlette.requests import Request

    monkeypatch.setattr(main, "settings", replace(settings, max_request_mb=1))
    scope = {
        "type": "http", "method": "POST", "path": "/api/v1/files",
        "headers": [(b"content-length", b"1048577")], "query_string": b"",
        "server": ("test", 80), "client": ("127.0.0.1", 12345), "scheme": "http",
    }
    response = asyncio.run(main.request_size_guard(Request(scope), lambda _request: None))
    assert response.status_code == 413
