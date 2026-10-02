import os
import tempfile
import uuid
from pathlib import Path

from fastapi.testclient import TestClient

# Each pytest process gets an isolated database/storage so repeated local and CI
# runs never consume a previous run's quotas or reuse auth sessions.
_TEST_ROOT = Path(tempfile.mkdtemp(prefix="uvms-ai-tests-"))
os.environ.setdefault("UVMS_DATABASE_URL", f"sqlite:///{(_TEST_ROOT / 'test.db').as_posix()}")
os.environ.setdefault("UVMS_STORAGE_DIR", str(_TEST_ROOT / "storage"))
os.environ.setdefault("UVMS_JWT_SECRET", "test-only-secret-key-longer-than-thirty-two-characters")

from app.main import app


def test_auth_and_chat_flow():
    with TestClient(app) as client:
        reg = client.post(
            "/api/v1/auth/register",
            json={"email": "stage1@example.com", "password": "strong-pass-123", "display_name": "Stage One"},
        )
        assert reg.status_code in (201, 409)
        if reg.status_code == 201:
            token = reg.json()["access_token"]
        else:
            login = client.post(
                "/api/v1/auth/login",
                json={"email": "stage1@example.com", "password": "strong-pass-123"},
            )
            assert login.status_code == 200
            token = login.json()["access_token"]

        headers = {"Authorization": f"Bearer {token}"}
        me = client.get("/api/v1/me", headers=headers)
        assert me.status_code == 200
        assert me.json()["email"] == "stage1@example.com"

        new_chat = client.post("/api/v1/chats", headers=headers, json={"title": "Smoke test"})
        assert new_chat.status_code == 201
        chat_id = new_chat.json()["id"]

        completion = client.post(
            "/api/v1/chat/complete",
            headers=headers,
            json={"chat_id": chat_id, "content": "Hello UVMS", "model_id": "uvms-1-balanced"},
        )
        assert completion.status_code == 200
        assert completion.json()["chat_id"] == chat_id
        assert completion.json()["answer"]

        detail = client.get(f"/api/v1/chats/{chat_id}", headers=headers)
        assert detail.status_code == 200
        assert len(detail.json()["messages"]) >= 2


def _auth_headers(client: TestClient, email: str = "stage12@example.com") -> dict[str, str]:
    reg = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "strong-pass-123", "display_name": "Stage 1.2"},
    )
    if reg.status_code == 201:
        token = reg.json()["access_token"]
    else:
        login = client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "strong-pass-123"},
        )
        assert login.status_code == 200
        token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_chat_lifecycle_edit_regenerate_and_archive():
    with TestClient(app) as client:
        headers = _auth_headers(client)
        created = client.post(
            "/api/v1/chats",
            headers=headers,
            json={"title": "Lifecycle", "model_id": "uvms-1-balanced"},
        )
        assert created.status_code == 201
        chat_id = created.json()["id"]

        first = client.post(
            "/api/v1/chat/complete",
            headers=headers,
            json={"chat_id": chat_id, "content": "First prompt", "model_id": "uvms-1-balanced"},
        )
        assert first.status_code == 200

        detail = client.get(f"/api/v1/chats/{chat_id}", headers=headers)
        assert detail.status_code == 200
        messages = detail.json()["messages"]
        user_message = next(m for m in messages if m["role"] == "user")
        assistant_message = next(m for m in messages if m["role"] == "assistant")

        regen = client.post(
            f"/api/v1/chats/{chat_id}/messages/{assistant_message['id']}/regenerate",
            headers=headers,
            json={"model_id": "uvms-1-fast"},
        )
        assert regen.status_code == 200
        assert regen.json()["answer"]

        detail = client.get(f"/api/v1/chats/{chat_id}", headers=headers)
        messages = detail.json()["messages"]
        user_message = next(m for m in messages if m["role"] == "user")

        edited = client.post(
            f"/api/v1/chats/{chat_id}/messages/{user_message['id']}/edit",
            headers=headers,
            json={"content": "Edited prompt", "model_id": "uvms-1-balanced"},
        )
        assert edited.status_code == 200

        renamed = client.patch(
            f"/api/v1/chats/{chat_id}",
            headers=headers,
            json={"title": "Renamed lifecycle", "is_archived": True},
        )
        assert renamed.status_code == 200
        assert renamed.json()["title"] == "Renamed lifecycle"
        assert renamed.json()["is_archived"] is True

        live = client.get("/api/v1/chats?archived=false", headers=headers)
        archived = client.get("/api/v1/chats?archived=true", headers=headers)
        assert all(row["id"] != chat_id for row in live.json())
        assert any(row["id"] == chat_id for row in archived.json())


def test_file_upload_attachment_and_vision_foundation():
    with TestClient(app) as client:
        headers = _auth_headers(client, "files-stage13@example.com")
        upload = client.post(
            "/api/v1/files",
            headers=headers,
            files={"upload": ("notes.txt", b"UVMS attachment test content", "text/plain")},
        )
        assert upload.status_code == 201, upload.text
        asset = upload.json()
        assert asset["original_name"] == "notes.txt"
        assert asset["category"] == "text"

        completion = client.post(
            "/api/v1/chat/complete",
            headers=headers,
            json={
                "chat_id": None,
                "content": "Summarize the attached file",
                "model_id": "uvms-1-balanced",
                "attachment_ids": [asset["id"]],
            },
        )
        assert completion.status_code == 200, completion.text
        chat_id = completion.json()["chat_id"]

        detail = client.get(f"/api/v1/chats/{chat_id}", headers=headers)
        assert detail.status_code == 200
        user_message = next(m for m in detail.json()["messages"] if m["role"] == "user")
        assert user_message["attachments"][0]["id"] == asset["id"]

        listed = client.get("/api/v1/files", headers=headers)
        assert listed.status_code == 200
        assert any(item["id"] == asset["id"] for item in listed.json())


def test_structured_sse_stream():
    with TestClient(app) as client:
        headers = _auth_headers(client, "sse-stage14@example.com")
        with client.stream(
            "POST",
            "/api/v1/chat/stream",
            headers=headers,
            json={"chat_id": None, "content": "Stream test", "model_id": "uvms-1-fast", "attachment_ids": []},
        ) as response:
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")
            assert "no-transform" in response.headers.get("cache-control", "")
            assert response.headers.get("x-uvms-request-id")
            body = "".join(response.iter_text())
        assert "event: meta" in body
        assert "event: delta" in body
        assert "event: done" in body


def test_web_search_stream_contract_and_persisted_meta_in_demo_mode():
    with TestClient(app) as client:
        headers = _auth_headers(client, "web-stage15@example.com")
        with client.stream(
            "POST",
            "/api/v1/chat/stream",
            headers=headers,
            json={
                "chat_id": None,
                "content": "What is new today?",
                "model_id": "uvms-1-balanced",
                "attachment_ids": [],
                "web_search": True,
            },
        ) as response:
            assert response.status_code == 200
            chat_id = response.headers.get("x-uvms-chat-id")
            body = "".join(response.iter_text())

        assert chat_id
        assert "event: tool" in body
        assert '"tool": "web_search"' in body
        assert "event: done" in body

        detail = client.get(f"/api/v1/chats/{chat_id}", headers=headers)
        assert detail.status_code == 200
        assistants = [m for m in detail.json()["messages"] if m["role"] == "assistant"]
        assert assistants
        meta = assistants[-1]["meta"]
        assert meta["web_search"] is True
        assert isinstance(meta["citations"], list)


def test_projects_memory_and_entitlements_foundation():
    with TestClient(app) as client:
        headers = _auth_headers(client, "projects-stage16@example.com")

        memory = client.post(
            "/api/v1/memory",
            headers=headers,
            json={"content": "The user prefers concise technical answers."},
        )
        assert memory.status_code == 201, memory.text
        memory_id = memory.json()["id"]
        assert memory.json()["is_enabled"] is True

        project = client.post(
            "/api/v1/projects",
            headers=headers,
            json={
                "name": "UVMS Launch",
                "description": "Public beta work",
                "instructions": "Keep answers aligned with the UVMS product context.",
            },
        )
        assert project.status_code == 201, project.text
        project_id = project.json()["id"]

        completion = client.post(
            "/api/v1/chat/complete",
            headers=headers,
            json={
                "chat_id": None,
                "content": "Give me a one-line launch checklist",
                "model_id": "uvms-1-balanced",
                "project_id": project_id,
            },
        )
        assert completion.status_code == 200, completion.text
        chat_id = completion.json()["chat_id"]

        project_chats = client.get(f"/api/v1/projects/{project_id}/chats", headers=headers)
        assert project_chats.status_code == 200
        assert any(item["id"] == chat_id for item in project_chats.json())

        models = client.get("/api/v1/models", headers=headers)
        assert models.status_code == 200
        deep = next(item for item in models.json() if item["id"] == "uvms-1-deep")
        assert deep["available"] is False

        denied = client.post(
            "/api/v1/chat/complete",
            headers=headers,
            json={"chat_id": None, "content": "Deep test", "model_id": "uvms-1-deep"},
        )
        assert denied.status_code == 403

        usage = client.get("/api/v1/usage/me", headers=headers)
        assert usage.status_code == 200
        assert usage.json()["plan"] == "free"
        assert usage.json()["today"]["messages"] >= 1

        disabled = client.patch(
            f"/api/v1/memory/{memory_id}",
            headers=headers,
            json={"is_enabled": False},
        )
        assert disabled.status_code == 200
        assert disabled.json()["is_enabled"] is False


def test_image_generation_demo_persists_asset_and_message():
    with TestClient(app) as client:
        headers = _auth_headers(client, f"images-{uuid.uuid4().hex[:10]}@example.com")
        generated = client.post(
            "/api/v1/images/generate",
            headers=headers,
            json={"prompt": "A clean futuristic UVMS operations center", "size": "1024x1024", "quality": "medium"},
        )
        assert generated.status_code == 201, generated.text
        body = generated.json()
        assert body["chat_id"]
        assert body["asset"]["category"] == "image"
        assert body["message"]["attachments"][0]["id"] == body["asset"]["id"]

        detail = client.get(f"/api/v1/chats/{body['chat_id']}", headers=headers)
        assert detail.status_code == 200
        assistant = [m for m in detail.json()["messages"] if m["role"] == "assistant"][-1]
        assert assistant["meta"]["image_generation"] is True
        assert assistant["attachments"][0]["id"] == body["asset"]["id"]

        usage = client.get("/api/v1/usage/me", headers=headers)
        assert usage.status_code == 200
        assert usage.json()["month"]["images"] >= 1

        download = client.get(f"/api/v1/files/{body['asset']['id']}/download", headers=headers)
        assert download.status_code == 200
        assert download.content
        if body["demo"]:
            assert download.content.startswith(b"\x89PNG")


def test_admin_can_manage_plan_and_user_subscription():
    with TestClient(app) as client:
        admin_headers = _auth_headers(client, "admin@uvms.uz")
        user_headers = _auth_headers(client, "billing-stage17@example.com")
        me = client.get("/api/v1/me", headers=user_headers).json()

        users = client.get("/api/v1/admin/users", headers=admin_headers)
        assert users.status_code == 200, users.text
        assert any(row["id"] == me["id"] for row in users.json())

        update_plan = client.patch(
            "/api/v1/admin/plans/plus",
            headers=admin_headers,
            json={"limits": {"images_monthly": 123}},
        )
        assert update_plan.status_code == 200, update_plan.text
        assert update_plan.json()["limits"]["images_monthly"] == 123

        grant = client.patch(
            f"/api/v1/admin/users/{me['id']}/subscription",
            headers=admin_headers,
            json={"plan_code": "plus", "status": "active"},
        )
        assert grant.status_code == 200, grant.text
        assert grant.json()["plan_code"] == "plus"

        usage = client.get("/api/v1/usage/me", headers=user_headers)
        assert usage.status_code == 200
        assert usage.json()["plan"] == "plus"


def test_refresh_rotation_and_demo_checkout():
    with TestClient(app) as client:
        email = f"refresh-billing-{uuid.uuid4().hex[:10]}@example.com"
        reg = client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": "strong-pass-123", "display_name": "Refresh Billing"},
        )
        if reg.status_code == 409:
            reg = client.post(
                "/api/v1/auth/login",
                json={"email": email, "password": "strong-pass-123"},
            )
        assert reg.status_code == 200 or reg.status_code == 201, reg.text
        pair = reg.json()
        old_refresh = pair["refresh_token"]

        rotated = client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
        assert rotated.status_code == 200, rotated.text
        assert rotated.json()["refresh_token"] != old_refresh
        reused = client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
        assert reused.status_code == 401

        headers = {"Authorization": f"Bearer {rotated.json()['access_token']}"}
        checkout = client.post("/api/v1/billing/checkout", headers=headers, json={"plan_code": "plus"})
        assert checkout.status_code == 201, checkout.text
        assert checkout.json()["status"] == "pending"
        assert checkout.json()["checkout_url"]

        completed = client.post(f"/api/v1/billing/demo/complete/{checkout.json()['id']}", headers=headers)
        assert completed.status_code == 200, completed.text
        assert completed.json()["status"] == "completed"

        subscription = client.get("/api/v1/billing/subscription", headers=headers)
        assert subscription.status_code == 200
        assert subscription.json()["plan_code"] == "plus"


def test_admin_model_controls_and_audit_log():
    with TestClient(app) as client:
        admin_headers = _auth_headers(client, "admin@uvms.uz")
        models = client.get("/api/v1/admin/models", headers=admin_headers)
        assert models.status_code == 200, models.text
        balanced = next(item for item in models.json() if item["id"] == "uvms-1-balanced")

        update = client.patch(
            "/api/v1/admin/models/uvms-1-balanced",
            headers=admin_headers,
            json={"description": "Balanced model managed from Admin", "reasoning_effort": "medium", "is_enabled": True},
        )
        assert update.status_code == 200, update.text
        assert update.json()["description"] == "Balanced model managed from Admin"

        audit = client.get("/api/v1/admin/audit?limit=50", headers=admin_headers)
        assert audit.status_code == 200, audit.text
        assert any(item["action"] == "admin.model.updated" and item["target_id"] == "uvms-1-balanced" for item in audit.json())

        # Restore the user-facing description so repeated local test runs stay deterministic.
        restore = client.patch(
            "/api/v1/admin/models/uvms-1-balanced",
            headers=admin_headers,
            json={"description": balanced["description"]},
        )
        assert restore.status_code == 200


def test_voice_transcription_demo_mode():
    with TestClient(app) as client:
        headers = _auth_headers(client, f"voice-{uuid.uuid4().hex[:8]}@example.com")
        response = client.post(
            "/api/v1/audio/transcribe",
            headers=headers,
            files={"audio": ("voice.m4a", b"demo-audio-bytes", "audio/mp4")},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["text"]
        assert payload["demo"] is True


def test_web_cookie_refresh_flow_rotates_session():
    with TestClient(app) as client:
        email = f"cookie-{uuid.uuid4().hex[:8]}@example.com"
        reg = client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": "strong-pass-123", "display_name": "Cookie User"},
        )
        assert reg.status_code == 201
        assert client.cookies.get("uvms_refresh")
        old_cookie = client.cookies.get("uvms_refresh")
        refreshed = client.post("/api/v1/auth/refresh", json={})
        assert refreshed.status_code == 200, refreshed.text
        assert client.cookies.get("uvms_refresh")
        assert client.cookies.get("uvms_refresh") != old_cookie


def test_session_list_and_revoke():
    with TestClient(app) as client:
        email = f"sessions-{uuid.uuid4().hex[:8]}@example.com"
        reg = client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": "strong-pass-123", "display_name": "Session User"},
        )
        headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
        rows = client.get("/api/v1/me/sessions", headers=headers)
        assert rows.status_code == 200, rows.text
        assert rows.json()
        session_id = rows.json()[0]["id"]
        revoked = client.delete(f"/api/v1/me/sessions/{session_id}", headers=headers)
        assert revoked.status_code == 204
        reuse = client.post("/api/v1/auth/refresh", json={"refresh_token": reg.json()["refresh_token"]})
        assert reuse.status_code == 401


def test_password_change_revokes_existing_refresh_sessions():
    with TestClient(app) as client:
        email = f"pwd-{uuid.uuid4().hex[:8]}@example.com"
        reg = client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": "strong-pass-123", "display_name": "Password User"},
        )
        headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
        changed = client.post(
            "/api/v1/me/password",
            headers=headers,
            json={"current_password": "strong-pass-123", "new_password": "new-strong-pass-456"},
        )
        assert changed.status_code == 204, changed.text
        old_refresh = client.post("/api/v1/auth/refresh", json={"refresh_token": reg.json()["refresh_token"]})
        assert old_refresh.status_code == 401
        old_login = client.post("/api/v1/auth/login", json={"email": email, "password": "strong-pass-123"})
        assert old_login.status_code == 401
        new_login = client.post("/api/v1/auth/login", json={"email": email, "password": "new-strong-pass-456"})
        assert new_login.status_code == 200


def test_password_reset_debug_flow_is_one_time_and_revokes_sessions():
    from urllib.parse import parse_qs, urlparse

    with TestClient(app) as client:
        email = f"reset-{uuid.uuid4().hex[:8]}@example.com"
        reg = client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": "strong-pass-123", "display_name": "Reset User"},
        )
        requested = client.post("/api/v1/auth/password-reset/request", json={"email": email})
        assert requested.status_code == 200
        body = requested.json()
        assert body["status"] == "accepted"
        assert "debug_reset_url" in body
        token = parse_qs(urlparse(body["debug_reset_url"]).query)["token"][0]
        confirmed = client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": token, "new_password": "reset-pass-456"},
        )
        assert confirmed.status_code == 200, confirmed.text
        second = client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": token, "new_password": "reset-pass-789"},
        )
        assert second.status_code == 400
        old_refresh = client.post("/api/v1/auth/refresh", json={"refresh_token": reg.json()["refresh_token"]})
        assert old_refresh.status_code == 401
        login = client.post("/api/v1/auth/login", json={"email": email, "password": "reset-pass-456"})
        assert login.status_code == 200


def test_profile_update_and_account_export():
    with TestClient(app) as client:
        headers = _auth_headers(client, f"export-{uuid.uuid4().hex[:8]}@example.com")
        patched = client.patch("/api/v1/me", headers=headers, json={"display_name": "UVMS Export Tester"})
        assert patched.status_code == 200
        assert patched.json()["display_name"] == "UVMS Export Tester"
        exported = client.get("/api/v1/me/export", headers=headers)
        assert exported.status_code == 200, exported.text
        body = exported.json()
        assert body["user"]["display_name"] == "UVMS Export Tester"
        assert body["subscription"]["plan_code"] in {"free", "plus", "pro"}


def test_file_delete_removes_owned_asset():
    with TestClient(app) as client:
        headers = _auth_headers(client, f"delete-file-{uuid.uuid4().hex[:8]}@example.com")
        upload = client.post(
            "/api/v1/files",
            headers=headers,
            files={"upload": ("delete-me.txt", b"temporary UVMS data", "text/plain")},
        )
        assert upload.status_code == 201, upload.text
        file_id = upload.json()["id"]
        deleted = client.delete(f"/api/v1/files/{file_id}", headers=headers)
        assert deleted.status_code == 204
        missing = client.get(f"/api/v1/files/{file_id}", headers=headers)
        assert missing.status_code == 404


def test_invalid_image_signature_is_rejected():
    with TestClient(app) as client:
        headers = _auth_headers(client, f"invalid-image-{uuid.uuid4().hex[:8]}@example.com")
        upload = client.post(
            "/api/v1/files",
            headers=headers,
            files={"upload": ("not-really.png", b"this is not a png", "image/png")},
        )
        assert upload.status_code == 415


def test_health_readiness_and_metrics_endpoints():
    with TestClient(app) as client:
        assert client.get("/live").status_code == 200
        ready = client.get("/ready")
        assert ready.status_code == 200, ready.text
        assert ready.json()["status"] == "ready"
        metrics = client.get("/metrics")
        assert metrics.status_code == 200
        assert "uvms_http_requests_total" in metrics.text


def test_account_delete_invalidates_access_token():
    with TestClient(app) as client:
        headers = _auth_headers(client, f"delete-account-{uuid.uuid4().hex[:8]}@example.com")
        deleted = client.delete("/api/v1/me", headers=headers)
        assert deleted.status_code == 204, deleted.text
        me = client.get("/api/v1/me", headers=headers)
        assert me.status_code == 401
