from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import Chat, SharedChat


def auth_headers(client: TestClient, email: str) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "strong-pass-123", "display_name": "Power QA"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def create_answered_chat(client: TestClient, headers: dict[str, str], title: str = "Power chat") -> str:
    created = client.post("/api/v1/chats", headers=headers, json={"title": title, "model_id": "uvms-1-balanced"})
    assert created.status_code == 201, created.text
    chat_id = created.json()["id"]
    completed = client.post(
        "/api/v1/chat/complete",
        headers=headers,
        json={"chat_id": chat_id, "content": "Remember branch point", "model_id": "uvms-1-balanced"},
    )
    assert completed.status_code == 200, completed.text
    return chat_id


def test_pinned_chats_sort_first_and_unpin_when_archived():
    with TestClient(app) as client:
        headers = auth_headers(client, "pin-power@example.com")
        first = client.post("/api/v1/chats", headers=headers, json={"title": "First"}).json()
        second = client.post("/api/v1/chats", headers=headers, json={"title": "Pinned"}).json()
        pinned = client.patch(f"/api/v1/chats/{second['id']}", headers=headers, json={"is_pinned": True})
        assert pinned.status_code == 200
        assert pinned.json()["is_pinned"] is True

        rows = client.get("/api/v1/chats", headers=headers).json()
        assert rows[0]["id"] == second["id"]
        assert rows[0]["is_pinned"] is True

        archived = client.patch(
            f"/api/v1/chats/{second['id']}", headers=headers, json={"is_archived": True}
        )
        assert archived.status_code == 200
        assert archived.json()["is_pinned"] is False
        assert first["id"] in {row["id"] for row in client.get("/api/v1/chats", headers=headers).json()}


def test_temporary_chat_is_hidden_and_expires():
    with TestClient(app) as client:
        headers = auth_headers(client, "temporary-power@example.com")
        completed = client.post(
            "/api/v1/chat/complete",
            headers=headers,
            json={
                "chat_id": None,
                "content": "Temporary hello",
                "model_id": "uvms-1-balanced",
                "temporary": True,
            },
        )
        assert completed.status_code == 200, completed.text
        chat_id = completed.json()["chat_id"]
        detail = client.get(f"/api/v1/chats/{chat_id}", headers=headers)
        assert detail.status_code == 200
        assert detail.json()["is_temporary"] is True
        assert detail.json()["expires_at"]
        assert all(row["id"] != chat_id for row in client.get("/api/v1/chats", headers=headers).json())

        share = client.post(f"/api/v1/chats/{chat_id}/share", headers=headers)
        assert share.status_code == 422

        with SessionLocal() as db:
            chat = db.get(Chat, chat_id)
            assert chat is not None
            chat.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
            db.commit()
        assert client.get(f"/api/v1/chats/{chat_id}", headers=headers).status_code == 404


def test_fork_chat_copies_prefix_without_mutating_source():
    with TestClient(app) as client:
        headers = auth_headers(client, "fork-power@example.com")
        chat_id = create_answered_chat(client, headers)
        original = client.get(f"/api/v1/chats/{chat_id}", headers=headers).json()
        user_message = next(message for message in original["messages"] if message["role"] == "user")

        fork = client.post(
            f"/api/v1/chats/{chat_id}/fork",
            headers=headers,
            json={"through_message_id": user_message["id"], "title": "Alternative path"},
        )
        assert fork.status_code == 201, fork.text
        body = fork.json()
        assert body["id"] != chat_id
        assert body["title"] == "Alternative path"
        assert len(body["messages"]) == 1
        assert body["messages"][0]["content"] == user_message["content"]

        reloaded = client.get(f"/api/v1/chats/{chat_id}", headers=headers).json()
        assert len(reloaded["messages"]) == len(original["messages"])


def test_shared_chat_is_immutable_public_snapshot_and_revocable():
    with TestClient(app) as client:
        headers = auth_headers(client, "share-power@example.com")
        chat_id = create_answered_chat(client, headers, "Share me")
        shared = client.post(f"/api/v1/chats/{chat_id}/share", headers=headers)
        assert shared.status_code == 201, shared.text
        token = shared.json()["url_token"]
        share_id = shared.json()["id"]

        public = client.get(f"/api/v1/public/shares/{token}")
        assert public.status_code == 200
        snapshot = public.json()
        assert snapshot["title"] == "Share me"
        assert len(snapshot["messages"]) == 2

        client.patch(f"/api/v1/chats/{chat_id}", headers=headers, json={"title": "Changed later"})
        public_again = client.get(f"/api/v1/public/shares/{token}")
        assert public_again.json()["title"] == "Share me"

        shares = client.get(f"/api/v1/chats/{chat_id}/shares", headers=headers)
        assert shares.status_code == 200
        assert shares.json()[0]["id"] == share_id
        # The raw public token is intentionally never recoverable from list APIs.
        assert "url_token" not in shares.json()[0]

        revoked = client.delete(f"/api/v1/shares/{share_id}", headers=headers)
        assert revoked.status_code == 204
        assert client.get(f"/api/v1/public/shares/{token}").status_code == 404
        with SessionLocal() as db:
            row = db.scalar(select(SharedChat).where(SharedChat.id == share_id))
            assert row is not None and row.token_hash != token


def test_chat_markdown_export():
    with TestClient(app) as client:
        headers = auth_headers(client, "export-power@example.com")
        chat_id = create_answered_chat(client, headers, "Export title")
        export = client.get(f"/api/v1/chats/{chat_id}/export?format=markdown", headers=headers)
        assert export.status_code == 200
        assert export.headers["content-type"].startswith("text/markdown")
        assert "# Export title" in export.text
        assert "## You" in export.text
        assert "## UVMS AI" in export.text


def test_global_share_management_is_owner_scoped_and_can_revoke_all():
    with TestClient(app) as client:
        owner = auth_headers(client, "share-manager@example.com")
        other = auth_headers(client, "share-manager-other@example.com")
        first_chat = create_answered_chat(client, owner, "First shared")
        second_chat = create_answered_chat(client, owner, "Second shared")
        other_chat = create_answered_chat(client, other, "Other person's share")

        first = client.post(f"/api/v1/chats/{first_chat}/share", headers=owner).json()
        second = client.post(f"/api/v1/chats/{second_chat}/share", headers=owner).json()
        client.post(f"/api/v1/chats/{other_chat}/share", headers=other)

        listing = client.get("/api/v1/shares", headers=owner)
        assert listing.status_code == 200, listing.text
        rows = listing.json()
        assert {row["id"] for row in rows} == {first["id"], second["id"]}
        assert {row["source_chat_id"] for row in rows} == {first_chat, second_chat}
        assert all(row["revoked_at"] is None for row in rows)

        revoked = client.delete("/api/v1/shares", headers=owner)
        assert revoked.status_code == 204, revoked.text
        assert client.get("/api/v1/shares", headers=owner).json() == []
        history = client.get("/api/v1/shares?include_revoked=true", headers=owner).json()
        assert len(history) == 2
        assert all(row["revoked_at"] for row in history)

        # Another user's public share remains active and private management stays isolated.
        assert len(client.get("/api/v1/shares", headers=other).json()) == 1
