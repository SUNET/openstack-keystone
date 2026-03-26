"""Kubernetes client for reading OpenstackProject CR status."""

import logging

from kubernetes import client, config

logger = logging.getLogger(__name__)

_api: client.CustomObjectsApi | None = None


def init_k8s() -> None:
    """Initialize the Kubernetes client (in-cluster or kubeconfig)."""
    global _api
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()
    _api = client.CustomObjectsApi()


def get_project_status(resource_name: str, namespace: str = "customer-projects") -> dict | None:
    """Get the status of an OpenstackProject CR.

    Returns a dict with phase, projectId, conditions, etc., or None if not found.
    """
    if _api is None:
        return None

    try:
        cr = _api.get_namespaced_custom_object(
            group="sunet.se",
            version="v1alpha1",
            namespace=namespace,
            plural="openstackprojects",
            name=resource_name,
        )
        return cr.get("status", {})
    except client.ApiException as e:
        if e.status == 404:
            return None
        logger.warning("Failed to get OpenstackProject %s: %s", resource_name, e)
        return None
