"""Customer endpoints for managing projects under contracts."""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy.orm import selectinload

from app.auth import get_current_user, get_user_contracts
from app.db import get_session
from app.git_backend import GitBackend, _sanitize_name
from app.k8s import get_project_status
from app.models import Contract, ContractAccess, Customer
from app.schemas import CreateProjectRequest, ProjectResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/contracts", tags=["projects"])


async def _require_contract_access(
    contract_number: str, user_sub: str, session: AsyncSession
) -> Contract:
    """Verify user has access to the contract. Returns the contract with customer loaded."""
    result = await session.execute(
        select(Contract)
        .join(ContractAccess)
        .where(
            Contract.contract_number == contract_number,
            ContractAccess.user_sub == user_sub,
        )
        .options(selectinload(Contract.customer))
    )
    contract = result.scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=403, detail="No access to this contract")
    return contract


@router.get("/{contract_number}/projects", response_model=list[ProjectResponse])
async def list_projects(
    contract_number: str,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    await _require_contract_access(contract_number, user["sub"], session)

    git_backend: GitBackend = request.app.state.git_backend
    projects = git_backend.list_projects(contract_number)

    # Enrich with K8s status
    results = []
    for proj in projects:
        resource_name = _sanitize_name(proj["name"])
        status = get_project_status(resource_name)
        results.append(
            ProjectResponse(
                name=proj["name"],
                description=proj["description"],
                contract_number=proj["contract_number"],
                users=proj["users"],
                phase=status.get("phase") if status else "Pending (not synced)",
            )
        )
    return results


@router.post("/{contract_number}/projects", response_model=ProjectResponse, status_code=201)
async def create_project(
    contract_number: str,
    req: CreateProjectRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    contract = await _require_contract_access(contract_number, user["sub"], session)

    # Qualify project name with customer domain (e.g. "my-project" -> "my-project.sunet.se")
    qualified_name = f"{req.name}.{contract.customer.domain}"

    # Ensure the creating user is in the users list
    users = list(set(req.users + [user["sub"]]))

    git_backend: GitBackend = request.app.state.git_backend
    try:
        git_backend.write_project(
            contract_number=contract_number,
            project_name=qualified_name,
            description=req.description,
            users=users,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    return ProjectResponse(
        name=qualified_name,
        description=req.description,
        contract_number=contract_number,
        users=users,
        phase="Pending (waiting for ArgoCD sync)",
    )
