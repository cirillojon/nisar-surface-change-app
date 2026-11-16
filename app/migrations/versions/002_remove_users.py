"""remove users and site ownership

Revision ID: 002_remove_users
Revises: 001_initial_schema
Create Date: 2026-11-14

Sign-in was removed, so drop ``sites.owner_id`` (index + FK) and the
``users`` table. Sites that had an owner are kept.
"""
from alembic import op
import sqlalchemy as sa


revision = '002_remove_users'
down_revision = '001_initial_schema'
branch_labels = None
depends_on = None

_OWNER_FK = 'fk_sites_owner_id_users'


def upgrade():
    # 001 created the FK unnamed: SQLite keeps it nameless (batch mode
    # drops it with the column), other databases give it a generated name.
    fk_names = [
        fk['name']
        for fk in sa.inspect(op.get_bind()).get_foreign_keys('sites')
        if fk['referred_table'] == 'users' and fk['name']
    ]
    with op.batch_alter_table('sites', schema=None) as batch_op:
        for name in fk_names:
            batch_op.drop_constraint(name, type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_sites_owner_id'))
        batch_op.drop_column('owner_id')

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_firebase_uid'))
    op.drop_table('users')


def downgrade():
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

    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.add_column(sa.Column('owner_id', sa.Integer(), nullable=True))
        batch_op.create_index(
            batch_op.f('ix_sites_owner_id'), ['owner_id'], unique=False,
        )
        batch_op.create_foreign_key(_OWNER_FK, 'users', ['owner_id'], ['id'])
