"""FastAPI app: e-commerce workshop dashboard API + static UI."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from src import config
from src.clients.cassandra_client import CassandraError
from src.clients.presto_client import PrestoQueryError
from src.routers import customers, inventory, sales

app = FastAPI(
    title="E-commerce Workshop API",
    version="2.0.0",
    description=(
        "Read-only dashboard API over the watsonx.data shared-cloud workshop "
        "dataset (domain: ecommerce). See api/openapi.yaml for the full contract. "
        "Runs against the live cluster when workshop credentials are configured, "
        "otherwise serves a deterministic demo dataset."
    ),
)

app.include_router(sales.router)
app.include_router(inventory.router)
app.include_router(customers.router)


@app.exception_handler(PrestoQueryError)
async def presto_error_handler(request: Request, exc: PrestoQueryError) -> JSONResponse:
    return JSONResponse(status_code=502, content={"detail": f"Presto query failed: {exc}"})


@app.exception_handler(CassandraError)
async def cassandra_error_handler(request: Request, exc: CassandraError) -> JSONResponse:
    return JSONResponse(status_code=502, content={"detail": f"Cassandra error: {exc}"})


@app.get("/api/health", tags=["meta"])
def health() -> dict:
    """Deployment metadata: which data backend is serving requests."""
    info: dict = {
        "status": "ok",
        "mode": "demo" if config.DEMO_MODE else "live",
    }
    if config.DEMO_MODE:
        from src import demo_data

        info["sample_customer_email"] = demo_data.KNOWN_CUSTOMER_EMAIL
    return info


_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if _STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="static")
