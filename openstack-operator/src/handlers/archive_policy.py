"""Kopf handlers for OpenstackArchivePolicy CRD."""

import logging
import time
from typing import Any

import kopf

from resources.archive_policy import (
    archive_policy_needs_update,
    delete_archive_policy,
    ensure_archive_policy,
)
from state import get_openstack_client, get_registry
from utils import now_iso
from metrics import (
    RECONCILE_TOTAL,
    RECONCILE_DURATION,
    RECONCILE_IN_PROGRESS,
)

logger = logging.getLogger(__name__)


def _set_patch_condition(
    patch: kopf.Patch,
    condition_type: str,
    condition_status: str,
    reason: str = "",
    message: str = "",
) -> None:
    """Set or update a condition in patch.status.conditions."""
    if "conditions" not in patch.status:
        patch.status["conditions"] = []

    conditions: list[dict[str, str]] = patch.status["conditions"]

    for condition in conditions:
        if condition["type"] == condition_type:
            if condition["status"] != condition_status:
                condition["status"] = condition_status
                condition["lastTransitionTime"] = now_iso()
            condition["reason"] = reason
            condition["message"] = message
            return

    conditions.append(
        {
            "type": condition_type,
            "status": condition_status,
            "reason": reason,
            "message": message,
            "lastTransitionTime": now_iso(),
        }
    )


@kopf.on.create("sunet.se", "v1alpha1", "openstackarchivepolicies")
def create_archive_policy_handler(
    spec: dict[str, Any],
    patch: kopf.Patch,
    name: str,
    body: kopf.Body,
    **_: Any,
) -> None:
    """Handle OpenstackArchivePolicy creation."""
    logger.info(f"Creating OpenstackArchivePolicy: {name}")
    start_time = time.monotonic()
    RECONCILE_IN_PROGRESS.labels(resource="OpenstackArchivePolicy").inc()

    patch.status["phase"] = "Provisioning"
    patch.status["conditions"] = []

    client = get_openstack_client()
    registry = get_registry()

    try:
        policy_name = spec["name"]

        _set_patch_condition(patch, "ArchivePolicyReady", "False", "Creating", "")

        ensure_archive_policy(client, spec)

        # Register in ConfigMap
        registry.register("archive_policies", policy_name, policy_name, cr_name=name)

        _set_patch_condition(patch, "ArchivePolicyReady", "True", "Created", "")
        patch.status["phase"] = "Ready"
        patch.status["lastSyncTime"] = now_iso()

        duration = time.monotonic() - start_time
        RECONCILE_TOTAL.labels(
            resource="OpenstackArchivePolicy", operation="create", status="success"
        ).inc()
        RECONCILE_DURATION.labels(
            resource="OpenstackArchivePolicy", operation="create"
        ).observe(duration)
        logger.info(f"Successfully created OpenstackArchivePolicy: {name}")

    except Exception as e:
        logger.error(f"Failed to create OpenstackArchivePolicy {name}: {e}")
        patch.status["phase"] = "Error"
        _set_patch_condition(patch, "ArchivePolicyReady", "False", "Error", str(e)[:200])
        RECONCILE_TOTAL.labels(
            resource="OpenstackArchivePolicy", operation="create", status="error"
        ).inc()
        kopf.warn(body, reason="CreateFailed", message=str(e)[:200])
        raise kopf.TemporaryError(f"Creation failed: {e}", delay=60)
    finally:
        RECONCILE_IN_PROGRESS.labels(resource="OpenstackArchivePolicy").dec()


@kopf.on.update("sunet.se", "v1alpha1", "openstackarchivepolicies")
def update_archive_policy_handler(
    spec: dict[str, Any],
    status: dict[str, Any],
    patch: kopf.Patch,
    name: str,
    body: kopf.Body,
    **_: Any,
) -> None:
    """Handle OpenstackArchivePolicy updates."""
    logger.info(f"Updating OpenstackArchivePolicy: {name}")
    start_time = time.monotonic()
    RECONCILE_IN_PROGRESS.labels(resource="OpenstackArchivePolicy").inc()

    client = get_openstack_client()
    registry = get_registry()
    patch.status["phase"] = "Provisioning"

    # Preserve existing status fields
    for key in ("conditions",):
        if key in status and key not in patch.status:
            patch.status[key] = status[key]

    try:
        policy_name = spec["name"]

        existing = client.get_archive_policy(policy_name)
        if not existing:
            # Policy doesn't exist, treat as create
            RECONCILE_IN_PROGRESS.labels(resource="OpenstackArchivePolicy").dec()
            create_archive_policy_handler(spec=spec, patch=patch, name=name, body=body)
            return

        can_update, has_incompatible = archive_policy_needs_update(existing, spec)

        if has_incompatible:
            msg = (
                "Incompatible changes detected (aggregation_methods, back_window, "
                "or rule removal). Gnocchi does not support these changes on "
                "existing policies. Delete and recreate the policy if no metrics "
                "reference it."
            )
            logger.error(f"OpenstackArchivePolicy {name}: {msg}")
            patch.status["phase"] = "Error"
            _set_patch_condition(
                patch, "ArchivePolicyReady", "False", "IncompatibleChange", msg
            )
            RECONCILE_TOTAL.labels(
                resource="OpenstackArchivePolicy", operation="update", status="error"
            ).inc()
            kopf.warn(body, reason="IncompatibleChange", message=msg[:200])
            raise kopf.PermanentError(msg)

        if can_update:
            # PATCH with new definition rules
            definition = [
                {"granularity": d["granularity"], "timespan": d["timespan"]}
                for d in spec["definition"]
            ]
            client.update_archive_policy(policy_name, definition)
            _set_patch_condition(patch, "ArchivePolicyReady", "True", "Updated", "")
        else:
            # No changes needed
            _set_patch_condition(patch, "ArchivePolicyReady", "True", "Unchanged", "")

        registry.register("archive_policies", policy_name, policy_name, cr_name=name)
        patch.status["phase"] = "Ready"
        patch.status["lastSyncTime"] = now_iso()

        duration = time.monotonic() - start_time
        RECONCILE_TOTAL.labels(
            resource="OpenstackArchivePolicy", operation="update", status="success"
        ).inc()
        RECONCILE_DURATION.labels(
            resource="OpenstackArchivePolicy", operation="update"
        ).observe(duration)
        logger.info(f"Successfully updated OpenstackArchivePolicy: {name}")

    except (kopf.PermanentError, kopf.TemporaryError):
        raise
    except Exception as e:
        logger.error(f"Failed to update OpenstackArchivePolicy {name}: {e}")
        patch.status["phase"] = "Error"
        _set_patch_condition(patch, "ArchivePolicyReady", "False", "Error", str(e)[:200])
        RECONCILE_TOTAL.labels(
            resource="OpenstackArchivePolicy", operation="update", status="error"
        ).inc()
        kopf.warn(body, reason="UpdateFailed", message=str(e)[:200])
        raise kopf.TemporaryError(f"Update failed: {e}", delay=60)
    finally:
        RECONCILE_IN_PROGRESS.labels(resource="OpenstackArchivePolicy").dec()


@kopf.on.delete("sunet.se", "v1alpha1", "openstackarchivepolicies")
def delete_archive_policy_handler(
    spec: dict[str, Any],
    status: dict[str, Any],
    name: str,
    body: kopf.Body,
    **_: Any,
) -> None:
    """Handle OpenstackArchivePolicy deletion."""
    logger.info(f"Deleting OpenstackArchivePolicy: {name}")
    start_time = time.monotonic()
    RECONCILE_IN_PROGRESS.labels(resource="OpenstackArchivePolicy").inc()

    client = get_openstack_client()
    registry = get_registry()

    policy_name = spec["name"]

    try:
        delete_archive_policy(client, policy_name)
        registry.unregister("archive_policies", policy_name)

        duration = time.monotonic() - start_time
        RECONCILE_TOTAL.labels(
            resource="OpenstackArchivePolicy", operation="delete", status="success"
        ).inc()
        RECONCILE_DURATION.labels(
            resource="OpenstackArchivePolicy", operation="delete"
        ).observe(duration)
        logger.info(f"Successfully deleted OpenstackArchivePolicy: {name}")

    except Exception as e:
        logger.error(f"Failed to delete OpenstackArchivePolicy {name}: {e}")
        RECONCILE_TOTAL.labels(
            resource="OpenstackArchivePolicy", operation="delete", status="error"
        ).inc()
        kopf.warn(body, reason="DeleteFailed", message=str(e)[:200])
        raise kopf.TemporaryError(f"Deletion failed: {e}", delay=60)
    finally:
        RECONCILE_IN_PROGRESS.labels(resource="OpenstackArchivePolicy").dec()


@kopf.timer("sunet.se", "v1alpha1", "openstackarchivepolicies", interval=300)
def reconcile_archive_policy(
    spec: dict[str, Any],
    status: dict[str, Any],
    patch: kopf.Patch,
    name: str,
    **_: Any,
) -> None:
    """Periodic reconciliation to detect and repair drift."""
    if status.get("phase") != "Ready":
        return

    logger.debug(f"Reconciling OpenstackArchivePolicy: {name}")

    client = get_openstack_client()
    policy_name = spec["name"]

    try:
        policy = client.get_archive_policy(policy_name)
        if not policy:
            logger.warning(f"Archive policy {policy_name} not found, triggering recreate")
            patch.status["phase"] = "Pending"
            return

        patch.status["lastSyncTime"] = now_iso()

    except Exception as e:
        logger.exception(f"Reconciliation failed for {name}")
