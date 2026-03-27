"""Add updated_at, pricing tables, and contract rebates.

Revision ID: 003
Create Date: 2026-03-27
"""

from alembic import op
import sqlalchemy as sa

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add updated_at to customer and contract
    op.add_column("customer", sa.Column("updated_at", sa.DateTime(), nullable=True))
    op.add_column("contract", sa.Column("updated_at", sa.DateTime(), nullable=True))

    # Global default prices per resource type
    op.create_table(
        "resource_price",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("resource_type", sa.String(100), unique=True, nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("unit", sa.String(50), nullable=False),
    )

    # Per-contract price overrides
    op.create_table(
        "contract_price_override",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("contract_id", sa.Integer(), sa.ForeignKey("contract.id"), nullable=False),
        sa.Column("resource_type", sa.String(100), nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.UniqueConstraint("contract_id", "resource_type", name="uq_contract_resource_price"),
    )

    # Per-contract rebate percentage
    op.create_table(
        "contract_rebate",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("contract_id", sa.Integer(), sa.ForeignKey("contract.id"), unique=True, nullable=False),
        sa.Column("rebate_percent", sa.Numeric(5, 2), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("contract_rebate")
    op.drop_table("contract_price_override")
    op.drop_table("resource_price")
    op.drop_column("contract", "updated_at")
    op.drop_column("customer", "updated_at")
