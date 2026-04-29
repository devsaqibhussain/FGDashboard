// ─────────────────────────────────────────────
//  FRAGRA DASHBOARD · APP
// ─────────────────────────────────────────────

(function () {
  const C = window.FRAGRA_CONFIG;
  const S = C.SETTINGS;

  // ── Helpers ──────────────────────────────────
  function colLetter(letter) {
    const upper = letter.toUpperCase();
    let n = 0;
    for (let i = 0; i < upper.length; i++) n = n * 26 + upper.charCodeAt(i) - 64;
    return n - 1;
  }

  function getCell(row, letter) {
    const i = colLetter(letter);
    return (row[i] || '').toString().trim();
  }

  function toNum(v) {
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  }

  function daysStatus(days, available) {
    if (available <= 0) return { label: 'Out / N/A', cls: 'badge-gray' };
    if (days === null) return { label: 'No forecast', cls: 'badge-gray' };
    if (days <= S.criticalDays) return { label: 'Critical', cls: 'badge-red' };
    if (days <= S.lowDays) return { label: 'Low', cls: 'badge-amber' };
    return { label: 'Healthy', cls: 'badge-green' };
  }

  function fmtDate(d) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ── Google Sheets fetch ───────────────────────
  async function fetchRange(tab, range) {
    const encodedTab = encodeURIComponent(tab);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${C.SHEET_ID}/values/${encodedTab}!${range}?key=${C.API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Sheets API error ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json.values || [];
  }

  // ── Parse Main_Dashboard ─────────────────────
  function parseMain(rows) {
    const mc = C.MAIN_COLS;
    const products = [];
    for (let i = S.dataStartRow - 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r.length) continue;
      const name = getCell(r, mc.productName);
      const status = getCell(r, mc.status);
      if (!name || status.toLowerCase() !== 'active') continue;

      const sku = getCell(r, mc.shopifyLink);
      const type = getCell(r, mc.type);
      const available = toNum(getCell(r, mc.available));
      const committed = toNum(getCell(r, mc.committed));
      const totalPipeline = toNum(getCell(r, mc.totalPipeline));
      const family = name.includes(' - ') ? name.split(' - ')[0].trim() : name;

      products.push({ name, sku, type, family, available, committed, totalPipeline });
    }
    return products;
  }

  // ── Parse Depletion Model ────────────────────
  // Weekly values = stock remaining at END of that week.
  // e.g. current stock = 709, week1 end = 665 → sold 44 that week → 6.3/day
  // Stockout = first week where stock hits 0 or goes negative.
  // Days until stockout = calendar days from today to that week's date header.
  function parseDepletion(rows, currentProducts) {
    if (!rows.length) return { headers: [], items: [] };

    const headerRow = rows[0];
    const weekStart = colLetter(C.DEPL_COLS.weekStart);
    const dateHeaders = headerRow.slice(weekStart).map(h => h.trim()).filter(Boolean);

    // Build stock lookup from Main_Dashboard for rate calculation
    const stockLookup = {};
    currentProducts.forEach(p => { stockLookup[p.name] = p.available; });

    const items = [];
    for (let i = S.deplDataStartRow - 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r.length) continue;
      const name = getCell(r, C.DEPL_COLS.productName);
      const sku = getCell(r, C.DEPL_COLS.sku);
      if (!name) continue;

      // week-end inventory values
      const weekly = r.slice(weekStart).map(v => toNum(v));

      const avail = stockLookup[name] ?? null;

      // Daily rate: prefer current stock → week1 end (most accurate for current week)
      // Fall back to week-over-week diffs
      let deplRate = null;
      if (avail !== null && weekly.length > 0) {
        const thisWeekSales = avail - weekly[0];
        if (thisWeekSales > 0) {
          deplRate = thisWeekSales / 7;
        }
      }
      if (deplRate === null) {
        for (let w = 0; w < weekly.length - 1; w++) {
          const diff = weekly[w] - weekly[w + 1];
          if (weekly[w] > 0 && diff > 0) {
            deplRate = diff / 7;
            break;
          }
        }
      }

      // Stockout: first week where week-end stock <= 0
      let stockoutWeekIdx = null;
      let stockoutDateStr = null;
      let daysUntilStockout = null;

      for (let w = 0; w < weekly.length; w++) {
        if (weekly[w] <= 0) {
          stockoutWeekIdx = w;
          stockoutDateStr = dateHeaders[w] || null;
          break;
        }
      }

      // Calculate calendar days from today to stockout date
      if (stockoutDateStr) {
        const stockoutD = new Date(stockoutDateStr);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        daysUntilStockout = Math.max(0, Math.round((stockoutD - today) / (1000 * 60 * 60 * 24)));
      }

      const family = name.includes(' - ') ? name.split(' - ')[0].trim() : name;

      items.push({
        name, sku, family, weekly, dateHeaders,
        deplRate,
        stockoutWeekIdx,
        stockoutDateStr,
        daysUntilStockout,
      });
    }
    return { headers: dateHeaders, items };
  }

  // ── Enrich products with depletion data ───────
  function enrichWithDays(products, deplItems) {
    const deplMap = {};
    deplItems.forEach(d => { deplMap[d.name] = d; });

    return products.map(p => {
      // 0-stock SKUs: always Out/NA
      if (p.available <= 0) {
        return {
          ...p,
          days: null,
          deplRate: deplMap[p.name]?.deplRate ?? null,
          stockoutDateStr: 'Out of stock',
          status: daysStatus(null, 0),
        };
      }

      const depl = deplMap[p.name];
      if (!depl) {
        return {
          ...p,
          days: null,
          deplRate: null,
          stockoutDateStr: null,
          status: daysStatus(null, p.available),
        };
      }

      return {
        ...p,
        days: depl.daysUntilStockout,
        deplRate: depl.deplRate,
        stockoutDateStr: depl.stockoutDateStr,
        stockoutWeekIdx: depl.stockoutWeekIdx,
        status: daysStatus(depl.daysUntilStockout, p.available),
      };
    });
  }

  // ── State ─────────────────────────────────────
  let state = {
    products: [],
    deplData: { headers: [], items: [] },
    activeView: 'overview',
    skuFilter: 'All',
    deplFilter: 'All',
    searchQuery: '',
  };

  // ── Render: Metrics ───────────────────────────
  function renderMetrics() {
    const p = state.products;
    const withForecast = p.filter(x => x.available > 0 && x.days !== null);
    const critical = withForecast.filter(x => x.days <= S.criticalDays).length;
    const low = withForecast.filter(x => x.days > S.criticalDays && x.days <= S.lowDays).length;
    const healthy = withForecast.filter(x => x.days > S.lowDays).length;
    const outOfStock = p.filter(x => x.available <= 0).length;
    const totalStock = p.reduce((s, x) => s + x.available, 0);

    document.getElementById('metricsGrid').innerHTML = `
      <div class="metric-card">
        <div class="metric-label">Total on hand</div>
        <div class="metric-value">${totalStock.toLocaleString()}</div>
        <div class="metric-sub">${p.length} active SKUs</div>
      </div>
      <div class="metric-card ok">
        <div class="metric-label">Healthy</div>
        <div class="metric-value">${healthy}</div>
        <div class="metric-sub">> ${S.lowDays} days stock</div>
      </div>
      <div class="metric-card warn">
        <div class="metric-label">Running low</div>
        <div class="metric-value">${low}</div>
        <div class="metric-sub">${S.criticalDays}–${S.lowDays} days stock</div>
      </div>
      <div class="metric-card crit">
        <div class="metric-label">Critical / Out</div>
        <div class="metric-value">${critical + outOfStock}</div>
        <div class="metric-sub">≤ ${S.criticalDays} days or out of stock</div>
      </div>
    `;
  }

  // ── Render: Urgency chart ─────────────────────
  function renderUrgencyChart() {
    const withDays = state.products
      .filter(x => x.available > 0 && x.days !== null)
      .sort((a, b) => a.days - b.days);

    const beyondForecast = state.products
      .filter(x => x.available > 0 && x.days === null && x.deplRate !== null);

    const items = [...withDays, ...beyondForecast].slice(0, S.maxTimelineItems);
    const maxDays = Math.max(...withDays.map(x => x.days), 1);

    document.getElementById('urgencyChart').innerHTML = items.map(x => {
      const hasDays = x.days !== null;
      const pct = hasDays ? Math.min(100, Math.round((x.days / maxDays) * 100)) : 100;
      const colorClass = !hasDays ? 'bar-green'
        : x.days <= S.criticalDays ? 'bar-red'
        : x.days <= S.lowDays ? 'bar-amber'
        : 'bar-green';
      const label = hasDays ? (x.stockoutDateStr || `${x.days}d`) : 'Beyond forecast window';
      return `
        <div class="urgency-row">
          <div class="urgency-label" title="${x.name}">${x.name}</div>
          <div class="urgency-track">
            <div class="urgency-fill ${colorClass}" style="width:${Math.max(pct, 4)}%">
              <span class="urgency-date">${label}</span>
            </div>
          </div>
          <div class="urgency-days">${hasDays ? x.days + 'd' : '✓'}</div>
        </div>`;
    }).join('');
  }

  // ── Render: Family list ───────────────────────
  function renderFamilyList() {
    const families = {};
    state.products.forEach(p => {
      if (!families[p.family]) families[p.family] = { total: 0, critical: 0, out: 0 };
      families[p.family].total += p.available;
      if (p.available <= 0) families[p.family].out++;
      else if (p.days !== null && p.days <= S.criticalDays) families[p.family].critical++;
    });

    document.getElementById('familyList').innerHTML = Object.entries(families).map(([name, f]) => `
      <div class="family-row">
        <div class="family-name">${name}</div>
        <div class="family-right">
          <div class="family-stock">${f.total.toLocaleString()} units</div>
          ${f.critical > 0
            ? `<span class="badge badge-red">${f.critical} critical</span>`
            : f.out > 0
            ? `<span class="badge badge-gray">${f.out} out</span>`
            : '<span class="badge badge-green">OK</span>'}
        </div>
      </div>
    `).join('');
  }

  // ── Render: Alerts ────────────────────────────
  function renderAlerts() {
    const outOfStock = state.products.filter(x => x.available <= 0);
    const lowStock = state.products
      .filter(x => x.available > 0 && x.days !== null && x.days <= S.lowDays)
      .sort((a, b) => a.days - b.days);

    const alerts = [...lowStock, ...outOfStock];

    if (!alerts.length) {
      document.getElementById('alertsList').innerHTML = `<div class="no-alerts">All SKUs are well stocked</div>`;
      return;
    }

    document.getElementById('alertsList').innerHTML = alerts.map(x => {
      const isOut = x.available <= 0;
      const dotCls = isOut ? 'dot-gray' : x.days <= S.criticalDays ? 'dot-red' : 'dot-amber';
      const daysLabel = isOut ? 'Out' : `${x.days}d`;
      const daysColor = isOut ? '' : x.days <= S.criticalDays ? 'text-red' : 'text-amber';
      const sub = isOut
        ? 'No stock on hand'
        : `Stockout ${x.stockoutDateStr || '—'} · ${x.available.toLocaleString()} units left`;
      return `
        <div class="alert-row">
          <div class="alert-dot ${dotCls}"></div>
          <div class="alert-info">
            <div class="alert-name">${x.name}</div>
            <div class="alert-sub">${sub}</div>
          </div>
          <div class="alert-days ${daysColor}">${daysLabel}</div>
        </div>`;
    }).join('');
  }

  // ── Render: Depletion timeline ────────────────
  function renderDepletionTimeline() {
    const families = ['All', ...new Set(state.deplData.items.map(d => d.family))];
    document.getElementById('deplFilters').innerHTML = families.map(f =>
      `<button class="pill ${f === state.deplFilter ? 'pill-active' : ''}" onclick="window.dashboard.setDeplFilter('${f}')">${f}</button>`
    ).join('');

    const totalWeeks = state.deplData.headers.length;
    const items = state.deplData.items
      .filter(d => state.deplFilter === 'All' || d.family === state.deplFilter)
      .sort((a, b) => (a.stockoutWeekIdx ?? 999) - (b.stockoutWeekIdx ?? 999));

    document.getElementById('depletionTimeline').innerHTML = `
      <div class="timeline-grid">
        ${items.map(item => {
          const runoutAt = item.stockoutWeekIdx !== null ? item.stockoutWeekIdx + 1 : totalWeeks;
          const pct = Math.min(100, Math.round((runoutAt / totalWeeks) * 100));
          const cls = item.stockoutWeekIdx !== null && item.stockoutWeekIdx <= 2 ? 'bar-red'
            : item.stockoutWeekIdx !== null && item.stockoutWeekIdx <= 4 ? 'bar-amber'
            : 'bar-green';
          const label = item.stockoutDateStr || 'Beyond forecast';
          return `
            <div class="urgency-row">
              <div class="urgency-label" title="${item.name}">${item.name}</div>
              <div class="urgency-track">
                <div class="urgency-fill ${cls}" style="width:${Math.max(pct, 3)}%">
                  <span class="urgency-date">${label}</span>
                </div>
              </div>
              <div class="urgency-days">${item.stockoutWeekIdx !== null ? 'Wk ' + (item.stockoutWeekIdx + 1) : '✓'}</div>
            </div>`;
        }).join('')}
      </div>`;
  }

  // ── Render: Depletion table ───────────────────
  function renderDepletionTable() {
    const headers = state.deplData.headers;
    const items = state.deplData.items
      .filter(d => state.deplFilter === 'All' || d.family === state.deplFilter);

    const visibleHeaders = headers.slice(0, 8);

    document.getElementById('deplTableHead').innerHTML =
      `<th>Product</th><th>SKU</th>` +
      visibleHeaders.map(h => `<th class="num">${h}</th>`).join('');

    document.getElementById('deplTableBody').innerHTML = items.map(item => {
      const cells = visibleHeaders.map((_, wi) => {
        const val = item.weekly[wi] ?? null;
        if (val === null) return `<td class="num">—</td>`;
        const cls = val <= 0 ? 'cell-red' : val <= 20 ? 'cell-amber' : '';
        return `<td class="num ${cls}">${val <= 0 ? '0' : val.toLocaleString()}</td>`;
      }).join('');
      return `<tr><td class="td-name">${item.name}</td><td class="td-sku">${item.sku}</td>${cells}</tr>`;
    }).join('');
  }

  // ── Render: SKU table ─────────────────────────
  function renderSkuTable() {
    const families = ['All', ...new Set(state.products.map(p => p.family))];
    document.getElementById('skuFilters').innerHTML = families.map(f =>
      `<button class="pill ${f === state.skuFilter ? 'pill-active' : ''}" onclick="window.dashboard.setSkuFilter('${f}')">${f}</button>`
    ).join('');

    const q = state.searchQuery.toLowerCase();
    const rows = state.products
      .filter(p => state.skuFilter === 'All' || p.family === state.skuFilter)
      .filter(p => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.available <= 0 && b.available > 0) return 1;
        if (b.available <= 0 && a.available > 0) return -1;
        if (a.days !== null && b.days !== null) return a.days - b.days;
        if (a.days === null && b.days !== null) return 1;
        if (b.days === null && a.days !== null) return -1;
        return 0;
      });

    document.getElementById('skuBody').innerHTML = rows.map(p => {
      const isOut = p.available <= 0;
      const daysCell = isOut ? '—' : p.days !== null ? `${p.days}d` : '—';
      const stockoutCell = isOut ? 'Out of stock' : p.stockoutDateStr || 'Beyond forecast';
      return `
        <tr>
          <td class="td-name">${p.name}</td>
          <td class="td-sku">${p.sku}</td>
          <td class="num">${p.available.toLocaleString()}</td>
          <td class="num ${p.committed < 0 ? 'text-amber' : ''}">${p.committed}</td>
          <td class="num">${Math.max(0, p.available + p.committed).toLocaleString()}</td>
          <td class="num">${p.deplRate ? p.deplRate.toFixed(1) : '—'}</td>
          <td class="num fw-500">${daysCell}</td>
          <td class="num">${stockoutCell}</td>
          <td><span class="badge ${p.status.cls}">${p.status.label}</span></td>
        </tr>`;
    }).join('');
  }

  // ── View switching ────────────────────────────
  function switchView(name) {
    state.activeView = name;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('view-' + name).classList.add('active');
    document.querySelector(`[data-view="${name}"]`).classList.add('active');
    if (name === 'depletion') { renderDepletionTimeline(); renderDepletionTable(); }
    if (name === 'skus') renderSkuTable();
  }

  // ── Load data ─────────────────────────────────
  async function loadData() {
    setLoader(true, 'Connecting to inventory...');
    try {
      setLoader(true, 'Fetching main dashboard...');
      const mainRows = await fetchRange(C.TABS.main, 'A:N');

      setLoader(true, 'Fetching depletion model...');
      const deplRows = await fetchRange(C.TABS.depletion, 'A:V');

      const rawProducts = parseMain(mainRows);
      const deplData = parseDepletion(deplRows, rawProducts);
      const products = enrichWithDays(rawProducts, deplData.items);

      state.products = products;
      state.deplData = deplData;

      renderMetrics();
      renderUrgencyChart();
      renderFamilyList();
      renderAlerts();

      document.getElementById('syncTime').textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      document.getElementById('headerDate').textContent = fmtDate(new Date());

      setLoader(false);
    } catch (err) {
      console.error(err);
      document.getElementById('loader').style.display = 'none';
      document.getElementById('errorState').style.display = 'flex';
      document.getElementById('errorMsg').textContent = err.message;
    }
  }

  function setLoader(show, msg) {
    const loader = document.getElementById('loader');
    const app = document.getElementById('app');
    if (show) {
      loader.style.display = 'flex';
      app.style.display = 'none';
      if (msg) document.getElementById('loaderMsg').textContent = msg;
    } else {
      loader.style.display = 'none';
      app.style.display = 'flex';
    }
  }

  // ── Public API ────────────────────────────────
  window.dashboard = {
    refresh: loadData,
    setSkuFilter(f) { state.skuFilter = f; renderSkuTable(); },
    setDeplFilter(f) { state.deplFilter = f; renderDepletionTimeline(); renderDepletionTable(); },
    filterSkus() { state.searchQuery = document.getElementById('skuSearch').value; renderSkuTable(); },
  };

  // ── Nav clicks ────────────────────────────────
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); switchView(el.dataset.view); });
  });

  // ── Boot ──────────────────────────────────────
  loadData();

})();
