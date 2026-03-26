#!/usr/bin/env python3
"""Monthly billing CSV export.

Queries CloudKitty for rated resource usage, maps to the billing format
agreed with the billing department, and outputs a semicolon-delimited CSV.

Output format (one row per resource type per project):
    ContractNumber;Project;ResourceType;Volume;Cost

Can be run standalone:
    python -m app.billing_export [--month 2026-03] [--output billing.csv]
"""

import argparse
import csv
import io
import logging
import sys
from datetime import datetime, timedelta

import openstack

logger = logging.getLogger(__name__)

# Mapping from CloudKitty metric names to billing resource types and units
METRIC_MAPPING = {
    "instance": {"resource_type": "Compute", "unit": "timmar"},
    "volume.size": {"resource_type": "Storage", "unit": "Gbyte"},
    "radosgw.objects.size": {"resource_type": "S3 Storage", "unit": "Gbyte"},
    "image.size": {"resource_type": "Image Storage", "unit": "Mbyte"},
    "ip.floating": {"resource_type": "Floating IP", "unit": "st"},
    "network.incoming.bytes.rate": {"resource_type": "Network In", "unit": "MB"},
    "network.outgoing.bytes.rate": {"resource_type": "Network Out", "unit": "MB"},
}

CONTRACT_TAG_PREFIX = "contract:"


def get_billing_period(month_str: str | None = None) -> tuple[datetime, datetime]:
    """Return (start, end) for the billing period.

    If month_str is None, uses the previous calendar month.
    """
    if month_str:
        start = datetime.strptime(month_str, "%Y-%m").replace(day=1)
    else:
        today = datetime.utcnow().replace(day=1)
        start = (today - timedelta(days=1)).replace(day=1)

    # End is first day of next month
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)

    return start, end


def get_project_contracts(conn: openstack.connection.Connection) -> dict[str, tuple[str, str]]:
    """Build a mapping of project_id -> (project_name, contract_number).

    Only includes projects that have a contract tag.
    """
    project_map = {}
    for project in conn.identity.projects():
        contract_number = None
        for tag in (project.tags or []):
            if tag.startswith(CONTRACT_TAG_PREFIX):
                contract_number = tag[len(CONTRACT_TAG_PREFIX):]
                break
        if contract_number:
            project_map[project.id] = (project.name, contract_number)
    return project_map


def query_cloudkitty_summary(
    conn: openstack.connection.Connection,
    begin: datetime,
    end: datetime,
) -> list[dict]:
    """Query CloudKitty v2 summary API for rated data.

    Returns a list of summary entries with project_id, metric type, quantity, and cost.
    """
    rating_proxy = conn.rating
    summaries = []

    for metric_name in METRIC_MAPPING:
        try:
            result = rating_proxy.get(
                "/v2/summary",
                params={
                    "begin": begin.isoformat(),
                    "end": end.isoformat(),
                    "groupby": "project_id,type",
                    "filters": f"type:{metric_name}",
                },
            )
            if result.status_code == 200:
                data = result.json()
                for entry in data.get("results", []):
                    summaries.append({
                        "project_id": entry.get("project_id", ""),
                        "metric": entry.get("type", metric_name),
                        "quantity": entry.get("qty", 0),
                        "cost": entry.get("rate", 0),
                    })
        except Exception:
            logger.exception("Failed to query CloudKitty for metric %s", metric_name)

    return summaries


def generate_csv(
    project_contracts: dict[str, tuple[str, str]],
    summaries: list[dict],
    delimiter: str = ";",
) -> str:
    """Generate the billing CSV string."""
    output = io.StringIO()
    writer = csv.writer(output, delimiter=delimiter, quoting=csv.QUOTE_MINIMAL)

    for entry in summaries:
        project_id = entry["project_id"]
        if project_id not in project_contracts:
            continue

        project_name, contract_number = project_contracts[project_id]
        metric = entry["metric"]
        mapping = METRIC_MAPPING.get(metric)
        if not mapping:
            continue

        quantity = entry["quantity"]
        cost = round(entry["cost"])

        volume = f"{quantity:.2f} {mapping['unit']}".replace(".", ",")
        writer.writerow([
            contract_number,
            project_name,
            mapping["resource_type"],
            volume,
            cost,
        ])

    return output.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate monthly billing CSV")
    parser.add_argument("--month", help="Billing month in YYYY-MM format (default: previous month)")
    parser.add_argument("--output", "-o", help="Output file path (default: stdout)")
    parser.add_argument("--cloud", default="openstack", help="OpenStack cloud name from clouds.yaml")
    parser.add_argument("--delimiter", default=";", help="CSV delimiter (default: ;)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")

    begin, end = get_billing_period(args.month)
    logger.info("Billing period: %s to %s", begin.date(), end.date())

    conn = openstack.connect(cloud=args.cloud)

    logger.info("Fetching project contract mappings...")
    project_contracts = get_project_contracts(conn)
    logger.info("Found %d projects with contract numbers", len(project_contracts))

    logger.info("Querying CloudKitty for rated data...")
    summaries = query_cloudkitty_summary(conn, begin, end)
    logger.info("Got %d summary entries", len(summaries))

    csv_output = generate_csv(project_contracts, summaries, args.delimiter)

    if args.output:
        with open(args.output, "w") as f:
            f.write(csv_output)
        logger.info("Written to %s", args.output)
    else:
        sys.stdout.write(csv_output)


if __name__ == "__main__":
    main()
