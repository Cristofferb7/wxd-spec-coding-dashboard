"""REQ-003 — live inventory status (Cassandra tables, via cassandra_catalog)."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Query

from src import config, demo_data
from src.clients.presto_client import run_query
from src.models import InventoryItem

router = APIRouter(tags=["inventory"])

_CASS = f"cassandra_catalog.{config.PRESTO_SCHEMA}"

_ORDER_BY = {
    "stock": "p.stock_quantity ASC",
    "urgency": "(p.stock_quantity - p.reorder_level) ASC",
}


@router.get("/inventory", response_model=list[InventoryItem])
def get_inventory(
    sort: Literal["stock", "urgency"] = Query("stock"),
) -> list[InventoryItem]:
    if config.DEMO_MODE:
        return demo_data.get_inventory(sort)
    sql = f"""
    SELECT p.product_id AS product_id, p.sku AS sku, p.name AS name, p.category AS category,
           p.stock_quantity AS stock_quantity, p.reorder_level AS reorder_level,
           (p.stock_quantity < p.reorder_level) AS below_reorder,
           lm.last_move_at AS last_move_at
    FROM {_CASS}.products p
    LEFT JOIN (
      SELECT product_id, MAX(created_at) AS last_move_at
      FROM {_CASS}.inventory_ledger_recent
      GROUP BY product_id
    ) lm ON lm.product_id = p.product_id
    ORDER BY {_ORDER_BY[sort]}
    """
    rows = run_query(sql)
    return [
        InventoryItem(
            product_id=str(row["product_id"]),
            sku=row["sku"],
            name=row["name"],
            category=row["category"],
            stock_quantity=int(row["stock_quantity"]),
            reorder_level=int(row["reorder_level"]),
            below_reorder=bool(row["below_reorder"]),
            last_move_at=row["last_move_at"],
        )
        for row in rows
    ]
