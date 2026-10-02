from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import mimetypes
import json
import uuid
import hashlib
import secrets

import jwt
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import FileResponse, PlainTextResponse
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session, selectinload

from .ai_gateway import complete_answer, complete_answer_with_meta, generate_image_bytes, stream_events, transcribe_audio_bytes
from .config import effective_ai_provider, settings
from .ai_gateway import is_demo, provider_error, upstream_model, reasoning_effort, ProviderError
from .ai_features import features, enforce_feature
from .provider_usage import new_trace, record_trace, accounting_summary
from .provider_health import provider_health
from .streaming import ManagedStreamingResponse
from .models import AiFeature
from pydantic import BaseModel
from .cancellation import cancel_request, finish_request, is_cancelled, register_request
from .database import SessionLocal, get_db
from .file_processing import ALLOWED_EXTENSIONS, category_for, extract_text, safe_filename, sha256_bytes, validate_upload
from .deps import admin_user, current_user
from .models import AiModelConfig, AuditEvent, Chat, CheckoutSession, FileAsset, MemoryItem, Message, Plan, Project, ProjectChat, ProjectFile, RefreshSession, SharedChat, Subscription, User, UsageEvent
from .schemas import (
    AiModelPatch,
    ChatCreate,
    ChatDetail,
    ChatForkIn,
    ChatOut,
    ChatPatch,
    ChatPromptIn,
    CompleteOut,
    CheckoutCreate,
    CheckoutOut,
    FileAssetOut,
    ImageGenerateIn,
    ImageGenerateOut,
    LoginIn,
    MessageOut,
    MessageEditIn,
    ModelInfo,
    MemoryCreate,
    MemoryOut,
    MemoryPatch,
    ProjectCreate,
    ProjectOut,
    ProjectPatch,
    PlanPatch,
    RegenerateIn,
    SubscriptionPatch,
    SharedChatOut,
    SharedChatPublic,
    SharedChatRecord,
    RefreshIn,
    RegisterIn,
    TokenPair,
    TranscriptionOut,
    UserAdminPatch,
    UserOut,
)
from .security import create_access_token, create_refresh_token, decode_token, hash_password, verify_password
from .storage_backend import delete_key as storage_delete_key, get_bytes as storage_get_bytes, local_path as storage_local_path, put_bytes as storage_put_bytes
from .services import (
    PLAN_RANK,
    append_assistant_message,
    audit_event,
    append_user_message,
    enforce_daily_limit,
    enforce_monthly_limit,
    ensure_chat,
    ensure_free_subscription,
    get_project,
    history_for_chat,
    model_runtime,
    plan_for_user,
    usage_snapshot,
)

router = APIRouter(prefix="/api/v1")


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _chat_expired(chat: Chat) -> bool:
    expires_at = _as_utc(chat.expires_at)
    return bool(chat.is_temporary and expires_at and expires_at <= datetime.now(timezone.utc))


def _cleanup_expired_temporary_chats(db: Session, user_id: str) -> None:
    rows = db.scalars(select(Chat).where(Chat.user_id == user_id, Chat.is_temporary.is_(True))).all()
    changed = False
    for row in rows:
        if _chat_expired(row):
            db.delete(row)
            changed = True
    if changed:
        db.commit()


def _owned_chat(db: Session, user_id: str, chat_id: str) -> Chat:
    chat = db.scalar(select(Chat).where(Chat.id == chat_id, Chat.user_id == user_id))
    if not chat or _chat_expired(chat):
        if chat and _chat_expired(chat):
            db.delete(chat)
            db.commit()
        raise HTTPException(status_code=404, detail="Chat not found")
    return chat


def _share_snapshot(chat: Chat, messages: list[Message]) -> dict:
    return {
        "version": 1,
        "model_id": chat.model_id,
        "messages": [
            {
                "role": message.role,
                "content": message.content,
                "model_id": message.model_id,
                "created_at": message.created_at.isoformat(),
                "attachments": [
                    {
                        "original_name": file.original_name,
                        "mime_type": file.mime_type,
                        "category": file.category,
                        "size_bytes": file.size_bytes,
                    }
                    for file in message.attachments
                ],
            }
            for message in messages
        ],
    }



def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _enforce_model(db: Session, user_id: str, model_id: str) -> dict:
    return model_runtime(db, user_id, model_id)


def _lock_quota(db, user_id):
    if db.bind.dialect.name == 'sqlite':
        db.execute(update(User).where(User.id == user_id).values(updated_at=User.updated_at))
    else:
        db.execute(select(User.id).where(User.id == user_id).with_for_update())


def _generation_limits(db, user_id, model_id, web_search=False, extra_request=False):
    # Serialize quota decisions for one user in PostgreSQL; SQLite writes serialize reservations.
    _lock_quota(db,user_id)
    enforce_daily_limit(db, user_id, 'message.user', 'messages_daily')
    if model_id == 'uvms-1-deep':
        enforce_daily_limit(db, user_id, 'tool.deep', 'deep_daily')
        db.add(UsageEvent(user_id=user_id,kind='tool.deep',units=1))
    if web_search:
        enforce_feature(db,'search')
        enforce_daily_limit(db,user_id,'tool.web_search','web_search_daily')
        db.add(UsageEvent(user_id=user_id,kind='tool.web_search',units=1))
    if extra_request: db.add(UsageEvent(user_id=user_id,kind='message.user',units=1,meta={'retry_or_replacement':True}))


def _provider_call(db, user_id, chat_id, model_id, operation, callback, runtime=None):
    trace = new_trace(model_id,operation,runtime)
    trace['user_id'] = user_id
    try:
        result = callback(trace)
    except Exception as exc:
        db.rollback()
        error = provider_error(exc)
        record_trace(db,trace,user_id,chat_id,'failed',error.code); db.commit()
        if isinstance(exc, HTTPException): raise
        if error.code == 'capability': raise HTTPException(422, str(error)) from None
        raise HTTPException(429 if error.code in {'rate_limit','daily_limit'} else 503 if error.code == 'busy' else 504 if error.code == 'timeout' else 502,
                            str(error), headers={'Retry-After': str(error.retry_after)} if error.retry_after else None) from None
    record_trace(db,trace,user_id,chat_id,'completed')
    db.info.setdefault('pending_provider_traces',[]).append((trace,user_id,chat_id))
    return result


def _text_call(db,user_id,chat_id,model_id,history,runtime,*,web_search=False,with_meta=False):
    def call(trace):
        runtime['_trace'] = trace
        result = complete_answer_with_meta(history,model_id,web_search=web_search,runtime=runtime) if with_meta else complete_answer(history,model_id,runtime=runtime)
        answer = result[0] if with_meta else result
        if not answer.strip(): raise RuntimeError('empty_answer')
        return result
    return _provider_call(db,user_id,chat_id,model_id,'text',call,runtime)


def issue_pair(db: Session, user: User, request: Request, response: Response | None = None, previous: RefreshSession | None = None) -> TokenPair:
    refresh, jti, expires = create_refresh_token(user.id)
    session_id = previous.id if previous else str(uuid.uuid4())
    access = create_access_token(user.id, sid=session_id)
    if previous:
        claimed = db.execute(update(RefreshSession).where(RefreshSession.id == previous.id, RefreshSession.jti == previous.jti, RefreshSession.revoked_at.is_(None)).values(jti=jti, expires_at=expires))
        if claimed.rowcount != 1:
            db.rollback()
            raise HTTPException(status_code=401, detail='Refresh session revoked')
    else:
        db.add(
        RefreshSession(
            id=session_id,
            user_id=user.id,
            jti=jti,
            expires_at=expires,
            user_agent=request.headers.get("user-agent", "")[:400],
            ip_address=request.client.host if request.client else None,
        )
    )
    db.commit()
    ensure_free_subscription(db, user.id)
    if response is not None:
        response.set_cookie(
            key=settings.refresh_cookie_name,
            value=refresh,
            max_age=settings.refresh_token_days * 24 * 60 * 60,
            httponly=True,
            secure=settings.refresh_cookie_secure or settings.env.lower() == "production",
            samesite="lax",
            domain=settings.refresh_cookie_domain or None,
            path="/api/v1/auth",
        )
    browser_client = request.headers.get('x-uvms-client') == 'web' or bool(request.headers.get('origin'))
    return TokenPair(access_token=access, refresh_token=None if browser_client else refresh, user=UserOut.model_validate(user))


@router.post("/auth/register", response_model=TokenPair, status_code=201)
def register(payload: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)):
    email = payload.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(
        email=email,
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password),
        role="admin" if settings.env.lower() != "production" and email == settings.bootstrap_admin_email else "user",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return issue_pair(db, user, request, response)


@router.post("/auth/login", response_model=TokenPair)
def login(payload: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")
    return issue_pair(db, user, request, response)


@router.post("/auth/refresh", response_model=TokenPair)
def refresh(payload: RefreshIn, request: Request, response: Response, db: Session = Depends(get_db)):
    raw_refresh = payload.refresh_token or request.cookies.get(settings.refresh_cookie_name)
    if not raw_refresh:
        raise HTTPException(status_code=401, detail="Refresh token required")
    if payload.refresh_token is None:
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") not in {x.rstrip("/") for x in settings.cors_origins}:
            raise HTTPException(status_code=403, detail="Untrusted origin")
    try:
        decoded = decode_token(raw_refresh, "refresh")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    session = db.scalar(select(RefreshSession).where(RefreshSession.jti == decoded["jti"]))
    if not session or session.revoked_at is not None:
        raise HTTPException(status_code=401, detail="Refresh session revoked")
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Refresh session expired")
    user = db.get(User, decoded["sub"])
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User unavailable")
    # Rotate the credential atomically within the same device session. Access
    # tokens in other tabs remain valid until expiry or explicit revocation.
    return issue_pair(db, user, request, response, previous=session)


@router.post("/auth/logout", status_code=204)
def logout(payload: RefreshIn, request: Request, response: Response, db: Session = Depends(get_db)):
    origin = request.headers.get('origin')
    if origin and origin.rstrip('/') not in {x.rstrip('/') for x in settings.cors_origins}:
        raise HTTPException(status_code=403, detail='Untrusted origin')
    raw_refresh = payload.refresh_token or request.cookies.get(settings.refresh_cookie_name)
    if raw_refresh:
        try:
            decoded = decode_token(raw_refresh, "refresh")
            session = db.scalar(select(RefreshSession).where(RefreshSession.jti == decoded["jti"]))
            if session and session.revoked_at is None:
                session.revoked_at = datetime.now(timezone.utc)
                db.commit()
        except jwt.PyJWTError:
            pass
    response.delete_cookie(
        settings.refresh_cookie_name,
        domain=settings.refresh_cookie_domain or None,
        path="/api/v1/auth",
    )
    return None


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user


@router.get("/models", response_model=list[ModelInfo])
def models(user: User = Depends(current_user), db: Session = Depends(get_db)):
    sub, _plan = plan_for_user(db, user.id)
    rank = PLAN_RANK.get(sub.plan_code, 0)
    rows = db.scalars(select(AiModelConfig).order_by(AiModelConfig.created_at.asc())).all()
    return [
        ModelInfo(
            id=row.id,
            name=row.name,
            description=row.description,
            tier=row.min_plan,
            available=bool(row.is_enabled and rank >= PLAN_RANK.get(row.min_plan, 0)),
        )
        for row in rows
    ]


@router.get('/capabilities')
def capabilities(user: User = Depends(current_user), db: Session = Depends(get_db)):
    provider = effective_ai_provider(settings)
    return {'ai_mode': 'development' if provider == 'openrouter' else 'demo' if is_demo() else 'live',
            'provider': provider, 'text_live': not is_demo(),
            'images_mode': 'unavailable' if provider in {'gemini', 'groq'} else 'demo' if is_demo('image') else 'live',
            'voice_mode': 'unavailable' if provider == 'gemini' else 'demo' if is_demo('voice') else 'live',
            'billing_enabled': settings.billing_provider not in {'disabled', 'demo'} or (settings.billing_provider == 'demo' and settings.env.lower() != 'production'),
            'billing_provider': settings.billing_provider,
            'max_upload_mb': settings.max_upload_mb, **features(db)}


@router.get("/plans")
def plans(db: Session = Depends(get_db)):
    rows = db.scalars(select(Plan).where(Plan.is_active.is_(True)).order_by(Plan.monthly_price_cents)).all()
    return [
        {
            "code": x.code,
            "name": x.name,
            "monthly_price_cents": x.monthly_price_cents,
            "currency": x.currency,
            "limits": x.limits,
        }
        for x in rows
    ]


def _checkout_payload(row: CheckoutSession) -> CheckoutOut:
    return CheckoutOut(
        id=row.id,
        plan_code=row.plan_code,
        provider=row.provider,
        status=row.status,
        amount_cents=row.amount_cents,
        currency=row.currency,
        checkout_url=row.checkout_url,
        created_at=row.created_at,
    )


@router.get("/billing/subscription")
def billing_subscription(user: User = Depends(current_user), db: Session = Depends(get_db)):
    sub, plan = plan_for_user(db, user.id)
    return {
        "plan_code": sub.plan_code,
        "plan_name": plan.name,
        "status": sub.status,
        "provider": sub.provider,
        "current_period_end": sub.current_period_end,
        "monthly_price_cents": plan.monthly_price_cents,
        "currency": plan.currency,
    }


@router.post("/billing/checkout", response_model=CheckoutOut, status_code=201)
def create_checkout(
    payload: CheckoutCreate,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    plan = db.scalar(select(Plan).where(Plan.code == payload.plan_code, Plan.is_active.is_(True)))
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    if plan.code == "free":
        raise HTTPException(status_code=422, detail="Free plan does not require checkout")

    provider = settings.billing_provider or "disabled"
    if provider == "disabled":
        raise HTTPException(status_code=503, detail="Paid subscriptions are not enabled on this deployment.")
    if settings.env.lower() == "production" and provider == "demo":
        raise HTTPException(status_code=503, detail="Billing is not configured for production yet")
    checkout = CheckoutSession(
        user_id=user.id,
        plan_code=plan.code,
        provider=provider,
        status="pending",
        amount_cents=plan.monthly_price_cents,
        currency=plan.currency,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    db.add(checkout)
    db.flush()

    if provider == "demo":
        checkout.checkout_url = f"{settings.public_web_url}/billing/demo?session={checkout.id}"
    else:
        checkout.checkout_url = None

    audit_event(
        db, actor_user_id=user.id, action="billing.checkout.created",
        target_type="checkout", target_id=checkout.id,
        meta={"plan_code": plan.code, "provider": provider, "amount_cents": plan.monthly_price_cents},
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    db.refresh(checkout)
    return _checkout_payload(checkout)


@router.get("/billing/checkout/{checkout_id}", response_model=CheckoutOut)
def get_checkout(checkout_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.scalar(select(CheckoutSession).where(CheckoutSession.id == checkout_id, CheckoutSession.user_id == user.id))
    if not row:
        raise HTTPException(status_code=404, detail="Checkout not found")
    return _checkout_payload(row)


@router.post("/billing/demo/complete/{checkout_id}", response_model=CheckoutOut)
def complete_demo_checkout(
    checkout_id: str,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if settings.billing_provider != "demo" or settings.env.lower() == "production":
        raise HTTPException(status_code=404, detail="Demo checkout unavailable")
    row = db.scalar(select(CheckoutSession).where(CheckoutSession.id == checkout_id, CheckoutSession.user_id == user.id))
    if not row:
        raise HTTPException(status_code=404, detail="Checkout not found")
    if row.status == "completed":
        return _checkout_payload(row)
    if row.expires_at:
        expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            row.status = "expired"
            db.commit()
            raise HTTPException(status_code=409, detail="Checkout expired")
    plan = db.scalar(select(Plan).where(Plan.code == row.plan_code, Plan.is_active.is_(True)))
    if not plan:
        raise HTTPException(status_code=409, detail="Plan unavailable")
    sub = ensure_free_subscription(db, user.id)
    sub.plan_code = plan.code
    sub.status = "active"
    sub.provider = "demo"
    sub.provider_ref = row.id
    sub.current_period_end = datetime.now(timezone.utc) + timedelta(days=30)
    row.status = "completed"
    row.completed_at = datetime.now(timezone.utc)
    audit_event(
        db, actor_user_id=user.id, action="billing.checkout.completed",
        target_type="checkout", target_id=row.id,
        meta={"plan_code": plan.code, "provider": "demo"},
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    db.refresh(row)
    return _checkout_payload(row)


@router.get("/usage/me")
def my_usage(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return usage_snapshot(db, user.id)


@router.post("/audio/transcribe", response_model=TranscriptionOut)
async def transcribe_audio(
    audio: UploadFile = File(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    enforce_feature(db, "voice")
    _lock_quota(db,user.id)
    enforce_monthly_limit(db, user.id, "tool.transcription", "voice_transcriptions_monthly")
    filename = safe_filename(audio.filename or "voice.m4a")
    allowed = {".m4a", ".mp3", ".wav", ".webm", ".mp4", ".mpeg", ".mpga"}
    extension = Path(filename).suffix.lower()
    if extension not in allowed:
        raise HTTPException(status_code=415, detail="Unsupported audio format")
    max_bytes = settings.max_audio_mb * 1024 * 1024
    data = await audio.read(max_bytes + 1)
    if not data:
        raise HTTPException(status_code=422, detail="Empty audio file")
    if len(data) > max_bytes:
        raise HTTPException(status_code=413, detail=f"Audio exceeds {settings.max_audio_mb} MB limit")
    mime_type = audio.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    from starlette.concurrency import run_in_threadpool
    text, demo = await run_in_threadpool(_provider_call, db, user.id, None, 'uvms-voice-1', 'voice', lambda trace: transcribe_audio_bytes(filename,data,mime_type,trace=trace))
    db.add(UsageEvent(user_id=user.id, kind="tool.transcription", units=1, meta={"bytes": len(data), "demo": demo}))
    db.commit()
    return TranscriptionOut(text=text, demo=demo)


@router.post("/images/generate", response_model=ImageGenerateOut, status_code=201)
def generate_image(
    payload: ImageGenerateIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    enforce_feature(db, "images")
    _lock_quota(db,user.id)
    enforce_daily_limit(db, user.id, "message.user", "messages_daily")
    enforce_monthly_limit(db, user.id, "tool.image_generation", "images_monthly")
    chat = ensure_chat(
        db,
        user,
        payload.chat_id,
        "uvms-1-balanced",
        project_id=payload.project_id,
        temporary=payload.temporary,
    )
    append_user_message(db, chat, payload.prompt, commit=False)

    data, mime_type, extension, demo = _provider_call(db,user.id,chat.id,'uvms-image-1','image',lambda trace: generate_image_bytes(payload.prompt,size=payload.size,quality=payload.quality,trace=trace))

    _sub, plan = plan_for_user(db, user.id)
    storage_limit = int(plan.limits.get("storage_mb", -1)) * 1024 * 1024
    if storage_limit >= 0:
        storage_used = int(db.scalar(select(func.coalesce(func.sum(FileAsset.size_bytes), 0)).where(FileAsset.user_id == user.id)) or 0)
        if storage_used + len(data) > storage_limit:
            raise HTTPException(status_code=413, detail=f"Storage limit reached for {plan.name}")

    file_id = str(uuid.uuid4())
    stored_name = f"{user.id}/{file_id}{extension}"
    storage_put_bytes(stored_name, data, mime_type)
    asset = FileAsset(
        id=file_id,
        user_id=user.id,
        original_name=f"uvms-ai-generated-{file_id[:8]}{extension}",
        stored_name=stored_name,
        mime_type=mime_type,
        category="image",
        size_bytes=len(data),
        sha256=sha256_bytes(data),
        extracted_text=None,
    )
    db.add(asset)
    if payload.project_id:
        db.add(ProjectFile(project_id=payload.project_id, file_id=file_id))
    # Commit the quota unit with the image/message while the user's quota lock is held.
    db.add(UsageEvent(
        user_id=user.id, kind="tool.image_generation", units=1,
        meta={"chat_id": chat.id, "file_id": file_id, "size": payload.size, "demo": demo},
    ))
    db.flush()
    message = append_assistant_message(
        db,
        chat.id,
        user.id,
        "Here is a UVMS demo image. It is a sample visual, not a live generation of your prompt." if demo else "Here is the image I created.",
        "uvms-image-1",
        meta={
            "image_generation": True,
            "image_prompt": payload.prompt,
            "image_size": payload.size,
            "image_quality": payload.quality,
            "demo": demo,
        },
        attachments=[asset],
    )
    return ImageGenerateOut(
        chat_id=chat.id,
        message=MessageOut.model_validate(message),
        asset=FileAssetOut.model_validate(asset),
        demo=demo,
    )


@router.post("/files", response_model=FileAssetOut, status_code=201)
async def upload_file(
    upload: UploadFile = File(...),
    project_id: str | None = Form(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    original_name = safe_filename(upload.filename or "file")
    _lock_quota(db,user.id)
    ext = Path(original_name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {ext or 'unknown'}")

    _sub, plan = plan_for_user(db, user.id)
    plan_file_mb = int(plan.limits.get("max_file_mb", settings.max_upload_mb))
    if plan_file_mb < 0: plan_file_mb = settings.max_upload_mb
    max_file_mb = min(settings.max_upload_mb, plan_file_mb) if settings.max_upload_mb > 0 else plan_file_mb
    max_bytes = max_file_mb * 1024 * 1024
    data = await upload.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds {max_file_mb} MB limit for {plan.name}")
    storage_limit = int(plan.limits.get("storage_mb", -1)) * 1024 * 1024
    if storage_limit >= 0:
        storage_used = int(db.scalar(select(func.coalesce(func.sum(FileAsset.size_bytes), 0)).where(FileAsset.user_id == user.id)) or 0)
        if storage_used + len(data) > storage_limit:
            raise HTTPException(status_code=413, detail=f"Storage limit reached for {plan.name}")
    if not data:
        raise HTTPException(status_code=422, detail="Empty file")

    mime_type = upload.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"
    try:
        validate_upload(original_name, data, mime_type)
    except ValueError as exc:
        raise HTTPException(status_code=415, detail=str(exc))
    category = category_for(original_name, mime_type)
    file_id = str(uuid.uuid4())
    stored_name = f"{user.id}/{file_id}{ext}"
    storage_put_bytes(stored_name, data, mime_type)

    if project_id:
        get_project(db, user.id, project_id)

    asset = FileAsset(
        id=file_id,
        user_id=user.id,
        original_name=original_name,
        stored_name=stored_name,
        mime_type=mime_type,
        category=category,
        size_bytes=len(data),
        sha256=sha256_bytes(data),
        extracted_text=extract_text(original_name, data),
    )
    db.add(asset)
    if project_id:
        db.add(ProjectFile(project_id=project_id, file_id=file_id))
    db.add(UsageEvent(user_id=user.id, kind="file.upload", units=1, meta={"file_id": file_id, "bytes": len(data), "category": category, "project_id": project_id}))
    db.commit()
    db.refresh(asset)
    return asset


@router.get("/files", response_model=list[FileAssetOut])
def list_files(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(
        select(FileAsset).where(FileAsset.user_id == user.id).order_by(FileAsset.created_at.desc()).limit(100)
    ).all()


@router.get("/files/{file_id}", response_model=FileAssetOut)
def get_file(file_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    asset = db.scalar(select(FileAsset).where(FileAsset.id == file_id, FileAsset.user_id == user.id))
    if not asset:
        raise HTTPException(status_code=404, detail="File not found")
    return asset


@router.get("/files/{file_id}/download")
def download_file(file_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    asset = db.scalar(select(FileAsset).where(FileAsset.id == file_id, FileAsset.user_id == user.id))
    if not asset:
        raise HTTPException(status_code=404, detail="File not found")
    path = storage_local_path(asset.stored_name)
    if path is not None:
        if not path.is_file():
            raise HTTPException(status_code=410, detail="Stored file is unavailable")
        return FileResponse(path, media_type=asset.mime_type, filename=asset.original_name)
    try:
        data = storage_get_bytes(asset.stored_name)
    except Exception:
        raise HTTPException(status_code=410, detail="Stored file is unavailable")
    safe_name = asset.original_name.replace('"', "")[:180]
    return Response(
        content=data,
        media_type=asset.mime_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@router.delete("/files/{file_id}", status_code=204)
def delete_file(file_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    asset = db.scalar(select(FileAsset).where(FileAsset.id == file_id, FileAsset.user_id == user.id))
    if not asset:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        storage_delete_key(asset.stored_name)
    except Exception:
        pass
    db.execute(delete(ProjectFile).where(ProjectFile.file_id == asset.id))
    db.delete(asset)
    db.commit()
    return None


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(
        select(Project).where(Project.user_id == user.id).order_by(Project.updated_at.desc()).limit(100)
    ).all()


@router.post("/projects", response_model=ProjectOut, status_code=201)
def create_project(payload: ProjectCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = Project(
        user_id=user.id,
        name=payload.name.strip(),
        description=payload.description.strip(),
        instructions=payload.instructions.strip(),
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/projects/{project_id}", response_model=ProjectOut)
def project_detail(project_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return get_project(db, user.id, project_id)


@router.patch("/projects/{project_id}", response_model=ProjectOut)
def patch_project(
    project_id: str,
    payload: ProjectPatch,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    project = get_project(db, user.id, project_id)
    if payload.name is not None:
        project.name = payload.name.strip()
    if payload.description is not None:
        project.description = payload.description.strip()
    if payload.instructions is not None:
        project.instructions = payload.instructions.strip()
    project.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(project)
    return project


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = get_project(db, user.id, project_id)
    db.execute(delete(ProjectChat).where(ProjectChat.project_id == project.id))
    db.execute(delete(ProjectFile).where(ProjectFile.project_id == project.id))
    db.delete(project)
    db.commit()
    return None


@router.get("/projects/{project_id}/chats", response_model=list[ChatOut])
def project_chats(project_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = get_project(db, user.id, project_id)
    return db.scalars(
        select(Chat)
        .join(ProjectChat, ProjectChat.chat_id == Chat.id)
        .where(ProjectChat.project_id == project.id, Chat.user_id == user.id)
        .order_by(Chat.updated_at.desc())
    ).all()


@router.post("/projects/{project_id}/chats/{chat_id}", status_code=201)
def attach_chat_to_project(project_id: str, chat_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_project(db, user.id, project_id)
    chat = db.scalar(select(Chat).where(Chat.id == chat_id, Chat.user_id == user.id))
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    existing = db.scalar(select(ProjectChat).where(ProjectChat.chat_id == chat_id))
    if existing and existing.project_id != project_id:
        raise HTTPException(status_code=409, detail="Chat already belongs to another project")
    if not existing:
        db.add(ProjectChat(project_id=project_id, chat_id=chat_id))
        db.commit()
    return {"status": "attached", "project_id": project_id, "chat_id": chat_id}


@router.get("/projects/{project_id}/files", response_model=list[FileAssetOut])
def project_files(project_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = get_project(db, user.id, project_id)
    return db.scalars(
        select(FileAsset)
        .join(ProjectFile, ProjectFile.file_id == FileAsset.id)
        .where(ProjectFile.project_id == project.id, FileAsset.user_id == user.id)
        .order_by(FileAsset.created_at.desc())
    ).all()


@router.post("/projects/{project_id}/files/{file_id}", status_code=201)
def attach_file_to_project(project_id: str, file_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_project(db, user.id, project_id)
    asset = db.scalar(select(FileAsset).where(FileAsset.id == file_id, FileAsset.user_id == user.id))
    if not asset:
        raise HTTPException(status_code=404, detail="File not found")
    exists = db.scalar(select(ProjectFile).where(ProjectFile.project_id == project_id, ProjectFile.file_id == file_id))
    if not exists:
        db.add(ProjectFile(project_id=project_id, file_id=file_id))
        db.commit()
    return {"status": "attached", "project_id": project_id, "file_id": file_id}


@router.get("/memory", response_model=list[MemoryOut])
def list_memory(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(
        select(MemoryItem).where(MemoryItem.user_id == user.id).order_by(MemoryItem.updated_at.desc()).limit(100)
    ).all()


@router.post("/memory", response_model=MemoryOut, status_code=201)
def create_memory(payload: MemoryCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    item = MemoryItem(user_id=user.id, content=payload.content.strip(), source="manual")
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/memory/{memory_id}", response_model=MemoryOut)
def patch_memory(
    memory_id: str,
    payload: MemoryPatch,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    item = db.scalar(select(MemoryItem).where(MemoryItem.id == memory_id, MemoryItem.user_id == user.id))
    if not item:
        raise HTTPException(status_code=404, detail="Memory not found")
    if payload.content is not None:
        item.content = payload.content.strip()
    if payload.is_enabled is not None:
        item.is_enabled = payload.is_enabled
    item.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/memory/{memory_id}", status_code=204)
def delete_memory(memory_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    item = db.scalar(select(MemoryItem).where(MemoryItem.id == memory_id, MemoryItem.user_id == user.id))
    if not item:
        raise HTTPException(status_code=404, detail="Memory not found")
    db.delete(item)
    db.commit()
    return None


@router.get("/chats", response_model=list[ChatOut])
def list_chats(
    response: Response,
    archived: bool = False,
    q: str = Query(default='', max_length=200),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    _cleanup_expired_temporary_chats(db, user.id)
    query = select(Chat).where(
        Chat.user_id == user.id,
        Chat.is_archived.is_(archived),
        Chat.is_temporary.is_(False),
    )
    if q.strip():
        pattern = '%' + q.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        query = query.where(Chat.title.ilike(pattern, escape='\\') | Chat.id.in_(select(Message.chat_id).where(Message.content.ilike(pattern, escape='\\'))))
    response.headers['X-Total-Count'] = str(db.scalar(select(func.count()).select_from(query.subquery())) or 0)
    return db.scalars(query.order_by(Chat.is_pinned.desc(), Chat.updated_at.desc()).offset(offset).limit(100)).all()


@router.post("/chats", response_model=ChatOut, status_code=201)
def create_chat(payload: ChatCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _enforce_model(db, user.id, payload.model_id)
    _cleanup_expired_temporary_chats(db, user.id)
    chat = ensure_chat(
        db,
        user,
        None,
        payload.model_id,
        project_id=payload.project_id,
        temporary=payload.is_temporary,
    )
    chat.title = payload.title.strip() or ("Temporary chat" if payload.is_temporary else "New chat")
    db.commit()
    db.refresh(chat)
    return chat


@router.get("/chats/{chat_id}", response_model=ChatDetail)
def get_chat(chat_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    chat = db.scalar(select(Chat).options(selectinload(Chat.messages).selectinload(Message.attachments)).where(Chat.id == chat_id, Chat.user_id == user.id))
    if not chat or _chat_expired(chat):
        if chat and _chat_expired(chat):
            db.delete(chat); db.commit()
        raise HTTPException(status_code=404, detail="Chat not found")
    result = ChatDetail.model_validate(chat)
    project = db.scalar(select(Project).join(ProjectChat, ProjectChat.project_id == Project.id).where(ProjectChat.chat_id == chat_id, Project.user_id == user.id))
    if project:
        result.project = {'id': project.id, 'name': project.name}
    return result


@router.patch("/chats/{chat_id}", response_model=ChatOut)
def patch_chat(payload: ChatPatch, chat_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    chat = _owned_chat(db, user.id, chat_id)
    if payload.title is not None:
        chat.title = payload.title.strip()
    if payload.model_id is not None:
        _enforce_model(db, user.id, payload.model_id)
        chat.model_id = payload.model_id
    if payload.is_archived is not None:
        chat.is_archived = payload.is_archived
        if payload.is_archived:
            chat.is_pinned = False
    if payload.is_pinned is not None:
        if chat.is_temporary:
            raise HTTPException(status_code=422, detail="Temporary chats cannot be pinned")
        chat.is_pinned = payload.is_pinned
    db.commit()
    db.refresh(chat)
    return chat


@router.delete("/chats/{chat_id}", status_code=204)
def delete_chat(chat_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    chat = _owned_chat(db, user.id, chat_id)
    db.execute(delete(ProjectChat).where(ProjectChat.chat_id == chat.id))
    db.delete(chat)
    db.commit()
    return None


@router.post("/chats/{chat_id}/fork", response_model=ChatDetail, status_code=201)
def fork_chat(
    chat_id: str,
    payload: ChatForkIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    source = db.scalar(
        select(Chat)
        .options(selectinload(Chat.messages).selectinload(Message.attachments))
        .where(Chat.id == chat_id, Chat.user_id == user.id)
    )
    if not source or _chat_expired(source):
        raise HTTPException(status_code=404, detail="Chat not found")

    copied: list[Message] = []
    found_boundary = payload.through_message_id is None
    if payload.through_message_id is not None:
        found_boundary = False
    for message in source.messages:
        copied.append(message)
        if payload.through_message_id and message.id == payload.through_message_id:
            found_boundary = True
            break
    if not found_boundary:
        raise HTTPException(status_code=404, detail="Branch point not found")

    title = (payload.title or f"{source.title} — branch").strip()[:180]
    forked = Chat(
        user_id=user.id,
        title=title or "Branched chat",
        model_id=source.model_id,
        is_temporary=source.is_temporary,
        expires_at=(datetime.now(timezone.utc) + timedelta(hours=24)) if source.is_temporary else None,
    )
    db.add(forked)
    db.flush()

    if not source.is_temporary:
        project_link = db.scalar(select(ProjectChat).where(ProjectChat.chat_id == source.id))
        if project_link:
            db.add(ProjectChat(chat_id=forked.id, project_id=project_link.project_id))

    for message in copied:
        clone = Message(
            chat_id=forked.id,
            role=message.role,
            content=message.content,
            model_id=message.model_id,
            meta=dict(message.meta or {}),
            attachments=list(message.attachments),
        )
        db.add(clone)
    audit_event(
        db,
        actor_user_id=user.id,
        action="chat.forked",
        target_type="chat",
        target_id=forked.id,
        meta={"source_chat_id": source.id, "messages": len(copied)},
    )
    db.commit()
    db.refresh(forked)
    detail = get_chat(forked.id, user, db)
    return detail


@router.get("/chats/{chat_id}/export")
def export_chat(
    chat_id: str,
    format: str = Query(default="markdown", pattern=r"^(markdown|json)$"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    chat = db.scalar(
        select(Chat)
        .options(selectinload(Chat.messages).selectinload(Message.attachments))
        .where(Chat.id == chat_id, Chat.user_id == user.id)
    )
    if not chat or _chat_expired(chat):
        raise HTTPException(status_code=404, detail="Chat not found")
    if format == "json":
        return {
            "title": chat.title,
            "model_id": chat.model_id,
            "created_at": chat.created_at,
            "messages": [MessageOut.model_validate(message).model_dump(mode="json") for message in chat.messages],
        }
    lines = [f"# {chat.title}", "", f"Model: {chat.model_id}", ""]
    for message in chat.messages:
        lines.extend([f"## {'You' if message.role == 'user' else 'UVMS AI'}", "", message.content or "", ""])
        if message.attachments:
            lines.append("Attachments: " + ", ".join(file.original_name for file in message.attachments))
            lines.append("")
    filename = "chat-" + chat.id[:8] + ".md"
    return PlainTextResponse(
        "\n".join(lines),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/chats/{chat_id}/share", response_model=SharedChatOut, status_code=201)
def share_chat(chat_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    chat = db.scalar(
        select(Chat)
        .options(selectinload(Chat.messages).selectinload(Message.attachments))
        .where(Chat.id == chat_id, Chat.user_id == user.id)
    )
    if not chat or _chat_expired(chat):
        raise HTTPException(status_code=404, detail="Chat not found")
    if chat.is_temporary:
        raise HTTPException(status_code=422, detail="Temporary chats cannot be shared")
    if not chat.messages:
        raise HTTPException(status_code=422, detail="Empty chats cannot be shared")
    active_shares = db.scalar(
        select(func.count(SharedChat.id)).where(
            SharedChat.owner_user_id == user.id,
            SharedChat.revoked_at.is_(None),
        )
    ) or 0
    if int(active_shares) >= 50:
        raise HTTPException(status_code=429, detail="Too many active share links. Revoke an old link before creating another.")

    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    row = SharedChat(
        owner_user_id=user.id,
        source_chat_id=chat.id,
        token_hash=token_hash,
        title=chat.title,
        snapshot=_share_snapshot(chat, list(chat.messages)),
    )
    db.add(row)
    audit_event(db, actor_user_id=user.id, action="chat.shared", target_type="chat", target_id=chat.id)
    db.commit()
    db.refresh(row)
    return SharedChatOut(id=row.id, url_token=token, title=row.title, created_at=row.created_at, expires_at=row.expires_at)


@router.get("/chats/{chat_id}/shares", response_model=list[SharedChatRecord])
def list_chat_shares(chat_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _owned_chat(db, user.id, chat_id)
    return db.scalars(
        select(SharedChat)
        .where(SharedChat.source_chat_id == chat_id, SharedChat.owner_user_id == user.id)
        .order_by(SharedChat.created_at.desc())
    ).all()


@router.get("/shares", response_model=list[SharedChatRecord])
def list_shares(
    include_revoked: bool = False,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    statement = select(SharedChat).where(SharedChat.owner_user_id == user.id)
    if not include_revoked:
        statement = statement.where(SharedChat.revoked_at.is_(None))
    return db.scalars(statement.order_by(SharedChat.created_at.desc()).limit(200)).all()


@router.delete("/shares", status_code=204)
def revoke_all_shares(user: User = Depends(current_user), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    rows = db.scalars(
        select(SharedChat).where(
            SharedChat.owner_user_id == user.id,
            SharedChat.revoked_at.is_(None),
        )
    ).all()
    for row in rows:
        row.revoked_at = now
    if rows:
        audit_event(db, actor_user_id=user.id, action="chat.shares.revoked_all", target_type="share", target_id=None)
        db.commit()
    return None


@router.delete("/shares/{share_id}", status_code=204)
def revoke_share(share_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.scalar(select(SharedChat).where(SharedChat.id == share_id, SharedChat.owner_user_id == user.id))
    if not row:
        raise HTTPException(status_code=404, detail="Share not found")
    row.revoked_at = datetime.now(timezone.utc)
    audit_event(db, actor_user_id=user.id, action="chat.share.revoked", target_type="share", target_id=row.id)
    db.commit()
    return None


@router.get("/public/shares/{token}", response_model=SharedChatPublic)
def public_share(token: str, db: Session = Depends(get_db)):
    if len(token) < 20 or len(token) > 200:
        raise HTTPException(status_code=404, detail="Shared conversation not found")
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    row = db.scalar(select(SharedChat).where(SharedChat.token_hash == token_hash))
    if not row or row.revoked_at is not None:
        raise HTTPException(status_code=404, detail="Shared conversation not found")
    expires_at = _as_utc(row.expires_at)
    if expires_at and expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=404, detail="Shared conversation not found")
    snapshot = row.snapshot or {}
    return SharedChatPublic(
        title=row.title,
        created_at=row.created_at,
        messages=list(snapshot.get("messages") or []),
    )


@router.post("/chats/{chat_id}/messages/{message_id}/edit", response_model=CompleteOut)
def edit_message(
    chat_id: str,
    message_id: str,
    payload: MessageEditIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    chat = db.scalar(select(Chat).where(Chat.id == chat_id, Chat.user_id == user.id))
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    message = db.scalar(select(Message).where(Message.id == message_id, Message.chat_id == chat_id))
    if not message or message.role != "user":
        raise HTTPException(status_code=404, detail="Editable user message not found")

    # Stage 1 edit semantics are intentionally deterministic: editing an older user
    # message truncates the later path and regenerates a fresh continuation.
    db.execute(
        delete(Message).where(
            Message.chat_id == chat_id,
            Message.created_at > message.created_at,
        )
    )
    model_id = payload.model_id or chat.model_id
    runtime = _enforce_model(db, user.id, model_id)
    _generation_limits(db,user.id,model_id,extra_request=True)
    message.content = payload.content.strip()
    if payload.model_id:
        chat.model_id = payload.model_id
    chat.updated_at = datetime.now(timezone.utc)
    db.flush()

    history = history_for_chat(db, chat_id, runtime)
    answer = _text_call(db,user.id,chat_id,model_id,history,runtime)
    append_assistant_message(db, chat_id, user.id, answer, model_id)
    return CompleteOut(chat_id=chat_id, answer=answer)


@router.post("/chats/{chat_id}/messages/{message_id}/regenerate", response_model=CompleteOut)
def regenerate_message(
    chat_id: str,
    message_id: str,
    payload: RegenerateIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    chat = db.scalar(select(Chat).where(Chat.id == chat_id, Chat.user_id == user.id))
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    message = db.scalar(select(Message).where(Message.id == message_id, Message.chat_id == chat_id))
    if not message or message.role != "assistant":
        raise HTTPException(status_code=404, detail="Assistant message not found")

    # Remove this response and anything after it, then regenerate from the same
    # conversation prefix. Branch-preserving history lands in Stage 2.
    db.execute(
        delete(Message).where(
            Message.chat_id == chat_id,
            Message.created_at >= message.created_at,
        )
    )
    model_id = payload.model_id or chat.model_id
    runtime = _enforce_model(db, user.id, model_id)
    _generation_limits(db,user.id,model_id,extra_request=True)
    if payload.model_id:
        chat.model_id = payload.model_id
    chat.updated_at = datetime.now(timezone.utc)
    db.flush()

    history = history_for_chat(db, chat_id, runtime)
    if not history or history[-1]["role"] != "user":
        raise HTTPException(status_code=409, detail="No user prompt available for regeneration")
    answer = _text_call(db,user.id,chat_id,model_id,history,runtime)
    append_assistant_message(db, chat_id, user.id, answer, model_id)
    return CompleteOut(chat_id=chat_id, answer=answer)


@router.post("/chat/stream")
def chat_stream(payload: ChatPromptIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    runtime = _enforce_model(db, user.id, payload.model_id)
    if payload.web_search and not runtime.get("supports_web_search", True):
        raise HTTPException(status_code=422, detail="Web search is disabled for this model")
    _generation_limits(db,user.id,payload.model_id,payload.web_search,extra_request=bool(payload.retry_message_id))
    chat = ensure_chat(
        db,
        user,
        payload.chat_id,
        payload.model_id,
        project_id=payload.project_id,
        temporary=payload.temporary,
    )
    if payload.retry_message_id:
        last = db.scalar(select(Message).where(Message.chat_id == chat.id).order_by(Message.created_at.desc()).limit(1))
        if not last or last.role != 'user' or last.id != payload.retry_message_id:
            raise HTTPException(status_code=409, detail='This message already has a response. Reload the conversation.')
        user_message = last
    else:
        user_message = append_user_message(db, chat, payload.content, payload.attachment_ids, commit=False)
    chat_id = chat.id
    user_id = user.id
    history = history_for_chat(db, chat_id, runtime)
    # Validate context before accepting the prompt and charging its plan quota.
    db.commit()
    request_id = str(uuid.uuid4())
    register_request(request_id, user_id)
    trace = new_trace(payload.model_id,'text',runtime,request_id)
    trace['user_id'] = user_id
    runtime['_trace'] = trace
    runtime['_cancel'] = lambda: is_cancelled(request_id)

    def generate():
        chunks: list[str] = []
        persisted = False
        accounted = False
        stopped = False
        provider_status = 'completed'
        error_code = None
        events = stream_events(history, payload.model_id, web_search=payload.web_search, runtime=runtime)
        def finalize_accounting():
            nonlocal accounted
            if not accounted:
                with SessionLocal() as accounting_db:
                    record_trace(accounting_db, trace, user_id, chat_id, 'cancelled' if stopped else provider_status, error_code)
                    accounting_db.commit()
                accounted = True
                finish_request(request_id)
        try:
            yield _sse("meta", {"chat_id": chat_id, "request_id": request_id, "model_id": payload.model_id})
            citations: list[dict] = []
            search_status = "idle"
            for event in events:
                if is_cancelled(request_id):
                    stopped = True
                    break
                event_type = event.get("type")
                if event_type == "delta":
                    chunk = str(event.get("delta") or "")
                    if chunk:
                        chunks.append(chunk)
                        yield _sse("delta", {"delta": chunk})
                elif event_type == "tool" and event.get("tool") == "web_search":
                    search_status = str(event.get("status") or "searching")
                    if search_status == 'failed': citations.clear()
                    yield _sse("tool", {"tool": "web_search", "status": search_status})
                elif event_type == "citation" and isinstance(event.get("citation"), dict):
                    citation = event["citation"]
                    if citation not in citations:
                        citations.append(citation)
                        yield _sse("citation", {"citation": citation})
            if is_cancelled(request_id):
                stopped = True

            answer = "".join(chunks).strip()
            if not answer and not stopped:
                raise RuntimeError('Provider returned no answer')
            message_meta = {
                "request_id": request_id,
                "stopped": stopped,
                "web_search": payload.web_search,
                "web_search_status": search_status,
                "citations": citations,
                "demo": is_demo(),
            }
            if answer:
                with SessionLocal() as write_db:
                    append_assistant_message(
                        write_db, chat_id, user_id, answer, payload.model_id,
                        meta=message_meta,
                    )
                persisted = True
            # A client may disconnect immediately on done. Commit accounting
            # before publishing the terminal event, while cleanup still has
            # the finally path for a disconnect during ordinary deltas.
            finalize_accounting()
            yield _sse("done", {
                "chat_id": chat_id,
                "request_id": request_id,
                "stopped": stopped,
                "web_search": payload.web_search,
                "citations": citations,
            })
        except GeneratorExit:
            stopped = True
            raise
        except Exception as exc:
            provider_status = 'failed'
            normalized = provider_error(exc); error_code = normalized.code
            # Failed output is discarded. The accepted user message remains retryable.
            chunks.clear()
            finalize_accounting()
            yield _sse("error", {"request_id": request_id, "message": str(normalized), "code": error_code,
                               **({'retry_after': normalized.retry_after} if normalized.retry_after else {})})
        finally:
            if not persisted:
                answer = "".join(chunks).strip()
                if answer:
                    with SessionLocal() as write_db:
                        append_assistant_message(
                            write_db, chat_id, user_id, answer, payload.model_id,
                            meta={
                                "request_id": request_id,
                                "stopped": True,
                                "web_search": payload.web_search,
                                "web_search_status": locals().get("search_status", "idle"),
                                "citations": locals().get("citations", []),
                                "demo": is_demo(),
                            },
                        )
            if hasattr(events, 'close'): events.close()
            finalize_accounting()

    response = ManagedStreamingResponse(generate(), lambda: cancel_request(request_id, user_id), media_type="text/event-stream; charset=utf-8")
    response.headers["X-UVMS-Chat-Id"] = chat_id
    response.headers["X-UVMS-Request-Id"] = request_id
    response.headers["X-UVMS-Message-Id"] = user_message.id
    response.headers["X-Accel-Buffering"] = "no"
    # Compression middleware/proxies must not buffer SSE deltas until gzip flush/end.
    response.headers["Cache-Control"] = "no-cache, no-transform"
    return response


@router.post("/chat/cancel/{request_id}", status_code=202)
def cancel_generation(request_id: str, user: User = Depends(current_user)):
    if not cancel_request(request_id, user.id):
        raise HTTPException(status_code=404, detail="Active generation not found")
    return {"status": "cancelling", "request_id": request_id}


@router.post("/chat/complete", response_model=CompleteOut)
def chat_complete(payload: ChatPromptIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    runtime = _enforce_model(db, user.id, payload.model_id)
    if payload.web_search and not runtime.get("supports_web_search", True):
        raise HTTPException(status_code=422, detail="Web search is disabled for this model")
    _generation_limits(db,user.id,payload.model_id,payload.web_search,extra_request=bool(payload.retry_message_id))
    chat = ensure_chat(
        db,
        user,
        payload.chat_id,
        payload.model_id,
        project_id=payload.project_id,
        temporary=payload.temporary,
    )
    if payload.retry_message_id:
        last = db.scalar(select(Message).where(Message.chat_id == chat.id).order_by(Message.created_at.desc()).limit(1))
        if not last or last.role != 'user' or last.id != payload.retry_message_id:
            raise HTTPException(status_code=409, detail='This message already has a response. Reload the conversation.')
    else:
        append_user_message(db, chat, payload.content, payload.attachment_ids, commit=False)
    history = history_for_chat(db, chat.id, runtime)
    answer, meta = _text_call(db,user.id,chat.id,payload.model_id,history,runtime,web_search=payload.web_search,with_meta=True)
    append_assistant_message(db, chat.id, user.id, answer, payload.model_id, meta=meta)
    return CompleteOut(chat_id=chat.id, answer=answer, meta=meta)


@router.get("/admin/users")
def admin_users(_admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(User).order_by(User.created_at.desc()).limit(250)).all()
    result = []
    for row in rows:
        sub = ensure_free_subscription(db, row.id)
        result.append({
            "id": row.id,
            "email": row.email,
            "display_name": row.display_name,
            "role": row.role,
            "is_active": row.is_active,
            "created_at": row.created_at,
            "plan_code": sub.plan_code,
            "subscription_status": sub.status,
        })
    return result


@router.patch("/admin/users/{user_id}")
def admin_patch_user(
    user_id: str,
    payload: UserAdminPatch,
    admin: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    row = db.get(User, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    if row.id == admin.id and payload.is_active is False:
        raise HTTPException(status_code=409, detail="You cannot disable your own admin account")
    if payload.is_active is not None:
        row.is_active = payload.is_active
    if payload.role is not None:
        row.role = payload.role
    audit_event(
        db, actor_user_id=admin.id, action="admin.user.updated",
        target_type="user", target_id=row.id,
        meta={"is_active": row.is_active, "role": row.role},
    )
    db.commit()
    return {"id": row.id, "role": row.role, "is_active": row.is_active}


@router.patch("/admin/users/{user_id}/subscription")
def admin_patch_subscription(
    user_id: str,
    payload: SubscriptionPatch,
    admin: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="User not found")
    plan = db.scalar(select(Plan).where(Plan.code == payload.plan_code))
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    sub = ensure_free_subscription(db, user_id)
    sub.plan_code = plan.code
    sub.status = payload.status
    sub.provider = "admin"
    audit_event(
        db, actor_user_id=admin.id, action="admin.subscription.updated",
        target_type="user", target_id=user_id,
        meta={"plan_code": sub.plan_code, "status": sub.status},
    )
    db.commit()
    return {"user_id": user_id, "plan_code": sub.plan_code, "status": sub.status}


@router.get("/admin/plans")
def admin_plans(_admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Plan).order_by(Plan.monthly_price_cents)).all()
    return [
        {
            "code": row.code,
            "name": row.name,
            "monthly_price_cents": row.monthly_price_cents,
            "currency": row.currency,
            "limits": row.limits,
            "is_active": row.is_active,
        }
        for row in rows
    ]


@router.patch("/admin/plans/{code}")
def admin_patch_plan(
    code: str,
    payload: PlanPatch,
    admin: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    row = db.scalar(select(Plan).where(Plan.code == code))
    if not row:
        raise HTTPException(status_code=404, detail="Plan not found")
    if payload.name is not None:
        row.name = payload.name.strip()
    if payload.monthly_price_cents is not None:
        row.monthly_price_cents = payload.monthly_price_cents
    if payload.currency is not None:
        row.currency = payload.currency.upper()
    if payload.limits is not None:
        merged = dict(row.limits or {})
        merged.update(payload.limits)
        row.limits = merged
    if payload.is_active is not None:
        row.is_active = payload.is_active
    audit_event(
        db, actor_user_id=admin.id, action="admin.plan.updated",
        target_type="plan", target_id=row.code,
        meta={"price": row.monthly_price_cents, "currency": row.currency, "is_active": row.is_active},
    )
    db.commit()
    return {
        "code": row.code,
        "name": row.name,
        "monthly_price_cents": row.monthly_price_cents,
        "currency": row.currency,
        "limits": row.limits,
        "is_active": row.is_active,
    }


@router.get("/admin/models")
def admin_models(_admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(AiModelConfig).order_by(AiModelConfig.created_at.asc())).all()
    return [
        {
            "id": row.id,
            "name": row.name,
            "description": row.description,
            "provider_model": upstream_model(row.id, {'provider_model': row.provider_model}),
            "reasoning_effort": reasoning_effort(row.id, {'reasoning_effort': row.reasoning_effort}),
            "routing_managed_by_env": effective_ai_provider(settings) in {'gemini', 'groq'},
            "min_plan": row.min_plan,
            "is_enabled": row.is_enabled,
            "supports_web_search": row.supports_web_search,
            "supports_vision": row.supports_vision,
        }
        for row in rows
    ]


@router.patch("/admin/models/{model_id}")
def admin_patch_model(
    model_id: str,
    payload: AiModelPatch,
    admin: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    row = db.get(AiModelConfig, model_id)
    if not row:
        raise HTTPException(status_code=404, detail="Model not found")
    if effective_ai_provider(settings) in {'gemini', 'groq'} and (
        payload.provider_model is not None and payload.provider_model != upstream_model(row.id)
        or payload.reasoning_effort is not None and payload.reasoning_effort != reasoning_effort(row.id)
    ):
        raise HTTPException(422, 'Gemini model aliases and reasoning effort are managed by backend configuration.')
    for field in (
        "name", "description", "provider_model", "reasoning_effort", "min_plan",
        "is_enabled", "supports_web_search", "supports_vision",
    ):
        value = getattr(payload, field)
        if effective_ai_provider(settings) in {'gemini', 'groq'} and field in {'provider_model', 'reasoning_effort'}:
            continue
        if value is not None:
            setattr(row, field, value.strip() if isinstance(value, str) else value)
    audit_event(
        db, actor_user_id=admin.id, action="admin.model.updated",
        target_type="ai_model", target_id=row.id,
        meta={
            "provider_model": row.provider_model,
            "reasoning_effort": row.reasoning_effort,
            "min_plan": row.min_plan,
            "is_enabled": row.is_enabled,
        },
    )
    db.commit()
    return {
        "id": row.id, "name": row.name, "description": row.description,
        "provider_model": upstream_model(row.id, {'provider_model': row.provider_model}),
        "reasoning_effort": reasoning_effort(row.id, {'reasoning_effort': row.reasoning_effort}),
        "routing_managed_by_env": effective_ai_provider(settings) in {'gemini', 'groq'},
        "min_plan": row.min_plan, "is_enabled": row.is_enabled,
        "supports_web_search": row.supports_web_search, "supports_vision": row.supports_vision,
    }


@router.get("/admin/audit")
def admin_audit(
    limit: int = 100,
    _admin: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    safe_limit = max(1, min(limit, 500))
    rows = db.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(safe_limit)).all()
    return [
        {
            "id": row.id, "actor_user_id": row.actor_user_id, "action": row.action,
            "target_type": row.target_type, "target_id": row.target_id,
            "meta": row.meta, "ip_address": row.ip_address, "created_at": row.created_at,
        }
        for row in rows
    ]


@router.get("/admin/stats")
def admin_stats(_admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    return {
        "users": db.scalar(select(func.count(User.id))) or 0,
        "chats": db.scalar(select(func.count(Chat.id))) or 0,
        "messages": db.scalar(select(func.count(Message.id))) or 0,
        "files": db.scalar(select(func.count(FileAsset.id))) or 0,
        "projects": db.scalar(select(func.count(Project.id))) or 0,
        "memories": db.scalar(select(func.count(MemoryItem.id))) or 0,
        "usage_events": db.scalar(select(func.count(UsageEvent.id))) or 0,
        "checkouts": db.scalar(select(func.count(CheckoutSession.id))) or 0,
        "audit_events": db.scalar(select(func.count(AuditEvent.id))) or 0,
        "ai_models": db.scalar(select(func.count(AiModelConfig.id))) or 0,
        "ai_mode": 'development' if effective_ai_provider(settings) == 'openrouter' else "demo" if is_demo() else "live",
        "provider_usage": accounting_summary(db),
        "provider_health": provider_health(db),
        "billing_provider": settings.billing_provider,
    }


@router.post('/admin/provider-health/check')
def check_provider_health(admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    runtime = {}
    trace = new_trace('uvms-1-fast', 'text', runtime)
    trace['user_id'] = admin.id
    runtime['_trace'] = trace
    status, error_code = 'completed', None
    try:
        if is_demo(): raise ProviderError('configuration')
        answer = complete_answer([{'role':'user','content':'Reply with exactly one word: READY'}], 'uvms-1-fast', runtime=runtime)
        if answer.strip() != 'READY': raise ProviderError('malformed_response')
    except Exception as exc:
        status, error_code = 'failed', provider_error(exc).code
    record_trace(db, trace, admin.id, None, status, error_code)
    db.commit()
    return provider_health(db)


class FeaturePatch(BaseModel):
    is_enabled: bool


@router.get('/admin/ai-features')
def admin_features(_admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    return features(db)


@router.patch('/admin/ai-features/{name}')
def patch_feature(name: str, payload: FeaturePatch, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    if name not in {'search','images','voice'}: raise HTTPException(404,'Feature not found')
    row = db.get(AiFeature,name)
    if not row: row = AiFeature(id=name); db.add(row)
    row.is_enabled = payload.is_enabled
    audit_event(db,actor_user_id=admin.id,action='ai.feature.updated',target_type='feature',target_id=name,meta={'enabled':payload.is_enabled})
    db.commit()
    return features(db)
