"""Shared fixtures for the test suite.

In live mode these tests run against the watsonx.data cluster (Presto +
Cassandra) — there is no mock layer. Per docs/getting-unstuck.md, tests
assert what api/openapi.yaml says, not what the implementation happens to
return.

In demo mode (no cluster credentials in the environment) the endpoints
serve src/demo_data.py, fixtures come from that dataset, and any test that
re-derives expectations directly from the cluster via run_query is skipped
automatically — see pytest_collection_modifyitems below.
"""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient
from jsonschema import RefResolver
from jsonschema.validators import validator_for

from src import config, demo_data
from src.clients.presto_client import run_query
from src.main import app

REPO_ROOT = Path(__file__).resolve().parents[1]
OPENAPI_PATH = REPO_ROOT / "api" / "openapi.yaml"
_CASS = f"cassandra_catalog.{config.PRESTO_SCHEMA}"


def pytest_collection_modifyitems(items) -> None:
    if not config.DEMO_MODE:
        return
    skip_live = pytest.mark.skip(
        reason="verifies API output against the live cluster via run_query; "
        "unavailable in demo mode"
    )
    for item in items:
        fn = getattr(item, "function", None)
        if fn is not None and "run_query" in fn.__code__.co_names:
            item.add_marker(skip_live)


@pytest.fixture(scope="session")
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(scope="session")
def sample_customer_id() -> str:
    """A customer_id with >=1 row in orders_inflight AND >=1 in
    reviews_recent, so REQ-005/006 tests have non-empty cases. Derived
    live so the tests survive a data reload."""
    if config.DEMO_MODE:
        return demo_data.sample_customer_id()
    rows = run_query(
        f"""
        SELECT o.customer_id
        FROM {_CASS}.orders_inflight o
        JOIN {_CASS}.reviews_recent r ON r.customer_id = o.customer_id
        GROUP BY o.customer_id
        LIMIT 1
        """
    )
    assert rows, "No customer found with both in-flight orders and recent reviews"
    return rows[0]["customer_id"]


@pytest.fixture(scope="session")
def customer_with_no_orders() -> str:
    """A customer_id that exists but has zero rows in orders_inflight."""
    if config.DEMO_MODE:
        return demo_data.customer_with_no_orders()
    rows = run_query(
        f"""
        SELECT c.customer_id
        FROM {_CASS}.customers c
        LEFT JOIN {_CASS}.orders_inflight o ON o.customer_id = c.customer_id
        WHERE o.customer_id IS NULL
        LIMIT 1
        """
    )
    assert rows, "No customer found with zero in-flight orders"
    return rows[0]["customer_id"]


@pytest.fixture(scope="session")
def customer_with_no_reviews() -> str:
    """A customer_id that exists but has zero rows in reviews_recent."""
    if config.DEMO_MODE:
        return demo_data.customer_with_no_reviews()
    rows = run_query(
        f"""
        SELECT c.customer_id
        FROM {_CASS}.customers c
        LEFT JOIN {_CASS}.reviews_recent r ON r.customer_id = c.customer_id
        WHERE r.customer_id IS NULL
        LIMIT 1
        """
    )
    assert rows, "No customer found with zero recent reviews"
    return rows[0]["customer_id"]


@pytest.fixture(scope="session")
def openapi_spec() -> dict:
    with OPENAPI_PATH.open() as f:
        return yaml.safe_load(f)


@pytest.fixture(scope="session")
def assert_matches_schema(openapi_spec):
    """Returns a function that validates a payload against a named
    component schema in api/openapi.yaml (resolving any internal $refs)."""

    def _assert(payload, schema_name: str) -> None:
        schema = openapi_spec["components"]["schemas"][schema_name]
        resolver = RefResolver.from_schema(openapi_spec)
        validator_cls = validator_for(schema)
        validator = validator_cls(schema, resolver=resolver)
        validator.validate(payload)

    return _assert
