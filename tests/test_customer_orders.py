"""REQ-005 — GET /customers/{customer_id}/orders."""
from __future__ import annotations

NONEXISTENT_CUSTOMER_ID = "00000000-0000-0000-0000-000000000000"

_TERMINAL_VS_INFLIGHT_STATUSES = {"pending", "processing", "shipped"}


def test_orders_for_active_customer(client, assert_matches_schema, sample_customer_id):
    resp = client.get(f"/customers/{sample_customer_id}/orders")
    assert resp.status_code == 200

    body = resp.json()
    assert len(body) > 0

    for order in body:
        assert_matches_schema(order, "CustomerOrder")
        assert order["order_status"] in _TERMINAL_VS_INFLIGHT_STATUSES
        assert len(order["items"]) > 0
        for item in order["items"]:
            assert_matches_schema(item, "OrderItem")


def test_empty_array_for_customer_with_no_inflight_orders(client, customer_with_no_orders):
    resp = client.get(f"/customers/{customer_with_no_orders}/orders")
    assert resp.status_code == 200
    assert resp.json() == []


def test_404_for_nonexistent_customer(client):
    resp = client.get(f"/customers/{NONEXISTENT_CUSTOMER_ID}/orders")
    assert resp.status_code == 404
