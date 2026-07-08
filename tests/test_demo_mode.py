"""Demo-mode contract: /api/health metadata and demo dataset invariants."""
from __future__ import annotations

import pytest

from src import config


def test_health_reports_mode(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["mode"] == ("demo" if config.DEMO_MODE else "live")


@pytest.mark.skipif(not config.DEMO_MODE, reason="demo dataset only exists in demo mode")
def test_demo_dataset_is_deterministic_within_a_day():
    from src import demo_data

    first = demo_data.recent_orders(50)
    second = demo_data.recent_orders(50)
    assert first == second


@pytest.mark.skipif(not config.DEMO_MODE, reason="demo dataset only exists in demo mode")
def test_health_sample_customer_is_resolvable(client):
    email = client.get("/api/health").json()["sample_customer_email"]
    resp = client.get("/customers", params={"email": email})
    assert resp.status_code == 200
    profile = resp.json()

    orders = client.get(f"/customers/{profile['customer_id']}/orders").json()
    reviews = client.get(f"/customers/{profile['customer_id']}/reviews").json()
    assert orders, "sample customer must have in-flight orders"
    assert reviews, "sample customer must have recent reviews"
