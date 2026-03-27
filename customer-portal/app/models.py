"""SQLAlchemy ORM models for the customer portal."""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Customer(Base):
    __tablename__ = "customer"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    domain: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, onupdate=func.now())

    contracts: Mapped[list["Contract"]] = relationship(back_populates="customer")


class Contract(Base):
    __tablename__ = "contract"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id"), nullable=False)
    contract_number: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, onupdate=func.now())

    customer: Mapped["Customer"] = relationship(back_populates="contracts")
    access_grants: Mapped[list["ContractAccess"]] = relationship(
        back_populates="contract", cascade="all, delete-orphan"
    )
    price_overrides: Mapped[list["ContractPriceOverride"]] = relationship(
        back_populates="contract", cascade="all, delete-orphan"
    )
    rebate: Mapped["ContractRebate | None"] = relationship(
        back_populates="contract", uselist=False, cascade="all, delete-orphan"
    )


class ContractAccess(Base):
    __tablename__ = "contract_access"
    __table_args__ = (
        UniqueConstraint("contract_id", "user_sub", name="uq_contract_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("contract.id"), nullable=False)
    user_sub: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    contract: Mapped["Contract"] = relationship(back_populates="access_grants")


class ResourcePrice(Base):
    """Global default price per resource type."""

    __tablename__ = "resource_price"

    id: Mapped[int] = mapped_column(primary_key=True)
    resource_type: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    unit: Mapped[str] = mapped_column(String(50), nullable=False)


class ContractPriceOverride(Base):
    """Per-contract price override for a resource type."""

    __tablename__ = "contract_price_override"
    __table_args__ = (
        UniqueConstraint("contract_id", "resource_type", name="uq_contract_resource_price"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("contract.id"), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(100), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    contract: Mapped["Contract"] = relationship(back_populates="price_overrides")


class ContractRebate(Base):
    """Per-contract rebate percentage."""

    __tablename__ = "contract_rebate"

    id: Mapped[int] = mapped_column(primary_key=True)
    contract_id: Mapped[int] = mapped_column(
        ForeignKey("contract.id"), unique=True, nullable=False
    )
    rebate_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)

    contract: Mapped["Contract"] = relationship(back_populates="rebate")
