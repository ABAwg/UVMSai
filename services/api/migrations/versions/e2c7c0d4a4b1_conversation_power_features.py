"""conversation power features

Revision ID: e2c7c0d4a4b1
Revises: d71b2e41aa11
Create Date: 2026-09-19
"""
from alembic import op
import sqlalchemy as sa

revision = 'e2c7c0d4a4b1'
down_revision = 'd71b2e41aa11'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('chats') as batch:
        batch.add_column(sa.Column('is_pinned', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column('is_temporary', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True))
        batch.create_index('ix_chats_is_pinned', ['is_pinned'], unique=False)
        batch.create_index('ix_chats_is_temporary', ['is_temporary'], unique=False)
        batch.create_index('ix_chats_expires_at', ['expires_at'], unique=False)

    op.create_table(
        'shared_chats',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('owner_user_id', sa.String(length=36), nullable=False),
        sa.Column('source_chat_id', sa.String(length=36), nullable=True),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('title', sa.String(length=180), nullable=False),
        sa.Column('snapshot', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['source_chat_id'], ['chats.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token_hash'),
    )
    op.create_index('ix_shared_chats_owner_user_id', 'shared_chats', ['owner_user_id'], unique=False)
    op.create_index('ix_shared_chats_source_chat_id', 'shared_chats', ['source_chat_id'], unique=False)
    op.create_index('ix_shared_chats_token_hash', 'shared_chats', ['token_hash'], unique=True)
    op.create_index('ix_shared_chats_created_at', 'shared_chats', ['created_at'], unique=False)
    op.create_index('ix_shared_chats_expires_at', 'shared_chats', ['expires_at'], unique=False)
    op.create_index('ix_shared_chats_revoked_at', 'shared_chats', ['revoked_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_shared_chats_revoked_at', table_name='shared_chats')
    op.drop_index('ix_shared_chats_expires_at', table_name='shared_chats')
    op.drop_index('ix_shared_chats_created_at', table_name='shared_chats')
    op.drop_index('ix_shared_chats_token_hash', table_name='shared_chats')
    op.drop_index('ix_shared_chats_source_chat_id', table_name='shared_chats')
    op.drop_index('ix_shared_chats_owner_user_id', table_name='shared_chats')
    op.drop_table('shared_chats')
    with op.batch_alter_table('chats') as batch:
        batch.drop_index('ix_chats_expires_at')
        batch.drop_index('ix_chats_is_temporary')
        batch.drop_index('ix_chats_is_pinned')
        batch.drop_column('expires_at')
        batch.drop_column('is_temporary')
        batch.drop_column('is_pinned')
