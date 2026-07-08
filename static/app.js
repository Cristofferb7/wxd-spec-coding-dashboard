// Dashboard frontend. Each section fetches independently so a failure in
// one (e.g. a 502 from Presto) doesn't take down the rest of the page.

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

function fmtMoney(value) {
  return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(1)}%`;
}

function deltaClass(value) {
  return value >= 0 ? "delta positive" : "delta negative";
}

function showError(containerId, message) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  el.classList.remove("hidden");
  el.textContent = `Error: ${message}`;
}

function hideError(containerId) {
  const el = document.getElementById(containerId);
  el.classList.add("hidden");
  el.textContent = "";
}

// Utility: Copy to clipboard
function copyToClipboard(text, el) {
  navigator.clipboard.writeText(text).then(() => {
    const originalText = el.textContent;
    el.textContent = "✓ Copied!";
    setTimeout(() => (el.textContent = originalText), 2000);
  });
}

// Utility: Export table to CSV
function exportTableToCSV(tableSelector, filename = "export.csv") {
  const table = document.querySelector(tableSelector);
  if (!table) return;

  const rows = [];
  table.querySelectorAll("tr").forEach((row) => {
    const cols = [];
    row.querySelectorAll("td, th").forEach((col) => {
      cols.push('"' + col.textContent.trim().replace(/"/g, '""') + '"');
    });
    rows.push(cols.join(","));
  });

  const csv = rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}

// Utility: Filter table by search term
function filterTable(tableSelector, searchTerm) {
  const table = document.querySelector(tableSelector);
  if (!table) return;

  const searchLower = searchTerm.toLowerCase();
  table.querySelectorAll("tbody tr").forEach((row) => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(searchLower) ? "" : "none";
  });
}

// Utility: Sort table by column index
function sortTable(tableSelector, columnIndex, ascending = true) {
  const table = document.querySelector(tableSelector);
  if (!table) return;

  const tbody = table.querySelector("tbody");
  const rows = Array.from(tbody.querySelectorAll("tr"));

  rows.sort((a, b) => {
    const aText = a.cells[columnIndex].textContent.trim();
    const bText = b.cells[columnIndex].textContent.trim();

    const aNum = parseFloat(aText);
    const bNum = parseFloat(bText);

    if (!isNaN(aNum) && !isNaN(bNum)) {
      return ascending ? aNum - bNum : bNum - aNum;
    }

    return ascending ? aText.localeCompare(bText) : bText.localeCompare(aText);
  });

  rows.forEach((row) => tbody.appendChild(row));
}

// Utility: Make headers clickable for sorting
function enableSortableHeaders(tableSelector) {
  const table = document.querySelector(tableSelector);
  if (!table) return;

  const headers = table.querySelectorAll("thead th");
  headers.forEach((header, index) => {
    let ascending = true;
    header.style.cursor = "pointer";
    header.title = "Click to sort";
    header.addEventListener("click", () => {
      sortTable(tableSelector, index, ascending);
      headers.forEach((h) => (h.style.fontWeight = "normal"));
      header.style.fontWeight = "bold";
      ascending = !ascending;
    });
  });
}

// Utility: Add row count to a section
function updateRowCount(containerId, count) {
  const content = document.getElementById(containerId);
  let countEl = content.querySelector(".row-count");
  if (!countEl) {
    countEl = document.createElement("div");
    countEl.className = "row-count";
    content.insertBefore(countEl, content.firstChild);
  }
  countEl.textContent = `${count} item${count !== 1 ? "s" : ""}`;
}

// ---------------------------------------------------------------------
// REQ-001: Sales today
// ---------------------------------------------------------------------
async function loadSalesToday() {
  const content = document.getElementById("sales-today-content");
  try {
    const data = await fetchJSON("/sales/today");
    document.getElementById("as-of-date").textContent = `(as of ${data.as_of_date})`;

    content.innerHTML = `
      <div class="kpi-row">
        <div class="kpi">
          <div class="label">Orders today</div>
          <div class="value">${data.today.order_count}</div>
          <div class="${deltaClass(data.delta.order_count_pct)}">
            ${fmtPct(data.delta.order_count_pct)} vs. 30-day avg (${data.baseline_30d_avg.order_count.toFixed(1)})
          </div>
        </div>
        <div class="kpi">
          <div class="label">Revenue today</div>
          <div class="value">${fmtMoney(data.today.revenue)}</div>
          <div class="${deltaClass(data.delta.revenue_pct)}">
            ${fmtPct(data.delta.revenue_pct)} vs. 30-day avg (${fmtMoney(data.baseline_30d_avg.revenue)})
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    content.classList.remove("loading");
    content.innerHTML = `<div class="error-banner">Error loading sales summary: ${err.message}</div>`;
  }
}

// ---------------------------------------------------------------------
// REQ-002: Category & region breakdowns
// ---------------------------------------------------------------------
function renderBreakdownTable(rows, labelKey, labelHeader) {
  if (rows.length === 0) {
    return `<p class="empty">No data available.</p>`;
  }
  const body = rows
    .map(
      (row) => `
      <tr>
        <td>${row[labelKey]}</td>
        <td>${row.order_count}</td>
        <td>${fmtMoney(row.revenue)}</td>
        <td>${row.baseline_order_count.toFixed(1)}</td>
        <td>${fmtMoney(row.baseline_revenue)}</td>
      </tr>
    `
    )
    .join("");
  return `
    <table>
      <thead>
        <tr>
          <th>${labelHeader}</th>
          <th>Orders</th>
          <th>Revenue</th>
          <th>Baseline orders/day</th>
          <th>Baseline revenue/day</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

async function loadByCategory() {
  const content = document.getElementById("by-category-content");
  try {
    const data = await fetchJSON("/sales/today/by-category");
    content.classList.remove("loading");
    content.innerHTML = renderBreakdownTable(data, "category", "Category");
  } catch (err) {
    content.classList.remove("loading");
    content.innerHTML = `<div class="error-banner">Error loading category breakdown: ${err.message}</div>`;
  }
}

async function loadByRegion() {
  const content = document.getElementById("by-region-content");
  try {
    const data = await fetchJSON("/sales/today/by-region");
    content.classList.remove("loading");
    content.innerHTML = renderBreakdownTable(data, "region", "Region");
  } catch (err) {
    content.classList.remove("loading");
    content.innerHTML = `<div class="error-banner">Error loading region breakdown: ${err.message}</div>`;
  }
}

// ---------------------------------------------------------------------
// REQ-003: Inventory
// ---------------------------------------------------------------------
async function loadInventory(sort) {
  const content = document.getElementById("inventory-content");
  content.classList.add("loading");
  content.innerHTML = "Loading…";
  try {
    const data = await fetchJSON(`/inventory?sort=${encodeURIComponent(sort)}`);
    content.classList.remove("loading");

    if (data.length === 0) {
      content.innerHTML = `<p class="empty">No products found.</p>`;
      return;
    }

    const body = data
      .map((item) => {
        const lastMove = item.last_move_at
          ? new Date(item.last_move_at).toLocaleString()
          : "No movement in last 30 days";
        const rowClass = item.below_reorder ? "row-below-reorder" : "";
        return `
          <tr class="${rowClass}">
            <td>${item.name}</td>
            <td>${item.sku}</td>
            <td>${item.category}</td>
            <td>${item.stock_quantity}</td>
            <td>${item.reorder_level}</td>
            <td>${item.below_reorder ? "Yes" : "No"}</td>
            <td>${lastMove}</td>
          </tr>
        `;
      })
      .join("");

    content.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>SKU</th>
            <th>Category</th>
            <th>Stock</th>
            <th>Reorder level</th>
            <th>Below reorder?</th>
            <th>Last stock move</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    `;
  } catch (err) {
    content.classList.remove("loading");
    content.innerHTML = `<div class="error-banner">Error loading inventory: ${err.message}</div>`;
  }
}

// ---------------------------------------------------------------------
// REQ-004/005/006: Customer lookup
// ---------------------------------------------------------------------
async function loadCustomer(searchType, searchValue) {
  const content = document.getElementById("customer-detail-content");
  content.innerHTML = `<div class="loading">Loading…</div>`;
  openCustomerModal();

  let profile;
  try {
    const params = new URLSearchParams();
    params.set(searchType, searchValue);
    profile = await fetchJSON(`/customers?${params.toString()}`);
  } catch (err) {
    content.innerHTML = `<div class="error-banner">Error: ${err.message}</div>`;
    return;
  }

  content.innerHTML = `
    <div class="kpi-row">
      <div class="kpi">
        <div class="label">${profile.first_name} ${profile.last_name}</div>
        <div class="value">${profile.loyalty_tier}</div>
        <div class="muted">${profile.account_status}</div>
      </div>
      <div class="kpi">
        <div class="label">Lifetime value</div>
        <div class="value">${fmtMoney(profile.current_ltv)}</div>
        <div class="muted">${profile.total_orders} total orders</div>
      </div>
      <div class="kpi">
        <div class="label">Contact</div>
        <div class="muted">${profile.email}</div>
        <div class="muted">${profile.phone}</div>
        <div class="muted">${profile.shipping_city}, ${profile.shipping_state}, ${profile.shipping_country}</div>
      </div>
    </div>
    <div class="subsection">
      <h3>In-flight orders</h3>
      <div id="customer-orders" class="loading">Loading…</div>
    </div>
    <div class="subsection">
      <h3>Recent reviews</h3>
      <div id="customer-reviews" class="loading">Loading…</div>
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
          .map((item) => `<li>${item.quantity} × ${item.product_name} (${fmtMoney(item.line_total)})</li>`)
          .join("");
        return `
          <div class="card">
            <strong>${order.order_date}</strong> — ${order.order_status} / ${order.payment_status}
            — ${fmtMoney(order.total_amount)} ${order.currency}
            ${order.tracking_number ? `<div class="muted">Tracking: ${order.tracking_number}</div>` : ""}
            ${order.estimated_delivery_date ? `<div class="muted">Est. delivery: ${order.estimated_delivery_date}</div>` : ""}
            <ul>${items}</ul>
          </div>
        `;
      })
      .join("");
  } catch (err) {
    el.innerHTML = `<div class="error-banner">Error loading orders: ${err.message}</div>`;
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
        <thead><tr><th>Product</th><th>Rating</th><th>Title</th><th>Verified</th><th>Date</th></tr></thead>
        <tbody>
          ${reviews
            .map(
              (r) => `
            <tr>
              <td>${r.product_name}</td>
              <td>${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</td>
              <td>${r.title}</td>
              <td>${r.verified_purchase ? "Yes" : "No"}</td>
              <td>${r.review_date}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;
  } catch (err) {
    el.innerHTML = `<div class="error-banner">Error loading reviews: ${err.message}</div>`;
  }
}

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------
async function loadModeBanner() {
  try {
    const health = await fetchJSON("/api/health");
    if (health.mode !== "demo") return;

    const banner = document.getElementById("mode-banner");
    banner.classList.remove("hidden");
    banner.innerHTML = `
      🧪 <strong>Demo mode</strong> — serving a generated sample dataset (no live
      watsonx.data cluster connected). Try the customer lookup with
      <button type="button" class="banner-link" id="banner-sample-email">${health.sample_customer_email}</button>
    `;
    document.getElementById("banner-sample-email").addEventListener("click", () => {
      document.getElementById("customer-search-type").value = "email";
      document.getElementById("customer-search-value").value = health.sample_customer_email;
      loadCustomer("email", health.sample_customer_email);
    });
  } catch {
    // Health endpoint unavailable — leave the banner hidden.
  }
}

document.addEventListener("DOMContentLoaded", () => {
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

// ---------------------------------------------------------------------
// Theme Toggle Logic
// ---------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const themeToggleBtn = document.getElementById("theme-toggle");
  
  // Check for saved theme preference, otherwise default to light
  const currentTheme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", currentTheme);
  
  // Set initial button text
  updateButtonText(currentTheme);

  // Toggle theme on click
  themeToggleBtn.addEventListener("click", () => {
    let theme = document.documentElement.getAttribute("data-theme");
    let targetTheme = theme === "dark" ? "light" : "dark";
    
    document.documentElement.setAttribute("data-theme", targetTheme);
    localStorage.setItem("theme", targetTheme);
    updateButtonText(targetTheme);
  });

  function updateButtonText(theme) {
    if (theme === "dark") {
      themeToggleBtn.textContent = "☀️ Light Mode";
    } else {
      themeToggleBtn.textContent = "🌙 Dark Mode";
    }
  }
});

// ---------------------------------------------------------------------
// Navigation & SPA View Switching
// ---------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const navLinks = document.querySelectorAll('.nav-item');
  const views = document.querySelectorAll('.view-section');

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      
      // 1. Remove active state from all links and views
      navLinks.forEach(l => l.classList.remove('active'));
      views.forEach(v => v.classList.remove('active'));
      
      // 2. Add active state to the clicked link and its target view
      link.classList.add('active');
      const targetId = link.getAttribute('data-target');
      const targetView = document.getElementById(targetId);
      
      if (targetView) {
        targetView.classList.add('active');
      }

      // 3. Load demo data if hitting a demo tab
      if (targetId === 'view-orders') loadDemoOrders();
      if (targetId === 'view-inventory') loadDemoInventory();
      if (targetId === 'view-customers') loadDemoCustomers();
    });
  });
});

// State for pagination
let orderPage = 0;
let inventoryPage = 0;
let customerPage = 0;

// Replace demo order loader with real data
function loadDemoOrders(append = false) {
  const content = document.getElementById("demo-orders-content");
  if (!append) {
    orderPage = 0;
    content.innerHTML = "<div class=\"loading\">⏳ Loading orders...</div>";
  }

  const limit = 25;
  const offset = orderPage * limit;

  fetchJSON(`/customers/recent-orders?limit=${limit}`)
    .then((allOrders) => {
      // Simulate pagination by slicing
      const orders = allOrders.slice(offset, offset + limit);

      if (orders.length === 0 && orderPage === 0) {
        content.innerHTML = `<p class="empty">No recent orders found.</p>`;
        return;
      }

      let tableHtml = content.querySelector("table")?.outerHTML || "";

      if (!append || !tableHtml) {
        const rows = orders
          .map(
            (o) => `
          <tr>
            <td><strong><span class="copy-btn" onclick="copyToClipboard('${o.order_id}', this)" title="Click to copy">${o.order_id.substring(0, 8)}…</span></strong></td>
            <td>${o.first_name} ${o.last_name}</td>
            <td>${new Date(o.order_date).toLocaleDateString()}</td>
            <td><span class="status-badge status-${o.order_status}">${o.order_status}</span></td>
            <td>${fmtMoney(o.total_amount)}</td>
          </tr>
        `
          )
          .join("");

        const html = `
          <div class="table-controls">
            <div class="row-count">${orders.length} items loaded</div>
            <input type="text" class="table-search" id="orders-search" placeholder="Search orders…" onkeyup="filterTable('#orders-table', this.value)">
            <button onclick="exportTableToCSV('#orders-table', 'orders.csv')" class="btn-export">📥 Export CSV</button>
            <button onclick="loadDemoOrders()" class="btn-refresh">🔄 Refresh</button>
          </div>
          <table id="orders-table">
            <thead><tr><th>Order ID</th><th>Customer</th><th>Date</th><th>Status</th><th>Total</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="pagination-controls">
            <button onclick="loadDemoOrders(true)" class="btn-load-more">📤 Load More</button>
          </div>
        `;
        content.innerHTML = html;
        enableSortableHeaders("#orders-table");
      }

      orderPage++;
    })
    .catch((err) => {
      content.innerHTML = `<div class="error-banner">Error loading orders: ${err.message}</div>`;
    });
}

// Replace demo inventory loader with real data
function loadDemoInventory(append = false) {
  const content = document.getElementById("demo-inventory-content");
  if (!append) {
    inventoryPage = 0;
    content.innerHTML = "<div class=\"loading\">⏳ Loading inventory...</div>";
  }

  const limit = 30;
  const offset = inventoryPage * limit;

  fetchJSON("/inventory?sort=urgency")
    .then((allInventory) => {
      const inventory = allInventory.slice(offset, offset + limit);

      if (inventory.length === 0 && inventoryPage === 0) {
        content.innerHTML = `<p class="empty">No products found.</p>`;
        return;
      }

      if (!append || !content.querySelector("table")) {
        const rows = inventory
          .map((i) => {
            const isBelowReorder = i.below_reorder;
            return `
          <tr class="${isBelowReorder ? "row-below-reorder" : ""}">
            <td><strong><span class="copy-btn" onclick="copyToClipboard('${i.sku}', this)" title="Click to copy SKU">${i.name}</span></strong></td>
            <td><span class="copy-btn" onclick="copyToClipboard('${i.sku}', this)" title="Click to copy">${i.sku}</span></td>
            <td>${i.category}</td>
            <td>${i.stock_quantity}</td>
            <td>${i.reorder_level}</td>
            <td>${isBelowReorder ? "⚠️ Yes" : "✓ No"}</td>
          </tr>
        `;
          })
          .join("");

        const html = `
          <div class="table-controls">
            <div class="row-count">${inventory.length} items loaded</div>
            <input type="text" class="table-search" id="inventory-search" placeholder="Search products…" onkeyup="filterTable('#inventory-table', this.value)">
            <button onclick="exportTableToCSV('#inventory-table', 'inventory.csv')" class="btn-export">📥 Export CSV</button>
            <button onclick="loadDemoInventory()" class="btn-refresh">🔄 Refresh</button>
          </div>
          <table id="inventory-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Stock</th>
                <th>Reorder</th>
                <th>Below?</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="pagination-controls">
            <button onclick="loadDemoInventory(true)" class="btn-load-more">📤 Load More</button>
          </div>
        `;
        content.innerHTML = html;
        enableSortableHeaders("#inventory-table");
      }

      inventoryPage++;
    })
    .catch((err) => {
      content.innerHTML = `<div class="error-banner">Error loading inventory: ${err.message}</div>`;
    });
}

// Replace demo customers loader with real data
function loadDemoCustomers(append = false) {
  const content = document.getElementById("demo-customers-content");
  if (!append) {
    customerPage = 0;
    content.innerHTML = "<div class=\"loading\">⏳ Loading customers...</div>";
  }

  const limit = 40;
  const offset = customerPage * limit;

  fetchJSON(`/customers/list?limit=${limit}`)
    .then((allCustomers) => {
      const customers = allCustomers.slice(offset, offset + limit);

      if (customers.length === 0 && customerPage === 0) {
        content.innerHTML = `<p class="empty">No customers found.</p>`;
        return;
      }

      if (!append || !content.querySelector("table")) {
        // Filter UI
        const filterHtml = `
          <div class="table-controls">
            <div class="row-count">${customers.length} items loaded</div>
            <select id="tier-filter" onchange="filterByTier()" class="filter-select">
              <option value="">All tiers</option>
              <option value="bronze">Bronze</option>
              <option value="silver">Silver</option>
              <option value="gold">Gold</option>
              <option value="platinum">Platinum</option>
            </select>
            <input type="text" class="table-search" id="customer-search" placeholder="Search customers…" onkeyup="filterTable('#customer-table', this.value)">
            <button onclick="exportTableToCSV('#customer-table', 'customers.csv')" class="btn-export">📥 Export CSV</button>
            <button onclick="loadDemoCustomers()" class="btn-refresh">🔄 Refresh</button>
          </div>
        `;

        const rows = customers
          .map((c) => {
            let tierColor = "var(--text-muted)";
            if (c.loyalty_tier === "platinum") tierColor = "var(--primary)";
            else if (c.loyalty_tier === "gold") tierColor = "#ca8a04";
            else if (c.loyalty_tier === "silver") tierColor = "#94a3b8";

            return `
          <tr data-tier="${c.loyalty_tier}">
            <td><strong><span class="copy-btn" onclick="copyToClipboard('${c.customer_id}', this)" title="Click to copy">${c.customer_id.substring(0, 8)}…</span></strong></td>
            <td>${c.first_name} ${c.last_name}</td>
            <td>${c.email}</td>
            <td>${fmtMoney(c.current_ltv)}</td>
            <td><span class="tier-badge" style="background: ${tierColor}">${c.loyalty_tier}</span></td>
          </tr>
        `;
          })
          .join("");

        const html = `
          ${filterHtml}
          <table id="customer-table">
            <thead>
              <tr>
                <th>Customer ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Lifetime Value</th>
                <th>Loyalty Tier</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="pagination-controls">
            <button onclick="loadDemoCustomers(true)" class="btn-load-more">📤 Load More</button>
          </div>
        `;
        content.innerHTML = html;
        enableSortableHeaders("#customer-table");
      }

      customerPage++;
    })
    .catch((err) => {
      content.innerHTML = `<div class="error-banner">Error loading customers: ${err.message}</div>`;
    });
}

// Filter customers by tier
function filterByTier() {
  const tier = document.getElementById("tier-filter").value;
  const table = document.querySelector("#customer-table");
  if (!table) return;

  table.querySelectorAll("tbody tr").forEach((row) => {
    const rowTier = row.getAttribute("data-tier");
    row.style.display = tier === "" || rowTier === tier ? "" : "none";
  });
}

// -----------------------------------------------
// Customer Modal
// -----------------------------------------------
function openCustomerModal() {
  document.getElementById("customer-modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeCustomerModal() {
  document.getElementById("customer-modal").classList.add("hidden");
  document.body.style.overflow = "auto";
}

// Close modal on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeCustomerModal();
  }
});

// -----------------------------------------------
// Customer Lookup History
// -----------------------------------------------
const HISTORY_KEY = "customer_lookup_history";
const MAX_HISTORY = 10;

function saveToHistory(searchType, searchValue, customer) {
  const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");

  const entry = {
    timestamp: new Date().toISOString(),
    searchType,
    searchValue,
    customer_id: customer.customer_id,
    name: `${customer.first_name} ${customer.last_name}`,
    email: customer.email,
  };

  // Remove duplicates (same customer ID)
  const filtered = history.filter((h) => h.customer_id !== customer.customer_id);
  filtered.unshift(entry);

  // Keep only last MAX_HISTORY entries
  const trimmed = filtered.slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));

  renderHistory();
}

function renderHistory() {
  const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  const content = document.getElementById("history-content");

  if (history.length === 0) {
    content.innerHTML = `<p class="empty">No recent lookups.</p>`;
    return;
  }

  const html = history
    .map(
      (entry, i) => `
    <div class="history-item" onclick="reSearchHistory('${entry.searchType}', '${entry.searchValue.replace(/'/g, "\\'")}')">
      <div class="history-name">${entry.name}</div>
      <div class="history-meta">${entry.email}</div>
      <div class="history-time">${new Date(entry.timestamp).toLocaleTimeString()}</div>
    </div>
  `
    )
    .join("");

  content.innerHTML = html;
}

function reSearchHistory(searchType, searchValue) {
  document.getElementById("customer-search-type").value = searchType;
  document.getElementById("customer-search-value").value = searchValue;
  loadCustomer(searchType, searchValue);
  document.getElementById("customer-search-value").focus();
}