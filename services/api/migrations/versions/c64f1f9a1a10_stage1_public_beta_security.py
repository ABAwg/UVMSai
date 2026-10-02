"""stage1 public beta security

Revision ID: c64f1f9a1a10
Revises: 9cf77a17f798
Create Date: 2026-09-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c64f1f9a1a10"
down_revision: Union[str, Sequence[str], None] = "9cf77a17f798"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("refresh_sessions") as batch_op:
        batch_op.add_column(sa.Column("ip_address", sa.String(length=64), nullable=True))

    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("password_reset_tokens") as batch_op:
        batch_op.create_index(batch_op.f("ix_password_reset_tokens_user_id"), ["user_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_password_reset_tokens_token_hash"), ["token_hash"], unique=True)
        batch_op.create_index(batch_op.f("ix_password_reset_tokens_expires_at"), ["expires_at"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("password_reset_tokens") as batch_op:
        batch_op.drop_index(batch_op.f("ix_password_reset_tokens_expires_at"))
        batch_op.drop_index(batch_op.f("ix_password_reset_tokens_token_hash"))
        batch_op.drop_index(batch_op.f("ix_password_reset_tokens_user_id"))
    op.drop_table("password_reset_tokens")
    with op.batch_alter_table("refresh_sessions") as batch_op:
        batch_op.drop_column("ip_address")
