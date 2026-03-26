"""Database engine and session management."""

import logging
from pathlib import Path

from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

logger = logging.getLogger(__name__)

_engine = None
_session_factory = None


def init_db(database_url: str) -> None:
    global _engine, _session_factory
    _engine = create_async_engine(database_url, echo=False)
    _session_factory = async_sessionmaker(_engine, expire_on_commit=False)


async def run_migrations(database_url: str) -> None:
    """Run Alembic migrations to head on startup."""
    # Alembic runs synchronously, but that's fine at startup
    app_dir = Path(__file__).parent.parent
    alembic_cfg = AlembicConfig(str(app_dir / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(app_dir / "alembic"))
    # Convert async URL to sync for Alembic
    sync_url = database_url.replace("+asyncpg", "+psycopg2")
    alembic_cfg.set_main_option("sqlalchemy.url", sync_url)
    alembic_command.upgrade(alembic_cfg, "head")
    logger.info("Database migrations applied")


async def close_db() -> None:
    global _engine
    if _engine:
        await _engine.dispose()


async def get_session() -> AsyncSession:
    if _session_factory is None:
        raise RuntimeError("Database not initialized — call init_db() first")
    async with _session_factory() as session:
        yield session
