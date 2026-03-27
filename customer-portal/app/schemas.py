"""Pydantic request/response schemas."""

from datetime import datetime

from pydantic import BaseModel, Field


# --- Admin: Customers ---


class CreateCustomerRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    domain: str = Field(min_length=1, max_length=255, pattern=r"^[a-z0-9.-]+$")
    description: str = ""


class CustomerResponse(BaseModel):
    id: int
    name: str
    domain: str
    description: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CustomerDetailResponse(CustomerResponse):
    contracts: list["ContractResponse"] = []


# --- Admin: Contracts ---


class CreateContractRequest(BaseModel):
    customer_id: int
    contract_number: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9-]+$")
    description: str = ""


class ContractResponse(BaseModel):
    id: int
    customer_id: int
    contract_number: str
    description: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ContractWithCustomerResponse(ContractResponse):
    customer: CustomerResponse


class ContractDetailResponse(ContractResponse):
    customer: CustomerResponse
    users: list[str] = []


# --- Admin: Contract Access ---


class GrantAccessRequest(BaseModel):
    user_sub: str = Field(min_length=1, max_length=255)


# --- Customer: Projects ---


class CreateProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: str = ""
    users: list[str] = Field(default_factory=list)


class ProjectResponse(BaseModel):
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
