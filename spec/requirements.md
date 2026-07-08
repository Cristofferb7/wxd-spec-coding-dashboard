# E-commerce Workshop — Requirements

## Personas

### Primary Users
- **Retail Manager**: monitors today's sales performance against historical baselines, needs real-time visibility into order velocity and revenue trends
- **Operations Lead**: tracks inventory movements and flagged low-stock products to plan replenishment
- **Customer Service**: looks up active customer orders and recent activity to resolve issues quickly

## User Flows

### Flow 1: Sales Performance Dashboard
1. Manager opens dashboard at start of business day
2. Sees today's orders placed + revenue
3. Compares against 30-day daily average
4. Identifies whether today is tracking above/below baseline
5. Drills into category and regional breakdowns

### Flow 2: Inventory Monitoring
1. Operations reviews current stock levels
2. Identifies products below reorder threshold
3. Views recent inventory movements (last 30 days)
4. Sees which products have high velocity

### Flow 3: Customer Lookup
1. Service agent searches for a customer by ID or email
2. Sees live account status, loyalty tier, total LTV
3. Views their in-flight orders (pending/processing/shipped)
4. Sees recent reviews they've submitted

---

## Definitions

- **"Today" / "current"**: this app runs against a fixed data snapshot, not a live feed. "Today" means the most recent date present in the operational order data — not the calendar date the app happens to be run on. Computed from the data itself (e.g. the latest order date), not the system clock.
- **"30-day average" / "baseline"**: the operational data (orders placed "today" and in the recent window) and the historical daily-summary data are adjacent, non-overlapping periods — the historical data ends exactly where the operational window begins. The baseline is therefore the most recent 30 days present in the historical daily-summary data (its own latest 30 days), not a 30-day window counted backward from "today". It represents "how a typical recent day performed" just before the current operational window opened.

---

## Requirements

### REQ-001: View Today's Order Volume vs. Historical Average
**Acceptance Criteria:**
- Returns count of orders placed today
- Returns total revenue for today's orders
- Compares against 30-day rolling average of daily order counts
- Compares against 30-day rolling average of daily revenue
- Response includes both the absolute values and the percent-change delta

### REQ-002: Drill into Sales by Category and Region
**Acceptance Criteria:**
- Breaks down today's orders by product category, with order count and revenue per category
- Breaks down today's orders by shipping region (state), with order count and revenue per region
- Both breakdowns are sortable by volume or revenue (descending)
- Each category and region is compared against its own 30-day daily average

### REQ-003: View Live Inventory Status
**Acceptance Criteria:**
- Lists all products with current stock quantity
- Flags products below their reorder threshold
- Shows last stock move timestamp for each product, or indicates no movement in the last 30 days if none exists
- Sortable by stock level or urgency (lowest stock first)

### REQ-004: Lookup Customer Profile
**Acceptance Criteria:**
- Search by customer ID or email
- Returns current account status
- Shows lifetime value (current snapshot), total orders, loyalty tier
- Returns email, phone, and shipping location (city, state, country) on file

### REQ-005: View Customer's In-Flight Orders
**Acceptance Criteria:**
- Lists orders placed in the last 30 days with status ≠ terminal
- Shows order date, status (pending/processing/shipped), total amount, tracking number
- Shows estimated delivery date if available
- Includes line-item details (product name, quantity, unit price)

### REQ-006: View Customer's Recent Reviews
**Acceptance Criteria:**
- Lists reviews submitted by that customer in the last 30 days
- Shows product name, rating (1–5), review title, timestamp
- Flags whether purchase was verified

---

## Out of Scope

- User authentication / authorization (assume internal-only tool)
- Real-time alerting or notifications
- Bulk operations (export, batch updates)
- Historical trend analysis beyond 30 days
- Recommendation engine
- Payment processing or refunds
- Internationalization (assume single currency/language)
- Mobile UI
