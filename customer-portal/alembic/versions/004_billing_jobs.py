"""Add billing job tables.

Revision ID: 004
Create Date: 2026-03-27
"""

from alembic import op
import sqlalchemy as sa

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "billing_job",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("owner_sub", sa.String(255), nullable=False),
        sa.Column("all_contracts", sa.Boolean(), server_default="false"),
        sa.Column("schedule", sa.String(100), nullable=False),
        sa.Column("delivery_method", sa.String(50), nullable=False),
        sa.Column("delivery_config", sa.Text(), nullable=False),
        sa.Column("filename_template", sa.String(255), server_default="billing-{year}-{month}.csv"),
        sa.Column("per_contract", sa.Boolean(), server_default="false"),
        sa.Column("enabled", sa.Boolean(), server_default="true"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "billing_job_contract",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "billing_job_id",
            sa.Integer(),
            sa.ForeignKey("billing_job.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "contract_id",
            sa.Integer(),
            sa.ForeignKey("contract.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.UniqueConstraint("billing_job_id", "contract_id", name="uq_billing_job_contract"),
    )

    op.create_table(
        "billing_job_run",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "billing_job_id",
            sa.Integer(),
            sa.ForeignKey("billing_job.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("billing_period_start", sa.DateTime(), nullable=False),
        sa.Column("billing_period_end", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(20), server_default="running"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("files_delivered", sa.Integer(), server_default="0"),
    )


def downgrade() -> None:
    op.drop_table("billing_job_run")
    op.drop_table("billing_job_contract")
    op.drop_table("billing_job")
