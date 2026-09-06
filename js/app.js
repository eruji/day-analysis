/* app.js — DOM wiring for the day×hour analyzer.
 * Loads a CSV (file picker / drag & drop / bundled sample), builds the dataset via DA,
 * then renders interactive heatmap + KPIs + drill-down details.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);

  let ds = null;            // { receipts, meta }
  let minD = '', maxD = '';
  const state = { s: '', e: '', days: [true, true, true, true, true, true, true], bigOn: false, threshold: 200 };
  let symbol = '$';

  /* ---------------- existing operating hours (edit to match your schedule) ----------------
   * Key = day of week: 0=Mon … 6=Sun.  Omitted day = closed (no outline).
   * Each value is a half-open hour span [open, close): a sale's clock hour must be >= open
   * and < close, so "10 AM–5 PM" outlines the 10 AM…4 PM columns — a 5:00 PM sale
   * lands after close.  Multi-span days look like [[9,12],[14,17]].
   */
  const OPEN = {
    0: [10, 17], 1: [10, 17], 2: [10, 17], 3: [10, 17], 4: [10, 17],  // Mon–Fri
    5: [9, 17],                                                        // Sat
    6: [9, 14]                                                         // Sun
  };

  function spansOf(d) {
    const v = OPEN[d];
    if (!v) return [];
    return typeof v[0] === 'number' ? [v] : v;
  }
  function spanKey(sp) { return sp.map(s => s[0] + '-' + s[1]).join('|'); }

  // human legend, auto-derived from OPEN, e.g. "Mon–Fri 10 AM–5 PM · Sat 9 AM–5 PM"
  function openLegend() {
    const runs = [];
    let start = 0;
    for (let d = 1; d <= 7; d++) {
      if (d < 7 && spanKey(spansOf(start)) === spanKey(spansOf(d))) continue;
      runs.push([start, d - 1]);
      start = d;
    }
    return runs
      .filter(([a]) => spansOf(a).length)
      .map(([a, b]) => {
        const who = a === b ? DA.DAYS[a] : DA.DAYS[a] + '–' + DA.DAYS[b];
        const hrs = spansOf(a).map(s => DA.hourLabel(s[0]) + '–' + DA.hourLabel(s[1])).join(', ');
        return who + ' ' + hrs;
      })
      .join(' · ');
  }

  /* ---------------- formatters ---------------- */
  function money(x, dec) {
    const d = dec === 0 ? 0 : 2;
    const s = x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    return symbol + (x < 0 ? '-' + s.slice(1) : s);
  }
  function esc(x) {
    return String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function pct(p) { return (Math.round(p * 10) / 10) + '%'; }

  /* ---------------- dataset loading ---------------- */
  async function loadText(text, filename) {
    const csv = CSV.parse(text);
    const built = DA.buildDataset(csv);
    ds = built;
    symbol = ds.meta.symbol || '$';
    if (ds.meta.fatal) {
      setStatus(ds.meta.fatal, 'err');
      $('filters').classList.add('hidden');
      $('kpis').classList.add('hidden');
      $('hmTitle').classList.add('hidden');
      $('note').classList.add('hidden');
      $('leg').classList.add('hidden');
      $('tableWrap').innerHTML = '';
      return;
    }
    const receipts = ds.receipts;
    minD = receipts.length ? receipts[0].ds.slice(0, 10) : '';
    maxD = receipts.length ? receipts[receipts.length - 1].ds.slice(0, 10) : '';
    state.s = minD; state.e = maxD;
    state.days = [true, true, true, true, true, true, true];
    state.bigOn = false;
    $('big').checked = false;
    buildControls();
    $('filters').classList.remove('hidden');
    $('kpis').classList.remove('hidden');
    $('hmTitle').classList.remove('hidden');
    $('note').classList.remove('hidden');
    const leg = $('leg');
    leg.innerHTML = '<span class="ohk"></span>Outline = current hours: ' + openLegend();
    leg.classList.remove('hidden');
    closeDet();
    render();
    const m = ds.meta;
    const parts = [];
    if (filename) parts.push('<b>' + esc(filename) + '</b>');
    parts.push((receipts.length) + ' completed receipts');
    parts.push(DA.fmtRange(minD, maxD));
    const ex = Object.entries(m.statusRemoved);
    if (ex.length) parts.push('excluded ' + ex.map(([k, v]) => v + ' ' + k.toUpperCase()).join(', '));
    if (m.nonSaleLines) parts.push(m.nonSaleLines + ' line/payment rows skipped');
    if (m.aggregated) parts.push(m.aggregated + ' line items grouped by receipt');
    if (m.skippedUnparsed) parts.push(m.skippedUnparsed + ' rows unreadable');
    if (m.skippedNoAmount) parts.push(m.skippedNoAmount + ' rows without amount');
    setStatus(parts.join(' · '), 'ok');
    if (m.note) {
      const n = $('note');
      n.textContent = m.note + 'Totals net of returns. Hover/click cells for details.';
    }
  }

  function loadFile(file) {
    const rd = new FileReader();
    rd.onload = () => loadText(String(rd.result), file.name);
    rd.onerror = () => setStatus('Could not read that file.', 'err');
    rd.readAsText(file);
  }

  function setStatus(html, kind) {
    const s = $('status');
    s.className = kind || 'ok';
    s.innerHTML = html;
    s.classList.remove('hidden');
  }

  async function loadSample() {
    try {
      const res = await fetch('data/sample.csv');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await loadText(await res.text(), 'sample.csv');
    } catch (e) {
      setStatus('Could not load the bundled sample (opened as a local file? ' + e.message +
        '). Drag <b>data/sample.csv</b> onto the page instead.', 'err');
    }
  }

  /* ---------------- controls ---------------- */
  function buildControls() {
    const pr = $('presets'); pr.innerHTML = '';
    const months = [...new Set(ds.receipts.map(r => r.ds.slice(0, 7)))].sort();
    const presets = [['All dates', minD, maxD], ['Last 7 days', null, 7], ['Last 14 days', null, 14], ['Last 30 days', null, 30]];
    for (const ymd of months) {
      const y = +ymd.slice(0, 4), mo = +ymd.slice(5, 7) - 1;
      presets.push([DA.MN[mo] + ' ' + y, ymd + '-01', ymd + '-31']);
    }
    for (const [label, s0, e0] of presets) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => {
        let s, e;
        if (typeof e0 === 'number') {
          e = maxD;
          s = new Date(Date.parse(maxD) - (e0 - 1) * 86400000).toISOString().slice(0, 10);
        } else { s = s0; e = e0; }
        state.s = s < minD ? minD : s;
        state.e = e > maxD ? maxD : e;
        render();
      };
      pr.appendChild(b);
    }
    const sI = $('startD'), eI = $('endD');
    sI.min = minD; sI.max = maxD; eI.min = minD; eI.max = maxD;
    sI.onchange = () => { state.s = sI.value || minD; if (state.s > state.e) state.e = state.s; render(); };
    eI.onchange = () => { state.e = eI.value || maxD; if (state.s > state.e) state.s = state.e; render(); };
    const chipEl = $('chips'); chipEl.innerHTML = '';
    for (let d = 0; d < 7; d++) {
      const c = document.createElement('button');
      c.className = 'chip on'; c.textContent = DA.DAYS[d];
      c.onclick = () => { state.days[d] = !state.days[d]; c.classList.toggle('on'); render(); };
      chipEl.appendChild(c);
    }
  }

  /* ---------------- rendering ---------------- */
  function render() {
    if (!ds) return;
    const rows = DA.filterReceipts(ds.receipts, state);
    const m = DA.compute(rows);
    const sI = $('startD'), eI = $('endD');
    sI.value = state.s; eI.value = state.e;

    $('kRev').textContent = money(m.tot);
    $('kN').textContent = m.n;
    if (m.n) {
      $('kDay').textContent = DA.DAYS[m.bd];
      $('kDaySub').textContent = money(m.dTot[m.bd]) + ' · ' + pct(100 * m.dTot[m.bd] / m.tot) + ' of rev';
      $('kHour').textContent = DA.hourLabel(m.bh);
      $('kHourSub').textContent = money(m.hTot[m.bh]) + ' · ' + pct(100 * m.hTot[m.bh] / m.tot) + ' of rev';
    } else {
      $('kDay').textContent = '—'; $('kDaySub').textContent = 'best day';
      $('kHour').textContent = '—'; $('kHourSub').textContent = 'best hour';
    }
    const wk = m.dTot[5] + m.dTot[6], wd = m.tot - wk;
    $('kWk').textContent = m.tot ? money(wd) + ' · M–F  |  ' + money(wk) : '—';

    const note = $('note');
    note.innerHTML = 'Showing <b>' + esc(DA.fmtRange(state.s, state.e)) + '</b> · ' + m.n + ' receipts · ' +
      money(m.tot) + ' net' + (m.daysUsed ? ' · ' + m.daysUsed + ' days with sales' : '') +
      (state.bigOn ? ' · receipts ≥ ' + money(state.threshold, 0) + ' hidden' : '') +
      '<br>Darker green = more revenue. Click any number to list those transactions.';

    const wrap = $('tableWrap');
    if (!m.n) {
      wrap.innerHTML = '<div class="empty">No completed receipts in this selection — widen the date range or re-enable days.</div>';
      return;
    }
    let maxC = 0;
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) if (m.rev[d][h] > maxC) maxC = m.rev[d][h];
    let html = '<table><tr><th class="d">Day</th>';
    for (let h = 0; h < 24; h++) html += '<th class="h">' + DA.hourLabel(h) + '<br><span>' + money(m.hTot[h]) + '</span></th>';
    html += '</tr>';
    for (let d = 0; d < 7; d++) {
      if (!state.days[d]) continue;
      // which hour columns are inside the current operating hours for this day
      const inOpen = new Set();
      for (const sp of spansOf(d)) for (let h = sp[0]; h < sp[1]; h++) inOpen.add(h);
      const ohCls = h => {
        if (!inOpen.has(h)) return '';
        let c = ' oh';
        if (inOpen.has(h - 1)) c += ' noL';   // not the left edge of the band
        if (inOpen.has(h + 1)) c += ' noR';   // not the right edge of the band
        return c;
      };
      html += '<tr><th class="d">' + DA.DAYS[d] + '<br><span>' + money(m.dTot[d]) + ' · ' + m.dCnt[d] + 'x</span></th>';
      for (let h = 0; h < 24; h++) {
        const a = m.rev[d][h], c = m.cnt[d][h];
        const ocl = ohCls(h);
        const tt = DA.DAYS[d] + ' ' + DA.hourLabel(h) + ' — ' + money(a) + ' / ' + c + ' receipt' + (c === 1 ? '' : 's');
        if (!a && !c) { html += '<td class="z' + ocl + '" title="no sales"></td>'; continue; }
        if (a < 0) { html += '<td class="neg c' + ocl + '" title="' + tt + '" onclick="openCell(' + d + ',' + h + ')">' + money(a) + '</td>'; continue; }
        const ratio = Math.max(0, a / maxC);
        const r = Math.round(255 * (1 - ratio)), g = 255, b = Math.round(255 * (1 - ratio * 0.6));
        html += '<td class="v c' + ocl + '" style="background:rgb(' + r + ',' + g + ',' + b + ')" title="' + tt +
          '" onclick="openCell(' + d + ',' + h + ')">' + money(a) + '</td>';
      }
      html += '</tr>';
    }
    html += '</table>';
    wrap.innerHTML = html;
    closeDet();
  }

  function openCell(d, h) {
    const rows = DA.filterReceipts(ds.receipts, state).filter(r => r.dow === d && r.hour === h);
    const wrap = $('detWrap');
    if (!rows.length) { wrap.classList.add('hidden'); return; }
    const tot = rows.reduce((s, r) => s + r.amt, 0);
    let html = '<div class="detH"><b>' + DA.DAYS[d] + ' · ' + DA.hourLabel(h) + '</b>' +
      '<span>' + rows.length + ' receipt' + (rows.length === 1 ? '' : 's') + ' · ' + money(tot) + ' net</span>' +
      '<button onclick="closeDet()" title="close">✕</button></div>' +
      '<table><tr><th>Date &amp; time</th><th>Ref</th><th>User</th><th style="text-align:right">Total</th><th>Items</th></tr>';
    for (const r of rows) {
      html += '<tr class="' + (r.amt < 0 ? 'negrow' : '') + '"><td>' + DA.fmtDT(r.ds) + '</td>' +
        '<td>' + esc(r.receipt ? '#' + r.receipt : '—') + '</td>' +
        '<td class="u">' + esc(r.user || '—') + '</td>' +
        '<td class="amt">' + money(r.amt) + '</td>' +
        '<td class="it" title="' + esc(r.details) + '">' + esc(r.details || '—') + '</td></tr>';
    }
    html += '</table>';
    wrap.innerHTML = html;
    wrap.classList.remove('hidden');
    wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function closeDet() { $('detWrap').classList.add('hidden'); }
  window.openCell = openCell;
  window.closeDet = closeDet;

  /* ---------------- download filtered matrix ---------------- */
  function csvEsc(x) {
    const s = String(x);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function download() {
    if (!ds) return;
    const rows = DA.filterReceipts(ds.receipts, state);
    const m = DA.compute(rows);
    const hdr = ['Day'].concat(Array.from({ length: 24 }, (_, h) => DA.hourLabel(h))).concat(['Day Total', 'Day # Sales']);
    const L = [
      ['Report', 'Sales by Day and Hour of Day (filtered view)'],
      ['Source', 'loaded CSV'],
      ['Reporting period', state.s + ' to ' + state.e, '(' + DA.fmtRange(state.s, state.e) + ')'],
      ['Filters', 'days=' + DA.DAYS.filter((_, i) => state.days[i]).join('+'),
        state.bigOn ? 'hide receipts >= ' + state.threshold : '', 'receipts=' + m.n, 'net=' + money(m.tot)],
      []
    ];
    const mat = [];
    for (let d = 0; d < 7; d++) {
      if (!state.days[d]) continue;
      const row = [DA.DAYS[d]];
      for (let h = 0; h < 24; h++) row.push(m.rev[d][h].toFixed(2));
      row.push(m.dTot[d].toFixed(2), m.dCnt[d]);
      mat.push(row);
    }
    const txt = '\ufeff' + L.concat([hdr], mat).map(r => r.map(csvEsc).join(',')).join('\r\n') + '\r\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
    a.download = 'day_hour_' + state.s + '_to_' + state.e + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------------- wiring ---------------- */
  $('file').addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });
  $('sample').addEventListener('click', loadSample);
  $('dl').addEventListener('click', download);
  $('big').addEventListener('change', e => { state.bigOn = e.target.checked; render(); });
  $('thr').addEventListener('change', e => { state.threshold = Math.max(1, +e.target.value || 200); render(); });
  const drop = $('drop'), file = $('file');
  drop.addEventListener('click', () => file.click());
  ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', e => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  $('tableWrap').innerHTML =
    '<div class="prompt">Load a CSV (or click <b>Use sample data</b>) to see the day × hour revenue heatmap, ' +
    'peak hours, best days, and per-transaction drill-down.</div>';
})();
