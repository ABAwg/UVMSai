from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from .config import settings


class StorageError(RuntimeError):
    pass


def _local_path(key: str) -> Path:
    root = Path(settings.storage_dir).resolve()
    candidate = (root / key).resolve()
    if root != candidate and root not in candidate.parents:
        raise StorageError("Invalid storage key")
    return candidate


@lru_cache(maxsize=1)
def _s3_client():
    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:  # pragma: no cover - dependency is installed in production image
        raise StorageError("S3 backend requires boto3") from exc

    if not settings.s3_bucket:
        raise StorageError("UVMS_S3_BUCKET is required for S3 storage")

    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url or None,
        region_name=settings.s3_region or None,
        aws_access_key_id=settings.s3_access_key_id or None,
        aws_secret_access_key=settings.s3_secret_access_key or None,
        config=Config(s3={"addressing_style": "path" if settings.s3_force_path_style else "auto"}),
    )


def backend_name() -> str:
    return settings.storage_backend.lower().strip() or "local"


def put_bytes(key: str, data: bytes, content_type: str) -> None:
    if backend_name() == "local":
        path = _local_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return
    if backend_name() == "s3":
        _s3_client().put_object(Bucket=settings.s3_bucket, Key=key, Body=data, ContentType=content_type)
        return
    raise StorageError(f"Unsupported storage backend: {backend_name()}")


def get_bytes(key: str) -> bytes:
    if backend_name() == "local":
        path = _local_path(key)
        if not path.is_file():
            raise FileNotFoundError(key)
        return path.read_bytes()
    if backend_name() == "s3":
        try:
            response = _s3_client().get_object(Bucket=settings.s3_bucket, Key=key)
            return response["Body"].read()
        except Exception as exc:  # provider errors are normalized for callers
            raise FileNotFoundError(key) from exc
    raise StorageError(f"Unsupported storage backend: {backend_name()}")


def local_path(key: str) -> Path | None:
    if backend_name() != "local":
        return None
    return _local_path(key)


def presigned_download_url(key: str, filename: str, content_type: str, expires_seconds: int = 120) -> str | None:
    if backend_name() != "s3":
        return None
    disposition_name = filename.replace('"', "")[:180]
    params = {
        "Bucket": settings.s3_bucket,
        "Key": key,
        "ResponseContentType": content_type,
        "ResponseContentDisposition": f'attachment; filename="{disposition_name}"',
    }
    return _s3_client().generate_presigned_url(
        "get_object",
        Params=params,
        ExpiresIn=max(30, min(expires_seconds, 900)),
    )


def delete_key(key: str) -> None:
    if backend_name() == "local":
        path = _local_path(key)
        try:
            path.unlink(missing_ok=True)
        except TypeError:  # Python < 3.8 compatibility guard
            if path.exists():
                path.unlink()
        return
    if backend_name() == "s3":
        _s3_client().delete_object(Bucket=settings.s3_bucket, Key=key)
        return
    raise StorageError(f"Unsupported storage backend: {backend_name()}")


def healthcheck() -> tuple[bool, str]:
    try:
        if backend_name() == "local":
            root = Path(settings.storage_dir).resolve()
            root.mkdir(parents=True, exist_ok=True)
            probe = root / ".uvms-health"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
            return True, "local"
        if backend_name() == "s3":
            _s3_client().head_bucket(Bucket=settings.s3_bucket)
            return True, "s3"
        return False, f"unsupported:{backend_name()}"
    except Exception as exc:
        return False, type(exc).__name__
