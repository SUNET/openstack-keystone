"""Billing job execution: CSV generation, delivery, scheduling."""

import asyncio
import csv
import io
import logging
import re
import smtplib
from datetime import datetime, timedelta
from decimal import Decimal
from email.message import EmailMessage

import httpx
import openstack
from croniter import croniter
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session as SyncSession, sessionmaker

from app.config import get_settings
from app.crypto import decrypt_value
from app.models import (
    BillingJob,
    BillingJobContract,
    BillingJobRun,
    Contract,
    ContractAccess,
    ContractPriceOverride,
    ContractRebate,
    ResourcePrice,
)

logger = logging.getLogger(__name__)

CONTRACT_TAG_PREFIX = "contract:"


def discover_cloudkitty_metrics(cloud_name: str = "openstack") -> list[dict]:
    """Query CloudKitty to discover available metric types and their units.

    Uses the /v1/info/metrics endpoint which returns the configured
    processor metrics with their IDs, units, and metadata fields.
    """
    try:
        conn = openstack.connect(cloud=cloud_name)
        import httpx
        token = conn.auth_token
        endpoint = conn.rating.get_endpoint().rstrip("/")
        # Use /v1/info/metrics — works regardless of which API version the SDK discovered
        base = endpoint.rsplit("/v", 1)[0]
        resp = httpx.get(f"{base}/v1/info/metrics", headers={"X-Auth-Token": token})
        if resp.status_code != 200:
            logger.warning("CloudKitty /v1/info/metrics returned %d", resp.status_code)
            return []

        metrics = []
        for m in resp.json().get("metrics", []):
            metrics.append({
                "metric_type": m.get("metric_id", ""),
                "unit": m.get("unit", ""),
            })

        return sorted(metrics, key=lambda m: m["metric_type"])
    except Exception:
        logger.exception("Failed to discover CloudKitty metrics")
        return []


# --- Billing period ---


def get_billing_period(year: int | None = None, month: int | None = None) -> tuple[datetime, datetime]:
    """Return (start, end) for a billing period. Defaults to previous month."""
    if year and month:
        start = datetime(year, month, 1)
    else:
        today = datetime.utcnow().replace(day=1)
        start = (today - timedelta(days=1)).replace(day=1)

    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)

    return start, end


# --- Contract resolution ---


def resolve_contract_numbers(
    sync_session: SyncSession, job: BillingJob, admin_users: list[str]
) -> list[str]:
    """Resolve which contract numbers a job should bill for."""
    if job.all_contracts:
        if job.owner_sub in admin_users:
            result = sync_session.execute(select(Contract.contract_number))
        else:
            result = sync_session.execute(
                select(Contract.contract_number)
                .join(ContractAccess)
                .where(ContractAccess.user_sub == job.owner_sub)
            )
        return [r[0] for r in result]
    else:
        result = sync_session.execute(
            select(Contract.contract_number)
            .join(BillingJobContract, BillingJobContract.contract_id == Contract.id)
            .where(BillingJobContract.billing_job_id == job.id)
        )
        return [r[0] for r in result]


# --- CSV generation (sync, runs in thread pool) ---


def _get_project_contracts(conn: openstack.connection.Connection) -> dict[str, tuple[str, str]]:
    """Build project_id -> (project_name, contract_number) mapping."""
    project_map = {}
    for project in conn.identity.projects():
        for tag in (project.tags or []):
            if tag.startswith(CONTRACT_TAG_PREFIX):
                project_map[project.id] = (project.name, tag[len(CONTRACT_TAG_PREFIX):])
                break
    return project_map


def _load_prices(sync_session: SyncSession) -> list[ResourcePrice]:
    """Load all resource prices, ordered so specific (metadata) prices come first."""
    result = sync_session.execute(
        select(ResourcePrice).order_by(
            ResourcePrice.resource_type,
            ResourcePrice.metadata_field.desc(),  # non-null first
        )
    )
    return list(result.scalars())


def _find_price(
    prices: list[ResourcePrice], metric: str, metadata: dict[str, str]
) -> ResourcePrice | None:
    """Find the most specific matching price for a metric + metadata combo.

    Specific (metadata_field+metadata_value match) takes priority over base (no metadata).
    """
    base_match = None
    for p in prices:
        if p.resource_type != metric:
            continue
        if p.metadata_field and p.metadata_value:
            # Specific price — check if metadata matches
            if metadata.get(p.metadata_field) == p.metadata_value:
                return p  # most specific, return immediately
        elif not p.metadata_field:
            base_match = p  # fallback
    return base_match


def _load_contract_overrides(sync_session: SyncSession) -> dict[int, dict[str, Decimal]]:
    result = sync_session.execute(select(ContractPriceOverride))
    overrides: dict[int, dict[str, Decimal]] = {}
    for o in result.scalars():
        overrides.setdefault(o.contract_id, {})[o.resource_type] = o.unit_price
    return overrides


def _load_rebates(sync_session: SyncSession) -> dict[int, Decimal]:
    result = sync_session.execute(select(ContractRebate))
    return {r.contract_id: r.rebate_percent for r in result.scalars()}


def _load_contract_ids(sync_session: SyncSession) -> dict[str, int]:
    result = sync_session.execute(select(Contract))
    return {c.contract_number: c.id for c in result.scalars()}


def _query_gnocchi_usage(
    conn, begin: datetime, end: datetime, resource_type: str, metric_name: str,
    groupby_fields: list[str],
) -> list[dict]:
    """Query Gnocchi for aggregated usage data grouped by project and metadata fields.

    Returns a list of dicts with 'project_id', 'metadata' (dict), and 'quantity'
    (count of data points — represents collection intervals).
    """
    import httpx
    token = conn.auth_token
    gnocchi = "http://gnocchi-api.openstack.svc.cluster.local:8041"

    params = [
        ("start", begin.isoformat()),
        ("stop", end.isoformat()),
        ("aggregation", "mean"),
        ("needed_overlap", "0"),
        ("groupby", "project_id"),
    ]
    for field in groupby_fields:
        params.append(("groupby", field))

    try:
        resp = httpx.post(
            f"{gnocchi}/v1/aggregation/resource/{resource_type}/metric/{metric_name}",
            params=params,
            json={},  # empty search = all resources
            headers={"X-Auth-Token": token},
            timeout=60,
        )
        if resp.status_code != 200:
            logger.warning("Gnocchi aggregation for %s/%s returned %d", resource_type, metric_name, resp.status_code)
            return []

        results = []
        for group in resp.json():
            group_info = group.get("group", {})
            measures = group.get("measures", [])
            # Count of data points = number of collection intervals
            quantity = len(measures)
            project_id = group_info.pop("project_id", "")
            results.append({
                "project_id": project_id,
                "metric": metric_name,
                "metadata": group_info,  # remaining fields (e.g. flavor_name)
                "quantity": quantity,
            })
        return results
    except Exception:
        logger.exception("Failed to query Gnocchi for %s/%s", resource_type, metric_name)
        return []


def generate_billing_csv(
    db_url: str,
    cloud_name: str,
    contract_numbers: list[str],
    period_start: datetime,
    period_end: datetime,
    delimiter: str = ";",
) -> str:
    """Generate billing CSV for the given contracts and period. Runs synchronously."""
    sync_url = db_url.replace("+asyncpg", "")
    if sync_url.startswith("postgresql://"):
        sync_url = sync_url.replace("postgresql://", "postgresql+psycopg2://", 1)

    engine = create_engine(sync_url)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()

    try:
        # Load prices from DB
        prices = _load_prices(db)
        contract_overrides = _load_contract_overrides(db)
        rebates = _load_rebates(db)
        contract_id_map = _load_contract_ids(db)

        # Determine which metric types to query, and their metadata fields
        # Group prices by resource_type to find which metadata fields are used
        metric_metadata_fields: dict[str, set[str]] = {}
        for p in prices:
            if p.resource_type not in metric_metadata_fields:
                metric_metadata_fields[p.resource_type] = set()
            if p.metadata_field:
                metric_metadata_fields[p.resource_type].add(p.metadata_field)

        # Also include metrics from contract overrides
        for overrides in contract_overrides.values():
            for rt in overrides:
                if rt not in metric_metadata_fields:
                    metric_metadata_fields[rt] = set()

        conn = openstack.connect(cloud=cloud_name)
        project_contracts = _get_project_contracts(conn)
        contract_set = set(contract_numbers)

        # Map metric types to Gnocchi resource types
        # CloudKitty config uses these resource_type mappings
        METRIC_RESOURCE_TYPES = {
            "cpu": "instance",
            "instance": "instance",
            "image.size": "image",
            "ip.floating": "network",
            "network.incoming.bytes.rate": "instance_network_interface",
            "network.outgoing.bytes.rate": "instance_network_interface",
            "radosgw.objects.size": "ceph_account",
            "volume.size": "volume",
        }

        output = io.StringIO()
        writer = csv.writer(output, delimiter=delimiter, quoting=csv.QUOTE_MINIMAL)

        for metric, meta_fields in metric_metadata_fields.items():
            resource_type = METRIC_RESOURCE_TYPES.get(metric, metric)
            groupby = list(meta_fields)

            usage = _query_gnocchi_usage(
                conn, period_start, period_end,
                resource_type, metric, groupby,
            )

            for entry in usage:
                pid = entry["project_id"]
                if pid not in project_contracts:
                    continue
                project_name, cn = project_contracts[pid]
                if cn not in contract_set:
                    continue

                metadata = entry.get("metadata", {})
                raw_qty = Decimal(str(entry["quantity"]))

                # Find the best matching price (specific metadata > base)
                price = _find_price(prices, metric, metadata)
                if not price:
                    continue

                conversion = price.conversion_factor or Decimal(1)
                quantity = raw_qty * conversion
                unit = price.unit

                # Determine unit_price: contract override > global
                contract_id = contract_id_map.get(cn)
                unit_price = price.unit_price
                if contract_id and contract_id in contract_overrides:
                    override_price = contract_overrides[contract_id].get(metric, None)
                    if override_price is not None:
                        unit_price = override_price

                cost = quantity * unit_price
                if contract_id and contract_id in rebates:
                    cost = cost * (1 - rebates[contract_id] / 100)

                # Label includes metadata if present (e.g. "instance (b2.c4r8)")
                label = metric
                if metadata:
                    meta_str = ", ".join(f"{v}" for v in metadata.values())
                    label = f"{metric} ({meta_str})"

                volume = f"{quantity:.2f} {unit}".replace(".", ",")
                writer.writerow([cn, project_name, label, volume, round(cost)])

        return output.getvalue()
    finally:
        db.close()
        engine.dispose()


# --- Filename template ---


def resolve_template(template: str, **kwargs: str) -> str:
    """Resolve a filename template with the given variables."""
    result = template
    for key, value in kwargs.items():
        result = result.replace("{" + key + "}", str(value))
    # Sanitize for filesystem safety
    result = re.sub(r'[^\w\-.]', '_', result)
    return result


# --- Delivery methods ---


async def deliver_webdav(url: str, username: str, password: str, filename: str, content: str) -> None:
    """Upload a file to a WebDAV endpoint."""
    full_url = url.rstrip("/") + "/" + filename
    async with httpx.AsyncClient() as client:
        resp = await client.put(full_url, content=content.encode(), auth=(username, password))
        resp.raise_for_status()
    logger.info("Delivered %s to WebDAV: %s", filename, url)


async def deliver_email(recipient: str, subject: str, filename: str, content: str) -> None:
    """Send a billing CSV as an email attachment."""
    settings = get_settings()
    if not settings.smtp_host:
        raise RuntimeError("SMTP not configured")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from
    msg["To"] = recipient
    msg.set_content(f"Billing report: {filename}")
    msg.add_attachment(content.encode(), maintype="text", subtype="csv", filename=filename)

    def _send():
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as smtp:
            if settings.smtp_username:
                smtp.starttls()
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(msg)

    await asyncio.to_thread(_send)
    logger.info("Emailed %s to %s", filename, recipient)


# --- Job execution ---


import json


def _decrypt_config(delivery_config_json: str) -> dict:
    """Parse delivery config JSON and decrypt any encrypted password."""
    config = json.loads(delivery_config_json)
    if "password" in config and config["password"]:
        try:
            config["password"] = decrypt_value(config["password"])
        except Exception:
            logger.warning("Failed to decrypt password, using as-is")
    return config


async def execute_job(
    session: AsyncSession,
    job: BillingJob,
    year: int | None = None,
    month: int | None = None,
) -> BillingJobRun:
    """Execute a billing job: generate CSV(s) and deliver."""
    settings = get_settings()
    period_start, period_end = get_billing_period(year, month)

    run = BillingJobRun(
        billing_job_id=job.id,
        billing_period_start=period_start,
        billing_period_end=period_end,
        status="running",
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)

    try:
        # Resolve contracts (sync query in thread)
        sync_url = settings.database_url.replace("+asyncpg", "")
        if sync_url.startswith("postgresql://"):
            sync_url = sync_url.replace("postgresql://", "postgresql+psycopg2://", 1)
        engine = create_engine(sync_url)
        sf = sessionmaker(bind=engine)

        def _resolve():
            db = sf()
            try:
                return resolve_contract_numbers(db, job, settings.admin_users)
            finally:
                db.close()

        contract_numbers = await asyncio.to_thread(_resolve)
        engine.dispose()

        if not contract_numbers:
            run.status = "success"
            run.completed_at = datetime.utcnow()
            run.files_delivered = 0
            await session.commit()
            return run

        config = _decrypt_config(job.delivery_config)
        template_vars = {
            "year": f"{period_start.year:04d}",
            "month": f"{period_start.month:02d}",
            "day": f"{datetime.utcnow().day:02d}",
            "date": datetime.utcnow().strftime("%Y-%m-%d"),
        }

        files_delivered = 0

        if job.per_contract:
            # One file per contract
            for cn in contract_numbers:
                csv_content = await asyncio.to_thread(
                    generate_billing_csv,
                    settings.database_url, settings.openstack_cloud,
                    [cn], period_start, period_end,
                )
                if not csv_content.strip():
                    continue

                # Look up customer name for template
                cn_vars = {**template_vars, "contract": cn}
                filename = resolve_template(job.filename_template, **cn_vars)

                await _deliver(job.delivery_method, config, filename, csv_content)
                files_delivered += 1
        else:
            # Single file with all contracts
            csv_content = await asyncio.to_thread(
                generate_billing_csv,
                settings.database_url, settings.openstack_cloud,
                contract_numbers, period_start, period_end,
            )
            filename = resolve_template(job.filename_template, **template_vars)
            await _deliver(job.delivery_method, config, filename, csv_content)
            files_delivered = 1

        run.status = "success"
        run.files_delivered = files_delivered

    except Exception as e:
        logger.exception("Billing job %d failed", job.id)
        run.status = "error"
        run.error_message = str(e)[:500]

    run.completed_at = datetime.utcnow()
    await session.commit()
    return run


async def _deliver(method: str, config: dict, filename: str, content: str) -> None:
    """Dispatch to the appropriate delivery method."""
    if method == "webdav":
        await deliver_webdav(config["url"], config.get("username", ""), config.get("password", ""), filename, content)
    elif method == "email":
        subject = f"Billing report: {filename}"
        await deliver_email(config["recipient"], subject, filename, content)
    else:
        raise ValueError(f"Unknown delivery method: {method}")


# --- Schedule matching ---


def should_run_now(schedule: str, now: datetime, window_minutes: int = 15) -> bool:
    """Check if a cron schedule has a trigger within the last window."""
    cron = croniter(schedule, now)
    last_scheduled = cron.get_prev(datetime)
    window_start = now - timedelta(minutes=window_minutes)
    return window_start <= last_scheduled <= now


async def run_due_jobs(session: AsyncSession) -> list[BillingJobRun]:
    """Find and execute all billing jobs that are due now."""
    now = datetime.utcnow()
    result = await session.execute(
        select(BillingJob).where(BillingJob.enabled == True)  # noqa: E712
    )
    jobs = result.scalars().all()
    runs = []

    for job in jobs:
        if not should_run_now(job.schedule, now):
            continue

        period_start, period_end = get_billing_period()

        # Check for existing run this period
        existing = await session.execute(
            select(BillingJobRun).where(
                BillingJobRun.billing_job_id == job.id,
                BillingJobRun.billing_period_start == period_start,
                BillingJobRun.billing_period_end == period_end,
                BillingJobRun.status.in_(["running", "success"]),
            )
        )
        if existing.scalar_one_or_none():
            continue

        logger.info("Executing due billing job %d: %s", job.id, job.name)
        run = await execute_job(session, job)
        runs.append(run)

    return runs
