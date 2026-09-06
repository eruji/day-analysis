/* core.js — schema detection, receipt-level aggregation, date/amount parsing,
 * day×hour filtering & aggregation, and display formatters.
 * Pure logic (no DOM) so it runs identically in the browser and in node tests.
 * Exposes: window.DA
 */
(function (global) {
  'use strict';

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------------- parsing helpers ---------------- */

  function parseDT(s) {
    s = String(s).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})[, ](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (m) {
      let hr = +m[4];
      if (/pm/i.test(m[7]) && hr < 12) hr += 12;
      if (/am/i.test(m[7]) && hr === 12) hr = 0;
      let y = +m[3]; if (y < 100) y += 2000;
      return new Date(y, +m[1] - 1, +m[2], hr, +m[5], +(m[6] || 0));
    }
    const t = Date.parse(s);
    return isNaN(t) ? null : new Date(t);
  }

  function parseAmount(raw) {
    if (raw === undefined || raw === null) return null;
    let s = String(raw).trim();
    if (!s) return null;
    let neg = false;
    if (s.startsWith('(') && s.endsWith(')')) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[$£€ ]/g, '');
    if (s.includes('.')) s = s.replace(/,/g, '');            // 1,234.56 -> 1234.56
    else if (/^\d+(?:,\d{3})+$/.test(s)) s = s.replace(/,/g, '');  // 1,234,567 -> 1234567
    else s = s.replace(',', '.');                            // 12,50 (EU) -> 12.50
    const n = parseFloat(s);
    if (isNaN(n)) return null;
    return neg ? -n : n;
  }

  const norm = h => String(h).toLowerCase().trim().replace(/[^a-z0-9]/g, '');

  /* ---------------- channel classification (online vs retail / in-store) ---------------- */

  // Buckets a channel-ish value. Returns 'online', 'retail', '' (blank) or null (unrecognised).
  function channelOf(raw) {
    const v = String(raw || '').trim().toLowerCase();
    if (!v) return '';
    if (/online|e-?com|web|internet|deliver|shipp|digital|download|door|curb|takeout|app/.test(v)) return 'online';
    if (/retail|register|walk|pos|counter|pickup|dine|physical|onsite|in.?store|loyalty|wholesale|cash/.test(v)) return 'retail';
    return null;
  }

  /* ---------------- schema detection ---------------- */

  function detectSchema(headers) {
    const idx = {};
    headers.forEach((h, i) => { idx[norm(h)] = i; });
    const pick = (cands) => { for (const c of cands) if (idx[c] !== undefined) return idx[c]; return -1; };
    const schema = {
      date: pick(['date', 'datetime', 'postingdate', 'effectivedate', 'transactiondate', 'timestamp', 'created', 'createdat']),
      amount: pick(['total', 'grandtotal', 'paid', 'amount', 'subtotal', 'gross', 'net', 'revenue', 'saletotal']),
      lineType: pick(['linetype', 'line', 'type', 'linetype1']),
      status: pick(['status', 'postingstatus', 'state']),
      receipt: pick(['receiptnumber', 'receipt', 'ordernumber', 'order', 'transactionid', 'invoice', 'transaction', 'id']),
      user: pick(['user', 'employee', 'staff', 'cashier', 'seller', 'username']),
      details: pick(['details', 'description', 'item', 'items', 'product', 'name', 'sku', 'itemname']),
      channel: pick(['channel', 'salechannel', 'saleschannel', 'saletype', 'ordertype', 'orderchannel', 'sourcetype',
        'source', 'platform', 'register', 'location', 'store', 'site', 'webstore', 'ecom', 'soldvia']),
      headers: headers.slice()
    };
    return schema;
  }

  /* ---------------- dataset build (raw CSV -> one row per receipt) ---------------- */

  const EXCLUDED_STATUS = ['voided', 'saved', 'parked', 'cancelled', 'canceled', 'deleted'];

  function buildDataset(csv) {
    const schema = detectSchema(csv.headers);
    const meta = {
      schema, sourceHeaders: csv.headers.slice(),
      statusRemoved: {}, skippedUnparsed: 0, skippedNoAmount: 0,
      nonSaleLines: 0, aggregated: 0, note: '', symbol: '', noTime: false, hadTime: false
    };

    if (schema.date < 0 || schema.amount < 0) {
      meta.fatal = 'Could not find a date column and/or an amount column. ' +
        'Expected headers like "Date" (datetime) and "Total" (or Amount / Subtotal / Paid). ' +
        'Found: ' + (csv.headers.join(', ') || '(no header row)');
      return { receipts: [], meta };
    }

    // currency symbol from raw amounts (first ~300 cells that contain one)
    for (let i = 0; i < csv.rows.length && i < 300; i++) {
      const v = String(csv.rows[i][schema.amount] || '');
      const m = v.match(/[$£€]/);
      if (m) { meta.symbol = m[0]; break; }
    }

    const rows = csv.rows.filter(r => r[schema.date] !== undefined && String(r[schema.date]).trim() !== '');
    let pool = rows;

    if (schema.lineType >= 0) {
      // Lightspeed-style export: keep only the "Sale" header rows (line items / payments skipped)
      const headersOnly = [];
      for (const r of rows) {
        const lt = String(r[schema.lineType] || '').trim().toLowerCase();
        if (lt === 'sale' || lt === 'sale header' || lt === 'receipt' || lt === 'invoice') headersOnly.push(r);
        else if (lt) meta.nonSaleLines++;
      }
      if (headersOnly.length) pool = headersOnly;
      else meta.note += 'Found a line-type column but no "Sale" header rows — treated every row as a sale. ';
    }

    if (schema.status >= 0) {
      const kept = [];
      for (const r of pool) {
        const st = String(r[schema.status] || '').trim().toLowerCase();
        if (st && EXCLUDED_STATUS.includes(st)) {
          meta.statusRemoved[st] = (meta.statusRemoved[st] || 0) + 1;
          continue;
        }
        kept.push(r);
      }
      pool = kept;
    }

    // If we have an order/receipt id and rows repeat it, they are line items: aggregate per id.
    let transactions = pool;
    if (schema.lineType < 0 && schema.receipt >= 0) {
      const groups = new Map();
      for (const r of pool) {
        const id = String(r[schema.receipt] || '').trim();
        if (!id) { transactions.push(r); continue; }
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(r);
      }
      if ([...groups.values()].some(g => g.length > 1)) {
        const agg = [];
        for (const g of groups.values()) {
          if (g.length === 1) { agg.push(g[0]); continue; }
          meta.aggregated += g.length - 1;
          const sum = g.reduce((s, r) => s + (parseAmount(r[schema.amount]) || 0), 0);
          const det = g.map(r => String(r[schema.details] || '')).filter(Boolean)
            .filter((v, i, a) => a.indexOf(v) === i).join(' + ');
          const first = g[0].slice();
          first[schema.amount] = String(sum);
          if (schema.details >= 0) first[schema.details] = det || first[schema.details];
          agg.push(first);
        }
        transactions = agg;
        meta.note += 'Grouped repeated ' + csv.headers[schema.receipt] + ' ids into ' +
          meta.aggregated + ' line item(s). ';
      }
    }

    const receipts = [];
    const chOrder = [];                    // discovery order of channel keys
    const chCounts = new Map();
    const chLabels = { online: 'Online', retail: 'Retail' };
    const chKeyOf = raw => {
      const c = schema.channel >= 0 ? channelOf(raw) : '';
      if (c === null) { const v = String(raw).trim(); return v ? 'raw:' + v : ''; }
      return c;
    };
    for (const r of transactions) {
      const dt = parseDT(r[schema.date]);
      if (!dt) { meta.skippedUnparsed++; continue; }
      const amt = parseAmount(r[schema.amount]);
      if (amt === null) { meta.skippedNoAmount++; continue; }
      if (dt.getHours() !== 0 || dt.getMinutes() !== 0) meta.hadTime = true;
      else meta.noTime = true;
      const chKey = chKeyOf(schema.channel >= 0 ? r[schema.channel] : '');
      chCounts.set(chKey, (chCounts.get(chKey) || 0) + 1);
      if (chKey && !chLabels[chKey]) {
        chLabels[chKey] = String(r[schema.channel]).trim().slice(0, 40);
        chOrder.push(chKey);
      }
      receipts.push({
        date: dt,
        ds: pad(dt.getFullYear()) + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()) + ' ' +
            pad(dt.getHours()) + ':' + pad(dt.getMinutes()) + ':' + pad(dt.getSeconds()),
        dow: dt.getDay() === 0 ? 6 : dt.getDay() - 1,   // 0 = Monday
        hour: dt.getHours(),
        amt: amt,
        receipt: schema.receipt >= 0 ? String(r[schema.receipt]).trim() : '',
        user: schema.user >= 0 ? String(r[schema.user]).trim() : '',
        details: schema.details >= 0 ? String(r[schema.details]).trim() : '',
        channel: chKey
      });
    }
    receipts.sort((a, b) => a.date - b.date);
    meta.nReceipts = receipts.length;
    meta.total = receipts.reduce((s, r) => s + r.amt, 0);
    meta.chCol = schema.channel >= 0 ? csv.headers[schema.channel] : '';
    meta.chs = [];
    const pushCh = k => { if (chCounts.get(k)) meta.chs.push({ k, label: chLabels[k] }); };
    pushCh('online');
    pushCh('retail');
    for (const k of chOrder) if (k !== 'online' && k !== 'retail') pushCh(k);
    if (meta.noTime && !meta.hadTime) meta.note += 'No clock times in the timestamps — everything lands at 12 AM. ';
    return { receipts, meta };
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  /* ---------------- view model: filtering + aggregation ---------------- */

  // state: { s:'YYYY-MM-DD', e:'YYYY-MM-DD', days:bool[7], ch?:'online'|'retail'|'raw:…' }
  function filterReceipts(receipts, st) {
    const out = [];
    for (const r of receipts) {
      const d = r.ds.slice(0, 10);
      if (d < st.s || d > st.e) continue;
      if (!st.days[r.dow]) continue;
      if (st.ch && r.channel !== st.ch) continue;
      out.push(r);
    }
    return out;
  }

  function compute(rows) {
    const rev = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const cnt = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const dTot = new Array(7).fill(0), dCnt = new Array(7).fill(0);
    const hTot = new Array(24).fill(0), hCnt = new Array(24).fill(0);
    let tot = 0; const used = new Set();
    for (const r of rows) {
      rev[r.dow][r.hour] += r.amt; cnt[r.dow][r.hour]++;
      dTot[r.dow] += r.amt; dCnt[r.dow]++; hTot[r.hour] += r.amt; hCnt[r.hour]++;
      tot += r.amt; used.add(r.dow);
    }
    let bd = -1, bh = -1;
    for (let i = 0; i < 7; i++) if (bd < 0 || dTot[i] > dTot[bd]) bd = i;
    for (let i = 0; i < 24; i++) if (bh < 0 || hTot[i] > hTot[bh]) bh = i;
    return { rev, cnt, dTot, dCnt, hTot, hCnt, tot, daysUsed: used.size, bd, bh, n: rows.length };
  }

  /* ---------------- formatters ---------------- */

  function hourLabel(h) {
    if (h === 0 || h === 12) return '12 ' + (h === 0 ? 'AM' : 'PM');
    return (h % 12) + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  function fmtRange(s, e) {
    const p = d => { const ymd = d.split('-').map(Number); return { y: ymd[0], mo: MN[ymd[1] - 1], dd: ymd[2] }; };
    const a = p(s), b = p(e);
    if (a.y === b.y) {
      if (a.mo === b.mo) return a.mo + ' ' + a.dd + '–' + b.dd + ', ' + a.y;
      return a.mo + ' ' + a.dd + ' – ' + b.mo + ' ' + b.dd + ', ' + a.y;
    }
    return a.mo + ' ' + a.dd + ', ' + a.y + ' – ' + b.mo + ' ' + b.dd + ', ' + b.y;
  }

  function fmtDT(ds) {
    const dp = ds.slice(0, 10).split('-').map(Number);
    const hh = +ds.slice(11, 13), mi = +ds.slice(14, 16);
    const h12 = hh % 12 || 12, ap = hh < 12 ? 'AM' : 'PM';
    return MN[dp[1] - 1] + ' ' + dp[2] + ', ' + dp[0] + ' · ' + h12 + ':' + pad(mi) + ' ' + ap;
  }

  const api = {
    DAYS, MN, parseDT, parseAmount, channelOf, detectSchema, buildDataset,
    filterReceipts, compute, hourLabel, fmtRange, fmtDT, pad
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.DA = api;
})(typeof self !== 'undefined' ? self : this);
