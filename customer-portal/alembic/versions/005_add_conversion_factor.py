"""Add conversion_factor to resource_price.

Revision ID: 005
Create Date: 2026-03-27
"""

from alembic import op
import sqlalchemy as sa

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "resource_price",
        sa.Column("conversion_factor", sa.Numeric(12, 6), server_default="1", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("resource_price", "conversion_factor")
