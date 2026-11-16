"""shared footprint on sites

Revision ID: 004_site_footprint
Revises: 003_scenes_and_site_product
Create Date: 2026-11-15

GCOV sites record the area every pass imaged, over which open water is
compared (scripts/shared_footprint.py).
"""
from alembic import op
import sqlalchemy as sa


revision = '004_site_footprint'
down_revision = '003_scenes_and_site_product'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.add_column(sa.Column('footprint', sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.drop_column('footprint')
