"""Price managed-cluster operations by package rather than node count.

Revision ID: 013
Revises: 012
Create Date: 2026-09-07
"""

from decimal import Decimal

import sqlalchemy as sa

from alembic import op

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Replace the old per-node fee with price-list package fees.

    Each fee is the Kubernetes list price less the standard profile's baseline
    VM and boot-volume costs. Actual VM flavors and volume use remain metered
    independently. The increment extends the XXXL package linearly for larger
    clusters, which have no published package price.
    """
    resource_price = sa.table(
        "resource_price",
        sa.column("resource_type", sa.String),
        sa.column("unit_price", sa.Numeric),
        sa.column("unit", sa.String),
        sa.column("metadata_field", sa.String),
        sa.column("metadata_value", sa.String),
    )
    op.execute(
        "DELETE FROM resource_price WHERE resource_type IN "
        "('cluster_management_fee', 'cluster_management_fee_increment')"
    )
    op.bulk_insert(
        resource_price,
        [
            {
                "resource_type": "cluster_management_fee",
                "unit_price": Decimal("5227.40"),
                "unit": "cluster-month",
                "metadata_field": "worker_groups",
                "metadata_value": "1",
            },
            {
                "resource_type": "cluster_management_fee",
                "unit_price": Decimal("8133.40"),
                "unit": "cluster-month",
                "metadata_field": "worker_groups",
                "metadata_value": "2",
            },
            {
                "resource_type": "cluster_management_fee",
                "unit_price": Decimal("10739.40"),
                "unit": "cluster-month",
                "metadata_field": "worker_groups",
                "metadata_value": "3",
            },
            {
                "resource_type": "cluster_management_fee",
                "unit_price": Decimal("13445.40"),
                "unit": "cluster-month",
                "metadata_field": "worker_groups",
                "metadata_value": "4",
            },
            {
                "resource_type": "cluster_management_fee",
                "unit_price": Decimal("16251.40"),
                "unit": "cluster-month",
                "metadata_field": "worker_groups",
                "metadata_value": "5",
            },
            {
                "resource_type": "cluster_management_fee",
                "unit_price": Decimal("19057.40"),
                "unit": "cluster-month",
                "metadata_field": "worker_groups",
                "metadata_value": "6",
            },
            {
                "resource_type": "cluster_management_fee_increment",
                "unit_price": Decimal("2806.00"),
                "unit": "worker-group",
                "metadata_field": None,
                "metadata_value": None,
            },
        ],
    )


def downgrade() -> None:
    resource_price = sa.table(
        "resource_price",
        sa.column("resource_type", sa.String),
        sa.column("unit_price", sa.Numeric),
        sa.column("unit", sa.String),
        sa.column("metadata_field", sa.String),
        sa.column("metadata_value", sa.String),
    )
    op.execute(
        "DELETE FROM resource_price WHERE resource_type IN "
        "('cluster_management_fee', 'cluster_management_fee_increment')"
    )
    op.bulk_insert(
        resource_price,
        [
            {
                "resource_type": "cluster_management_fee",
                "unit_price": 500,
                "unit": "vm-month",
                "metadata_field": None,
                "metadata_value": None,
            }
        ],
    )
