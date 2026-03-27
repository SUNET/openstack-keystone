"""Structured audit logging for portal mutations."""

import logging

logger = logging.getLogger("audit")


def audit_log(user_sub: str, action: str, **kwargs: str | int) -> None:
    """Log an audit event in a structured format."""
    details = " ".join(f"{k}={v}" for k, v in kwargs.items())
    logger.info("user=%s action=%s %s", user_sub, action, details)
