"""Archive policy resource management for OpenStack operator."""

import logging
from typing import Any

from openstack_client import OpenStackClient

logger = logging.getLogger(__name__)


def _spec_to_gnocchi_definition(definition: list[dict[str, str]]) -> list[dict[str, str]]:
    """Convert CRD definition spec to Gnocchi API format."""
    return [
        {"granularity": d["granularity"], "timespan": d["timespan"]}
        for d in definition
    ]


def _normalize_definitions(definitions: list[dict]) -> set[tuple[str, str]]:
    """Normalize a list of definitions to a set of (granularity, timespan) tuples."""
    return {(d["granularity"], d["timespan"]) for d in definitions}


def archive_policy_needs_update(
    existing: dict, spec: dict[str, Any]
) -> tuple[bool, bool]:
    """Check if an archive policy needs updating.

    Returns:
        (can_update, has_incompatible_changes)
        can_update=True if PATCH can handle the diff (new rules added).
        has_incompatible_changes=True if aggregation_methods changed or rules removed.
    """
    # Check aggregation methods
    existing_methods = set(existing.get("aggregation_methods", []))
    desired_methods = set(spec.get("aggregationMethods", []))
    if existing_methods != desired_methods:
        return False, True

    # Check back_window
    existing_bw = existing.get("back_window", 0)
    desired_bw = spec.get("backWindow", 0)
    if existing_bw != desired_bw:
        return False, True

    # Check definitions
    existing_defs = _normalize_definitions(existing.get("definition", []))
    desired_defs = _normalize_definitions(spec.get("definition", []))

    if existing_defs == desired_defs:
        return False, False  # No update needed

    # Rules were removed — incompatible
    if existing_defs - desired_defs:
        return False, True

    # Only new rules added — PATCH can handle this
    return True, False


def ensure_archive_policy(client: OpenStackClient, spec: dict[str, Any]) -> str:
    """Ensure an archive policy exists with the given configuration.

    Creates the policy if it doesn't exist.

    Args:
        client: OpenStack client
        spec: Archive policy specification from CRD

    Returns:
        The archive policy name
    """
    name = spec["name"]
    existing = client.get_archive_policy(name)

    if existing:
        logger.info(f"Archive policy {name} already exists")
        return name

    definition = _spec_to_gnocchi_definition(spec["definition"])
    client.create_archive_policy(
        name=name,
        definition=definition,
        aggregation_methods=spec["aggregationMethods"],
        back_window=spec.get("backWindow", 0),
    )
    logger.info(f"Created archive policy {name}")
    return name


def delete_archive_policy(client: OpenStackClient, name: str) -> None:
    """Delete an archive policy.

    Args:
        client: OpenStack client
        name: The archive policy name to delete
    """
    client.delete_archive_policy(name)
