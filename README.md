# E-commerce Dashboard — IBM watsonx.data Spec-Coding Workshop

A read-only e-commerce operations dashboard built during IBM's **watsonx.data
shared-cloud spec-coding workshop**: the API contract and requirements were
written first ([spec/](spec/), [api/openapi.yaml](api/openapi.yaml)), then the
implementation was AI-coded against that spec and verified by an integration
test suite.

The original build ran **federated SQL** against a live watsonx.data cluster —
single Presto queries joining hot operational data in **Cassandra** with cold
historical rollups in **Iceberg**. Since the workshop cluster is ephemeral,
this repo also ships a **demo mode** that serves a deterministic generated
dataset with the exact same API shapes, so the app runs anywhere (including
the public Vercel deployment) with zero infrastructure.

## Architecture

```
             ┌──────────────────┐
  Browser ──▶│  FastAPI (src/)  │──▶ demo mode: src/demo_data.py (in-memory)
             │  + static UI     │
             └────────┬─────────┘
                      │ live mode (workshop credentials in .env)
             ┌────────▼─────────┐
             │      Presto      │  federated SQL engine (watsonx.data)
             └───┬──────────┬───┘
                 ▼          ▼
           Cassandra      Iceberg
          (hot/mutable) (cold/archive)
```

| Endpoint | Requirement | Data path (live mode) |
|---|---|---|
| `GET /sales/today` | REQ-001 | Federated: Cassandra `orders_inflight` × Iceberg `daily_sales_summary` |
| `GET /sales/today/by-category`, `/by-region` | REQ-002 | Federated join via Presto |
| `GET /inventory` | REQ-003 | Cassandra tables via Presto catalog |
| `GET /customers` | REQ-004 | Direct Cassandra point lookup |
| `GET /customers/{id}/orders` | REQ-005 | Direct Cassandra partition read |
| `GET /customers/{id}/reviews` | REQ-006 | Presto join over Cassandra tables |
| `GET /api/health` | — | Reports which mode (demo/live) is serving |

## Run locally

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.main:app --reload
```

Open <http://localhost:8000>. With no cluster credentials in the environment
the app starts in **demo mode** automatically (a banner in the UI says so and
suggests a sample customer for the lookup widget).

### Live mode (workshop cluster)

Copy `setup/workshop.env` values / run `setup/connect-workshop.sh` to produce
a `.env` with `WXD_HOST`, `PRESTO_HOST`, `CASSANDRA_HOST`, `WORKSHOP_USER`,
`WORKSHOP_PASSWORD`, and `WORKSHOP_SCHEMA_SUFFIX`, then:

```bash
pip install -r requirements-live.txt
uvicorn src.main:app --reload
```

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```

The suite asserts what `api/openapi.yaml` promises, not what the code happens
to return. In demo mode, tests that re-derive expectations from the live
cluster are skipped automatically; everything else (contract validation,
schema conformance, error handling) runs offline.

## Deployment

Deployed on Vercel as a Python serverless function: `vercel.json` rewrites all
routes to [api/index.py](api/index.py), which exposes the FastAPI app. No
environment variables are configured there, so it serves demo mode.

## Repo layout

- `spec/` — requirements + design written before any code (spec-coding)
- `api/openapi.yaml` — the API contract; tests validate against it
- `src/` — FastAPI app, Presto/Cassandra clients, demo dataset
- `static/` — vanilla JS dashboard UI
- `tests/` — contract + integration tests
- `setup/` — workshop connection scripts and sample-data schemas
- `docs/` — workshop workflow notes and troubleshooting guide
