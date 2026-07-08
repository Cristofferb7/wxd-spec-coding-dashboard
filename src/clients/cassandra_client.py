"""Direct cassandra-driver reads for hot-path, single-key lookups.

Used only by REQ-004 (customer profile) and REQ-005 (in-flight orders +
items) — both are partition-key (or indexed) point lookups, so going
through Presto would add unnecessary latency.

Uses the RouteEndPointFactory pattern from AGENTS.md / smoke_test.py:
collapses every discovered Cassandra node back to
``${CASSANDRA_HOST}:${CASSANDRA_PORT}`` so the driver never tries to dial
unreachable internal pod IPs.
"""
from __future__ import annotations

import ssl
import threading
import uuid
from decimal import Decimal

from src import config


class CassandraError(Exception):
    """Raised when Cassandra is unreachable or a query fails."""


_lock = threading.Lock()
_cluster = None
_session = None


def _get_session():
    # The driver is imported lazily so demo-mode deployments (e.g. Vercel)
    # don't need cassandra-driver installed at all.
    try:
        from cassandra.auth import PlainTextAuthProvider
        from cassandra.cluster import Cluster
        from cassandra.connection import DefaultEndPoint, EndPointFactory
    except ImportError as e:
        raise CassandraError(
            "cassandra-driver is not installed. Install requirements-live.txt "
            "to run against the live workshop cluster."
        ) from e

    class _RouteEndPointFactory(EndPointFactory):
        def __init__(self, host: str, port: int) -> None:
            self._host = host
            self._port = port

        def create(self, row):  # noqa: ANN001 - driver-defined signature
            return DefaultEndPoint(self._host, self._port)

        def create_from_sni(self, sni):  # noqa: ANN001 - driver-defined signature
            return DefaultEndPoint(self._host, self._port)

    global _cluster, _session
    with _lock:
        if _session is not None:
            return _session

        ctx = ssl.create_default_context()
        ctx.check_hostname = False

        try:
            _cluster = Cluster(
                contact_points=[config.CASSANDRA_HOST],
                port=config.CASSANDRA_PORT,
                ssl_context=ctx,
                ssl_options={"server_hostname": config.CASSANDRA_HOST},
                endpoint_factory=_RouteEndPointFactory(
                    config.CASSANDRA_HOST, config.CASSANDRA_PORT
                ),
                auth_provider=PlainTextAuthProvider(
                    config.WORKSHOP_USER, config.WORKSHOP_PASSWORD
                ),
                connect_timeout=15,
            )
            _session = _cluster.connect(config.CASSANDRA_KEYSPACE)
        except Exception as e:  # noqa: BLE001 - surface as a uniform error
            _cluster = None
            _session = None
            raise CassandraError(f"Could not connect to Cassandra: {e}") from e

        return _session


def parse_uuid(value: str) -> uuid.UUID:
    """Validate a path/query param as a UUID. Raises ValueError if not."""
    return uuid.UUID(value)


def _to_jsonable(value):
    from cassandra.util import Date as CassandraDate

    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, CassandraDate):
        return value.date()
    return value


def _row_to_dict(row) -> dict:
    return {k: _to_jsonable(v) for k, v in row._asdict().items()}


def get_customer_by_id(customer_id: uuid.UUID) -> dict | None:
    session = _get_session()
    try:
        row = session.execute(
            "SELECT customer_id, email, first_name, last_name, phone, "
            "account_status, loyalty_tier, current_ltv, total_orders, "
            "shipping_city, shipping_state, shipping_country "
            "FROM customers WHERE customer_id = %s",
            (customer_id,),
        ).one()
    except Exception as e:  # noqa: BLE001
        raise CassandraError(f"Customer lookup by id failed: {e}") from e
    return _row_to_dict(row) if row else None


def get_customer_by_email(email: str) -> dict | None:
    session = _get_session()
    try:
        row = session.execute(
            "SELECT customer_id, email, first_name, last_name, phone, "
            "account_status, loyalty_tier, current_ltv, total_orders, "
            "shipping_city, shipping_state, shipping_country "
            "FROM customers WHERE email = %s",
            (email,),
        ).one()
    except Exception as e:  # noqa: BLE001
        raise CassandraError(f"Customer lookup by email failed: {e}") from e
    return _row_to_dict(row) if row else None


def get_customer_by_name(full_name: str) -> dict | None:
    """Search for a customer by full name (first + last) via Presto scan.

    Returns the first match. Names are case-insensitive.
    """
    from src.clients.presto_client import run_query

    name_lower = full_name.lower().strip()
    schema = f"cassandra_catalog.{config.CASSANDRA_KEYSPACE}"
    try:
        rows = run_query(f"""
            SELECT customer_id, email, first_name, last_name, phone,
                   account_status, loyalty_tier, current_ltv, total_orders,
                   shipping_city, shipping_state, shipping_country
            FROM {schema}.customers
            WHERE LOWER(CONCAT(first_name, ' ', last_name)) = '{name_lower}'
            LIMIT 1
        """)
        if rows:
            return rows[0]
        return None
    except Exception as e:  # noqa: BLE001
        raise CassandraError(f"Customer lookup by name failed: {e}") from e


def get_customer_orders(customer_id: uuid.UUID) -> list[dict]:
    session = _get_session()
    try:
        rows = session.execute(
            "SELECT order_id, order_date, order_status, payment_status, "
            "total_amount, currency, tracking_number, estimated_delivery_date "
            "FROM orders_inflight WHERE customer_id = %s",
            (customer_id,),
        )
        return [_row_to_dict(r) for r in rows]
    except Exception as e:  # noqa: BLE001
        raise CassandraError(f"Order lookup failed: {e}") from e


def get_order_items(order_id: uuid.UUID) -> list[dict]:
    session = _get_session()
    try:
        rows = session.execute(
            "SELECT product_id, product_name, product_sku, quantity, "
            "unit_price, line_total FROM order_items_inflight WHERE order_id = %s",
            (order_id,),
        )
        return [_row_to_dict(r) for r in rows]
    except Exception as e:  # noqa: BLE001
        raise CassandraError(f"Order items lookup failed: {e}") from e
