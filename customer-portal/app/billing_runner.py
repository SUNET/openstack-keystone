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


def _load_prices(sync_session: SyncSession) -> dict[str, Decimal]:
    result = sync_session.execute(select(ResourcePrice))
    return {p.resource_type: p.unit_price for p in result.scalars()}


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


def _query_cloudkitty(conn, begin, end, metric_types: list[str]) -> list[dict]:
    """Query CloudKitty for usage data for the given metric types."""
    import httpx
    token = conn.auth_token
    endpoint = conn.rating.get_endpoint().rstrip("/")
    base = endpoint.rsplit("/v", 1)[0]

    summaries = []
    for metric_name in metric_types:
        try:
            resp = httpx.get(
                f"{base}/v1/report/summary",
                params={
                    "begin": begin.isoformat(),
                    "end": end.isoformat(),
                    "groupby": "project_id",
                    "service": metric_name,
                },
                headers={"X-Auth-Token": token},
            )
            if resp.status_code == 200:
                for entry in resp.json().get("summary", []):
                    summaries.append({
                        "project_id": entry.get("project_id", entry.get("tenant_id", "")),
                        "metric": metric_name,
                        "quantity": entry.get("qty", entry.get("res_qty", 0)),
                    })
        except Exception:
            logger.exception("Failed to query CloudKitty for %s", metric_name)
    return summaries


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
        # Load prices from DB — resource_type is the CloudKitty metric type
        global_prices = _load_prices(db)  # {resource_type: unit_price}
        # Also load units and conversion factors from ResourcePrice
        price_meta = {}
        for p in db.execute(select(ResourcePrice)).scalars():
            price_meta[p.resource_type] = {
                "unit": p.unit,
                "conversion_factor": p.conversion_factor or Decimal(1),
            }

        contract_overrides = _load_contract_overrides(db)
        rebates = _load_rebates(db)
        contract_id_map = _load_contract_ids(db)

        # Only query CloudKitty for metric types we have prices for
        priced_metrics = list(global_prices.keys())
        # Also include metrics that have contract overrides
        for overrides in contract_overrides.values():
            for rt in overrides:
                if rt not in priced_metrics:
                    priced_metrics.append(rt)

        conn = openstack.connect(cloud=cloud_name)
        project_contracts = _get_project_contracts(conn)
        summaries = _query_cloudkitty(conn, period_start, period_end, priced_metrics)

        contract_set = set(contract_numbers)

        output = io.StringIO()
        writer = csv.writer(output, delimiter=delimiter, quoting=csv.QUOTE_MINIMAL)

        for entry in summaries:
            pid = entry["project_id"]
            if pid not in project_contracts:
                continue
            project_name, cn = project_contracts[pid]
            if cn not in contract_set:
                continue

            metric = entry["metric"]
            raw_qty = Decimal(str(entry["quantity"]))
            meta = price_meta.get(metric, {"unit": "", "conversion_factor": Decimal(1)})
            unit = meta["unit"]
            conversion = meta["conversion_factor"]

            # Apply conversion factor (e.g. raw data points -> hours)
            quantity = raw_qty * conversion

            contract_id = contract_id_map.get(cn)
            unit_price = Decimal(0)
            if contract_id and contract_id in contract_overrides:
                unit_price = contract_overrides[contract_id].get(metric, Decimal(0))
            if unit_price == 0:
                unit_price = global_prices.get(metric, Decimal(0))

            cost = quantity * unit_price
            if contract_id and contract_id in rebates:
                cost = cost * (1 - rebates[contract_id] / 100)

            volume = f"{quantity:.2f} {unit}".replace(".", ",")
            writer.writerow([cn, project_name, metric, volume, round(cost)])

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
