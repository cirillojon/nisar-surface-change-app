"""scenes table and NISAR product fields on sites

Revision ID: 003_scenes_and_site_product
Revises: 002_remove_users
Create Date: 2026-11-14

Sites now carry the NISAR product/frame their values come from (and, for
interferometry sites, the stable reference point and image colour range).
Each NISAR pass over a site is a ``scenes`` row with a small image.
"""
from alembic import op
import sqlalchemy as sa


revision = '003_scenes_and_site_product'
down_revision = '002_remove_users'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.add_column(sa.Column('product', sa.String(length=8), nullable=True))
        batch_op.add_column(sa.Column('frame', sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column('reference_lon', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('reference_lat', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('image_range', sa.Float(), nullable=True))

    op.create_table(
        'scenes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('site_id', sa.Integer(), nullable=False),
        sa.Column('acquired_on', sa.Date(), nullable=False),
        sa.Column('granule_id', sa.String(length=255), nullable=True),
        sa.Column('quality', sa.String(length=16), nullable=True),
        sa.Column('valid_pct', sa.Float(), nullable=True),
        sa.Column('image', sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(['site_id'], ['sites.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('scenes', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_scenes_site_id'), ['site_id'], unique=False)


def downgrade():
    with op.batch_alter_table('scenes', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_scenes_site_id'))
    op.drop_table('scenes')

    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.drop_column('image_range')
        batch_op.drop_column('reference_lat')
        batch_op.drop_column('reference_lon')
        batch_op.drop_column('frame')
        batch_op.drop_column('product')
