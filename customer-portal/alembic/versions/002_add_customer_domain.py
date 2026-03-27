"""Add domain column to customer table.

Revision ID: 002
Create Date: 2026-03-27
"""

from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("customer", sa.Column("domain", sa.String(255), nullable=True))
    # Backfill existing rows with empty string, then make non-nullable
    op.execute("UPDATE customer SET domain = '' WHERE domain IS NULL")
    op.alter_column("customer", "domain", nullable=False)


def downgrade() -> None:
    op.drop_column("customer", "domain")
