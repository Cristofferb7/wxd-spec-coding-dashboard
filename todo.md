
# E-commerce Workshop — Build Tasks

Source of truth: `spec/requirements.md` (REQs) → `spec/design.md` (data access) →
`api/openapi.yaml` (contract). Domain: ecommerce only (`user-08`).

---

## Phase 0 — Project scaffold

- [x] `requirements.txt`: `fastapi`, `uvicorn`, `cassandra-driver`, `python-dotenv`, `pydantic`. Use stdlib `urllib` for the Presto client (mirrors `setup/lib/smoke_test.py`) — no extra HTTP dep needed.
- [x] `src/config.py` — loads `.env` (`python-dotenv`): `CASSANDRA_HOST`, `CASSANDRA_PORT`, `WXD_HOST`, `PRESTO_HOST`, `WORKSHOP_USER`, `WORKSHOP_PASSWORD`, `WORKSHOP_SCHEMA_SUFFIX`. No hardcoded hosts/credentials anywhere else.
- [x] `src/main.py` — FastAPI app, mounts routers, registers exception handlers (404 → `{"detail": ...}`, Presto failure → 502).

## Phase 1 — Shared clients

- [x] `src/clients/cassandra_client.py`
  - `cassandra-driver` `Cluster` with `RouteEndPointFactory` (collapse all discovered nodes to `${CASSANDRA_HOST}:443`) — copy the pattern from `AGENTS.md` / `smoke_test.py`, do not re-derive.
  - `ssl_context.check_hostname = False`, `ssl_options={'server_hostname': CASSANDRA_HOST}`, `auth_provider=PlainTextAuthProvider(WORKSHOP_USER, WORKSHOP_PASSWORD)`.
  - Exposes a session bound to keyspace `ecommerce_{WORKSHOP_SCHEMA_SUFFIX}`.
  - **Used only by REQ-004 and REQ-005** — direct hot-data point lookups.
- [x] `src/clients/presto_client.py`
  - Two-step bearer-token auth (`/icp4d-api/v1/authorize`), cache token in-process (~12h).
  - `run_query(sql) -> list[dict]`: POST to `/v1/statement`, poll `nextUri` until `stats.state == "FINISHED"`, raise on `"FAILED"` (caught by main.py → 502).
  - **Used by REQ-001, REQ-002 (federated `cassandra_catalog` + `iceberg_data`), REQ-003 and REQ-006 (`cassandra_catalog` only)**.
- [x] `src/models.py` — Pydantic models mirroring `api/openapi.yaml` components: `SalesToday`, `CategoryBreakdown`, `RegionBreakdown`, `InventoryItem`, `CustomerProfile`, `CustomerOrder`, `OrderItem`, `CustomerReview`, `Error`.

---

## Phase 2 — Endpoints

Each task = router function + the exact query from `spec/design.md` + data-source check.

- [x] **`GET /sales/today`** (REQ-001) — `src/routers/sales.py`
  - Data source: **federated** — single Presto statement over `cassandra_catalog.ecommerce_user08.orders_inflight` (today's count/revenue) `CROSS JOIN` `iceberg_data.ecommerce_reference.daily_sales_summary` (30-day baseline).
  - Compute `delta.order_count_pct` / `delta.revenue_pct` in Python: `(today - baseline) / baseline * 100`.

- [x] **`GET /sales/today/by-category`** (REQ-002) — `src/routers/sales.py`
  - Data source: **federated** — `order_items_inflight` ⋈ `orders_inflight` ⋈ `products` (all `cassandra_catalog`) `FULL OUTER JOIN` category-grouped `daily_sales_summary` (`iceberg_data.ecommerce_reference`).
  - Sort by `revenue` descending.

- [x] **`GET /sales/today/by-region`** (REQ-002) — `src/routers/sales.py`
  - Data source: **federated** — `orders_inflight` (`cassandra_catalog`) `FULL OUTER JOIN` region-grouped `daily_sales_summary` (`iceberg_data.ecommerce_reference`).
  - Sort by `revenue` descending.

- [x] **`GET /inventory?sort=stock|urgency`** (REQ-003) — `src/routers/inventory.py`
  - Data source: **Cassandra-only**, via `cassandra_catalog` — `products` `LEFT JOIN` (`inventory_ledger_recent` grouped by `product_id` for `MAX(created_at)`).
  - `last_move_at` must be `null` (not omitted, not an error) when a product has no ledger row — verified 50/200 products hit this.
  - `sort=stock` → `ORDER BY stock_quantity ASC`; `sort=urgency` → `ORDER BY (stock_quantity - reorder_level) ASC`.

- [x] **`GET /customers?customer_id=|email=`** (REQ-004) — `src/routers/customers.py`
  - Data source: **direct Cassandra** (`cassandra-driver`, not Presto) — point lookup on `customers` by primary key or `customers_email_idx`.
  - 400 if zero or both params given; 404 if no row.

- [x] **`GET /customers/{customer_id}/orders`** (REQ-005) — `src/routers/customers.py`
  - Data source: **direct Cassandra** (`cassandra-driver`) — `orders_inflight WHERE customer_id=?` (partition key), then `order_items_inflight WHERE order_id=?` per order.
  - 404 only if the customer doesn't exist (check via REQ-004 lookup first); `[]` if customer exists but has no in-flight orders.

- [x] **`GET /customers/{customer_id}/reviews`** (REQ-006) — `src/routers/customers.py`
  - Data source: **Presto over `cassandra_catalog`** (not `cassandra-driver` — `reviews_recent` has no index on `customer_id`, so this is a scan, not a partition lookup) — `reviews_recent` ⋈ `products` for `product_name`.
  - 404 only if the customer doesn't exist; `[]` if no reviews in last 30 days.

---

## Phase 3 — Tests (`tests/`)

Per `docs/getting-unstuck.md`: tests assert what `openapi.yaml` says, not what the implementation happens to return. If a test fails, fix the implementation (or fix the spec first, explicitly, then the test).

- [x] `tests/conftest.py`
  - `client` fixture: FastAPI `TestClient`.
  - `sample_customer_id` fixture: query Cassandra directly for a `customer_id` that has ≥1 row in `orders_inflight` AND ≥1 row in `reviews_recent` (so REQ-005/006 tests have non-empty cases) — don't hardcode a UUID, derive it live so tests survive a data reload.
  - `openapi_spec` fixture: load and parse `api/openapi.yaml` once.
  - Helper `assert_matches_schema(payload, schema_name)` — validates a response body against the named component schema in `openapi.yaml` via `jsonschema`.

- [x] `tests/test_sales_today.py` (REQ-001)
  - 200 + matches `SalesToday` schema.
  - `as_of_date` equals `MAX(order_date)` from a direct check against `orders_inflight`.
  - `today.order_count` / `today.revenue` are non-negative.
  - `delta.*_pct == (today - baseline_30d_avg) / baseline_30d_avg * 100` within floating-point tolerance.

- [x] `tests/test_sales_breakdown.py` (REQ-002)
  - For both `/by-category` and `/by-region`: 200 + array items match `CategoryBreakdown`/`RegionBreakdown` schema.
  - Response is sorted by `revenue` descending.
  - `/by-category` categories are a subset of the known `products.category` values.
  - Every item has both `order_count`/`revenue` (today) and `baseline_order_count`/`baseline_revenue` populated (possibly 0/0 for today if nothing sold).

- [x] `tests/test_inventory.py` (REQ-003)
  - 200 + array length == total product count + each item matches `InventoryItem`.
  - `below_reorder == (stock_quantity < reorder_level)` for every item.
  - At least one item has `last_move_at: null` (regression guard for the no-movement case).
  - `sort=urgency` puts all `below_reorder=true` items before any `below_reorder=false` item.

- [x] `tests/test_customers.py` (REQ-004)
  - Lookup by `customer_id` and by `email` for the same customer return identical bodies.
  - 400 when neither param given; 400 when both given; 400 for malformed UUID.
  - 404 for a well-formed but non-existent `customer_id`.
  - Response matches `CustomerProfile` schema (incl. `shipping_city/state/country`, no invented "address" field).

- [x] `tests/test_customer_orders.py` (REQ-005)
  - For `sample_customer_id`: 200, non-empty, every order has `order_status` in `{pending, processing, shipped}` and a non-empty `items` array matching `OrderItem`.
  - For a customer known to have zero in-flight orders: 200 + `[]` (not 404).
  - 404 for non-existent `customer_id`.

- [x] `tests/test_customer_reviews.py` (REQ-006)
  - For `sample_customer_id`: 200, non-empty, every item matches `CustomerReview`, `rating` in 1–5.
  - For a customer with zero recent reviews: 200 + `[]`.
  - 404 for non-existent `customer_id`.

- [x] `tests/test_openapi_contract.py`
  - `api/openapi.yaml` parses and validates (3.1) — regression guard.
  - Every REQ-ID in `spec/requirements.md` appears in at least one endpoint `description` (and vice versa) — automated version of the getting-unstuck.md propagation check.

---

## Phase 4 — Wiring + demo

- [x] `uvicorn src.main:app --reload` runs cleanly.
- [x] Run full test suite against the live cluster; expect Presto-backed tests to take several seconds each (shared coordinator — not a bug). 34/34 pass.
- [x] Manual smoke: hit all 7 endpoints via `curl`/Swagger UI (`/docs`), confirm shapes match the `examples:` in `openapi.yaml`.
- [x] Static UI (`static/`) wired up at `/`, served by FastAPI; covers all 7 endpoints with live data.
