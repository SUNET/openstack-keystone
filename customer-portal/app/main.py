"""Customer Portal API — FastAPI application."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.sessions import SessionMiddleware

from app.auth import get_current_user, get_user_contracts, init_oauth, oauth
from app.config import Settings, get_settings
from app.db import close_db, get_session, init_db, run_migrations
from app.git_backend import GitBackend
from app.k8s import init_k8s
from app.routers import admin, projects
from app.schemas import ContractWithCustomerResponse, UserInfo

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    # Initialize database and run migrations
    init_db(settings.database_url)
    await run_migrations(settings.database_url)
    logger.info("Database initialized")

    # Initialize git backend
    git_backend = GitBackend(settings)
    git_backend.init()
    app.state.git_backend = git_backend
    logger.info("Git backend initialized")

    # Initialize Kubernetes client
    try:
        init_k8s()
        logger.info("Kubernetes client initialized")
    except Exception:
        logger.warning("Kubernetes client not available (running outside cluster?)")

    # Initialize OIDC
    init_oauth(settings)
    logger.info("OIDC provider configured")

    yield

    await close_db()


app = FastAPI(title="Customer Portal API", version="0.1.0", lifespan=lifespan)

# Session middleware for OIDC auth
_settings = get_settings()
app.add_middleware(SessionMiddleware, secret_key=_settings.secret_key)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(admin.router)
app.include_router(projects.router)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.get("/auth/login")
async def login(request: Request):
    redirect_uri = _settings.oidc_redirect_uri
    return await oauth.oidc.authorize_redirect(request, redirect_uri)


@app.get("/callback")
async def callback(request: Request):
    token = await oauth.oidc.authorize_access_token(request)
    userinfo = token.get("userinfo", {})
    request.session["user"] = {
        "sub": userinfo.get("sub", ""),
        "name": userinfo.get("name", ""),
        "email": userinfo.get("email", ""),
    }
    return RedirectResponse(url="/")


@app.get("/auth/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/")


@app.get("/api/me", response_model=UserInfo)
async def me(
    user: dict[str, Any] = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    contracts = await get_user_contracts(user["sub"], session)
    return UserInfo(
        sub=user["sub"],
        name=user.get("name"),
        email=user.get("email"),
        is_admin=user["sub"] in _settings.admin_users,
        contracts=[ContractWithCustomerResponse.model_validate(c) for c in contracts],
    )


# Serve static frontend — must be last so API routes take precedence
_static_dir = Path(__file__).parent.parent / "static"
if _static_dir.is_dir():
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")
