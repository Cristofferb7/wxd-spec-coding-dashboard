"""REQ-001 / REQ-002 — federated Cassandra + Iceberg sales endpoints."""
from __future__ import annotations

from fastapi import APIRouter

from src import config, demo_data
from src.clients.presto_client import run_query
from src.models import (
    CategoryBreakdown,
    RegionBreakdown,
    SalesToday,
)

router = APIRouter(prefix="/sales", tags=["sales"])

_CASS = f"cassandra_catalog.{config.PRESTO_SCHEMA}"
_ICE_REF = "iceberg_data.ecommerce_reference"


def _pct_change(today: float, baseline: float) -> float:
    if baseline == 0:
        return 0.0
    return (today - baseline) / baseline * 100


@router.get("/today", response_model=SalesToday)
def get_sales_today() -> SalesToday:
    if config.DEMO_MODE:
        return demo_data.get_sales_today()
    sql = f"""
    WITH today AS (
      SELECT COUNT(*) AS order_count, COALESCE(SUM(total_amount), 0) AS revenue
      FROM {_CASS}.orders_inflight
      WHERE order_date = (SELECT MAX(order_date) FROM {_CASS}.orders_inflight)
    ),
    baseline_days AS (
      SELECT summary_date, SUM(order_count) AS daily_orders, SUM(net_revenue) AS daily_revenue
      FROM {_ICE_REF}.daily_sales_summary
      WHERE summary_date > (SELECT MAX(summary_date) FROM {_ICE_REF}.daily_sales_summary) - INTERVAL '30' DAY
      GROUP BY summary_date
    )
    SELECT
      (SELECT MAX(order_date) FROM {_CASS}.orders_inflight) AS as_of_date,
      today.order_count AS order_count,
      today.revenue AS revenue,
      AVG(baseline_days.daily_orders) AS baseline_order_count,
      AVG(baseline_days.daily_revenue) AS baseline_revenue
    FROM today CROSS JOIN baseline_days
    GROUP BY today.order_count, today.revenue
    """
    rows = run_query(sql)
    row = rows[0]

    today_count = int(row["order_count"])
    today_revenue = float(row["revenue"])
    baseline_count = float(row["baseline_order_count"])
    baseline_revenue = float(row["baseline_revenue"])

    return SalesToday(
        as_of_date=row["as_of_date"],
        today={"order_count": today_count, "revenue": today_revenue},
        baseline_30d_avg={"order_count": baseline_count, "revenue": baseline_revenue},
        delta={
            "order_count_pct": _pct_change(today_count, baseline_count),
            "revenue_pct": _pct_change(today_revenue, baseline_revenue),
        },
    )


@router.get("/today/by-category", response_model=list[CategoryBreakdown])
def get_sales_today_by_category() -> list[CategoryBreakdown]:
    if config.DEMO_MODE:
        return demo_data.get_sales_by_category()
    sql = f"""
    WITH today_cat AS (
      SELECT p.category AS category, COUNT(DISTINCT oi.order_id) AS order_count, SUM(oi.line_total) AS revenue
      FROM {_CASS}.order_items_inflight oi
      JOIN {_CASS}.orders_inflight o ON o.order_id = oi.order_id
      JOIN {_CASS}.products p ON p.product_id = oi.product_id
      WHERE o.order_date = (SELECT MAX(order_date) FROM {_CASS}.orders_inflight)
      GROUP BY p.category
    ),
    baseline_cat AS (
      SELECT product_category,
             AVG(cat_revenue) AS avg_revenue,
             AVG(cat_orders) AS avg_order_count
      FROM (
        SELECT summary_date, product_category,
               SUM(net_revenue) AS cat_revenue, SUM(order_count) AS cat_orders
        FROM {_ICE_REF}.daily_sales_summary
        WHERE summary_date > (SELECT MAX(summary_date) FROM {_ICE_REF}.daily_sales_summary) - INTERVAL '30' DAY
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
    """
    rows = run_query(sql)
    return [
        CategoryBreakdown(
            category=row["category"],
            order_count=int(row["order_count"]),
            revenue=float(row["revenue"]),
            baseline_order_count=float(row["baseline_order_count"] or 0),
            baseline_revenue=float(row["baseline_revenue"] or 0),
        )
        for row in rows
    ]


@router.get("/today/by-region", response_model=list[RegionBreakdown])
def get_sales_today_by_region() -> list[RegionBreakdown]:
    if config.DEMO_MODE:
        return demo_data.get_sales_by_region()
    sql = f"""
    WITH today_region AS (
      SELECT shipping_state, COUNT(*) AS order_count, SUM(total_amount) AS revenue
      FROM {_CASS}.orders_inflight
      WHERE order_date = (SELECT MAX(order_date) FROM {_CASS}.orders_inflight)
      GROUP BY shipping_state
    ),
    baseline_region AS (
      SELECT shipping_state,
             AVG(reg_revenue) AS avg_revenue,
             AVG(reg_orders) AS avg_order_count
      FROM (
        SELECT summary_date, shipping_state,
               SUM(net_revenue) AS reg_revenue, SUM(order_count) AS reg_orders
        FROM {_ICE_REF}.daily_sales_summary
        WHERE summary_date > (SELECT MAX(summary_date) FROM {_ICE_REF}.daily_sales_summary) - INTERVAL '30' DAY
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
    """
    rows = run_query(sql)
    return [
        RegionBreakdown(
            region=row["region"],
            order_count=int(row["order_count"]),
            revenue=float(row["revenue"]),
            baseline_order_count=float(row["baseline_order_count"] or 0),
            baseline_revenue=float(row["baseline_revenue"] or 0),
        )
        for row in rows
    ]
