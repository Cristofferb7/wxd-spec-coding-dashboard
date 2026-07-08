"""REQ-006 — GET /customers/{customer_id}/reviews."""
from __future__ import annotations

NONEXISTENT_CUSTOMER_ID = "00000000-0000-0000-0000-000000000000"


def test_reviews_for_active_customer(client, assert_matches_schema, sample_customer_id):
    resp = client.get(f"/customers/{sample_customer_id}/reviews")
    assert resp.status_code == 200

    body = resp.json()
    assert len(body) > 0

    for review in body:
        assert_matches_schema(review, "CustomerReview")
        assert 1 <= review["rating"] <= 5


def test_empty_array_for_customer_with_no_recent_reviews(client, customer_with_no_reviews):
    resp = client.get(f"/customers/{customer_with_no_reviews}/reviews")
    assert resp.status_code == 200
    assert resp.json() == []


def test_404_for_nonexistent_customer(client):
    resp = client.get(f"/customers/{NONEXISTENT_CUSTOMER_ID}/reviews")
    assert resp.status_code == 404
