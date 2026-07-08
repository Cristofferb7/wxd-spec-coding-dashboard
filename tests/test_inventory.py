"""REQ-003 — GET /inventory."""
from __future__ import annotations

from src import config
from src.clients.presto_client import run_query

_CASS = f"cassandra_catalog.{config.PRESTO_SCHEMA}"


def test_inventory_matches_schema_and_covers_all_products(client, assert_matches_schema):
    resp = client.get("/inventory")
    assert resp.status_code == 200

    body = resp.json()
    for item in body:
        assert_matches_schema(item, "InventoryItem")

    expected_count = run_query(f"SELECT COUNT(*) AS n FROM {_CASS}.products")[0]["n"]
    assert len(body) == expected_count


def test_below_reorder_flag_is_correct(client):
    resp = client.get("/inventory")
    body = resp.json()

    for item in body:
        assert item["below_reorder"] == (item["stock_quantity"] < item["reorder_level"])


def test_some_products_have_no_recent_stock_movement(client):
    """Regression guard: last_move_at must be present-but-null, not omitted,
    when a product has no inventory_ledger_recent row."""
    resp = client.get("/inventory")
    body = resp.json()

    assert any(item["last_move_at"] is None for item in body)
    assert any(item["last_move_at"] is not None for item in body)


def test_urgency_sort_orders_below_reorder_items_first(client):
    resp = client.get("/inventory", params={"sort": "urgency"})
    assert resp.status_code == 200

    body = resp.json()
    flags = [item["below_reorder"] for item in body]

    # All `below_reorder=true` items must appear before any `below_reorder=false`
    # item — i.e. the flag sequence is non-increasing (True, ..., True, False, ..., False).
    assert flags == sorted(flags, reverse=True)


def test_stock_sort_is_ascending(client):
    resp = client.get("/inventory", params={"sort": "stock"})
    assert resp.status_code == 200

    body = resp.json()
    quantities = [item["stock_quantity"] for item in body]
    assert quantities == sorted(quantities)
