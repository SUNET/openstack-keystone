"""Admin endpoints for managing customers, contracts, and access."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import require_admin
from app.db import get_session
from app.models import Contract, ContractAccess, Customer
from app.schemas import (
    ContractDetailResponse,
    ContractResponse,
    CreateContractRequest,
    CreateCustomerRequest,
    CustomerDetailResponse,
    CustomerResponse,
    GrantAccessRequest,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


# --- Customers ---


@router.get("/customers", response_model=list[CustomerResponse])
async def list_customers(
    _user=Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(Customer).order_by(Customer.name))
    return result.scalars().all()


@router.post("/customers", response_model=CustomerResponse, status_code=201)
async def create_customer(
    req: CreateCustomerRequest,
    _user=Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    existing = await session.execute(select(Customer).where(Customer.name == req.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Customer already exists")

    customer = Customer(name=req.name, description=req.description)
    session.add(customer)
    await session.commit()
    await session.refresh(customer)
    return customer


@router.get("/customers/{customer_id}", response_model=CustomerDetailResponse)
async def get_customer(
    customer_id: int,
    _user=Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(Customer)
        .where(Customer.id == customer_id)
        .options(selectinload(Customer.contracts))
    )
    customer = result.scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


# --- Contracts ---


@router.get("/contracts", response_model=list[ContractResponse])
async def list_contracts(
    _user=Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(Contract).order_by(Contract.contract_number))
    return result.scalars().all()


@router.post("/contracts", response_model=ContractResponse, status_code=201)
async def create_contract(
    req: CreateContractRequest,
    _user=Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    # Verify customer exists
    customer = await session.get(Customer, req.customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    # Check uniqueness
    existing = await session.execute(
        select(Contract).where(Contract.contract_number == req.contract_number)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Contract number already exists")

    contract = Contract(
        customer_id=req.customer_id,
        contract_number=req.contract_number,
        description=req.description,
    )
    session.add(contract)
    await session.commit()
    await session.refresh(contract)
    return contract


@router.get("/contracts/{contract_id}", response_model=ContractDetailResponse)
async def get_contract(
    contract_id: int,
    _user=Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(Contract)
        .where(Contract.id == contract_id)
        .options(selectinload(Contract.customer), selectinload(Contract.access_grants))
    )
    contract = result.scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    return ContractDetailResponse(
        id=contract.id,
        customer_id=contract.customer_id,
        contract_number=contract.contract_number,
        description=contract.description,
        created_at=contract.created_at,
        customer=contract.customer,
        users=[g.user_sub for g in contract.access_grants],
    )


# --- Contract Access ---


@router.post("/contracts/{contract_id}/users", status_code=201)
async def grant_access(
    contract_id: int,
    req: GrantAccessRequest,
    _user=Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    contract = await session.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    existing = await session.execute(
        select(ContractAccess).where(
            ContractAccess.contract_id == contract_id,
            ContractAccess.user_sub == req.user_sub,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="User already has access")

    grant = ContractAccess(contract_id=contract_id, user_sub=req.user_sub)
    session.add(grant)
    await session.commit()
    return {"status": "granted", "user_sub": req.user_sub}


@router.delete("/contracts/{contract_id}/users/{user_sub}", status_code=204)
async def revoke_access(
    contract_id: int,
    user_sub: str,
    _user=Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(ContractAccess).where(
            ContractAccess.contract_id == contract_id,
            ContractAccess.user_sub == user_sub,
        )
    )
    grant = result.scalar_one_or_none()
    if not grant:
        raise HTTPException(status_code=404, detail="Access grant not found")

    await session.delete(grant)
    await session.commit()
