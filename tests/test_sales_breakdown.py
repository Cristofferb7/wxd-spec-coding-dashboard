"""REQ-002 — GET /sales/today/by-category and /sales/today/by-region."""
from __future__ import annotations

from src import config
from src.clients.presto_client import run_query

_CASS = f"cassandra_catalog.{config.PRESTO_SCHEMA}"


def _is_sorted_desc_by_revenue(rows: list[dict]) -> bool:
    revenues = [row["revenue"] for row in rows]
    return revenues == sorted(revenues, reverse=True)


def test_by_category_matches_schema_and_is_sorted(client, assert_matches_schema):
    resp = client.get("/sales/today/by-category")
    assert resp.status_code == 200

    body = resp.json()
    assert len(body) > 0
    for item in body:
        assert_matches_schema(item, "CategoryBreakdown")

    assert _is_sorted_desc_by_revenue(body)


def test_by_category_values_are_known_product_categories(client):
    resp = client.get("/sales/today/by-category")
    body = resp.json()

    known_categories = {
        row["category"] for row in run_query(f"SELECT DISTINCT category FROM {_CASS}.products")
    }

    for item in body:
        assert item["category"] in known_categories


def test_by_category_includes_today_and_baseline_for_every_item(client):
    resp = client.get("/sales/today/by-category")
    body = resp.json()

    for item in body:
        assert item["order_count"] >= 0
        assert item["revenue"] >= 0
        assert item["baseline_order_count"] >= 0
        assert item["baseline_revenue"] >= 0


def test_by_region_matches_schema_and_is_sorted(client, assert_matches_schema):
    resp = client.get("/sales/today/by-region")
    assert resp.status_code == 200

    body = resp.json()
    assert len(body) > 0
    for item in body:
        assert_matches_schema(item, "RegionBreakdown")

    assert _is_sorted_desc_by_revenue(body)


def test_by_region_values_are_known_shipping_states(client):
    resp = client.get("/sales/today/by-region")
    body = resp.json()

    known_states = {
        row["shipping_state"]
        for row in run_query(f"SELECT DISTINCT shipping_state FROM {_CASS}.orders_inflight")
    }

    for item in body:
        assert item["region"] in known_states


def test_by_region_includes_today_and_baseline_for_every_item(client):
    resp = client.get("/sales/today/by-region")
    body = resp.json()

    for item in body:
        assert item["order_count"] >= 0
        assert item["revenue"] >= 0
        assert item["baseline_order_count"] >= 0
        assert item["baseline_revenue"] >= 0
