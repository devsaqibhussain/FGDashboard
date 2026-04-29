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
    return n - 1; // 0-based index
  }

  function colIdx(key, colMap) {
    return colLetter(colMap[key]);
  }

  function getCell(row, letter) {
    const i = colLetter(letter);
    return (row[i] || '').toString().trim();
  }

  function toNum(v) {
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  }

  function daysStatus(days) {
    if (days === null) return { label: 'Out / N/A', cls: 'badge-gray' };
    if (days <= S.criticalDays) return { label: 'Critical', cls: 'badge-red' };
    if (days <= S.lowDays) return { label: 'Low', cls: 'badge-amber' };
    return { label: 'Healthy', cls: 'badge-green' };
  }

  function stockoutDate(days) {
    if (days === null || days < 0) return '—';
    const d = new Date();
    d.setDate(d.getDate() + Math.round(days));
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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

      // Derive product family from name (everything before the dash)
      const family = name.includes(' - ') ? name.split(' - ')[0].trim() : name;

      products.push({ name, sku, type, family, available, committed, totalPipeline, status });
    }
    return products;
  }

  // ── Parse Depletion Model ────────────────────
  function parseDepletion(rows) {
    if (!rows.length) return { headers: [], items: [] };

    // Row 1 = headers (product, status, sku, date1, date2, ...)
    const headerRow = rows[0];
    const weekStart = colLetter(C.DEPL_COLS.weekStart);
    const dateHeaders = headerRow.slice(weekStart).map(h => h.trim()).filter(Boolean);

    const items = [];
    for (let i = S.deplDataStartRow - 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r.length) continue;
      const name = getCell(r, C.DEPL_COLS.productName);
      const sku = getCell(r, C.DEPL_COLS.sku);
      if (!name) continue;

      const weekly = r.slice(weekStart).map(v => toNum(v));

      // Calculate daily depletion rate from first two non-null week values
      let deplRate = null;
      for (let w = 0; w < weekly.length - 1; w++) {
        const diff = weekly[w] - weekly[w + 1];
        if (weekly[w] > 0 && diff > 0) {
          deplRate = diff / 7;
          break;
        }
      }

      // Find stockout week (first week where value hits 0 or goes negative)
      let stockoutWeekIdx = null;
      for (let w = 0; w < weekly.length; w++) {
        if (weekly[w] <= 0) { stockoutWeekIdx = w; break; }
      }

      const family = name.includes(' - ') ? name.split(' - ')[0].trim() : name;

      items.push({ name, sku, family, weekly, deplRate, stockoutWeekIdx, dateHeaders });
    }
    return { headers: dateHeaders, items };
  }

  // ── Compute days remaining from depletion data ─
  function enrichWithDays(products, deplItems) {
    const deplMap = {};
    deplItems.forEach(d => { deplMap[d.name] = d; });

    return products.map(p => {
      const depl = deplMap[p.name];
      let days = null;
      let deplRate = null;

      if (depl && depl.deplRate !== null) {
        deplRate = depl.deplRate;
        const netStock = Math.max(0, p.available + p.committed);
        days = deplRate > 0 ? Math.round(netStock / deplRate) : null;
      }

      return { ...p, days, deplRate, status: daysStatus(days) };
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
    const active = p.filter(x => x.days !== null);
    const critical = active.filter(x => x.days <= S.criticalDays).length;
    const low = active.filter(x => x.days > S.criticalDays && x.days <= S.lowDays).length;
    const healthy = active.filter(x => x.days > S.lowDays).length;
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
        <div class="metric-label">Critical</div>
        <div class="metric-value">${critical}</div>
        <div class="metric-sub">≤ ${S.criticalDays} days stock</div>
      </div>
    `;
  }

  // ── Render: Urgency chart ─────────────────────
  function renderUrgencyChart() {
    const items = state.products
      .filter(x => x.days !== null && x.deplRate > 0)
      .sort((a, b) => a.days - b.days)
      .slice(0, S.maxTimelineItems);

    const maxDays = Math.max(...items.map(x => x.days), 1);

    document.getElementById('urgencyChart').innerHTML = items.map(x => {
      const pct = Math.min(100, Math.round((x.days / maxDays) * 100));
      const colorClass = x.days <= S.criticalDays ? 'bar-red' : x.days <= S.lowDays ? 'bar-amber' : 'bar-green';
      return `
        <div class="urgency-row">
          <div class="urgency-label" title="${x.name}">${x.name}</div>
          <div class="urgency-track">
            <div class="urgency-fill ${colorClass}" style="width:${Math.max(pct, 3)}%">
              <span class="urgency-date">${stockoutDate(x.days)}</span>
            </div>
          </div>
          <div class="urgency-days">${x.days}d</div>
        </div>`;
    }).join('');
  }

  // ── Render: Family list ───────────────────────
  function renderFamilyList() {
    const families = {};
    state.products.forEach(p => {
      if (!families[p.family]) families[p.family] = { total: 0, critical: 0 };
      families[p.family].total += p.available;
      if (p.days !== null && p.days <= S.criticalDays) families[p.family].critical++;
    });

    document.getElementById('familyList').innerHTML = Object.entries(families).map(([name, f]) => `
      <div class="family-row">
        <div class="family-name">${name}</div>
        <div class="family-right">
          <div class="family-stock">${f.total.toLocaleString()} units</div>
          ${f.critical > 0 ? `<span class="badge badge-red">${f.critical} critical</span>` : '<span class="badge badge-green">OK</span>'}
        </div>
      </div>
    `).join('');
  }

  // ── Render: Alerts ────────────────────────────
  function renderAlerts() {
    const alerts = state.products
      .filter(x => x.days !== null && x.days <= S.lowDays)
      .sort((a, b) => a.days - b.days);

    if (!alerts.length) {
      document.getElementById('alertsList').innerHTML = `<div class="no-alerts">All SKUs are well stocked</div>`;
      return;
    }

    document.getElementById('alertsList').innerHTML = alerts.map(x => `
      <div class="alert-row">
        <div class="alert-dot ${x.days <= S.criticalDays ? 'dot-red' : 'dot-amber'}"></div>
        <div class="alert-info">
          <div class="alert-name">${x.name}</div>
          <div class="alert-sub">Stockout ${stockoutDate(x.days)} · ${x.available.toLocaleString()} units left</div>
        </div>
        <div class="alert-days ${x.days <= S.criticalDays ? 'text-red' : 'text-amber'}">${x.days}d</div>
      </div>
    `).join('');
  }

  // ── Render: Depletion timeline ────────────────
  function renderDepletionTimeline() {
    const families = ['All', ...new Set(state.deplData.items.map(d => d.family))];
    document.getElementById('deplFilters').innerHTML = families.map(f =>
      `<button class="pill ${f === state.deplFilter ? 'pill-active' : ''}" onclick="window.dashboard.setDeplFilter('${f}')">${f}</button>`
    ).join('');

    const items = state.deplData.items
      .filter(d => state.deplFilter === 'All' || d.family === state.deplFilter)
      .filter(d => d.deplRate !== null && d.deplRate > 0)
      .sort((a, b) => (a.stockoutWeekIdx ?? 999) - (b.stockoutWeekIdx ?? 999))
      .slice(0, S.maxTimelineItems);

    const totalWeeks = state.deplData.headers.length;

    document.getElementById('depletionTimeline').innerHTML = `
      <div class="timeline-grid">
        ${items.map(item => {
          const runoutAt = item.stockoutWeekIdx !== null ? item.stockoutWeekIdx : totalWeeks;
          const pct = Math.min(100, Math.round((runoutAt / totalWeeks) * 100));
          const cls = runoutAt <= 2 ? 'bar-red' : runoutAt <= 4 ? 'bar-amber' : 'bar-green';
          return `
            <div class="urgency-row">
              <div class="urgency-label" title="${item.name}">${item.name}</div>
              <div class="urgency-track">
                <div class="urgency-fill ${cls}" style="width:${Math.max(pct, 3)}%">
                  <span class="urgency-date">${item.stockoutWeekIdx !== null ? item.dateHeaders[item.stockoutWeekIdx] || '—' : 'Beyond forecast'}</span>
                </div>
              </div>
              <div class="urgency-days">${item.stockoutWeekIdx !== null ? 'Wk ' + (item.stockoutWeekIdx + 1) : '✓'}</div>
            </div>`;
        }).join('')}
      </div>
    `;
  }

  // ── Render: Depletion table ───────────────────
  function renderDepletionTable() {
    const headers = state.deplData.headers;
    const items = state.deplData.items
      .filter(d => state.deplFilter === 'All' || d.family === state.deplFilter);

    // Show max 8 week columns to keep it readable
    const visibleHeaders = headers.slice(0, 8);

    document.getElementById('deplTableHead').innerHTML =
      `<th>Product</th><th>SKU</th>` +
      visibleHeaders.map(h => `<th class="num">${h}</th>`).join('');

    document.getElementById('deplTableBody').innerHTML = items.map(item => {
      const cells = visibleHeaders.map((_, wi) => {
        const val = item.weekly[wi];
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
        if (a.days === null && b.days === null) return 0;
        if (a.days === null) return 1;
        if (b.days === null) return -1;
        return a.days - b.days;
      });

    document.getElementById('skuBody').innerHTML = rows.map(p => `
      <tr>
        <td class="td-name">${p.name}</td>
        <td class="td-sku">${p.sku}</td>
        <td class="num">${p.available.toLocaleString()}</td>
        <td class="num ${p.committed < 0 ? 'text-amber' : ''}">${p.committed}</td>
        <td class="num">${Math.max(0, p.available + p.committed).toLocaleString()}</td>
        <td class="num">${p.deplRate ? p.deplRate.toFixed(1) : '—'}</td>
        <td class="num fw-500">${p.days !== null ? p.days + 'd' : '—'}</td>
        <td class="num">${stockoutDate(p.days)}</td>
        <td><span class="badge ${p.status.cls}">${p.status.label}</span></td>
      </tr>
    `).join('');
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
      const deplData = parseDepletion(deplRows);
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
