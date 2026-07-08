// Dashboard frontend. Each section fetches independently so a failure in
// one (e.g. a 502 from Presto) doesn't take down the rest of the page.
// All dynamic values pass through esc() before hitting innerHTML.

"use strict";

// ---------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------
function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function fetchJSON(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error(`Network error calling ${url}: ${err.message}`);
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body — fall through to status-based error below.
  }

  if (!response.ok) {
    const detail = body && body.detail ? body.detail : `HTTP ${response.status}`;
    throw new Error(detail);
  }

  return body;
}

const _money = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const _moneyCompact = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const _number = new Intl.NumberFormat();

function fmtMoney(value) {
  return _money.format(Number(value));
}

function fmtMoneyCompact(value) {
  return _moneyCompact.format(Number(value));
}

function fmtPct(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(1)}%`;
}

// Dates from the API are date-only ISO strings; parse the parts so the
// browser's timezone can't shift them to the previous day.
function fmtDate(isoDate) {
  const [y, m, d] = String(isoDate).split("T")[0].split("-").map(Number);
  if (!y || !m || !d) return esc(isoDate);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function deltaBadge(value, { suffix = "" } = {}) {
  const cls = value >= 0 ? "delta positive" : "delta negative";
  const arrow = value >= 0 ? "▲" : "▼";
  return `<span class="${cls}">${arrow} ${esc(fmtPct(value))}${suffix}</span>`;
}

function skeleton(rows = 4) {
  const widths = ["wide", "mid", "wide", "narrow", "mid", "wide"];
  let html = "";
  for (let i = 0; i < rows; i++) {
    html += `<div class="skeleton-row ${widths[i % widths.length]}"></div>`;
  }
  return html;
}

function errorHTML(message) {
  return `<div class="error-banner">Error: ${esc(message)}</div>`;
}

function copyToClipboard(text, el) {
  navigator.clipboard.writeText(text).then(() => {
    const original = el.textContent;
    el.textContent = "✓ Copied";
    setTimeout(() => (el.textContent = original), 1500);
  });
}

function exportTableToCSV(tableSelector, filename = "export.csv") {
  const table = document.querySelector(tableSelector);
  if (!table) return;

  const rows = [];
  table.querySelectorAll("tr").forEach((row) => {
    if (row.style.display === "none") return;
    const cols = [];
    row.querySelectorAll("td, th").forEach((col) => {
      cols.push('"' + col.textContent.trim().replace(/"/g, '""') + '"');
    });
    rows.push(cols.join(","));
  });

  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function filterTable(tableSelector, searchTerm) {
  const table = document.querySelector(tableSelector);
  if (!table) return;

  const searchLower = searchTerm.toLowerCase();
  table.querySelectorAll("tbody tr").forEach((row) => {
    row.style.display = row.textContent.toLowerCase().includes(searchLower) ? "" : "none";
  });
}

function sortTable(tableSelector, columnIndex, ascending) {
  const table = document.querySelector(tableSelector);
  if (!table) return;

  const tbody = table.querySelector("tbody");
  const rows = Array.from(tbody.querySelectorAll("tr"));

  rows.sort((a, b) => {
    const aText = a.cells[columnIndex].textContent.trim();
    const bText = b.cells[columnIndex].textContent.trim();
    const aNum = parseFloat(aText.replace(/[$,]/g, ""));
    const bNum = parseFloat(bText.replace(/[$,]/g, ""));

    if (!isNaN(aNum) && !isNaN(bNum)) {
      return ascending ? aNum - bNum : bNum - aNum;
    }
    return ascending ? aText.localeCompare(bText) : bText.localeCompare(aText);
  });

  rows.forEach((row) => tbody.appendChild(row));
}

function enableSortableHeaders(tableSelector) {
  const table = document.querySelector(tableSelector);
  if (!table) return;

  const headers = table.querySelectorAll("thead th");
  headers.forEach((header, index) => {
    header.setAttribute("aria-sort", "none");
    header.title = "Click to sort";
    const indicator = document.createElement("span");
    indicator.className = "sort-indicator";
    indicator.setAttribute("aria-hidden", "true");
    header.appendChild(indicator);

    header.addEventListener("click", () => {
      const ascending = header.getAttribute("aria-sort") !== "ascending";
      sortTable(tableSelector, index, ascending);
      headers.forEach((h) => {
        h.setAttribute("aria-sort", "none");
        h.querySelector(".sort-indicator").textContent = "";
      });
      header.setAttribute("aria-sort", ascending ? "ascending" : "descending");
      indicator.textContent = ascending ? "▲" : "▼";
    });
  });
}

// Status badges: icon/dot + label, never color alone.
function statusBadge(status) {
  const kinds = { pending: "warning", processing: "neutral", shipped: "good", delivered: "good" };
  const kind = kinds[status] || "plain";
  return `<span class="badge badge-${kind}"><span class="dot" aria-hidden="true"></span>${esc(status)}</span>`;
}

function tierBadge(tier) {
  return `<span class="badge badge-plain"><span class="dot" aria-hidden="true"></span>${esc(tier)}</span>`;
}

// ---------------------------------------------------------------------
// REQ-001: Sales today (KPI stat tiles)
// ---------------------------------------------------------------------
async function loadSalesToday() {
  const content = document.getElementById("sales-today-content");
  content.innerHTML = `<div class="kpi">${skeleton(2)}</div><div class="kpi">${skeleton(2)}</div><div class="kpi">${skeleton(2)}</div>`;
  try {
    const data = await fetchJSON("/sales/today");
    document.getElementById("as-of-date").textContent = `Today's sales, as of ${fmtDate(data.as_of_date)}`;

    const aov = data.today.order_count > 0 ? data.today.revenue / data.today.order_count : 0;
    const baselineAov = data.baseline_30d_avg.order_count > 0
      ? data.baseline_30d_avg.revenue / data.baseline_30d_avg.order_count
      : 0;
    const aovDelta = baselineAov > 0 ? ((aov - baselineAov) / baselineAov) * 100 : 0;

    content.innerHTML = `
      <div class="kpi">
        <div class="label">Orders today</div>
        <div class="value">${esc(_number.format(data.today.order_count))}</div>
        <div class="delta-line">
          ${deltaBadge(data.delta.order_count_pct)}
          <span class="vs">vs 30-day avg (${esc(data.baseline_30d_avg.order_count.toFixed(1))}/day)</span>
        </div>
      </div>
      <div class="kpi">
        <div class="label">Revenue today</div>
        <div class="value">${esc(fmtMoney(data.today.revenue))}</div>
        <div class="delta-line">
          ${deltaBadge(data.delta.revenue_pct)}
          <span class="vs">vs 30-day avg (${esc(fmtMoneyCompact(data.baseline_30d_avg.revenue))}/day)</span>
        </div>
      </div>
      <div class="kpi">
        <div class="label">Avg order value</div>
        <div class="value">${esc(fmtMoney(aov))}</div>
        <div class="delta-line">
          ${deltaBadge(aovDelta)}
          <span class="vs">vs 30-day avg (${esc(fmtMoney(baselineAov))})</span>
        </div>
      </div>
    `;
  } catch (err) {
    content.innerHTML = errorHTML(`loading sales summary: ${err.message}`);
  }
}

// ---------------------------------------------------------------------
// REQ-002: Category & region breakdowns (single-series bar list with a
// baseline tick — values are printed in-row, so nothing is tooltip-gated)
// ---------------------------------------------------------------------
function renderBarList(rows, labelKey) {
  if (rows.length === 0) {
    return `<p class="empty">No data available.</p>`;
  }

  const max = Math.max(...rows.map((r) => Math.max(r.revenue, r.baseline_revenue)), 1);

  const body = rows
    .map((row) => {
      const width = Math.max((row.revenue / max) * 100, 0).toFixed(1);
      const tick = Math.min((row.baseline_revenue / max) * 100, 99).toFixed(1);
      const deltaPct = row.baseline_revenue > 0
        ? ((row.revenue - row.baseline_revenue) / row.baseline_revenue) * 100
        : 0;
      return `
      <div class="bar-row" title="${esc(row[labelKey])}: ${esc(fmtMoney(row.revenue))} today across ${esc(_number.format(row.order_count))} orders; 30-day baseline ${esc(fmtMoney(row.baseline_revenue))}/day">
        <span class="bar-label">${esc(row[labelKey])}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width: ${width}%"></div>
          <div class="bar-baseline" style="left: ${tick}%"></div>
        </div>
        <span class="bar-value">
          ${esc(fmtMoney(row.revenue))}
          <span class="bar-meta">${esc(_number.format(row.order_count))} ${row.order_count === 1 ? "order" : "orders"} · ${esc(fmtPct(deltaPct))}</span>
        </span>
      </div>
    `;
    })
    .join("");

  return `
    <div class="bar-list" role="img" aria-label="Revenue by ${labelKey}, sorted highest first">${body}</div>
    <div class="chart-caption"><span class="caption-tick" aria-hidden="true"></span> 30-day average revenue per day</div>
  `;
}

async function loadByCategory() {
  const content = document.getElementById("by-category-content");
  content.innerHTML = skeleton(6);
  try {
    const data = await fetchJSON("/sales/today/by-category");
    content.innerHTML = renderBarList(data, "category");
  } catch (err) {
    content.innerHTML = errorHTML(`loading category breakdown: ${err.message}`);
  }
}

async function loadByRegion() {
  const content = document.getElementById("by-region-content");
  content.innerHTML = skeleton(6);
  try {
    const data = await fetchJSON("/sales/today/by-region");
    content.innerHTML = renderBarList(data, "region");
  } catch (err) {
    content.innerHTML = errorHTML(`loading region breakdown: ${err.message}`);
  }
}

// ---------------------------------------------------------------------
// REQ-003: Inventory (sidebar card)
// ---------------------------------------------------------------------
async function loadInventory(sort) {
  const content = document.getElementById("inventory-content");
  if (content.querySelector("table")) {
    content.classList.add("refreshing"); // hold the previous render, no flash
  } else {
    content.innerHTML = skeleton(6);
  }

  try {
    const data = await fetchJSON(`/inventory?sort=${encodeURIComponent(sort)}`);
    content.classList.remove("refreshing");

    if (data.length === 0) {
      content.innerHTML = `<p class="empty">No products found.</p>`;
      return;
    }

    const body = data
      .map((item) => {
        const rowClass = item.below_reorder ? "row-below-reorder" : "";
        const badge = item.below_reorder
          ? `<span class="badge badge-critical"><span class="dot" aria-hidden="true"></span>Reorder</span>`
          : `<span class="badge badge-good"><span class="dot" aria-hidden="true"></span>In stock</span>`;
        return `
          <tr class="${rowClass}">
            <td>${esc(item.name)}</td>
            <td class="num">${esc(_number.format(item.stock_quantity))}</td>
            <td class="num">${esc(_number.format(item.reorder_level))}</td>
            <td>${badge}</td>
          </tr>
        `;
      })
      .join("");

    content.innerHTML = `
      <table>
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col" class="num">Stock</th>
            <th scope="col" class="num">Reorder at</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    `;
  } catch (err) {
    content.classList.remove("refreshing");
    content.innerHTML = errorHTML(`loading inventory: ${err.message}`);
  }
}

// ---------------------------------------------------------------------
// REQ-004/005/006: Customer lookup
// ---------------------------------------------------------------------
async function loadCustomer(searchType, searchValue) {
  const content = document.getElementById("customer-detail-content");
  content.innerHTML = skeleton(5);
  openCustomerModal();

  let profile;
  try {
    const params = new URLSearchParams();
    params.set(searchType, searchValue);
    profile = await fetchJSON(`/customers?${params.toString()}`);
  } catch (err) {
    content.innerHTML = errorHTML(err.message);
    return;
  }

  content.innerHTML = `
    <div class="kpi-row">
      <div class="kpi">
        <div class="label">${esc(profile.first_name)} ${esc(profile.last_name)}</div>
        <div class="value">${tierBadge(profile.loyalty_tier)}</div>
        <div class="muted">${esc(profile.account_status)} account</div>
      </div>
      <div class="kpi">
        <div class="label">Lifetime value</div>
        <div class="value">${esc(fmtMoney(profile.current_ltv))}</div>
        <div class="muted">${esc(_number.format(profile.total_orders))} total orders</div>
      </div>
      <div class="kpi">
        <div class="label">Contact</div>
        <div class="muted">${esc(profile.email)}</div>
        <div class="muted">${esc(profile.phone)}</div>
        <div class="muted">${esc(profile.shipping_city)}, ${esc(profile.shipping_state)}, ${esc(profile.shipping_country)}</div>
      </div>
    </div>
    <div class="subsection">
      <h3>In-flight orders</h3>
      <div id="customer-orders">${skeleton(3)}</div>
    </div>
    <div class="subsection">
      <h3>Recent reviews</h3>
      <div id="customer-reviews">${skeleton(3)}</div>
    </div>
  `;

  loadCustomerOrders(profile.customer_id);
  loadCustomerReviews(profile.customer_id);
  saveToHistory(searchType, searchValue, profile);
}

async function loadCustomerOrders(customerId) {
  const el = document.getElementById("customer-orders");
  try {
    const orders = await fetchJSON(`/customers/${encodeURIComponent(customerId)}/orders`);
    if (orders.length === 0) {
      el.innerHTML = `<p class="empty">No in-flight orders.</p>`;
      return;
    }
    el.innerHTML = orders
      .map((order) => {
        const items = order.items
          .map((item) => `<li>${esc(item.quantity)} × ${esc(item.product_name)} (${esc(fmtMoney(item.line_total))})</li>`)
          .join("");
        return `
          <div class="card order-card">
            <div class="order-head">
              <strong>${esc(fmtDate(order.order_date))}</strong>
              ${statusBadge(order.order_status)}
              <span class="muted">payment ${esc(order.payment_status)}</span>
              <strong class="order-total">${esc(fmtMoney(order.total_amount))} ${esc(order.currency)}</strong>
            </div>
            ${order.tracking_number ? `<div class="muted">Tracking: <span class="copy-btn" data-action="copy" data-copy="${esc(order.tracking_number)}">${esc(order.tracking_number)}</span></div>` : ""}
            ${order.estimated_delivery_date ? `<div class="muted">Est. delivery: ${esc(fmtDate(order.estimated_delivery_date))}</div>` : ""}
            <ul>${items}</ul>
          </div>
        `;
      })
      .join("");
  } catch (err) {
    el.innerHTML = errorHTML(`loading orders: ${err.message}`);
  }
}

async function loadCustomerReviews(customerId) {
  const el = document.getElementById("customer-reviews");
  try {
    const reviews = await fetchJSON(`/customers/${encodeURIComponent(customerId)}/reviews`);
    if (reviews.length === 0) {
      el.innerHTML = `<p class="empty">No reviews in the last 30 days.</p>`;
      return;
    }
    el.innerHTML = `
      <table>
        <thead><tr><th scope="col">Product</th><th scope="col">Rating</th><th scope="col">Title</th><th scope="col">Verified</th><th scope="col">Date</th></tr></thead>
        <tbody>
          ${reviews
            .map(
              (r) => `
            <tr>
              <td>${esc(r.product_name)}</td>
              <td><span aria-label="${esc(r.rating)} out of 5 stars">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span></td>
              <td>${esc(r.title)}</td>
              <td>${r.verified_purchase ? "Yes" : "No"}</td>
              <td>${esc(fmtDate(r.review_date))}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;
  } catch (err) {
    el.innerHTML = errorHTML(`loading reviews: ${err.message}`);
  }
}

// ---------------------------------------------------------------------
// Full-page views: orders / inventory / customers
// ---------------------------------------------------------------------
function tableControlsHTML(count, tableId, filename, refreshAction, extra = "") {
  return `
    <div class="table-controls">
      <span class="row-count">${esc(_number.format(count))} rows</span>
      ${extra}
      <input type="text" class="table-search" placeholder="Filter rows…"
             aria-label="Filter table rows" data-filter-table="#${tableId}">
      <button type="button" data-action="export-csv" data-table="#${tableId}" data-filename="${esc(filename)}">Export CSV</button>
      <button type="button" data-action="${refreshAction}">Refresh</button>
    </div>
  `;
}

function loadOrdersPage() {
  const content = document.getElementById("demo-orders-content");
  if (content.querySelector("table")) {
    content.classList.add("refreshing");
  } else {
    content.innerHTML = skeleton(8);
  }

  fetchJSON("/customers/recent-orders?limit=100")
    .then((orders) => {
      content.classList.remove("refreshing");
      if (orders.length === 0) {
        content.innerHTML = `<p class="empty">No recent orders found.</p>`;
        return;
      }

      const rows = orders
        .map(
          (o) => `
        <tr>
          <td><span class="copy-btn" data-action="copy" data-copy="${esc(o.order_id)}" title="Click to copy full ID">${esc(o.order_id.substring(0, 8))}…</span></td>
          <td>${esc(o.first_name)} ${esc(o.last_name)}</td>
          <td>${esc(fmtDate(o.order_date))}</td>
          <td>${statusBadge(o.order_status)}</td>
          <td class="num">${esc(fmtMoney(o.total_amount))}</td>
        </tr>
      `
        )
        .join("");

      content.innerHTML = `
        ${tableControlsHTML(orders.length, "orders-table", "orders.csv", "refresh-orders")}
        <table id="orders-table">
          <thead><tr><th scope="col">Order ID</th><th scope="col">Customer</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col" class="num">Total</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `;
      enableSortableHeaders("#orders-table");
    })
    .catch((err) => {
      content.classList.remove("refreshing");
      content.innerHTML = errorHTML(`loading orders: ${err.message}`);
    });
}

function loadInventoryPage() {
  const content = document.getElementById("demo-inventory-content");
  if (content.querySelector("table")) {
    content.classList.add("refreshing");
  } else {
    content.innerHTML = skeleton(8);
  }

  fetchJSON("/inventory?sort=urgency")
    .then((inventory) => {
      content.classList.remove("refreshing");
      if (inventory.length === 0) {
        content.innerHTML = `<p class="empty">No products found.</p>`;
        return;
      }

      const rows = inventory
        .map((i) => {
          const badge = i.below_reorder
            ? `<span class="badge badge-critical"><span class="dot" aria-hidden="true"></span>Reorder</span>`
            : `<span class="badge badge-good"><span class="dot" aria-hidden="true"></span>In stock</span>`;
          return `
          <tr class="${i.below_reorder ? "row-below-reorder" : ""}">
            <td>${esc(i.name)}</td>
            <td><span class="copy-btn" data-action="copy" data-copy="${esc(i.sku)}" title="Click to copy SKU">${esc(i.sku)}</span></td>
            <td>${esc(i.category)}</td>
            <td class="num">${esc(_number.format(i.stock_quantity))}</td>
            <td class="num">${esc(_number.format(i.reorder_level))}</td>
            <td>${badge}</td>
          </tr>
        `;
        })
        .join("");

      content.innerHTML = `
        ${tableControlsHTML(inventory.length, "inventory-table", "inventory.csv", "refresh-inventory")}
        <table id="inventory-table">
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">SKU</th>
              <th scope="col">Category</th>
              <th scope="col" class="num">Stock</th>
              <th scope="col" class="num">Reorder at</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
      enableSortableHeaders("#inventory-table");
    })
    .catch((err) => {
      content.classList.remove("refreshing");
      content.innerHTML = errorHTML(`loading inventory: ${err.message}`);
    });
}

function loadCustomersPage() {
  const content = document.getElementById("demo-customers-content");
  if (content.querySelector("table")) {
    content.classList.add("refreshing");
  } else {
    content.innerHTML = skeleton(8);
  }

  fetchJSON("/customers/list?limit=100")
    .then((customers) => {
      content.classList.remove("refreshing");
      if (customers.length === 0) {
        content.innerHTML = `<p class="empty">No customers found.</p>`;
        return;
      }

      const tierFilter = `
        <select class="filter-select" aria-label="Filter by loyalty tier" data-tier-filter="#customer-table">
          <option value="">All tiers</option>
          <option value="bronze">Bronze</option>
          <option value="silver">Silver</option>
          <option value="gold">Gold</option>
          <option value="platinum">Platinum</option>
        </select>
      `;

      const rows = customers
        .map(
          (c) => `
        <tr data-tier="${esc(c.loyalty_tier)}">
          <td><span class="copy-btn" data-action="copy" data-copy="${esc(c.customer_id)}" title="Click to copy full ID">${esc(c.customer_id.substring(0, 8))}…</span></td>
          <td>${esc(c.first_name)} ${esc(c.last_name)}</td>
          <td>${esc(c.email)}</td>
          <td class="num">${esc(fmtMoney(c.current_ltv))}</td>
          <td>${tierBadge(c.loyalty_tier)}</td>
        </tr>
      `
        )
        .join("");

      content.innerHTML = `
        ${tableControlsHTML(customers.length, "customer-table", "customers.csv", "refresh-customers", tierFilter)}
        <table id="customer-table">
          <thead>
            <tr>
              <th scope="col">Customer ID</th>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col" class="num">Lifetime value</th>
              <th scope="col">Loyalty tier</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
      enableSortableHeaders("#customer-table");
    })
    .catch((err) => {
      content.classList.remove("refreshing");
      content.innerHTML = errorHTML(`loading customers: ${err.message}`);
    });
}

// ---------------------------------------------------------------------
// Customer modal
// ---------------------------------------------------------------------
function openCustomerModal() {
  document.getElementById("customer-modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeCustomerModal() {
  document.getElementById("customer-modal").classList.add("hidden");
  document.body.style.overflow = "auto";
}

// ---------------------------------------------------------------------
// Customer lookup history (localStorage)
// ---------------------------------------------------------------------
const HISTORY_KEY = "customer_lookup_history";
const MAX_HISTORY = 10;

function readHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveToHistory(searchType, searchValue, customer) {
  const entry = {
    timestamp: new Date().toISOString(),
    searchType,
    searchValue,
    customer_id: customer.customer_id,
    name: `${customer.first_name} ${customer.last_name}`,
    email: customer.email,
  };

  const filtered = readHistory().filter((h) => h.customer_id !== customer.customer_id);
  filtered.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered.slice(0, MAX_HISTORY)));
  renderHistory();
}

function renderHistory() {
  const history = readHistory();
  const content = document.getElementById("history-content");

  if (history.length === 0) {
    content.innerHTML = `<p class="empty">No recent lookups.</p>`;
    return;
  }

  content.innerHTML = history
    .map(
      (entry) => `
    <button type="button" class="history-item" data-action="re-search"
            data-search-type="${esc(entry.searchType)}" data-search-value="${esc(entry.searchValue)}">
      <div class="history-name">${esc(entry.name)}</div>
      <div class="history-meta">${esc(entry.email)} · ${esc(new Date(entry.timestamp).toLocaleTimeString())}</div>
    </button>
  `
    )
    .join("");
}

// ---------------------------------------------------------------------
// Demo-mode banner
// ---------------------------------------------------------------------
async function loadModeBanner() {
  if (sessionStorage.getItem("demo-banner-dismissed")) return;
  try {
    const health = await fetchJSON("/api/health");
    if (health.mode !== "demo") return;

    const banner = document.getElementById("mode-banner");
    banner.classList.remove("hidden");
    banner.innerHTML = `
      <span><strong>Demo mode</strong> — serving a generated sample dataset (no live
      watsonx.data cluster connected). Try the customer lookup with
      <button type="button" class="banner-link" data-action="re-search"
              data-search-type="email" data-search-value="${esc(health.sample_customer_email)}">${esc(health.sample_customer_email)}</button></span>
      <button type="button" class="banner-close" data-action="dismiss-banner" aria-label="Dismiss demo notice">✕</button>
    `;
  } catch {
    // Health endpoint unavailable — leave the banner hidden.
  }
}

// ---------------------------------------------------------------------
// Theme toggle (default follows the system; choice persists)
// ---------------------------------------------------------------------
function initThemeToggle() {
  const btn = document.getElementById("theme-toggle");

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    btn.textContent = theme === "dark" ? "☀️" : "🌙";
    btn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }

  apply(document.documentElement.getAttribute("data-theme") || "light");

  btn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    localStorage.setItem("theme", next);
    apply(next);
  });
}

// ---------------------------------------------------------------------
// Navigation (SPA view switching)
// ---------------------------------------------------------------------
function initNavigation() {
  const navLinks = document.querySelectorAll(".nav-item");
  const views = document.querySelectorAll(".view-section");
  const loaded = new Set();

  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();

      navLinks.forEach((l) => l.classList.remove("active"));
      views.forEach((v) => v.classList.remove("active"));

      link.classList.add("active");
      const targetId = link.getAttribute("data-target");
      const targetView = document.getElementById(targetId);
      if (targetView) targetView.classList.add("active");

      // Lazy-load full-page views once; Refresh re-fetches on demand.
      if (!loaded.has(targetId)) {
        if (targetId === "view-orders") loadOrdersPage();
        if (targetId === "view-inventory") loadInventoryPage();
        if (targetId === "view-customers") loadCustomersPage();
        loaded.add(targetId);
      }
    });
  });
}

// ---------------------------------------------------------------------
// Global event delegation (clicks + inputs)
// ---------------------------------------------------------------------
function initDelegation() {
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;

    const action = el.getAttribute("data-action");
    switch (action) {
      case "copy":
        copyToClipboard(el.getAttribute("data-copy"), el);
        break;
      case "close-modal":
        closeCustomerModal();
        break;
      case "dismiss-banner":
        document.getElementById("mode-banner").classList.add("hidden");
        sessionStorage.setItem("demo-banner-dismissed", "1");
        break;
      case "export-csv":
        exportTableToCSV(el.getAttribute("data-table"), el.getAttribute("data-filename"));
        break;
      case "refresh-orders":
        loadOrdersPage();
        break;
      case "refresh-inventory":
        loadInventoryPage();
        break;
      case "refresh-customers":
        loadCustomersPage();
        break;
      case "re-search": {
        const type = el.getAttribute("data-search-type");
        const value = el.getAttribute("data-search-value");
        document.getElementById("customer-search-type").value = type;
        document.getElementById("customer-search-value").value = value;
        loadCustomer(type, value);
        break;
      }
    }
  });

  document.addEventListener("input", (e) => {
    const search = e.target.closest("[data-filter-table]");
    if (search) {
      filterTable(search.getAttribute("data-filter-table"), search.value);
      return;
    }
    const tierSelect = e.target.closest("[data-tier-filter]");
    if (tierSelect) {
      const table = document.querySelector(tierSelect.getAttribute("data-tier-filter"));
      if (!table) return;
      const tier = tierSelect.value;
      table.querySelectorAll("tbody tr").forEach((row) => {
        row.style.display = tier === "" || row.getAttribute("data-tier") === tier ? "" : "none";
      });
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCustomerModal();
  });
}

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  initThemeToggle();
  initNavigation();
  initDelegation();
  loadModeBanner();
  loadSalesToday();
  loadByCategory();
  loadByRegion();
  loadInventory("stock");
  renderHistory();

  document.getElementById("inventory-sort").addEventListener("change", (e) => {
    loadInventory(e.target.value);
  });

  document.getElementById("customer-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const searchType = document.getElementById("customer-search-type").value;
    const searchValue = document.getElementById("customer-search-value").value.trim();
    if (!searchValue) return;
    loadCustomer(searchType, searchValue);
  });
});
