from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from .config import settings

_hasher = PasswordHasher()
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    try:
        return _hasher.verify(encoded, password)
    except VerifyMismatchError:
        return False


def _encode(user_id: str, token_type: str, lifetime: timedelta, jti: str | None = None, sid: str | None = None) -> tuple[str, str, datetime]:
    now = datetime.now(timezone.utc)
    expires = now + lifetime
    token_jti = jti or uuid.uuid4().hex
    payload = {
        "sub": user_id,
        "type": token_type,
        "jti": token_jti,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
    }
    if sid:
        payload['sid'] = sid
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM), token_jti, expires


def create_access_token(user_id: str, sid: str | None = None) -> str:
    token, _, _ = _encode(user_id, "access", timedelta(minutes=settings.access_token_minutes), sid=sid)
    return token


def create_refresh_token(user_id: str) -> tuple[str, str, datetime]:
    return _encode(user_id, "refresh", timedelta(days=settings.refresh_token_days))


def decode_token(token: str, expected_type: str) -> dict:
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM], options={'require': ['sub', 'exp', 'iat', 'jti', 'type']})
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("Wrong token type")
    return payload


def hash_reset_token(raw: str) -> str:
    import hashlib
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def create_reset_token() -> str:
    import secrets
    return secrets.token_urlsafe(48)
