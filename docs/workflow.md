# Workshop Workflow — watsonx.data Shared-Cloud

## What this workshop is

A 3-hour hands-on session where you build a real app against a **live IBM watsonx.data cluster**. The data is pre-loaded; you write the code. The core idea is **federated querying**: a single SQL statement that joins hot operational data in Cassandra with cold historical data in Iceberg (via Presto).

You steer the build by reading exercise prompts from the instructor. The AI agent writes the code.

---

## Architecture

```
                      ┌─────────────┐
                      │    Presto    │  ← federated SQL engine (watsonx.data)
                      └──┬───────┬──┘
                         │       │
             ┌───────────┘       └───────────┐
             ▼                               ▼
  ┌─────────────────┐             ┌─────────────────┐
  │   Cassandra      │             │     Iceberg      │
  │  (hot/mutable)   │             │  (cold/archive)  │
  │  current state   │             │  history + rollup│
  │  single-row ops  │             │  aggregate scans │
  └─────────────────┘             └─────────────────┘
```

| Layer      | Role                          | What it holds                                             |
|------------|-------------------------------|-----------------------------------------------------------|
| Cassandra  | Operational / transactional   | Active records, recent events, live state, open work      |
| Iceberg    | Analytical / archival         | Closed records, monthly/weekly rollups, external feeds    |
| Presto     | Unified query engine          | Talks to both; enables cross-store federated joins        |

---

## Connection details (user-27)

The `.env` file was written at the repo root by `connect-workshop.sh`. All code must read from it — do not hardcode credentials.

| Variable                | Value / description                                              |
|-------------------------|------------------------------------------------------------------|
| `WXD_HOST`              | Software Hub hostname (Presto auth + browser UI)                 |
| `PRESTO_HOST`           | Presto HTTP endpoint                                             |
| `PRESTO_PORT`           | `443`                                                            |
| `CASSANDRA_HOST`        | Cassandra TLS-passthrough Route hostname                         |
| `CASSANDRA_PORT`        | `443` (not the native 9042)                                      |
| `CASSANDRA_USE_SSL`     | `true`                                                           |
| `WORKSHOP_USER`         | `user-27`                                                        |
| `WORKSHOP_PASSWORD`     | your slip password                                               |
| `WORKSHOP_SCHEMA_SUFFIX`| `user27` (appended to per-user schema names)                     |

Software Hub UI: `https://cpd-cpd-instance.apps.itz-pmli45.infra01-lb.wdc04.techzone.ibm.com/`
Login: `user-27` / your slip password

---

## Naming convention: your slice vs shared reference

Every domain has two variants:

| Pattern                  | Location          | Access              | Purpose                              |
|--------------------------|-------------------|---------------------|--------------------------------------|
| `{domain}_user27`        | Cassandra + Iceberg | Read + Write       | Your personal writable slice         |
| `{domain}_reference`     | Iceberg only       | Read-only (shared) | Analytical baseline shared by all attendees |

Examples for `user-27`:
- `cassandra.ecommerce_user27.orders` — writable Cassandra table (you can INSERT here)
- `iceberg_data.ecommerce_user27.dashboard_results` — your empty Iceberg schema (CREATE TABLE during exercises)
- `iceberg_data.ecommerce_reference.orders_archive` — shared, read-only archived data

> **Never write to `_reference` schemas** — they're pre-loaded and shared across the room.

---

## The three domains

Pick **one domain** per exercise. Feed the LLM only that domain's DDL files, not all three.

### E-commerce (`setup/sample-data/ecommerce/`)

| Store     | Key tables                                                        |
|-----------|-------------------------------------------------------------------|
| Cassandra | `customers`, `products`, `orders_inflight`, `active_carts`, `reviews_recent` |
| Iceberg   | `orders_archive`, `daily_sales_summary`, `customer_ltv_monthly`, `competitor_prices_weekly` |

**Starter app idea:** today's orders + revenue (`orders_inflight`) vs. 30-day daily average (`daily_sales_summary`).

### IoT (`setup/sample-data/iot/`)

| Store     | Key tables                                                        |
|-----------|-------------------------------------------------------------------|
| Cassandra | `device_state_current`, `readings_hot`, `alerts_open`, `topology_current` |
| Iceberg   | `readings_archive`, `hourly_aggregates`, `daily_site_summary`, `failure_history` |

**Starter app idea:** per-device last-hour readings vs. 7-day baseline — flag unusual devices.

### Financial (`setup/sample-data/financial/`)

| Store     | Key tables                                                        |
|-----------|-------------------------------------------------------------------|
| Cassandra | `customers`, `accounts`, `card_transactions_recent`, `fraud_alerts_open` |
| Iceberg   | `transactions_archive`, `account_statements_monthly`, `portfolio_metrics_daily`, `market_data_daily` |

**Starter app idea:** recent card transactions vs. 30-day spend average.

---

## How to connect from Python (working pattern)

```python
import os, ssl
from cassandra.cluster import Cluster
from cassandra.auth import PlainTextAuthProvider
from cassandra.connection import DefaultEndPoint, EndPointFactory
from dotenv import load_dotenv

load_dotenv()

ctx = ssl.create_default_context()
ctx.check_hostname = False  # cert SANs are hostnames, not IPs

CASS_HOST = os.environ['CASSANDRA_HOST']
CASS_PORT = int(os.environ['CASSANDRA_PORT'])  # 443

class RouteEndPointFactory(EndPointFactory):
    # Collapses all discovered internal pod IPs back to the single Route endpoint.
    # Without this, the driver stalls ~15s per node trying unreachable 10.x:9042.
    def __init__(self, host, port): self._host = host; self._port = port
    def create(self, row): return DefaultEndPoint(self._host, self._port)
    def create_from_sni(self, sni): return DefaultEndPoint(self._host, self._port)

cluster = Cluster(
    contact_points=[CASS_HOST], port=CASS_PORT,
    ssl_context=ctx,
    ssl_options={'server_hostname': CASS_HOST},
    endpoint_factory=RouteEndPointFactory(CASS_HOST, CASS_PORT),
    auth_provider=PlainTextAuthProvider(
        os.environ['WORKSHOP_USER'], os.environ['WORKSHOP_PASSWORD']
    ),
)
session = cluster.connect(f"ecommerce_{os.environ['WORKSHOP_SCHEMA_SUFFIX']}")
```

### Presto / watsonx.data (two-step bearer token)

```python
import json, ssl, urllib.request, os
from dotenv import load_dotenv
load_dotenv()

ctx = ssl.create_default_context()
wxd_host = os.environ['WXD_HOST']
presto_host = os.environ['PRESTO_HOST']
user = os.environ['WORKSHOP_USER']
password = os.environ['WORKSHOP_PASSWORD']

# Step 1: mint token
req = urllib.request.Request(
    f"https://{wxd_host}/icp4d-api/v1/authorize",
    method="POST",
    headers={"Content-Type": "application/json"},
    data=json.dumps({"username": user, "password": password}).encode(),
)
with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
    token = json.loads(r.read())["token"]

# Step 2: POST SQL + poll nextUri until stats.state == "FINISHED"
req = urllib.request.Request(
    f"https://{presto_host}/v1/statement",
    method="POST",
    headers={"Authorization": f"Bearer {token}",
             "X-Presto-User": user, "Content-Type": "text/plain"},
    data=b"SHOW SCHEMAS FROM iceberg_data",
)
# ... poll resp["nextUri"] collecting resp["data"] rows
```

Full working reference: `setup/lib/smoke_test.py` — the `probe_cassandra` and `probe_presto` functions are copy-paste ready.

---

## Example federated query

```sql
SELECT c.customer_id, COUNT(o.order_id) AS recent_orders
FROM cassandra.ecommerce_user27.customers c
LEFT JOIN iceberg_data.ecommerce_reference.orders_archive o
  ON o.customer_id = c.customer_id
WHERE o.order_date >= DATE '2025-01-01'
GROUP BY c.customer_id
ORDER BY recent_orders DESC
LIMIT 10
```

This joins Cassandra (hot customer records) with Iceberg (cold order archive) in a single Presto statement — the workshop's central demo.

---

## Exercise flow (3 hours)

```
Hour 1 — Requirements (Exercise 1)
  ↓  Instructor projects exercise prompt
  ↓  Choose domain (ecommerce / iot / financial)
  ↓  Agent reads SCHEMAS.md + DDL files for that domain
  ↓  Produce spec/requirements.md  (5–7 concrete, testable REQs)

Hour 2 — Design + OpenAPI (Exercise 2)
  ↓  Agent reads requirements.md
  ↓  Produce spec/design.md  (data flow, which tables, federated SQL)
  ↓  Produce api/openapi.yaml  (endpoints with response examples)
  ↓  Verify: every REQ-ID covered by at least one endpoint

Hour 3 — Build + Test (Exercise 3)
  ↓  Agent reads openapi.yaml + design.md
  ↓  Produce todo.md  (task list)
  ↓  Generate src/ code + tests/
  ↓  Run tests; fix failures
  ↓  Demo: one endpoint end-to-end through the UI

Hour 4 (optional) — Expand
  ↓  Add a new REQ
  ↓  Propagate: requirements.md → openapi.yaml → todo.md → code → test → UI
```

---

## Before writing any code — checklist

1. **Read SCHEMAS.md** — understand which tables exist in your domain.
2. **Read the DDL files** for your domain:
   - `setup/sample-data/<domain>/cassandra_schema.cql` — partition keys, clustering columns, constraints
   - `setup/sample-data/<domain>/iceberg_schema.sql` — column types, partitioning
3. Never reference a table that isn't in those DDL files. Common hallucinations to avoid: `customer_dim`, `sales_fact`, `daily_metrics`, `customer_cohort_analysis` — none of these exist.
4. Every endpoint in `openapi.yaml` must trace back to a REQ-ID in `requirements.md`.
5. Tests assert what the spec says, not what the implementation happens to return.

---

## Boundaries

| Rule | Reason |
|------|--------|
| No `oc`, `helm`, or `cpd-cli` | You don't have cluster-admin credentials |
| Don't write to `_reference` schemas | Shared + read-only for all attendees |
| Don't access other attendees' `_userNN` slices | Enforced by Cassandra GRANTs + Presto ACLs |
| No local installs / Podman / image pulls | Cloud variant — no local watsonx.data |
| Presto queries may be slow (several seconds) | Single shared coordinator for 15–30 attendees |
| Data does not persist after the cluster is torn down | Save code on your laptop |

---

## Troubleshooting quick-reference

| Symptom | Likely cause | Action |
|---------|-------------|--------|
| Cassandra connect hangs ~15s | Driver dialing internal pod IPs (10.x:9042) | Add `RouteEndPointFactory` (see connection pattern above) |
| `AuthenticationFailed` / "Bad credentials" | Wrong password | Re-check slip; re-run `connect-workshop.sh` |
| Presto 401 after a break | Bearer token expired (~12h) | Re-run `./setup/connect-workshop.sh user-27 '<password>'` |
| `Schema/catalog does not exist` (Presto→Cassandra) | Cassandra not registered in watsonx.data UI | Follow the Cassandra registration steps in `docs/getting-unstuck.md` |
| Federated query hangs or returns no rows | Missing partition filter or missing JOIN ON clause | Add `WHERE year=... AND month=...` and verify JOIN condition |
| UI shows no data | CORS misconfigured, wrong backend URL, or swallowed 500 | Fix CORS headers; check network tab; surface the exception |

Full playbook: `docs/getting-unstuck.md`

---

## Key files reference

| File | Purpose |
|------|---------|
| `AGENTS.md` | Master instructions for the AI agent |
| `SCHEMAS.md` | High-level domain schema overview |
| `setup/connect-workshop.sh` | One-time connection + smoke-test script |
| `setup/workshop.env` | Baked cluster endpoints (do not edit) |
| `setup/lib/smoke_test.py` | Working connection reference for both Cassandra and Presto |
| `setup/sample-data/<domain>/cassandra_schema.cql` | Exact Cassandra DDL |
| `setup/sample-data/<domain>/iceberg_schema.sql` | Exact Iceberg DDL |
| `docs/getting-unstuck.md` | Symptom → fix playbook |
| `.env` | Generated credentials (loaded by your code) |
| `.env.example` | Template showing what `.env` looks like |
