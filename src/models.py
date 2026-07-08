"""Pydantic models mirroring api/openapi.yaml component schemas."""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


class SalesTodayCounts(BaseModel):
    order_count: int
    revenue: float


class SalesTodayBaseline(BaseModel):
    order_count: float
    revenue: float


class SalesTodayDelta(BaseModel):
    order_count_pct: float
    revenue_pct: float


class SalesToday(BaseModel):
    as_of_date: date
    today: SalesTodayCounts
    baseline_30d_avg: SalesTodayBaseline
    delta: SalesTodayDelta


class CategoryBreakdown(BaseModel):
    category: str
    order_count: int
    revenue: float
    baseline_order_count: float
    baseline_revenue: float


class RegionBreakdown(BaseModel):
    region: str
    order_count: int
    revenue: float
    baseline_order_count: float
    baseline_revenue: float


class InventoryItem(BaseModel):
    product_id: str
    sku: str
    name: str
    category: str
    stock_quantity: int
    reorder_level: int
    below_reorder: bool
    last_move_at: Optional[datetime] = None


class CustomerProfile(BaseModel):
    customer_id: str
    email: str
    first_name: str
    last_name: str
    phone: str
    account_status: str
    loyalty_tier: str
    current_ltv: float
    total_orders: int
    shipping_city: str
    shipping_state: str
    shipping_country: str


class OrderItem(BaseModel):
    product_id: str
    product_name: str
    product_sku: str
    quantity: int
    unit_price: float
    line_total: float


class CustomerOrder(BaseModel):
    order_id: str
    order_date: date
    order_status: str
    payment_status: str
    total_amount: float
    currency: str
    tracking_number: Optional[str] = None
    estimated_delivery_date: Optional[date] = None
    items: list[OrderItem]


class CustomerReview(BaseModel):
    review_id: str
    product_name: str
    rating: int
    title: str
    verified_purchase: bool
    review_date: date


class Error(BaseModel):
    detail: str
