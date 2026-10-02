from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .deps import current_user
from .email_service import send_password_reset
from .models import (
    Chat,
    FileAsset,
    MemoryItem,
    Message,
    PasswordResetToken,
    Project,
    RefreshSession,
    Subscription,
    User,
)
from .schemas import (
    AccountExportOut,
    PasswordChangeIn,
    PasswordResetConfirmIn,
    PasswordResetRequestIn,
    ProfilePatch,
    RefreshSessionOut,
    UserOut,
)
from .security import create_reset_token, hash_password, hash_reset_token, verify_password
from .services import audit_event, plan_for_user
from .storage_backend import delete_key

router = APIRouter(prefix="/api/v1")


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _revoke_all_sessions(db: Session, user_id: str) -> int:
    now = datetime.now(timezone.utc)
    rows = db.scalars(
        select(RefreshSession).where(
            RefreshSession.user_id == user_id,
            RefreshSession.revoked_at.is_(None),
        )
    ).all()
    for row in rows:
        row.revoked_at = now
    return len(rows)


@router.patch("/me", response_model=UserOut)
def update_profile(
    payload: ProfilePatch,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if payload.display_name is not None:
        user.display_name = payload.display_name.strip()
    user.updated_at = datetime.now(timezone.utc)
    audit_event(
        db,
        actor_user_id=user.id,
        action="account.profile.updated",
        target_type="user",
        target_id=user.id,
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    db.refresh(user)
    return user


@router.post("/me/password", status_code=204)
def change_password(
    payload: PasswordChangeIn,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=422, detail="New password must be different")
    user.password_hash = hash_password(payload.new_password)
    user.updated_at = datetime.now(timezone.utc)
    revoked = _revoke_all_sessions(db, user.id)
    audit_event(
        db,
        actor_user_id=user.id,
        action="account.password.changed",
        target_type="user",
        target_id=user.id,
        meta={"revoked_sessions": revoked},
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    return None


@router.get("/me/sessions", response_model=list[RefreshSessionOut])
def list_sessions(user: User = Depends(current_user), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    rows = db.scalars(
        select(RefreshSession)
        .where(RefreshSession.user_id == user.id)
        .order_by(RefreshSession.created_at.desc())
        .limit(100)
    ).all()
    # Keep the response useful by pruning old expired sessions opportunistically.
    stale = [row for row in rows if row.revoked_at is not None or _aware(row.expires_at) < now - timedelta(days=7)]
    for row in stale:
        db.delete(row)
    if stale:
        db.commit()
        rows = [row for row in rows if row not in stale]
    return rows


@router.delete("/me/sessions/{session_id}", status_code=204)
def revoke_session(
    session_id: str,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    row = db.scalar(
        select(RefreshSession).where(
            RefreshSession.id == session_id,
            RefreshSession.user_id == user.id,
        )
    )
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    if row.revoked_at is None:
        row.revoked_at = datetime.now(timezone.utc)
    audit_event(
        db,
        actor_user_id=user.id,
        action="account.session.revoked",
        target_type="refresh_session",
        target_id=row.id,
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    return None


@router.post("/me/logout-all", status_code=204)
def logout_all(
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    revoked = _revoke_all_sessions(db, user.id)
    audit_event(
        db,
        actor_user_id=user.id,
        action="account.logout_all",
        target_type="user",
        target_id=user.id,
        meta={"revoked_sessions": revoked},
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    return None


@router.get("/me/export", response_model=AccountExportOut)
def export_account(user: User = Depends(current_user), db: Session = Depends(get_db)):
    sub, plan = plan_for_user(db, user.id)
    chats = db.scalars(select(Chat).where(Chat.user_id == user.id).order_by(Chat.created_at)).all()
    projects = db.scalars(select(Project).where(Project.user_id == user.id).order_by(Project.created_at)).all()
    memory = db.scalars(select(MemoryItem).where(MemoryItem.user_id == user.id).order_by(MemoryItem.created_at)).all()
    files = db.scalars(select(FileAsset).where(FileAsset.user_id == user.id).order_by(FileAsset.created_at)).all()
    return AccountExportOut(
        generated_at=datetime.now(timezone.utc),
        user={
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "role": user.role,
            "created_at": user.created_at.isoformat(),
        },
        subscription={
            "plan_code": sub.plan_code,
            "plan_name": plan.name,
            "status": sub.status,
            "provider": sub.provider,
        },
        chats=[
            {
                "id": row.id,
                "title": row.title,
                "model_id": row.model_id,
                "archived": row.is_archived,
                "created_at": row.created_at.isoformat(),
                "messages": [
                    {
                        "id": message.id,
                        "role": message.role,
                        "content": message.content,
                        "model_id": message.model_id,
                        "meta": message.meta,
                        "created_at": message.created_at.isoformat(),
                    }
                    for message in db.scalars(
                        select(Message).where(Message.chat_id == row.id).order_by(Message.created_at.asc())
                    ).all()
                ],
            }
            for row in chats
        ],
        projects=[
            {
                "id": row.id,
                "name": row.name,
                "description": row.description,
                "instructions": row.instructions,
                "created_at": row.created_at.isoformat(),
            }
            for row in projects
        ],
        memory=[
            {
                "id": row.id,
                "content": row.content,
                "enabled": row.is_enabled,
                "created_at": row.created_at.isoformat(),
            }
            for row in memory
        ],
        files=[
            {
                "id": row.id,
                "name": row.original_name,
                "mime_type": row.mime_type,
                "category": row.category,
                "size_bytes": row.size_bytes,
                "created_at": row.created_at.isoformat(),
            }
            for row in files
        ],
    )


@router.delete("/me", status_code=204)
def delete_account(
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    files = db.scalars(select(FileAsset).where(FileAsset.user_id == user.id)).all()
    for asset in files:
        try:
            delete_key(asset.stored_name)
        except Exception as exc:
            if settings.env.lower() == "production":
                db.rollback()
                raise HTTPException(status_code=503, detail="Account deletion is temporarily unavailable. Please retry when storage is healthy.") from exc
            # Development keeps best-effort cleanup so local fixture/storage issues
            # do not make disposable accounts impossible to remove.
    audit_event(
        db,
        actor_user_id=user.id,
        action="account.deleted",
        target_type="user",
        target_id=user.id,
        ip_address=request.client.host if request.client else None,
    )
    db.flush()
    db.delete(user)
    db.commit()
    return None


@router.get('/auth/options')
def auth_options():
    return {'password_reset': settings.password_reset_enabled and (bool(settings.smtp_host) or settings.env.lower() != 'production')}


@router.post("/auth/password-reset/request")
def request_password_reset(
    payload: PasswordResetRequestIn,
    request: Request,
    db: Session = Depends(get_db),
):
    # Always return the same public shape to avoid account enumeration.
    response: dict[str, object] = {
        "status": "accepted",
        "message": "If the account exists, password reset instructions were sent.",
    }
    if not settings.password_reset_enabled:
        raise HTTPException(status_code=503, detail='Password reset is temporarily unavailable. Contact the administrator for help.')

    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user or not user.is_active:
        return response

    raw = create_reset_token()
    token = PasswordResetToken(
        user_id=user.id,
        token_hash=hash_reset_token(raw),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.password_reset_minutes),
    )
    db.add(token)
    reset_url = f"{settings.public_web_url}/reset-password?token={quote(raw)}"
    delivered = False
    try:
        delivered = send_password_reset(user.email, reset_url)
    except Exception:
        if settings.env.lower() == "production":
            db.rollback()
            # Still preserve the anti-enumeration response.
            return response

    audit_event(
        db,
        actor_user_id=user.id,
        action="account.password_reset.requested",
        target_type="user",
        target_id=user.id,
        meta={"delivered": delivered},
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    if settings.env.lower() != "production" and not delivered:
        response["debug_reset_url"] = reset_url
    return response


@router.post("/auth/password-reset/confirm")
def confirm_password_reset(
    payload: PasswordResetConfirmIn,
    request: Request,
    db: Session = Depends(get_db),
):
    row = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_reset_token(payload.token)))
    if not row or row.used_at is not None or _aware(row.expires_at) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    user = db.get(User, row.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user.password_hash = hash_password(payload.new_password)
    user.updated_at = datetime.now(timezone.utc)
    row.used_at = datetime.now(timezone.utc)
    revoked = _revoke_all_sessions(db, user.id)
    audit_event(
        db,
        actor_user_id=user.id,
        action="account.password_reset.completed",
        target_type="user",
        target_id=user.id,
        meta={"revoked_sessions": revoked},
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    return {"status": "ok", "message": "Password updated. Sign in again on your devices."}
