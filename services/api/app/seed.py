from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .models import AiModelConfig, Plan

PLANS = [
    {
        "code": "free",
        "name": "Free",
        "monthly_price_cents": 0,
        "limits": {"messages_daily": 50, "web_search_daily": 10, "storage_mb": 100, "max_file_mb": 20, "images_monthly": 5, "voice_transcriptions_monthly": 20, "deep_daily": 0},
    },
    {
        "code": "plus",
        "name": "Plus",
        "monthly_price_cents": 999,
        "limits": {"messages_daily": 500, "web_search_daily": 100, "storage_mb": 2048, "max_file_mb": 50, "images_monthly": 100, "voice_transcriptions_monthly": 300, "deep_daily": 25},
    },
    {
        "code": "pro",
        "name": "Pro",
        "monthly_price_cents": 2499,
        "limits": {"messages_daily": 3000, "web_search_daily": 1000, "storage_mb": 10240, "max_file_mb": 100, "images_monthly": 500, "voice_transcriptions_monthly": 2000, "deep_daily": 200},
    },
]

MODELS = [
    {
        "id": "uvms-1-fast",
        "name": "UVMS-1 Fast",
        "description": "Fast everyday assistant",
        "provider_model": settings.model_fast or settings.openai_model,
        "reasoning_effort": "none",
        "min_plan": "free",
        "is_enabled": True,
        "supports_web_search": True,
        "supports_vision": True,
    },
    {
        "id": "uvms-1-balanced",
        "name": "UVMS-1 Balanced",
        "description": "Best balance of speed and quality",
        "provider_model": settings.model_balanced or settings.openai_model,
        "reasoning_effort": "medium",
        "min_plan": "free",
        "is_enabled": True,
        "supports_web_search": True,
        "supports_vision": True,
    },
    {
        "id": "uvms-1-deep",
        "name": "UVMS-1 Deep",
        "description": "Higher-effort reasoning for hard tasks",
        "provider_model": settings.model_deep or settings.openai_model,
        "reasoning_effort": "high",
        "min_plan": "plus",
        "is_enabled": True,
        "supports_web_search": True,
        "supports_vision": True,
    },
]


def seed_plans(db: Session) -> None:
    for item in PLANS:
        existing = db.scalar(select(Plan).where(Plan.code == item["code"]))
        if not existing:
            db.add(Plan(**item))
            continue
        # Preserve admin overrides while adding newly introduced entitlement keys.
        merged = dict(item["limits"])
        merged.update(existing.limits or {})
        existing.limits = merged
    db.commit()


def seed_models(db: Session) -> None:
    for item in MODELS:
        existing = db.get(AiModelConfig, item["id"])
        if not existing:
            db.add(AiModelConfig(**item))
            continue
        # Preserve admin edits. Only backfill blank provider model fields.
        if not existing.provider_model:
            existing.provider_model = item["provider_model"]
    db.commit()
