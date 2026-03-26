"""OIDC authentication and session management."""

import logging
from typing import Any

from authlib.integrations.starlette_client import OAuth
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings, get_settings
from app.db import get_session
from app.models import Contract, ContractAccess

logger = logging.getLogger(__name__)

oauth = OAuth()


def init_oauth(settings: Settings) -> None:
    """Register the OIDC provider with authlib."""
    oauth.register(
        name="oidc",
        client_id=settings.oidc_client_id,
        client_secret=settings.oidc_client_secret,
        server_metadata_url=f"{settings.oidc_issuer}/.well-known/openid-configuration",
        client_kwargs={"scope": "openid profile email"},
    )


def get_current_user(request: Request) -> dict[str, Any]:
    """Extract the current user from the session. Raises 401 if not logged in."""
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def require_admin(
    request: Request, settings: Settings = Depends(get_settings)
) -> dict[str, Any]:
    """Require the current user to be an admin."""
    user = get_current_user(request)
    if user["sub"] not in settings.admin_users:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def get_user_contracts(
    user_sub: str, session: AsyncSession
) -> list[Contract]:
    """Get all contracts a user has access to."""
    result = await session.execute(
        select(Contract)
        .join(ContractAccess)
        .where(ContractAccess.user_sub == user_sub)
        .options(selectinload(Contract.customer))
    )
    return list(result.scalars().all())
