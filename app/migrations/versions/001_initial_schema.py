"""initial schema

Revision ID: 001_initial_schema
Revises:
Create Date: 2026-04-24

Creates ``users``, ``sites``, ``observations`` and ``load_jobs``.
Add new revisions on top with ``flask db migrate -m "..."``.
"""
from alembic import op
import sqlalchemy as sa


revision = '001_initial_schema'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('firebase_uid', sa.String(length=128), nullable=False),
        sa.Column('email', sa.String(length=120), nullable=True),
        sa.Column('display_name', sa.String(length=120), nullable=True),
        sa.Column('avatar_url', sa.String(length=500), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_users_firebase_uid'),
            ['firebase_uid'], unique=True,
        )

    op.create_table(
        'sites',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('slug', sa.String(length=80), nullable=True),
        sa.Column('owner_id', sa.Integer(), nullable=True),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('change_type', sa.String(length=32), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('latitude', sa.Float(), nullable=False),
        sa.Column('longitude', sa.Float(), nullable=False),
        sa.Column('min_lon', sa.Float(), nullable=False),
        sa.Column('min_lat', sa.Float(), nullable=False),
        sa.Column('max_lon', sa.Float(), nullable=False),
        sa.Column('max_lat', sa.Float(), nullable=False),
        sa.Column('event_date', sa.Date(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_sites_change_type'), ['change_type'], unique=False,
        )
        batch_op.create_index(
            batch_op.f('ix_sites_owner_id'), ['owner_id'], unique=False,
        )
        batch_op.create_index(
            batch_op.f('ix_sites_slug'), ['slug'], unique=True,
        )

    op.create_table(
        'observations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('site_id', sa.Integer(), nullable=False),
        sa.Column('observed_on', sa.Date(), nullable=False),
        sa.Column('metric', sa.String(length=64), nullable=False),
        sa.Column('value', sa.Float(), nullable=False),
        sa.Column('unit', sa.String(length=16), nullable=False),
        sa.Column('source', sa.String(length=32), nullable=False),
        sa.Column('granule_id', sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('observations', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_observations_site_id'), ['site_id'], unique=False,
        )

    op.create_table(
        'load_jobs',
        sa.Column('source_id', sa.String(length=50), nullable=False),
        sa.Column('last_attempt_at', sa.DateTime(), nullable=True),
        sa.Column('last_success_at', sa.DateTime(), nullable=True),
        sa.Column('item_count', sa.Integer(), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint('source_id'),
    )


def downgrade():
    op.drop_table('load_jobs')
    with op.batch_alter_table('observations', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_observations_site_id'))
    op.drop_table('observations')
    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_sites_slug'))
        batch_op.drop_index(batch_op.f('ix_sites_owner_id'))
        batch_op.drop_index(batch_op.f('ix_sites_change_type'))
    op.drop_table('sites')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_firebase_uid'))
    op.drop_table('users')
