/* Pulse · Commerce Intelligence — frontend
 * Zero dependencies. Each section fetches independently so one failure
 * never takes down the page. All dynamic values pass through esc(). */

"use strict";

/* ------------------------------------------------------------------ */
/* utilities                                                           */
/* ------------------------------------------------------------------ */

function esc(v) {
  return String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function fetchJSON(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Network error: ${err.message}`);
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    throw new Error(body && body.detail ? body.detail : `HTTP ${res.status}`);
  }
  return body;
}

const _money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
const _moneyCompact = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const _num = new Intl.NumberFormat();

const fmtMoney = (v) => _money.format(Number(v));
const fmtMoneyCompact = (v) => _moneyCompact.format(Number(v));
const fmtNum = (v) => _num.format(Number(v));
const fmtPct = (v) => `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`;

/* Date-only ISO strings: parse parts so timezones can't shift the day. */
function parseDay(iso) {
  const [y, m, d] = String(iso).split("T")[0].split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}
function fmtDate(iso) {
  const d = parseDay(iso);
  return d ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : esc(iso);
}
function fmtDateShort(iso) {
  const d = parseDay(iso);
  if (!d) return esc(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? esc(iso) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const ICONS = {
  up: '<svg viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 9v8H9"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><path d="m10.3 3.9-8.5 14.2A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2Z"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  revenue: '<svg viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  orders: '<svg viewBox="0 0 24 24"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0"/></svg>',
  aov: '<svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>',
};

function deltaBadge(v) {
  const positive = v >= 0;
  return `<span class="delta ${positive ? "positive" : "negative"}">${positive ? ICONS.up : ICONS.down}${esc(fmtPct(v))}</span>`;
}

function skeletonHTML(rows = 4) {
  const widths = ["wide", "mid", "wide", "narrow", "mid", "wide"];
  let html = "";
  for (let i = 0; i < rows; i++) html += `<div class="skeleton ${widths[i % widths.length]}"></div>`;
  return html;
}

function errorHTML(msg, retryId) {
  return `<div class="error-box">${ICONS.alert}<span>${esc(msg)}</span>` +
    (retryId ? `<button class="btn btn-ghost btn-sm" data-retry="${esc(retryId)}" type="button">Retry</button>` : "") + `</div>`;
}

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* animated count-up */
function countUp(el, target, formatter, duration = 900) {
  if (REDUCED || !isFinite(target)) { el.textContent = formatter(target); return; }
  const start = performance.now();
  function frame(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = formatter(target * eased);
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = formatter(target);
  }
  requestAnimationFrame(frame);
}

/* reveal-on-scroll */
const revealObserver = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); revealObserver.unobserve(e.target); }
}, { threshold: 0.08 });
function watchReveals(scope = document) {
  scope.querySelectorAll(".reveal:not(.in), .kpi:not(.in)").forEach((el) => revealObserver.observe(el));
}

/* ------------------------------------------------------------------ */
/* health + theme                                                      */
/* ------------------------------------------------------------------ */

async function loadHealth() {
  const pill = document.getElementById("health-pill");
  try {
    const h = await fetchJSON("/api/health");
    const demo = h.mode === "demo";
    pill.className = `pill ${demo ? "pill-demo" : "pill-live"}`;
    pill.innerHTML = `<span class="pill-dot"></span>${demo ? "demo data" : "live cluster"}`;
    if (demo && h.sample_customer_email) {
      const banner = document.getElementById("demo-banner");
      banner.hidden = false;
      document.getElementById("demo-lookup").addEventListener("click", () => {
        setSearchType("email");
        document.getElementById("cust-input").value = h.sample_customer_email;
        document.getElementById("customers").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth" });
        runCustomerSearch("email", h.sample_customer_email);
      });
    }
  } catch {
    pill.className = "pill pill-err";
    pill.innerHTML = `<span class="pill-dot"></span>offline`;
  }
}

function initTheme() {
  const root = document.documentElement;
  const saved = (() => { try { return localStorage.getItem("pulse-theme"); } catch { return null; } })();
  if (saved === "light" || saved === "dark") root.dataset.theme = saved;
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("pulse-theme", next); } catch { /* private mode */ }
  });
}

/* ------------------------------------------------------------------ */
/* KPIs                                                                */
/* ------------------------------------------------------------------ */

async function loadSales() {
  const grid = document.getElementById("kpi-grid");
  grid.innerHTML = `<div class="kpi">${skeletonHTML(3)}</div><div class="kpi">${skeletonHTML(3)}</div><div class="kpi">${skeletonHTML(3)}</div>`;
  try {
    const s = await fetchJSON("/sales/today");
    document.getElementById("as-of").textContent =
      `Sales snapshot for ${fmtDate(s.as_of_date)} — measured against the trailing 30-day average.`;

    const aov = s.today.order_count > 0 ? s.today.revenue / s.today.order_count : 0;
    const baseAov = s.baseline_30d_avg.order_count > 0 ? s.baseline_30d_avg.revenue / s.baseline_30d_avg.order_count : 0;
    const aovDelta = baseAov > 0 ? ((aov - baseAov) / baseAov) * 100 : 0;

    const kpis = [
      { icon: ICONS.revenue, label: "Revenue today", value: s.today.revenue, fmt: fmtMoney, delta: s.delta.revenue_pct, base: s.baseline_30d_avg.revenue, baseFmt: fmtMoneyCompact },
      { icon: ICONS.orders, label: "Orders today", value: s.today.order_count, fmt: (v) => fmtNum(Math.round(v)), delta: s.delta.order_count_pct, base: s.baseline_30d_avg.order_count, baseFmt: (v) => fmtNum(Math.round(v)) },
      { icon: ICONS.aov, label: "Average order value", value: aov, fmt: fmtMoney, delta: aovDelta, base: baseAov, baseFmt: fmtMoney },
    ];

    grid.innerHTML = kpis.map((k, i) => {
      const max = Math.max(k.value, k.base) || 1;
      const fill = Math.min((k.value / max) * 100, 100);
      const tick = Math.min((k.base / max) * 100, 99);
      return `<div class="kpi" style="transition-delay:${i * 70}ms">
        <p class="kpi-label">${k.icon}${esc(k.label)}</p>
        <p class="kpi-value" data-kpi="${i}">–</p>
        <div class="compare"><div class="compare-track">
          <div class="compare-fill" data-fill="${fill.toFixed(1)}"></div>
          <div class="compare-tick" style="left:${tick.toFixed(1)}%" title="30-day average"></div>
        </div></div>
        <div class="kpi-foot">${deltaBadge(k.delta)}<span>30-day avg ${esc(k.baseFmt(k.base))}</span></div>
      </div>`;
    }).join("");

    kpis.forEach((k, i) => countUp(grid.querySelector(`[data-kpi="${i}"]`), k.value, k.fmt));
    requestAnimationFrame(() => {
      grid.querySelectorAll(".kpi").forEach((el) => el.classList.add("in"));
      grid.querySelectorAll("[data-fill]").forEach((el) => { el.style.width = el.dataset.fill + "%"; });
    });
  } catch (err) {
    grid.innerHTML = errorHTML(`Couldn't load sales: ${err.message}`, "sales");
  }
}

/* ------------------------------------------------------------------ */
/* category + region breakdowns                                        */
/* ------------------------------------------------------------------ */

const CAT_COLORS = ["#5b8cff", "#8b5cf6", "#ff5c7a", "#2dd4a7", "#f5a524", "#64748b"];

function barRows(items, labelKey, colors) {
  const max = Math.max(...items.map((it) => Math.max(it.revenue, it.baseline_revenue)), 1);
  return items.map((it, i) => {
    const fill = (it.revenue / max) * 100;
    const tick = Math.min((it.baseline_revenue / max) * 100, 99);
    const delta = it.baseline_revenue > 0 ? ((it.revenue - it.baseline_revenue) / it.baseline_revenue) * 100 : 0;
    const color = colors ? colors[i % colors.length] : "var(--accent)";
    return `<div class="bar-row">
      <span class="bar-label">${colors ? `<span class="bar-swatch" style="background:${color}"></span>` : ""}${esc(it[labelKey])}</span>
      <div class="bar-track">
        <div class="bar-fill" data-fill="${fill.toFixed(1)}" style="background:${colors ? color : "var(--grad)"}"></div>
        <div class="bar-tick" style="left:${tick.toFixed(1)}%" title="30-day baseline"></div>
      </div>
      <span class="bar-val">${esc(fmtMoneyCompact(it.revenue))}<small class="${delta >= 0 ? "up" : "down"}">${esc(fmtPct(delta))}</small></span>
    </div>`;
  }).join("");
}

function animateFills(scope) {
  requestAnimationFrame(() => {
    scope.querySelectorAll("[data-fill]").forEach((el) => { el.style.width = el.dataset.fill + "%"; });
  });
}

async function loadCategories() {
  const donut = document.getElementById("cat-donut");
  const bars = document.getElementById("cat-bars");
  bars.innerHTML = skeletonHTML(6);
  donut.innerHTML = "";
  try {
    const cats = await fetchJSON("/sales/today/by-category");
    const total = cats.reduce((s, c) => s + c.revenue, 0);

    /* donut */
    const R = 15.9155, C = 100; // circumference = 100 for easy percentages
    let offset = 0;
    let circles = "";
    cats.forEach((c, i) => {
      const share = total > 0 ? (c.revenue / total) * 100 : 0;
      circles += `<circle cx="18" cy="18" r="${R}" stroke="${CAT_COLORS[i % CAT_COLORS.length]}"
        stroke-dasharray="0 ${C}" data-dash="${share.toFixed(2)} ${(C - share).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}"></circle>`;
      offset += share;
    });
    donut.innerHTML = `<svg viewBox="0 0 36 36">${circles}</svg>
      <div class="donut-center"><b>${esc(fmtMoneyCompact(total))}</b><span>today</span></div>`;
    requestAnimationFrame(() => {
      donut.querySelectorAll("circle").forEach((el) => el.setAttribute("stroke-dasharray", el.dataset.dash));
    });

    bars.innerHTML = barRows(cats, "category", CAT_COLORS);
    animateFills(bars);
  } catch (err) {
    bars.innerHTML = errorHTML(`Couldn't load categories: ${err.message}`, "categories");
  }
}

async function loadRegions() {
  const bars = document.getElementById("region-bars");
  bars.innerHTML = skeletonHTML(8);
  try {
    const regions = await fetchJSON("/sales/today/by-region");
    bars.innerHTML = barRows(regions, "region", null);
    animateFills(bars);
  } catch (err) {
    bars.innerHTML = errorHTML(`Couldn't load regions: ${err.message}`, "regions");
  }
}

/* ------------------------------------------------------------------ */
/* recent orders                                                       */
/* ------------------------------------------------------------------ */

function statusPill(status) {
  const s = String(status).toLowerCase();
  const cls = s === "shipped" ? "status-shipped" : s === "processing" ? "status-processing" : "status-pending";
  return `<span class="status ${cls}">${esc(s)}</span>`;
}

async function loadOrders() {
  const body = document.getElementById("orders-body");
  body.innerHTML = `<tr><td colspan="5">${skeletonHTML(6)}</td></tr>`;
  try {
    const orders = await fetchJSON("/customers/recent-orders?limit=25");
    document.getElementById("orders-count").innerHTML = `<strong>${orders.length}</strong>&nbsp;most recent`;
    if (!orders.length) { body.innerHTML = `<tr><td colspan="5"><p class="empty-note">No orders yet today.</p></td></tr>`; return; }
    body.innerHTML = orders.map((o) => `
      <tr class="row-click" data-customer="${esc(o.customer_id)}" tabindex="0" role="button"
          aria-label="Open customer ${esc(o.first_name)} ${esc(o.last_name)}">
        <td><span class="cell-main mono">#${esc(String(o.order_id).slice(0, 8))}</span></td>
        <td><span class="cell-main">${esc(o.first_name)} ${esc(o.last_name)}</span><span class="cell-sub mono">${esc(String(o.customer_id).slice(0, 8))}…</span></td>
        <td>${esc(fmtDateShort(o.order_date))}</td>
        <td>${statusPill(o.order_status)}</td>
        <td class="num">${esc(fmtMoney(o.total_amount))}</td>
      </tr>`).join("");

    body.querySelectorAll("[data-customer]").forEach((row) => {
      const open = () => {
        setSearchType("customer_id");
        document.getElementById("cust-input").value = row.dataset.customer;
        document.getElementById("customers").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth" });
        runCustomerSearch("customer_id", row.dataset.customer);
      };
      row.addEventListener("click", open);
      row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5">${errorHTML(`Couldn't load orders: ${err.message}`, "orders")}</td></tr>`;
  }
}

/* ------------------------------------------------------------------ */
/* inventory                                                           */
/* ------------------------------------------------------------------ */

let invSort = "urgency";

async function loadInventory() {
  const body = document.getElementById("inv-body");
  const summary = document.getElementById("inv-summary");
  body.innerHTML = `<tr><td colspan="5">${skeletonHTML(6)}</td></tr>`;
  try {
    const items = await fetchJSON(`/inventory?sort=${encodeURIComponent(invSort)}`);
    const low = items.filter((it) => it.below_reorder).length;
    summary.innerHTML =
      `<span class="chip"><strong>${items.length}</strong>&nbsp;SKUs tracked</span>` +
      (low > 0 ? `<span class="chip chip-danger">${ICONS.alert}<strong>${low}</strong>&nbsp;below reorder point</span>`
               : `<span class="chip"><strong>0</strong>&nbsp;below reorder point</span>`);

    body.innerHTML = items.map((it) => {
      const scale = Math.max(it.stock_quantity, it.reorder_level * 2, 1);
      const fill = Math.min((it.stock_quantity / scale) * 100, 100);
      const tick = Math.min((it.reorder_level / scale) * 100, 99);
      const fillCls = it.below_reorder ? "low" : it.stock_quantity < it.reorder_level * 1.5 ? "warn" : "";
      return `<tr${it.below_reorder ? ' class="row-below"' : ""}>
        <td><span class="cell-main">${esc(it.name)}</span><span class="cell-sub mono">${esc(it.sku)}</span></td>
        <td><span class="cell-sub" style="margin:0">${esc(it.category)}</span></td>
        <td><div class="stock-cell">
          <div class="stock-track">
            <div class="stock-fill ${fillCls}" data-fill="${fill.toFixed(1)}"></div>
            <div class="stock-tick" style="left:${tick.toFixed(1)}%" title="Reorder level: ${esc(fmtNum(it.reorder_level))}"></div>
          </div>
          <span class="stock-nums">${esc(fmtNum(it.stock_quantity))} <small>/ ${esc(fmtNum(it.reorder_level))}</small></span>
        </div></td>
        <td>${it.last_move_at ? esc(fmtDateTime(it.last_move_at)) : '<span class="cell-sub" style="margin:0">no movement</span>'}</td>
        <td>${it.below_reorder ? '<span class="status status-danger">reorder</span>' : '<span class="status status-ok">healthy</span>'}</td>
      </tr>`;
    }).join("");
    animateFills(body);
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5">${errorHTML(`Couldn't load inventory: ${err.message}`, "inventory")}</td></tr>`;
  }
}

function initInventorySort() {
  document.querySelectorAll('#inventory .seg-btn').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.sort === invSort) return;
      invSort = btn.dataset.sort;
      document.querySelectorAll('#inventory .seg-btn').forEach((b) => b.classList.toggle("is-active", b === btn));
      loadInventory();
    });
  });
}

/* ------------------------------------------------------------------ */
/* customers                                                           */
/* ------------------------------------------------------------------ */

let searchType = "email";

function setSearchType(type) {
  searchType = type;
  document.querySelectorAll("#cust-form .seg-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.type === type));
  const input = document.getElementById("cust-input");
  input.placeholder = type === "email" ? "sarah.davis291@example.com"
    : type === "name" ? "Sarah Davis" : "1b175efd-b770-4b0b-…";
}

const TIER_CLS = { platinum: "tier-platinum", gold: "tier-gold", silver: "tier-silver", bronze: "tier-bronze" };

async function runCustomerSearch(type, value) {
  const result = document.getElementById("cust-result");
  const detail = document.getElementById("cust-detail");
  result.innerHTML = skeletonHTML(4);
  detail.innerHTML = "";
  try {
    const params = new URLSearchParams(); params.set(type, value.trim());
    const c = await fetchJSON(`/customers?${params}`);
    const initials = (c.first_name[0] || "") + (c.last_name[0] || "");
    const tierCls = TIER_CLS[String(c.loyalty_tier).toLowerCase()] || "tier-bronze";
    result.innerHTML = `<div class="profile">
      <div class="avatar">${esc(initials.toUpperCase())}</div>
      <div class="profile-main">
        <p class="profile-name">${esc(c.first_name)} ${esc(c.last_name)}
          <span class="tier ${tierCls}">${esc(c.loyalty_tier)}</span>
          <span class="status ${c.account_status === "active" ? "status-ok" : "status-pending"}">${esc(c.account_status)}</span>
        </p>
        <p class="profile-meta">${esc(c.email)} · ${esc(c.phone)} · ${esc(c.shipping_city)}, ${esc(c.shipping_state)}</p>
      </div>
      <div class="profile-stats">
        <div class="pstat"><b>${esc(fmtMoney(c.current_ltv))}</b><span>lifetime value</span></div>
        <div class="pstat"><b>${esc(fmtNum(c.total_orders))}</b><span>orders</span></div>
      </div>
    </div>`;
    loadCustomerDetail(c.customer_id);
  } catch (err) {
    result.innerHTML = errorHTML(err.message);
  }
}

async function loadCustomerDetail(customerId) {
  const detail = document.getElementById("cust-detail");
  detail.innerHTML = `<article class="card"><header class="card-head"><h2>Orders</h2></header>${skeletonHTML(5)}</article>
    <article class="card"><header class="card-head"><h2>Reviews</h2></header>${skeletonHTML(4)}</article>`;

  const [ordersRes, reviewsRes] = await Promise.allSettled([
    fetchJSON(`/customers/${encodeURIComponent(customerId)}/orders`),
    fetchJSON(`/customers/${encodeURIComponent(customerId)}/reviews`),
  ]);

  let ordersHTML;
  if (ordersRes.status === "fulfilled") {
    const orders = ordersRes.value;
    ordersHTML = orders.length ? orders.map((o) => `
      <details class="order-item">
        <summary class="order-summary">
          <span class="mono">#${esc(String(o.order_id).slice(0, 8))}</span>
          <span>${esc(fmtDate(o.order_date))}</span>
          ${statusPill(o.order_status)}
          <span class="status ${o.payment_status === "captured" ? "status-ok" : "status-pending"}">${esc(o.payment_status)}</span>
          <strong style="font-variant-numeric:tabular-nums">${esc(fmtMoney(o.total_amount))}</strong>
          ${ICONS.chev}
        </summary>
        <div class="order-lines">
          ${o.items.map((it) => `<div class="order-line">
            <span class="order-line-name"><b>${esc(it.product_name)}</b> · ${esc(it.quantity)} × ${esc(fmtMoney(it.unit_price))} <span class="mono">${esc(it.product_sku)}</span></span>
            <span class="num">${esc(fmtMoney(it.line_total))}</span>
          </div>`).join("")}
          ${o.tracking_number ? `<div class="order-track">Tracking <span class="mono">${esc(o.tracking_number)}</span>${o.estimated_delivery_date ? ` · est. delivery ${esc(fmtDate(o.estimated_delivery_date))}` : ""}</div>` : ""}
        </div>
      </details>`).join("") : `<p class="empty-note">No orders on file.</p>`;
  } else {
    ordersHTML = errorHTML(`Couldn't load orders: ${ordersRes.reason.message}`);
  }

  let reviewsHTML;
  if (reviewsRes.status === "fulfilled") {
    const reviews = reviewsRes.value;
    reviewsHTML = reviews.length ? reviews.map((r) => {
      let stars = "";
      for (let i = 1; i <= 5; i++) {
        stars += ICONS.star.replace('<svg ', `<svg class="${i <= r.rating ? "on" : "off"}" `);
      }
      return `<div class="review">
        <div class="review-head"><span class="stars">${stars}</span><span class="review-meta">${esc(fmtDate(r.review_date))}</span></div>
        <div class="review-title">${esc(r.title)}</div>
        <div class="review-meta">${esc(r.product_name)}${r.verified_purchase ? ' · <span class="verified">verified purchase</span>' : ""}</div>
      </div>`;
    }).join("") : `<p class="empty-note">No reviews yet.</p>`;
  } else {
    reviewsHTML = errorHTML(`Couldn't load reviews: ${reviewsRes.reason.message}`);
  }

  detail.innerHTML = `
    <article class="card reveal in"><header class="card-head"><h2>Order history</h2><span class="card-note">${ordersRes.status === "fulfilled" ? `${ordersRes.value.length} orders` : ""}</span></header>${ordersHTML}</article>
    <article class="card reveal in"><header class="card-head"><h2>Reviews</h2><span class="card-note">${reviewsRes.status === "fulfilled" ? `${reviewsRes.value.length} reviews` : ""}</span></header>${reviewsHTML}</article>`;
}

async function loadTopCustomers() {
  const list = document.getElementById("top-customers");
  list.innerHTML = `<li style="display:block">${skeletonHTML(5)}</li>`;
  try {
    const customers = await fetchJSON("/customers/list?limit=100");
    const top = [...customers].sort((a, b) => b.current_ltv - a.current_ltv).slice(0, 8);
    list.innerHTML = top.map((c) => `
      <li data-customer="${esc(c.customer_id)}" tabindex="0" role="button" aria-label="Open ${esc(c.first_name)} ${esc(c.last_name)}">
        <span class="rank"></span>
        <span class="top-name"><b>${esc(c.first_name)} ${esc(c.last_name)}</b><span>${esc(c.loyalty_tier)}</span></span>
        <span class="top-ltv">${esc(fmtMoneyCompact(c.current_ltv))}</span>
      </li>`).join("");
    list.querySelectorAll("[data-customer]").forEach((li) => {
      const open = () => {
        setSearchType("customer_id");
        document.getElementById("cust-input").value = li.dataset.customer;
        runCustomerSearch("customer_id", li.dataset.customer);
      };
      li.addEventListener("click", open);
      li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
  } catch (err) {
    list.innerHTML = `<li style="display:block">${errorHTML(`Couldn't load customers: ${err.message}`, "top")}</li>`;
  }
}

function initCustomerForm() {
  document.querySelectorAll("#cust-form .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => setSearchType(btn.dataset.type));
  });
  document.getElementById("cust-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const value = document.getElementById("cust-input").value;
    if (value.trim()) runCustomerSearch(searchType, value);
  });
}

/* ------------------------------------------------------------------ */
/* orchestration                                                       */
/* ------------------------------------------------------------------ */

const LOADERS = {
  sales: loadSales, categories: loadCategories, regions: loadRegions,
  orders: loadOrders, inventory: loadInventory, top: loadTopCustomers,
};

function loadAll() {
  Object.values(LOADERS).forEach((fn) => fn());
}

document.addEventListener("click", (e) => {
  const retry = e.target.closest("[data-retry]");
  if (retry && LOADERS[retry.dataset.retry]) LOADERS[retry.dataset.retry]();
});

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initInventorySort();
  initCustomerForm();
  watchReveals();
  loadHealth();
  loadAll();

  const refreshBtn = document.getElementById("refresh");
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.classList.add("is-loading");
    loadAll();
    setTimeout(() => refreshBtn.classList.remove("is-loading"), 1200);
  });
});
