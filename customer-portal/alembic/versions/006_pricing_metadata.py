"""Add metadata_field and metadata_value to resource_price for per-flavor pricing.

Revision ID: 006
Create Date: 2026-03-27
"""

from alembic import op
import sqlalchemy as sa

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("resource_price", sa.Column("metadata_field", sa.String(100), nullable=True))
    op.add_column("resource_price", sa.Column("metadata_value", sa.String(255), nullable=True))
    # Drop old unique constraint on resource_type alone
    op.drop_constraint("resource_price_resource_type_key", "resource_price", type_="unique")
    # New unique constraint on the triple
    op.create_unique_constraint(
        "uq_resource_price_type_meta",
        "resource_price",
        ["resource_type", "metadata_field", "metadata_value"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_resource_price_type_meta", "resource_price", type_="unique")
    op.create_unique_constraint(
        "resource_price_resource_type_key", "resource_price", ["resource_type"]
    )
    op.drop_column("resource_price", "metadata_value")
    op.drop_column("resource_price", "metadata_field")
