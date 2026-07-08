"""REQ-004 — GET /customers. Focused on the error-handling contract:
400 for malformed/missing params, 404 for a well-formed but unknown id."""
from __future__ import annotations

KNOWN_CUSTOMER_ID = "1b175efd-b770-4b0b-a3d9-360912319a9b"
KNOWN_CUSTOMER_EMAIL = "sarah.davis291@example.com"
NONEXISTENT_CUSTOMER_ID = "00000000-0000-0000-0000-000000000000"


def test_lookup_by_id_matches_schema(client, assert_matches_schema):
    resp = client.get("/customers", params={"customer_id": KNOWN_CUSTOMER_ID})
    assert resp.status_code == 200
    body = resp.json()
    assert_matches_schema(body, "CustomerProfile")
    assert body["customer_id"] == KNOWN_CUSTOMER_ID


def test_lookup_by_id_and_email_return_same_customer(client):
    by_id = client.get("/customers", params={"customer_id": KNOWN_CUSTOMER_ID}).json()
    by_email = client.get("/customers", params={"email": KNOWN_CUSTOMER_EMAIL}).json()
    assert by_id == by_email


def test_400_when_no_params_given(client, assert_matches_schema):
    resp = client.get("/customers")
    assert resp.status_code == 400
    assert_matches_schema(resp.json(), "Error")


def test_400_when_both_params_given(client):
    resp = client.get(
        "/customers", params={"customer_id": KNOWN_CUSTOMER_ID, "email": KNOWN_CUSTOMER_EMAIL}
    )
    assert resp.status_code == 400


def test_400_for_malformed_customer_id(client):
    resp = client.get("/customers", params={"customer_id": "not-a-uuid"})
    assert resp.status_code == 400


def test_404_for_nonexistent_customer_id(client, assert_matches_schema):
    resp = client.get("/customers", params={"customer_id": NONEXISTENT_CUSTOMER_ID})
    assert resp.status_code == 404
    assert_matches_schema(resp.json(), "Error")


def test_404_for_nonexistent_customer_orders(client):
    resp = client.get(f"/customers/{NONEXISTENT_CUSTOMER_ID}/orders")
    assert resp.status_code == 404


def test_404_for_nonexistent_customer_reviews(client):
    resp = client.get(f"/customers/{NONEXISTENT_CUSTOMER_ID}/reviews")
    assert resp.status_code == 404


def test_400_for_malformed_customer_id_in_orders_path(client):
    resp = client.get("/customers/not-a-uuid/orders")
    assert resp.status_code == 400
