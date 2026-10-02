"""Production container entrypoint for UVMS AI.

This module deliberately sets the database URL before importing application
modules. It safely escapes PostgreSQL credentials, runs migrations and seeds
reference data once, then replaces itself with Uvicorn so signals reach the
server process directly.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import URL


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise SystemExit(f"Missing required production environment variable: {name}")
    return value


def configure_database_url() -> None:
    url = URL.create(
        "postgresql+psycopg",
        username=_required("POSTGRES_USER"),
        password=_required("POSTGRES_PASSWORD"),
        host=os.getenv("POSTGRES_HOST", "postgres"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        database=_required("POSTGRES_DB"),
    )
    os.environ["UVMS_DATABASE_URL"] = url.render_as_string(hide_password=False)


def migrate() -> None:
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(cfg, "head")


def seed() -> None:
    # Import only after UVMS_DATABASE_URL is set.
    from .cli import seed_reference_data

    seed_reference_data()


def main() -> None:
    configure_database_url()
    os.environ.setdefault("UVMS_SEED_ON_STARTUP", "false")
    migrate()
    seed()

    workers = max(1, int(os.getenv("UVMS_API_WORKERS", "2")))
    graceful = max(5, int(os.getenv("UVMS_GRACEFUL_SHUTDOWN_SECONDS", "30")))
    keep_alive = max(1, int(os.getenv("UVMS_KEEP_ALIVE_SECONDS", "5")))
    forwarded = os.getenv("FORWARDED_ALLOW_IPS", "*")
    argv = [
        "uvicorn",
        "app.main:app",
        "--host",
        "0.0.0.0",
        "--port",
        "8000",
        "--workers",
        str(workers),
        "--proxy-headers",
        "--forwarded-allow-ips",
        forwarded,
        "--timeout-graceful-shutdown",
        str(graceful),
        "--timeout-keep-alive",
        str(keep_alive),
    ]
    os.execvp(argv[0], argv)


if __name__ == "__main__":
    try:
        main()
    except ValueError as exc:
        print(f"Invalid production runtime value: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc
