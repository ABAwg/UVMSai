from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: EmailStr
    display_name: str
    role: str
    created_at: datetime


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(default="UVMS User", min_length=1, max_length=120)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class RefreshIn(BaseModel):
    refresh_token: str | None = None


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    user: UserOut


class ChatCreate(BaseModel):
    title: str = Field(default="New chat", max_length=180)
    model_id: str = Field(default="uvms-1-balanced", max_length=80)
    project_id: str | None = None
    is_temporary: bool = False


class ChatPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    model_id: str | None = Field(default=None, max_length=80)
    is_archived: bool | None = None
    is_pinned: bool | None = None


class ChatOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    model_id: str
    is_archived: bool
    is_pinned: bool
    is_temporary: bool
    expires_at: datetime | None
    created_at: datetime
    updated_at: datetime


class FileAssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    original_name: str
    mime_type: str
    category: str
    size_bytes: int
    created_at: datetime


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    role: str
    content: str
    model_id: str | None
    created_at: datetime
    attachments: list[FileAssetOut] = Field(default_factory=list)
    meta: dict = Field(default_factory=dict)


class ChatDetail(ChatOut):
    messages: list[MessageOut]
    project: dict[str, str] | None = None


class ChatPromptIn(BaseModel):
    chat_id: str | None = None
    retry_message_id: str | None = None
    content: str = Field(default="", max_length=50_000)
    model_id: str = Field(default="uvms-1-balanced", max_length=80)
    attachment_ids: list[str] = Field(default_factory=list, max_length=8)
    web_search: bool = False
    project_id: str | None = None
    temporary: bool = False


class ChatForkIn(BaseModel):
    through_message_id: str | None = None
    title: str | None = Field(default=None, min_length=1, max_length=180)


class SharedChatOut(BaseModel):
    id: str
    url_token: str
    title: str
    created_at: datetime
    expires_at: datetime | None = None


class SharedChatRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    source_chat_id: str | None = None
    title: str
    created_at: datetime
    expires_at: datetime | None = None
    revoked_at: datetime | None = None


class SharedChatPublic(BaseModel):
    title: str
    created_at: datetime
    messages: list[dict]


class MessageEditIn(BaseModel):
    content: str = Field(min_length=1, max_length=50_000)
    model_id: str | None = Field(default=None, max_length=80)


class RegenerateIn(BaseModel):
    model_id: str | None = Field(default=None, max_length=80)


class CompleteOut(BaseModel):
    chat_id: str
    answer: str
    meta: dict = Field(default_factory=dict)


class ModelInfo(BaseModel):
    id: str
    name: str
    description: str
    tier: str
    available: bool = True


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=140)
    description: str = Field(default="", max_length=2_000)
    instructions: str = Field(default="", max_length=12_000)


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=140)
    description: str | None = Field(default=None, max_length=2_000)
    instructions: str | None = Field(default=None, max_length=12_000)


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    description: str
    instructions: str
    created_at: datetime
    updated_at: datetime


class MemoryCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4_000)


class MemoryPatch(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=4_000)
    is_enabled: bool | None = None


class MemoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    content: str
    is_enabled: bool
    source: str
    created_at: datetime
    updated_at: datetime


class ImageGenerateIn(BaseModel):
    prompt: str = Field(min_length=3, max_length=4_000)
    chat_id: str | None = None
    project_id: str | None = None
    temporary: bool = False
    size: str = Field(default="1024x1024", pattern=r"^(1024x1024|1536x1024|1024x1536)$")
    quality: str = Field(default="medium", pattern=r"^(low|medium|high)$")


class ImageGenerateOut(BaseModel):
    chat_id: str
    message: MessageOut
    asset: FileAssetOut
    demo: bool = False


class PlanPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    monthly_price_cents: int | None = Field(default=None, ge=0, le=10_000_000)
    currency: str | None = Field(default=None, min_length=3, max_length=8)
    limits: dict | None = None
    is_active: bool | None = None


class SubscriptionPatch(BaseModel):
    plan_code: str = Field(min_length=1, max_length=40)
    status: str = Field(default="active", min_length=1, max_length=30)


class UserAdminPatch(BaseModel):
    is_active: bool | None = None
    role: str | None = Field(default=None, pattern=r"^(user|admin)$")


class AiModelPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    provider_model: str | None = Field(default=None, min_length=1, max_length=160)
    reasoning_effort: str | None = Field(default=None, pattern=r"^(none|low|medium|high)$")
    min_plan: str | None = Field(default=None, pattern=r"^(free|plus|pro|business)$")
    is_enabled: bool | None = None
    supports_web_search: bool | None = None
    supports_vision: bool | None = None


class CheckoutCreate(BaseModel):
    plan_code: str = Field(min_length=1, max_length=40)


class CheckoutOut(BaseModel):
    id: str
    plan_code: str
    provider: str
    status: str
    amount_cents: int
    currency: str
    checkout_url: str | None = None
    created_at: datetime


class TranscriptionOut(BaseModel):
    text: str
    demo: bool = False


class ProfilePatch(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class PasswordResetRequestIn(BaseModel):
    email: EmailStr


class PasswordResetConfirmIn(BaseModel):
    token: str = Field(min_length=20, max_length=500)
    new_password: str = Field(min_length=8, max_length=128)


class RefreshSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    user_agent: str | None
    ip_address: str | None
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None


class AccountExportOut(BaseModel):
    generated_at: datetime
    user: dict
    subscription: dict
    chats: list[dict]
    projects: list[dict]
    memory: list[dict]
    files: list[dict]
