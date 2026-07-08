"""Deterministic in-memory demo dataset (used when config.DEMO_MODE is on).

Mirrors the workshop schema in setup/sample-data/ecommerce/: the same
entities Cassandra held (customers, products, orders_inflight,
order_items_inflight, inventory_ledger_recent, reviews_recent) plus the
Iceberg daily_sales_summary rollup used for 30-day baselines.

Everything is generated once per calendar day from a fixed seed, so the
dashboard always shows a fresh "today" while responses stay stable across
requests. One well-known customer is pinned (same id/email the live test
suite uses) so tests/test_customers.py passes in demo mode too.
"""
from __future__ import annotations

import random
import uuid
from datetime import date, datetime, time, timedelta, timezone

from src.models import (
    CategoryBreakdown,
    CustomerOrder,
    CustomerProfile,
    CustomerReview,
    InventoryItem,
    OrderItem,
    RegionBreakdown,
    SalesToday,
)

_SEED = 20260610

KNOWN_CUSTOMER_ID = "1b175efd-b770-4b0b-a3d9-360912319a9b"
KNOWN_CUSTOMER_EMAIL = "sarah.davis291@example.com"

_CATEGORIES = {
    "Electronics": [
        ("Aurora 27\" 4K Monitor", "Aurora", 379.99),
        ("PulseBuds Pro Earbuds", "Pulse", 129.99),
        ("Voltix 65W GaN Charger", "Voltix", 44.99),
        ("Nimbus Mechanical Keyboard", "Nimbus", 99.99),
        ("Orbit Wireless Mouse", "Orbit", 39.99),
    ],
    "Home & Kitchen": [
        ("BrewMaster Pour-Over Kettle", "BrewMaster", 64.99),
        ("Everstone Cast Iron Skillet", "Everstone", 54.99),
        ("Lumo Smart Desk Lamp", "Lumo", 49.99),
        ("AeroPress Coffee Maker", "AeroPress", 39.99),
        ("Cedar & Sage Candle Set", "Hearth", 29.99),
    ],
    "Apparel": [
        ("Trailform Merino Hoodie", "Trailform", 89.99),
        ("Coastline Linen Shirt", "Coastline", 59.99),
        ("Summit Waterproof Jacket", "Summit", 149.99),
        ("Stride Everyday Sneakers", "Stride", 79.99),
    ],
    "Sports & Outdoors": [
        ("Ridgeline 2P Tent", "Ridgeline", 199.99),
        ("Hydra 1L Insulated Bottle", "Hydra", 34.99),
        ("Tempo Resistance Band Set", "Tempo", 24.99),
        ("Drift Foam Roller", "Drift", 27.99),
    ],
    "Beauty": [
        ("Glow Vitamin C Serum", "Glow", 32.99),
        ("Halo Mineral Sunscreen SPF 50", "Halo", 21.99),
        ("Velvet Matte Lip Trio", "Velvet", 26.99),
    ],
    "Toys & Games": [
        ("Cosmos Building Blocks 500pc", "Cosmos", 49.99),
        ("Quest Family Board Game", "Quest", 34.99),
        ("Zippy RC Rover", "Zippy", 59.99),
    ],
}

_STATES = ["CA", "NY", "TX", "FL", "WA", "IL", "MA", "CO", "GA", "OR"]

_CITIES = {
    "CA": "San Francisco", "NY": "New York", "TX": "Austin", "FL": "Miami",
    "WA": "Seattle", "IL": "Chicago", "MA": "Boston", "CO": "Denver",
    "GA": "Atlanta", "OR": "Portland",
}

_FIRST_NAMES = [
    "James", "Maria", "Wei", "Aisha", "Carlos", "Emma", "Noah", "Priya",
    "Liam", "Sofia", "Mateo", "Yuki", "Omar", "Ingrid", "Diego", "Chloe",
    "Ravi", "Elena", "Tomas", "Nadia", "Felix", "Amara", "Hugo", "Isla",
]

_LAST_NAMES = [
    "Smith", "Garcia", "Chen", "Johnson", "Martinez", "Brown", "Patel",
    "Kim", "Nguyen", "Lopez", "Miller", "Sato", "Hassan", "Berg",
    "Rivera", "Dubois", "Novak", "Silva", "Okafor", "Larsen",
]

_REVIEW_TITLES = [
    "Exceeded expectations", "Solid value for the price", "Would buy again",
    "Great quality, fast shipping", "Does exactly what it says",
    "Better than I hoped", "Decent, with minor flaws", "A new favorite",
    "Impressive build quality", "Works perfectly",
]

_ORDER_STATUSES = ["pending", "processing", "shipped"]
_PAYMENT_STATUSES = {"pending": "authorized", "processing": "captured", "shipped": "captured"}
_TIERS = ["bronze", "silver", "gold", "platinum"]

_db_cache: dict[date, dict] = {}


def _uuid(rng: random.Random) -> str:
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def _build(today: date) -> dict:
    rng = random.Random(_SEED)

    products = []
    for category, entries in _CATEGORIES.items():
        for name, brand, price in entries:
            stock = rng.randint(0, 400)
            reorder = rng.randint(25, 120)
            products.append({
                "product_id": _uuid(rng),
                "sku": f"{brand[:3].upper()}-{rng.randint(1000, 9999)}",
                "name": name,
                "category": category,
                "brand": brand,
                "price": price,
                "stock_quantity": stock,
                "reorder_level": reorder,
                # ~2/3 of products moved stock recently; the rest have no
                # ledger rows (tests require both cases to exist).
                "last_move_at": (
                    datetime.combine(today, time(rng.randint(6, 20), rng.randint(0, 59)), timezone.utc)
                    - timedelta(days=rng.randint(0, 12))
                ) if rng.random() < 0.66 else None,
            })

    customers = []
    used_emails = set()
    for i in range(60):
        if i == 0:
            first, last = "Sarah", "Davis"
            cid, email = KNOWN_CUSTOMER_ID, KNOWN_CUSTOMER_EMAIL
        else:
            first = rng.choice(_FIRST_NAMES)
            last = rng.choice(_LAST_NAMES)
            email = f"{first.lower()}.{last.lower()}{rng.randint(1, 999)}@example.com"
            while email in used_emails:
                email = f"{first.lower()}.{last.lower()}{rng.randint(1, 999)}@example.com"
            cid = _uuid(rng)
        used_emails.add(email)
        state = rng.choice(_STATES)
        total_orders = rng.randint(1, 60)
        ltv = round(total_orders * rng.uniform(45, 220), 2)
        tier = _TIERS[min(3, int(ltv // 2500))]
        customers.append({
            "customer_id": cid,
            "email": email,
            "first_name": first,
            "last_name": last,
            "phone": f"+1-{rng.randint(200, 989)}-{rng.randint(200, 989)}-{rng.randint(1000, 9999)}",
            "account_status": "active" if rng.random() < 0.93 else "paused",
            "loyalty_tier": tier,
            "current_ltv": ltv,
            "total_orders": total_orders,
            "shipping_city": _CITIES[state],
            "shipping_state": state,
            "shipping_country": "USA",
        })

    # In-flight orders over the last 7 days. Customer 0 (Sarah) always gets
    # orders + reviews; the last two customers get none of either, so the
    # fixture cases "no orders" / "no reviews" exist.
    orders = []
    order_items = []
    orderable = customers[:-2]
    for customer in orderable:
        n_orders = rng.choices([0, 1, 2, 3], weights=[25, 45, 22, 8])[0]
        if customer["customer_id"] == KNOWN_CUSTOMER_ID:
            n_orders = max(2, n_orders)
        for _ in range(n_orders):
            order_date = today - timedelta(days=rng.choices(range(7), weights=[38, 16, 12, 10, 9, 8, 7])[0])
            status = rng.choice(_ORDER_STATUSES)
            order_id = _uuid(rng)
            items = []
            for seq in range(rng.randint(1, 4)):
                product = rng.choice(products)
                qty = rng.randint(1, 3)
                items.append({
                    "order_id": order_id,
                    "item_sequence": seq,
                    "product_id": product["product_id"],
                    "product_name": product["name"],
                    "product_sku": product["sku"],
                    "category": product["category"],
                    "quantity": qty,
                    "unit_price": product["price"],
                    "line_total": round(qty * product["price"], 2),
                })
            total = round(sum(item["line_total"] for item in items), 2)
            orders.append({
                "order_id": order_id,
                "customer_id": customer["customer_id"],
                "first_name": customer["first_name"],
                "last_name": customer["last_name"],
                "order_date": order_date,
                "order_status": status,
                "payment_status": _PAYMENT_STATUSES[status],
                "total_amount": total,
                "currency": "USD",
                "shipping_state": customer["shipping_state"],
                "tracking_number": f"TRK{rng.randint(10**9, 10**10 - 1)}" if status == "shipped" else None,
                "estimated_delivery_date": order_date + timedelta(days=rng.randint(2, 7)),
            })
            order_items.extend(items)

    # Reviews in the last 30 days for ~40% of customers (never the last one,
    # reserved as the "no reviews" case).
    reviews = []
    for customer in customers[:-1]:
        wants_reviews = customer["customer_id"] == KNOWN_CUSTOMER_ID or rng.random() < 0.4
        if not wants_reviews:
            continue
        for _ in range(rng.randint(1, 3)):
            product = rng.choice(products)
            reviews.append({
                "review_id": _uuid(rng),
                "customer_id": customer["customer_id"],
                "product_name": product["name"],
                "rating": rng.choices([1, 2, 3, 4, 5], weights=[4, 6, 14, 34, 42])[0],
                "title": rng.choice(_REVIEW_TITLES),
                "verified_purchase": rng.random() < 0.8,
                "review_date": today - timedelta(days=rng.randint(0, 29)),
            })

    # 30-day Iceberg-style baseline averages, anchored to today's actuals so
    # the vs-baseline deltas on the dashboard stay in a plausible range.
    todays = [o for o in orders if o["order_date"] == today]
    today_ids = {o["order_id"] for o in todays}
    overall_baseline = (
        max(1.0, len(todays) * rng.uniform(0.82, 1.08)),
        round(max(1.0, sum(o["total_amount"] for o in todays) * rng.uniform(0.8, 1.1)), 2),
    )

    category_baseline = {}
    cat_today: dict[str, dict] = {c: {"orders": set(), "revenue": 0.0} for c in _CATEGORIES}
    for item in order_items:
        if item["order_id"] in today_ids:
            cat_today[item["category"]]["orders"].add(item["order_id"])
            cat_today[item["category"]]["revenue"] += item["line_total"]
    for category, bucket in cat_today.items():
        category_baseline[category] = (
            max(1.0, len(bucket["orders"]) * rng.uniform(0.7, 1.35)),
            round(max(50.0, bucket["revenue"] * rng.uniform(0.7, 1.35)), 2),
        )

    region_baseline = {}
    state_today: dict[str, dict] = {s: {"orders": 0, "revenue": 0.0} for s in _STATES}
    for order in todays:
        state_today[order["shipping_state"]]["orders"] += 1
        state_today[order["shipping_state"]]["revenue"] += order["total_amount"]
    for state, bucket in state_today.items():
        region_baseline[state] = (
            max(0.5, bucket["orders"] * rng.uniform(0.7, 1.35)),
            round(max(40.0, bucket["revenue"] * rng.uniform(0.7, 1.35)), 2),
        )

    return {
        "today": today,
        "products": products,
        "customers": customers,
        "orders": orders,
        "order_items": order_items,
        "reviews": reviews,
        "overall_baseline": overall_baseline,
        "category_baseline": category_baseline,
        "region_baseline": region_baseline,
    }


def _db() -> dict:
    today = date.today()
    if today not in _db_cache:
        _db_cache.clear()
        _db_cache[today] = _build(today)
    return _db_cache[today]


# ---------------------------------------------------------------------------
# Sales (REQ-001 / REQ-002)
# ---------------------------------------------------------------------------

def _pct_change(current: float, baseline: float) -> float:
    if baseline == 0:
        return 0.0
    return (current - baseline) / baseline * 100


def get_sales_today() -> SalesToday:
    db = _db()
    todays = [o for o in db["orders"] if o["order_date"] == db["today"]]
    order_count = len(todays)
    revenue = round(sum(o["total_amount"] for o in todays), 2)
    baseline_orders, baseline_revenue = db["overall_baseline"]
    return SalesToday(
        as_of_date=db["today"],
        today={"order_count": order_count, "revenue": revenue},
        baseline_30d_avg={"order_count": baseline_orders, "revenue": baseline_revenue},
        delta={
            "order_count_pct": _pct_change(order_count, baseline_orders),
            "revenue_pct": _pct_change(revenue, baseline_revenue),
        },
    )


def get_sales_by_category() -> list[CategoryBreakdown]:
    db = _db()
    today_order_ids = {o["order_id"] for o in db["orders"] if o["order_date"] == db["today"]}
    per_category: dict[str, dict] = {c: {"orders": set(), "revenue": 0.0} for c in _CATEGORIES}
    for item in db["order_items"]:
        if item["order_id"] in today_order_ids:
            bucket = per_category[item["category"]]
            bucket["orders"].add(item["order_id"])
            bucket["revenue"] += item["line_total"]
    rows = [
        CategoryBreakdown(
            category=category,
            order_count=len(bucket["orders"]),
            revenue=round(bucket["revenue"], 2),
            baseline_order_count=db["category_baseline"][category][0],
            baseline_revenue=db["category_baseline"][category][1],
        )
        for category, bucket in per_category.items()
    ]
    return sorted(rows, key=lambda r: r.revenue, reverse=True)


def get_sales_by_region() -> list[RegionBreakdown]:
    db = _db()
    per_state: dict[str, dict] = {s: {"orders": 0, "revenue": 0.0} for s in _STATES}
    for order in db["orders"]:
        if order["order_date"] == db["today"]:
            bucket = per_state[order["shipping_state"]]
            bucket["orders"] += 1
            bucket["revenue"] += order["total_amount"]
    rows = [
        RegionBreakdown(
            region=state,
            order_count=bucket["orders"],
            revenue=round(bucket["revenue"], 2),
            baseline_order_count=db["region_baseline"][state][0],
            baseline_revenue=db["region_baseline"][state][1],
        )
        for state, bucket in per_state.items()
    ]
    return sorted(rows, key=lambda r: r.revenue, reverse=True)


# ---------------------------------------------------------------------------
# Inventory (REQ-003)
# ---------------------------------------------------------------------------

def get_inventory(sort: str) -> list[InventoryItem]:
    db = _db()
    items = [
        InventoryItem(
            product_id=p["product_id"],
            sku=p["sku"],
            name=p["name"],
            category=p["category"],
            stock_quantity=p["stock_quantity"],
            reorder_level=p["reorder_level"],
            below_reorder=p["stock_quantity"] < p["reorder_level"],
            last_move_at=p["last_move_at"],
        )
        for p in db["products"]
    ]
    if sort == "urgency":
        items.sort(key=lambda i: i.stock_quantity - i.reorder_level)
    else:
        items.sort(key=lambda i: i.stock_quantity)
    return items


# ---------------------------------------------------------------------------
# Customers (REQ-004 / REQ-005 / REQ-006)
# ---------------------------------------------------------------------------

def _customer_row(customer: dict) -> CustomerProfile:
    return CustomerProfile(**customer)


def get_customer_by_id(customer_id: str) -> CustomerProfile | None:
    for customer in _db()["customers"]:
        if customer["customer_id"] == str(customer_id):
            return _customer_row(customer)
    return None


def get_customer_by_email(email: str) -> CustomerProfile | None:
    for customer in _db()["customers"]:
        if customer["email"].lower() == email.lower():
            return _customer_row(customer)
    return None


def get_customer_by_name(full_name: str) -> CustomerProfile | None:
    wanted = " ".join(full_name.lower().split())
    for customer in _db()["customers"]:
        if f"{customer['first_name']} {customer['last_name']}".lower() == wanted:
            return _customer_row(customer)
    return None


def customer_exists(customer_id: str) -> bool:
    return get_customer_by_id(customer_id) is not None


def get_customer_orders(customer_id: str) -> list[CustomerOrder]:
    db = _db()
    result = []
    for order in db["orders"]:
        if order["customer_id"] != str(customer_id):
            continue
        items = [
            OrderItem(
                product_id=i["product_id"],
                product_name=i["product_name"],
                product_sku=i["product_sku"],
                quantity=i["quantity"],
                unit_price=i["unit_price"],
                line_total=i["line_total"],
            )
            for i in db["order_items"]
            if i["order_id"] == order["order_id"]
        ]
        result.append(
            CustomerOrder(
                order_id=order["order_id"],
                order_date=order["order_date"],
                order_status=order["order_status"],
                payment_status=order["payment_status"],
                total_amount=order["total_amount"],
                currency=order["currency"],
                tracking_number=order["tracking_number"],
                estimated_delivery_date=order["estimated_delivery_date"],
                items=items,
            )
        )
    result.sort(key=lambda o: str(o.order_date), reverse=True)
    return result


def get_customer_reviews(customer_id: str) -> list[CustomerReview]:
    reviews = [
        CustomerReview(
            review_id=r["review_id"],
            product_name=r["product_name"],
            rating=r["rating"],
            title=r["title"],
            verified_purchase=r["verified_purchase"],
            review_date=r["review_date"],
        )
        for r in _db()["reviews"]
        if r["customer_id"] == str(customer_id)
    ]
    reviews.sort(key=lambda r: str(r.review_date), reverse=True)
    return reviews


def list_customers(limit: int) -> list[dict]:
    return [
        {
            "customer_id": c["customer_id"],
            "first_name": c["first_name"],
            "last_name": c["last_name"],
            "email": c["email"],
            "loyalty_tier": c["loyalty_tier"],
            "current_ltv": c["current_ltv"],
        }
        for c in _db()["customers"][:limit]
    ]


def recent_orders(limit: int) -> list[dict]:
    orders = sorted(_db()["orders"], key=lambda o: str(o["order_date"]), reverse=True)
    return [
        {
            "order_id": o["order_id"],
            "customer_id": o["customer_id"],
            "order_date": o["order_date"],
            "order_status": o["order_status"],
            "total_amount": o["total_amount"],
            "currency": o["currency"],
            "first_name": o["first_name"],
            "last_name": o["last_name"],
        }
        for o in orders[:limit]
    ]


# ---------------------------------------------------------------------------
# Fixture helpers (used by tests/conftest.py in demo mode)
# ---------------------------------------------------------------------------

def sample_customer_id() -> str:
    """Sarah Davis always has both in-flight orders and recent reviews."""
    return KNOWN_CUSTOMER_ID


def customer_with_no_orders() -> str:
    return _db()["customers"][-2]["customer_id"]


def customer_with_no_reviews() -> str:
    return _db()["customers"][-1]["customer_id"]
