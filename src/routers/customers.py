"""REQ-004 / REQ-005 / REQ-006 — customer profile, in-flight orders, reviews."""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from src import config, demo_data
from src.models import CustomerOrder, CustomerProfile, CustomerReview, OrderItem

router = APIRouter(prefix="/customers", tags=["customers"])

_CASS = f"cassandra_catalog.{config.PRESTO_SCHEMA}"


def _parse_customer_id(customer_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(customer_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="customer_id must be a valid UUID.")


@router.get("", response_model=CustomerProfile)
def get_customer(
    customer_id: Optional[str] = Query(None),
    email: Optional[str] = Query(None),
    name: Optional[str] = Query(None),
) -> CustomerProfile:
    provided = sum([customer_id is not None, email is not None, name is not None])
    if provided != 1:
        raise HTTPException(
            status_code=400,
            detail="Provide exactly one of 'customer_id', 'email', or 'name'.",
        )

    if customer_id is not None:
        cid = _parse_customer_id(customer_id)
        if config.DEMO_MODE:
            profile = demo_data.get_customer_by_id(str(cid))
            if profile is None:
                raise HTTPException(status_code=404, detail="Customer not found.")
            return profile
        from src.clients import cassandra_client

        row = cassandra_client.get_customer_by_id(cid)
    elif email is not None:
        if config.DEMO_MODE:
            profile = demo_data.get_customer_by_email(email)
            if profile is None:
                raise HTTPException(status_code=404, detail="Customer not found.")
            return profile
        from src.clients import cassandra_client

        row = cassandra_client.get_customer_by_email(email)
    else:
        if config.DEMO_MODE:
            profile = demo_data.get_customer_by_name(name)
            if profile is None:
                raise HTTPException(status_code=404, detail="Customer not found.")
            return profile
        from src.clients import cassandra_client

        row = cassandra_client.get_customer_by_name(name)

    if row is None:
        raise HTTPException(status_code=404, detail="Customer not found.")

    return CustomerProfile(
        customer_id=str(row["customer_id"]),
        email=row["email"],
        first_name=row["first_name"],
        last_name=row["last_name"],
        phone=row["phone"],
        account_status=row["account_status"],
        loyalty_tier=row["loyalty_tier"],
        current_ltv=float(row["current_ltv"]),
        total_orders=int(row["total_orders"]),
        shipping_city=row["shipping_city"],
        shipping_state=row["shipping_state"],
        shipping_country=row["shipping_country"],
    )


@router.get("/list", response_model=list[dict])
def list_customers(limit: int = Query(20, ge=1, le=100)) -> list[dict]:
    """List customers paginated. Returns summary fields only."""
    if config.DEMO_MODE:
        return demo_data.list_customers(limit)

    from src.clients.presto_client import run_query

    schema = f"cassandra_catalog.{config.CASSANDRA_KEYSPACE}"
    sql = f"""
    SELECT customer_id, first_name, last_name, email, loyalty_tier, current_ltv
    FROM {schema}.customers
    LIMIT {limit}
    """
    return run_query(sql)


@router.get("/recent-orders", response_model=list[dict])
def recent_orders(limit: int = Query(20, ge=1, le=100)) -> list[dict]:
    """List recent orders across all customers."""
    if config.DEMO_MODE:
        return demo_data.recent_orders(limit)

    from src.clients.presto_client import run_query

    schema = f"cassandra_catalog.{config.CASSANDRA_KEYSPACE}"
    sql = f"""
    SELECT o.order_id, o.customer_id, o.order_date, o.order_status,
           o.total_amount, o.currency,
           c.first_name, c.last_name
    FROM {schema}.orders_inflight o
    JOIN {schema}.customers c ON c.customer_id = o.customer_id
    ORDER BY o.order_date DESC
    LIMIT {limit}
    """
    return run_query(sql)


@router.get("/{customer_id}/orders", response_model=list[CustomerOrder])
def get_customer_orders(customer_id: str) -> list[CustomerOrder]:
    cid = _parse_customer_id(customer_id)

    if config.DEMO_MODE:
        if not demo_data.customer_exists(str(cid)):
            raise HTTPException(status_code=404, detail="Customer not found.")
        return demo_data.get_customer_orders(str(cid))

    from src.clients import cassandra_client

    if cassandra_client.get_customer_by_id(cid) is None:
        raise HTTPException(status_code=404, detail="Customer not found.")

    orders = cassandra_client.get_customer_orders(cid)

    result = []
    for order in orders:
        items = cassandra_client.get_order_items(order["order_id"])
        result.append(
            CustomerOrder(
                order_id=str(order["order_id"]),
                order_date=order["order_date"],
                order_status=order["order_status"],
                payment_status=order["payment_status"],
                total_amount=float(order["total_amount"]),
                currency=order["currency"],
                tracking_number=order["tracking_number"],
                estimated_delivery_date=order["estimated_delivery_date"],
                items=[
                    OrderItem(
                        product_id=str(item["product_id"]),
                        product_name=item["product_name"],
                        product_sku=item["product_sku"],
                        quantity=int(item["quantity"]),
                        unit_price=float(item["unit_price"]),
                        line_total=float(item["line_total"]),
                    )
                    for item in items
                ],
            )
        )
    return result


@router.get("/{customer_id}/reviews", response_model=list[CustomerReview])
def get_customer_reviews(customer_id: str) -> list[CustomerReview]:
    cid = _parse_customer_id(customer_id)

    if config.DEMO_MODE:
        if not demo_data.customer_exists(str(cid)):
            raise HTTPException(status_code=404, detail="Customer not found.")
        return demo_data.get_customer_reviews(str(cid))

    from src.clients import cassandra_client
    from src.clients.presto_client import run_query

    if cassandra_client.get_customer_by_id(cid) is None:
        raise HTTPException(status_code=404, detail="Customer not found.")

    sql = f"""
    SELECT r.review_id AS review_id, p.name AS product_name, r.rating AS rating,
           r.title AS title, r.verified_purchase AS verified_purchase, r.review_date AS review_date
    FROM {_CASS}.reviews_recent r
    JOIN {_CASS}.products p ON p.product_id = r.product_id
    WHERE r.customer_id = '{cid!s}'
    ORDER BY r.review_date DESC
    """
    rows = run_query(sql)
    return [
        CustomerReview(
            review_id=str(row["review_id"]),
            product_name=row["product_name"],
            rating=int(row["rating"]),
            title=row["title"],
            verified_purchase=bool(row["verified_purchase"]),
            review_date=row["review_date"],
        )
        for row in rows
    ]
