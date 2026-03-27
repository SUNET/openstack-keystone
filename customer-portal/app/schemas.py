"""Pydantic request/response schemas."""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


# --- Admin: Customers ---


class CreateCustomerRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    domain: str = Field(min_length=1, max_length=255, pattern=r"^[a-z0-9.-]+$")
    description: str = ""


class UpdateCustomerRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    domain: str | None = Field(default=None, min_length=1, max_length=255, pattern=r"^[a-z0-9.-]+$")
    description: str | None = None


class CustomerResponse(BaseModel):
    id: int
    name: str
    domain: str
    description: str
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class CustomerDetailResponse(CustomerResponse):
    contracts: list["ContractResponse"] = []


# --- Admin: Contracts ---


class CreateContractRequest(BaseModel):
    customer_id: int
    contract_number: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9-]+$")
    description: str = ""


class UpdateContractRequest(BaseModel):
    description: str | None = None


class ContractResponse(BaseModel):
    id: int
    customer_id: int
    contract_number: str
    description: str
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class ContractWithCustomerResponse(ContractResponse):
    customer: CustomerResponse


class ContractDetailResponse(ContractResponse):
    customer: CustomerResponse
    users: list[str] = []
    rebate_percent: Decimal | None = None


# --- Admin: Contract Access ---


class GrantAccessRequest(BaseModel):
    user_sub: str = Field(min_length=1, max_length=255)


# --- Admin: Pricing ---


class ResourcePriceRequest(BaseModel):
    resource_type: str = Field(min_length=1, max_length=100)
    unit_price: Decimal = Field(ge=0)
    unit: str = Field(min_length=1, max_length=50)


class ResourcePriceResponse(BaseModel):
    id: int
    resource_type: str
    unit_price: Decimal
    unit: str

    model_config = {"from_attributes": True}


class ContractPriceOverrideRequest(BaseModel):
    resource_type: str = Field(min_length=1, max_length=100)
    unit_price: Decimal = Field(ge=0)


class ContractPriceOverrideResponse(BaseModel):
    id: int
    contract_id: int
    resource_type: str
    unit_price: Decimal

    model_config = {"from_attributes": True}


class ContractRebateRequest(BaseModel):
    rebate_percent: Decimal = Field(ge=0, le=100)


# --- Customer: Projects ---


class CreateProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$")
    description: str = ""
    users: list[str] = Field(default_factory=list)


class UpdateProjectRequest(BaseModel):
    description: str | None = None
    users: list[str] | None = None


class ProjectResponse(BaseModel):
    resource_name: str
    name: str
    description: str
    contract_number: str
    users: list[str]
    phase: str | None = None


# --- Auth ---


class UserInfo(BaseModel):
    sub: str
    name: str | None = None
    email: str | None = None
    is_admin: bool = False
    contracts: list[ContractWithCustomerResponse] = []
