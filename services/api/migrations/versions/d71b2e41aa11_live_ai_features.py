"""Live provider feature controls. Accounting extends existing UsageEvent metadata."""
from alembic import op
import sqlalchemy as sa
revision = 'd71b2e41aa11'
down_revision = 'c64f1f9a1a10'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('ai_features', sa.Column('id',sa.String(30),primary_key=True),sa.Column('is_enabled',sa.Boolean(),nullable=False))

def downgrade():
    op.drop_table('ai_features')
