"""Drop conversion_factor from resource_price (auto-detected from Gnocchi now).

Revision ID: 007
Create Date: 2026-03-27
"""

from alembic import op

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("resource_price", "conversion_factor")


def downgrade() -> None:
    import sqlalchemy as sa
    op.add_column(
        "resource_price",
        sa.Column("conversion_factor", sa.Numeric(12, 6), server_default="1", nullable=False),
    )
