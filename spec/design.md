# E-commerce Workshop — Design

## Tech stack

- **Python 3.11+ / FastAPI** for the API layer (matches the workshop's reference patterns and `setup/lib/smoke_test.py`).
- **`cassandra-driver`** for direct, single-key Cassandra reads (REQ-004, REQ-005) — uses the `RouteEndPointFactory` pattern from `AGENTS.md` (collapses discovered nodes to `${CASSANDRA_HOST}:443`).
- **Presto HTTP API** (two-step bearer token, per `setup/lib/smoke_test.py`'s `probe_presto`) for every query that touches Iceberg, joins across Cassandra tables, or scans a table without a usable partition/index key (REQ-001, REQ-002, REQ-003, REQ-006). A small `presto_client` module wraps auth + the `nextUri` polling loop and caches the bearer token (~12h validity).
- **`python-dotenv`** to load `.env` — no hardcoded credentials, host names, or schema suffixes.

### Catalog/schema names actually used (verified against the live cluster, `user-08`)

> **Correction to `AGENTS.md`/`workflow.md`**: their example queries use a Presto catalog named `cassandra`. On this cluster the catalog is **`cassandra_catalog`**. `SHOW CATALOGS` returns: `cassandra_catalog, hive_data, iceberg_data, jmx, system, tpcds, tpch`. All queries below use `cassandra_catalog`.

| Logical name | Actual identifier |
|---|---|
| Your Cassandra keyspace (via Presto) | `cassandra_catalog.ecommerce_{WORKSHOP_SCHEMA_SUFFIX}` |
| Your Cassandra keyspace (via cassandra-driver) | `ecommerce_{WORKSHOP_SCHEMA_SUFFIX}` |
| Shared read-only analytical baseline | `iceberg_data.ecommerce_reference` |
| Your (empty) Iceberg schema | `iceberg_data.ecommerce_{WORKSHOP_SCHEMA_SUFFIX}` |

`daily_sales_summary`, `orders_archive`, `customer_ltv_monthly`, `competitor_prices_weekly`, etc. all live in **`ecommerce_reference`** (shared, read-only) — not in the per-user Iceberg schema, which is empty.

---

## Shared concept: "today" and the 30-day baseline

Per `requirements.md` → Definitions, this is a **fixed snapshot**, not live data. Verified against `user-08`'s data:

- `orders_inflight` / `reviews_recent` / `inventory_ledger_recent` span **2026-03-24 → 2026-04-23**.
- `iceberg_data.ecommerce_reference.daily_sales_summary` spans **2025-03-24 → 2026-03-23** — i.e. it ends exactly the day before the operational window starts. **The two windows do not overlap.**

So:

- **`as_of_date`** (= "today") = `SELECT MAX(order_date) FROM cassandra_catalog.ecommerce_{suffix}.orders_inflight` → currently `2026-04-23`.
- **Baseline window** = the most recent 30 days *of `daily_sales_summary` itself*: `summary_date > (SELECT MAX(summary_date) FROM ...daily_sales_summary) - INTERVAL '30' DAY` → currently `2026-02-22 .. 2026-03-23`. **Not** `as_of_date - 30 .. as_of_date - 1` (that range has zero rows in `daily_sales_summary`).

Both endpoints below compute these dynamically via subqueries — no hardcoded dates.

---

## REQ-ID → endpoint map

| Endpoint | REQ-ID(s) | Pattern |
|---|---|---|
| `GET /sales/today` | REQ-001 | **Federated** (Cassandra + Iceberg in one statement) — also exercises a pure Iceberg read (the baseline CTE) and a pure Cassandra read (the today CTE) |
| `GET /sales/today/by-category` | REQ-002 | Federated |
| `GET /sales/today/by-region` | REQ-002 | Federated |
| `GET /inventory` | REQ-003 | Cassandra (cross-table join via `cassandra_catalog`) |
| `GET /customers` | REQ-004 | Cassandra (direct driver, point lookup) |
| `GET /customers/{customer_id}/orders` | REQ-005 | Cassandra (direct driver, partition-key lookups) |
| `GET /customers/{customer_id}/reviews` | REQ-006 | Cassandra (`cassandra_catalog`, full scan — see note) |

This satisfies the "one Cassandra read / one Iceberg read / one federated read" minimum within `GET /sales/today` alone, plus dedicated single-store endpoints.

---

## Endpoints

### `GET /sales/today` — REQ-001

Single Presto statement:

```sql
WITH today AS (
  SELECT COUNT(*) AS order_count, COALESCE(SUM(total_amount), 0) AS revenue
  FROM cassandra_catalog.ecommerce_user08.orders_inflight
  WHERE order_date = (SELECT MAX(order_date) FROM cassandra_catalog.ecommerce_user08.orders_inflight)
),
baseline_days AS (
  SELECT summary_date, SUM(order_count) AS daily_orders, SUM(net_revenue) AS daily_revenue
  FROM iceberg_data.ecommerce_reference.daily_sales_summary
  WHERE summary_date > (SELECT MAX(summary_date) FROM iceberg_data.ecommerce_reference.daily_sales_summary) - INTERVAL '30' DAY
  GROUP BY summary_date
)
SELECT
  (SELECT MAX(order_date) FROM cassandra_catalog.ecommerce_user08.orders_inflight) AS as_of_date,
  today.order_count, today.revenue,
  AVG(baseline_days.daily_orders) AS baseline_order_count,
  AVG(baseline_days.daily_revenue) AS baseline_revenue
FROM today CROSS JOIN baseline_days
GROUP BY today.order_count, today.revenue
```

App layer computes `*_pct_change = (today - baseline) / baseline * 100` for both metrics.

**Verified result (user-08):** `as_of_date=2026-04-23`, today = 15 orders / $100,691.33; baseline ≈ 18.87 orders / $58,058.28 → order count −20.5%, revenue +73.4%.

### `GET /sales/today/by-category` — REQ-002

```sql
WITH today_cat AS (
  SELECT p.category, COUNT(DISTINCT oi.order_id) AS order_count, SUM(oi.line_total) AS revenue
  FROM cassandra_catalog.ecommerce_user08.order_items_inflight oi
  JOIN cassandra_catalog.ecommerce_user08.orders_inflight o ON o.order_id = oi.order_id
  JOIN cassandra_catalog.ecommerce_user08.products p ON p.product_id = oi.product_id
  WHERE o.order_date = (SELECT MAX(order_date) FROM cassandra_catalog.ecommerce_user08.orders_inflight)
  GROUP BY p.category
),
baseline_cat AS (
  SELECT product_category,
         AVG(cat_revenue) AS avg_revenue,
         AVG(cat_orders) AS avg_order_count
  FROM (
    SELECT summary_date, product_category,
           SUM(net_revenue) AS cat_revenue, SUM(order_count) AS cat_orders
    FROM iceberg_data.ecommerce_reference.daily_sales_summary
    WHERE summary_date > (SELECT MAX(summary_date) FROM iceberg_data.ecommerce_reference.daily_sales_summary) - INTERVAL '30' DAY
    GROUP BY summary_date, product_category
  )
  GROUP BY product_category
)
SELECT COALESCE(t.category, b.product_category) AS category,
       COALESCE(t.order_count, 0) AS order_count,
       COALESCE(t.revenue, 0) AS revenue,
       b.avg_order_count AS baseline_order_count,
       b.avg_revenue AS baseline_revenue
FROM today_cat t FULL OUTER JOIN baseline_cat b ON t.category = b.product_category
ORDER BY revenue DESC
```

`FULL OUTER JOIN` because a category can appear in one side and not the other (e.g. nothing sold today in a category that has a baseline).

### `GET /sales/today/by-region` — REQ-002

Same shape, grouped by `shipping_state` instead of category:

```sql
WITH today_region AS (
  SELECT shipping_state, COUNT(*) AS order_count, SUM(total_amount) AS revenue
  FROM cassandra_catalog.ecommerce_user08.orders_inflight
  WHERE order_date = (SELECT MAX(order_date) FROM cassandra_catalog.ecommerce_user08.orders_inflight)
  GROUP BY shipping_state
),
baseline_region AS (
  SELECT shipping_state,
         AVG(reg_revenue) AS avg_revenue,
         AVG(reg_orders) AS avg_order_count
  FROM (
    SELECT summary_date, shipping_state,
           SUM(net_revenue) AS reg_revenue, SUM(order_count) AS reg_orders
    FROM iceberg_data.ecommerce_reference.daily_sales_summary
    WHERE summary_date > (SELECT MAX(summary_date) FROM iceberg_data.ecommerce_reference.daily_sales_summary) - INTERVAL '30' DAY
    GROUP BY summary_date, shipping_state
  )
  GROUP BY shipping_state
)
SELECT COALESCE(t.shipping_state, b.shipping_state) AS region,
       COALESCE(t.order_count, 0) AS order_count,
       COALESCE(t.revenue, 0) AS revenue,
       b.avg_order_count AS baseline_order_count,
       b.avg_revenue AS baseline_revenue
FROM today_region t FULL OUTER JOIN baseline_region b ON t.shipping_state = b.shipping_state
ORDER BY revenue DESC
```

### `GET /inventory` — REQ-003

Cross-table join within `cassandra_catalog` (Presto). `inventory_ledger_recent`'s partition key is `(product_id, transaction_date)`, so "last move per product" is computed via `GROUP BY product_id` rather than per-product point queries:

```sql
SELECT p.product_id, p.sku, p.name, p.category, p.stock_quantity, p.reorder_level,
       (p.stock_quantity < p.reorder_level) AS below_reorder,
       lm.last_move_at
FROM cassandra_catalog.ecommerce_user08.products p
LEFT JOIN (
  SELECT product_id, MAX(created_at) AS last_move_at
  FROM cassandra_catalog.ecommerce_user08.inventory_ledger_recent
  GROUP BY product_id
) lm ON lm.product_id = p.product_id
```

`last_move_at` is `null` when absent — **verified this happens in practice** (50 of 200 products have no ledger entry in the 30-day window). Per REQ-003, the API returns `last_move_at: null` for these; the client renders "no movement in last 30 days".

Sorting (`?sort=stock` default | `?sort=urgency`):
- `stock`: `ORDER BY p.stock_quantity ASC`
- `urgency`: `ORDER BY (p.stock_quantity - p.reorder_level) ASC` (most-overdrawn-relative-to-threshold first; `below_reorder=true` rows sort first)

### `GET /customers` — REQ-004

Direct `cassandra-driver` read against `ecommerce_user08.customers`. Exactly one of `customer_id` or `email` query params required (400 if neither/both).

```cql
-- by id (primary key point lookup)
SELECT customer_id, email, first_name, last_name, phone, account_status, loyalty_tier,
       current_ltv, total_orders, shipping_city, shipping_state, shipping_country
FROM customers WHERE customer_id = %s

-- by email (uses customers_email_idx)
SELECT ... FROM customers WHERE email = %s
```

404 if no row found. `account_status`/`loyalty_tier` are returned verbatim (observed values: `active`/`suspended`, `bronze`/`silver`/`gold`/`platinum` — not enumerated as a fixed set in the API contract per the REQ-004 fix).

### `GET /customers/{customer_id}/orders` — REQ-005

Two direct `cassandra-driver` reads, both partition-key lookups (efficient):

```cql
SELECT order_id, order_date, order_status, payment_status, total_amount, currency,
       tracking_number, estimated_delivery_date
FROM orders_inflight WHERE customer_id = %s

-- for each order_id returned:
SELECT product_id, product_name, product_sku, quantity, unit_price, line_total
FROM order_items_inflight WHERE order_id = %s
```

A customer typically has 0–3 in-flight orders, so the per-order item fetch is a small, bounded fan-out (not an N+1 concern at this scale). Returns `[]` (200, empty list) for a customer with no in-flight orders — not a 404, since the customer itself may still exist.

### `GET /customers/{customer_id}/reviews` — REQ-006

> **Schema note**: `reviews_recent`'s primary key is `(product_id, review_date), review_id` — there is **no index on `customer_id`**. A per-customer lookup with `cassandra-driver` would require `ALLOW FILTERING` (full table scan). Instead we run the equivalent scan through Presto, which also lets us join `products` for the product name in one statement (400 rows total in this table — fine at this scale; would need a customer-keyed index or materialized view at production scale).

```sql
SELECT r.review_id, p.name AS product_name, r.rating, r.title, r.verified_purchase, r.review_date
FROM cassandra_catalog.ecommerce_user08.reviews_recent r
JOIN cassandra_catalog.ecommerce_user08.products p ON p.product_id = r.product_id
WHERE r.customer_id = ?
ORDER BY r.review_date DESC
```

Returns `[]` (200) if the customer has no reviews in the last 30 days.

---

## Error handling conventions

- `404 Not Found` — `{customer_id}` doesn't exist (REQ-004/005/006), or `email`/`customer_id` lookup in REQ-004 matches no row.
- `400 Bad Request` — REQ-004 called with neither or both of `customer_id`/`email`.
- `502 Bad Gateway` — Presto query fails (`stats.state == "FAILED"`) or returns malformed response; the proxied Presto error message is included in `detail`.
- All error responses use the shape `{"detail": "<message>"}` (FastAPI default), documented in `openapi.yaml`.

---

## Open design notes

- `daily_sales_summary` is partitioned by `(summary_year, summary_month)`; the `summary_date > MAX(summary_date) - INTERVAL '30' DAY` predicates above may span two months. At this table's size (~5,656 rows total) this is not a performance problem, but if it becomes one, add explicit `summary_year`/`summary_month IN (...)` predicates derived from the same date bounds.
- All five "today"/"baseline" subqueries (`MAX(order_date)`, `MAX(summary_date)`) are cheap (single-partition / small-table scans) but are recomputed per request. If latency becomes an issue under Presto contention, cache `as_of_date` and `baseline_end_date` for a short TTL (e.g. 60s) at the app layer — not changed per-request anyway in a static snapshot.
