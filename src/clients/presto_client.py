"""Presto HTTP client: two-step bearer-token auth + nextUri polling.

Mirrors setup/lib/smoke_test.py's probe_presto. Used for every query that
touches Iceberg, joins across Cassandra tables, or scans without a usable
partition/index key (REQ-001, REQ-002, REQ-003, REQ-006).
"""
from __future__ import annotations

import json
import ssl
import threading
import time
import urllib.error
import urllib.request

from src import config


class PrestoQueryError(Exception):
    """Raised when a Presto query fails or the upstream is unreachable."""


_TOKEN_TTL_SECONDS = 11 * 60 * 60  # refresh before the ~12h expiry

_lock = threading.Lock()
_token: str | None = None
_token_minted_at: float = 0.0


def _ssl_context() -> ssl.SSLContext:
    return ssl.create_default_context()


def _mint_token() -> str:
    ctx = _ssl_context()
    req = urllib.request.Request(
        f"https://{config.WXD_HOST}/icp4d-api/v1/authorize",
        method="POST",
        headers={"Content-Type": "application/json"},
        data=json.dumps(
            {"username": config.WORKSHOP_USER, "password": config.WORKSHOP_PASSWORD}
        ).encode(),
    )
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
            body = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise PrestoQueryError(f"Software Hub auth failed: HTTP {e.code}") from e
    except OSError as e:
        raise PrestoQueryError(f"Could not reach {config.WXD_HOST}: {e}") from e

    token = body.get("token")
    if not token:
        raise PrestoQueryError("Software Hub auth returned no token")
    return token


def _get_token(force_refresh: bool = False) -> str:
    global _token, _token_minted_at
    with _lock:
        now = time.monotonic()
        if (
            force_refresh
            or _token is None
            or (now - _token_minted_at) > _TOKEN_TTL_SECONDS
        ):
            _token = _mint_token()
            _token_minted_at = now
        return _token


def _post_statement(sql: str, token: str) -> dict:
    ctx = _ssl_context()
    req = urllib.request.Request(
        f"https://{config.PRESTO_HOST}/v1/statement",
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Presto-User": config.WORKSHOP_USER,
            "Content-Type": "text/plain",
        },
        data=sql.encode(),
    )
    with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
        return json.loads(r.read())


def _get_next(uri: str, token: str) -> dict:
    ctx = _ssl_context()
    req = urllib.request.Request(
        uri,
        headers={
            "Authorization": f"Bearer {token}",
            "X-Presto-User": config.WORKSHOP_USER,
        },
    )
    with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
        return json.loads(r.read())


def run_query(sql: str, _retried: bool = False) -> list[dict]:
    """Execute a Presto SQL statement and return rows as a list of dicts.

    Raises PrestoQueryError on any failure (caught by main.py -> 502).
    """
    token = _get_token()

    try:
        resp = _post_statement(sql, token)
    except urllib.error.HTTPError as e:
        if e.code == 401 and not _retried:
            _get_token(force_refresh=True)
            return run_query(sql, _retried=True)
        raise PrestoQueryError(f"Presto request failed: HTTP {e.code}") from e
    except OSError as e:
        raise PrestoQueryError(f"Could not reach {config.PRESTO_HOST}: {e}") from e

    columns: list[str] | None = None
    rows: list[list] = []

    while True:
        if resp.get("stats", {}).get("state") == "FAILED":
            message = resp.get("error", {}).get("message", "unknown error")
            raise PrestoQueryError(f"Presto query failed: {message}")

        if columns is None and "columns" in resp:
            columns = [c["name"] for c in resp["columns"]]

        for row in resp.get("data") or []:
            rows.append(row)

        next_uri = resp.get("nextUri")
        if not next_uri:
            break

        try:
            resp = _get_next(next_uri, token)
        except urllib.error.HTTPError as e:
            if e.code == 401 and not _retried:
                _get_token(force_refresh=True)
                return run_query(sql, _retried=True)
            raise PrestoQueryError(f"Presto request failed: HTTP {e.code}") from e
        except OSError as e:
            raise PrestoQueryError(f"Could not reach {config.PRESTO_HOST}: {e}") from e

    if columns is None:
        return []

    return [dict(zip(columns, row)) for row in rows]
