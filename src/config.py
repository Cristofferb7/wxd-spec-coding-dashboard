"""Loads connection settings from .env. No hardcoded hosts/credentials.

Two modes:
  * live — all workshop cluster variables are present in the environment;
    queries go to Presto/Cassandra as during the workshop.
  * demo — DEMO_MODE=true, or one or more cluster variables are missing.
    Endpoints serve the deterministic in-memory dataset in src/demo_data.py
    so the app (and the public Vercel deployment) works without the cluster.
"""
import os

from dotenv import load_dotenv

load_dotenv()

_LIVE_VARS = (
    "WXD_HOST",
    "PRESTO_HOST",
    "CASSANDRA_HOST",
    "WORKSHOP_USER",
    "WORKSHOP_PASSWORD",
    "WORKSHOP_SCHEMA_SUFFIX",
)


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


_missing = [name for name in _LIVE_VARS if not os.environ.get(name)]
DEMO_MODE = _flag("DEMO_MODE") or bool(_missing)

if DEMO_MODE:
    # Placeholder values: clients are never called in demo mode, but router
    # modules interpolate these into SQL text at import time.
    WXD_HOST = "demo.invalid"
    PRESTO_HOST = "demo.invalid"
    CASSANDRA_HOST = "demo.invalid"
    WORKSHOP_USER = "demo"
    WORKSHOP_PASSWORD = "demo"
    WORKSHOP_SCHEMA_SUFFIX = "demo"
else:
    WXD_HOST = os.environ["WXD_HOST"]
    PRESTO_HOST = os.environ["PRESTO_HOST"]
    CASSANDRA_HOST = os.environ["CASSANDRA_HOST"]
    WORKSHOP_USER = os.environ["WORKSHOP_USER"]
    WORKSHOP_PASSWORD = os.environ["WORKSHOP_PASSWORD"]
    WORKSHOP_SCHEMA_SUFFIX = os.environ["WORKSHOP_SCHEMA_SUFFIX"]

PRESTO_PORT = int(os.environ.get("PRESTO_PORT", "443"))
CASSANDRA_PORT = int(os.environ.get("CASSANDRA_PORT", "443"))

CASSANDRA_KEYSPACE = f"ecommerce_{WORKSHOP_SCHEMA_SUFFIX}"
PRESTO_SCHEMA = f"ecommerce_{WORKSHOP_SCHEMA_SUFFIX}"
