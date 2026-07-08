"""REQ-001 — GET /sales/today.

Integration test against the federated query: the endpoint joins
`orders_inflight` (Cassandra, operational) with `daily_sales_summary`
(Iceberg, historical baseline) in a single Presto statement. This test
hits the live endpoint, then independently re-derives both halves of the
federated result via separate Presto queries — one scoped to the Cassandra
side, one to the Iceberg side — and checks the API's output against both.
"""
from __future__ import annotations

import math

from src import config
from src.clients.presto_client import run_query

_CASS = f"cassandra_catalog.{config.PRESTO_SCHEMA}"
_ICE_REF = "iceberg_data.ecommerce_reference"


def test_sales_today_matches_schema(client, assert_matches_schema):
    resp = client.get("/sales/today")
    assert resp.status_code == 200

    body = resp.json()
    assert_matches_schema(body, "SalesToday")


def test_as_of_date_matches_cassandra_max_order_date(client):
    """The 'as_of_date' half of the federated query comes from Cassandra."""
    resp = client.get("/sales/today")
    body = resp.json()

    rows = run_query(f"SELECT MAX(order_date) AS max_date FROM {_CASS}.orders_inflight")
    expected_as_of_date = str(rows[0]["max_date"])

    assert body["as_of_date"] == expected_as_of_date


def test_today_totals_match_cassandra_orders(client):
    """The 'today' half of the federated query comes from Cassandra."""
    resp = client.get("/sales/today")
    body = resp.json()

    rows = run_query(
        f"""
        SELECT COUNT(*) AS order_count, COALESCE(SUM(total_amount), 0) AS revenue
        FROM {_CASS}.orders_inflight
        WHERE order_date = (SELECT MAX(order_date) FROM {_CASS}.orders_inflight)
        """
    )
    expected = rows[0]

    assert body["today"]["order_count"] == int(expected["order_count"])
    assert body["today"]["order_count"] >= 0
    assert math.isclose(body["today"]["revenue"], float(expected["revenue"]), rel_tol=1e-6)
    assert body["today"]["revenue"] >= 0


def test_baseline_matches_iceberg_daily_summary(client):
    """The 'baseline_30d_avg' half of the federated query comes from Iceberg."""
    resp = client.get("/sales/today")
    body = resp.json()

    rows = run_query(
        f"""
        WITH baseline_days AS (
          SELECT summary_date, SUM(order_count) AS daily_orders, SUM(net_revenue) AS daily_revenue
          FROM {_ICE_REF}.daily_sales_summary
          WHERE summary_date > (SELECT MAX(summary_date) FROM {_ICE_REF}.daily_sales_summary) - INTERVAL '30' DAY
          GROUP BY summary_date
        )
        SELECT AVG(daily_orders) AS baseline_order_count, AVG(daily_revenue) AS baseline_revenue
        FROM baseline_days
        """
    )
    expected = rows[0]

    assert math.isclose(
        body["baseline_30d_avg"]["order_count"], float(expected["baseline_order_count"]), rel_tol=1e-6
    )
    assert math.isclose(
        body["baseline_30d_avg"]["revenue"], float(expected["baseline_revenue"]), rel_tol=1e-6
    )


def test_delta_is_percent_change_from_baseline(client):
    resp = client.get("/sales/today")
    body = resp.json()

    today = body["today"]
    baseline = body["baseline_30d_avg"]
    delta = body["delta"]

    expected_order_count_pct = (today["order_count"] - baseline["order_count"]) / baseline["order_count"] * 100
    expected_revenue_pct = (today["revenue"] - baseline["revenue"]) / baseline["revenue"] * 100

    assert math.isclose(delta["order_count_pct"], expected_order_count_pct, rel_tol=1e-6)
    assert math.isclose(delta["revenue_pct"], expected_revenue_pct, rel_tol=1e-6)
