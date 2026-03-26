"""Git backend for managing OpenstackProject YAML files."""

import logging
import re
from pathlib import Path

import git
import yaml

from app.config import Settings

logger = logging.getLogger(__name__)

# Default quotas for self-service projects
DEFAULT_QUOTAS = {
    "compute": {"instances": 10, "cores": 20, "ramMB": 40960},
    "storage": {"volumes": 10, "volumesGB": 500, "snapshots": 10},
    "network": {"securityGroups": 10, "securityGroupRules": 100},
}


def _sanitize_name(name: str) -> str:
    """Sanitize a project name for use as a K8s resource name and filename."""
    sanitized = re.sub(r"[^a-z0-9-]", "-", name.lower())
    sanitized = re.sub(r"-+", "-", sanitized).strip("-")
    return sanitized[:63]


class GitBackend:
    """Manages OpenstackProject YAML files in a git repository."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.work_dir = Path(settings.git_work_dir)
        self.projects_dir = self.work_dir / "projects"
        self.repo: git.Repo | None = None

    def init(self) -> None:
        """Clone or pull the repository."""
        if (self.work_dir / ".git").exists():
            self.repo = git.Repo(self.work_dir)
            origin = self.repo.remotes.origin
            origin.pull(self.settings.git_branch)
            logger.info("Pulled latest changes from %s", self.settings.git_repo_url)
        else:
            self.repo = git.Repo.clone_from(
                self.settings.git_repo_url,
                self.work_dir,
                branch=self.settings.git_branch,
            )
            logger.info("Cloned %s to %s", self.settings.git_repo_url, self.work_dir)

        self.projects_dir.mkdir(exist_ok=True)

    def _pull(self) -> None:
        """Pull latest changes before writing."""
        if self.repo:
            self.repo.remotes.origin.pull(self.settings.git_branch)

    def _commit_and_push(self, message: str) -> None:
        """Stage all changes, commit, and push."""
        if self.repo is None:
            raise RuntimeError("Git repo not initialized")

        self.repo.index.add("*")
        self.repo.index.commit(
            message,
            author=git.Actor(self.settings.git_author_name, self.settings.git_author_email),
            committer=git.Actor(self.settings.git_author_name, self.settings.git_author_email),
        )
        self.repo.remotes.origin.push(self.settings.git_branch)
        logger.info("Pushed: %s", message)

    def _update_kustomization(self) -> None:
        """Update kustomization.yaml to list all project files."""
        kustomization_path = self.work_dir / "kustomization.yaml"
        project_files = sorted(
            f"projects/{p.name}" for p in self.projects_dir.glob("*.yaml")
        )

        kustomization = {
            "apiVersion": "kustomize.config.k8s.io/v1beta1",
            "kind": "Kustomization",
            "resources": project_files,
        }

        with open(kustomization_path, "w") as f:
            yaml.dump(kustomization, f, default_flow_style=False, allow_unicode=True)

    def _render_project_cr(
        self,
        contract_number: str,
        project_name: str,
        description: str,
        users: list[str],
    ) -> dict:
        """Render an OpenstackProject CR as a dict."""
        resource_name = _sanitize_name(project_name)

        cr = {
            "apiVersion": "sunet.se/v1alpha1",
            "kind": "OpenstackProject",
            "metadata": {
                "name": resource_name,
            },
            "spec": {
                "name": project_name,
                "domain": self.settings.default_domain,
                "description": description,
                "enabled": True,
                "contractNumber": contract_number,
                "quotas": DEFAULT_QUOTAS,
                "roleBindings": [
                    {
                        "role": "member",
                        "users": users,
                        "userDomain": self.settings.default_domain,
                    }
                ],
                "federationRef": {
                    "configMapName": self.settings.federation_config_map,
                    "configMapNamespace": self.settings.federation_config_namespace,
                },
            },
        }
        return cr

    def write_project(
        self,
        contract_number: str,
        project_name: str,
        description: str,
        users: list[str],
    ) -> str:
        """Write an OpenstackProject YAML file, commit, and push.

        Returns the sanitized resource name.
        """
        self._pull()

        resource_name = _sanitize_name(project_name)
        file_path = self.projects_dir / f"{resource_name}.yaml"

        if file_path.exists():
            raise ValueError(f"Project '{resource_name}' already exists")

        cr = self._render_project_cr(contract_number, project_name, description, users)

        with open(file_path, "w") as f:
            f.write("---\n")
            yaml.dump(cr, f, default_flow_style=False, allow_unicode=True)

        self._update_kustomization()
        self._commit_and_push(f"Add project {project_name} (contract {contract_number})")

        return resource_name

    def list_projects(self, contract_number: str | None = None) -> list[dict]:
        """List projects from YAML files, optionally filtered by contract number."""
        self._pull()
        projects = []

        for path in self.projects_dir.glob("*.yaml"):
            with open(path) as f:
                doc = yaml.safe_load(f)
            if not doc or doc.get("kind") != "OpenstackProject":
                continue

            spec = doc.get("spec", {})
            cn = spec.get("contractNumber", "")

            if contract_number and cn != contract_number:
                continue

            role_bindings = spec.get("roleBindings", [])
            users = []
            for rb in role_bindings:
                users.extend(rb.get("users", []))

            projects.append({
                "name": spec.get("name", ""),
                "description": spec.get("description", ""),
                "contract_number": cn,
                "users": users,
            })

        return projects
