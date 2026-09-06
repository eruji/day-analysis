/* test.js — node test suite for csv.js + core.js against data/sample.csv.
 * Run: node test/test.js   (from the project root)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const CSV = require('../public/js/csv.js');
const DA = require('../public/js/core.js');

let fails = 0;
function t(name, cond, extra) {
  if (cond) console.log('PASS | ' + name);
  else { fails++; console.log('FAIL | ' + name + (extra !== undefined ? '  -> got: ' + JSON.stringify(extra) : '')); }
}

const text = fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'sample.csv'), 'utf8');
const csv = CSV.parse(text);
t('parses headers + 864 data rows', csv.headers.length === 22 && csv.rows.length === 864, [csv.headers.length, csv.rows.length]);
t('header cells clean', csv.headers[0] === 'Date' && csv.headers[21] === 'Attributes');

const built = DA.buildDataset(csv);
const m = built.meta;
t('schema detects Date/Total/Line Type/Status/Receipt/User/Details',
  m.schema.date === 0 && m.schema.amount === 11 && m.schema.lineType === 2 &&
  m.schema.status === 16 && m.schema.receipt === 1 && m.schema.user === 15 && m.schema.details === 13, m.schema);
t('excluded VOIDED=10 SAVED=3', m.statusRemoved.voided === 10 && m.statusRemoved.saved === 3, m.statusRemoved);
t('non-sale lines skipped (541 Sale Line + 162 Payment)', m.nonSaleLines === 703, m.nonSaleLines);
t('148 completed receipts', m.nReceipts === 148, m.nReceipts);
t('net revenue $15,007.50', Math.abs(m.total - 15007.50) < 0.01, m.total);
t('no currency symbol in sample', m.symbol === '', m.symbol);

const state = { s: built.receipts[0].ds.slice(0, 10), e: built.receipts[built.receipts.length - 1].ds.slice(0, 10),
  days: [true, true, true, true, true, true, true] };
t('full-range filter = 148', DA.filterReceipts(built.receipts, state).length === 148);
let comp = DA.compute(DA.filterReceipts(built.receipts, state));
t('best day Saturday', comp.bd === 5, comp.bd);
t('best hour 13 (1 PM)', comp.bh === 13, comp.bh);

function tot(s, e, days) {
  const st = { s, e, days: days || [true, true, true, true, true, true, true] };
  return DA.compute(DA.filterReceipts(built.receipts, st));
}
t('July 2026 $7,476.03 / 62', (() => { const x = tot('2026-07-01', '2026-07-31'); return Math.abs(x.tot - 7476.03) < 0.01 && x.n === 62; })());
t('August 2026 $6,117.71 / 70', (() => { const x = tot('2026-08-01', '2026-08-31'); return Math.abs(x.tot - 6117.71) < 0.01 && x.n === 70; })());
t('weekdays-only $8,431.86', (() => { const x = tot('2026-07-01', '2026-09-30', [true, true, true, true, true, false, false]); return Math.abs(x.tot - 8431.86) < 0.01; })());
t('Sat 1 PM cell = 4 receipts $2,104.08', (() => {
  const r = DA.filterReceipts(built.receipts, state).filter(x => x.dow === 5 && x.hour === 13);
  return r.length === 4 && Math.abs(r.reduce((s, x) => s + x.amt, 0) - 2104.08) < 0.01;
})());

t('channelOf buckets', DA.channelOf('Online register') === 'online' && DA.channelOf('Web Shop') === 'online' &&
  DA.channelOf('Main Register') === 'retail' && DA.channelOf('walk-in') === 'retail' &&
  DA.channelOf('') === '' && DA.channelOf('odd value') === null);
t('Register detected as channel column', m.chCol === 'Register', m.chCol);
t('channels discovered = Online + Retail', m.chs.map(c => c.k + '=' + c.label).join(',') === 'online=Online,retail=Retail', m.chs);
t('receipts tagged online 4 / retail 144', (() => {
  const c = built.receipts.reduce((o, r) => { o[r.channel] = (o[r.channel] || 0) + 1; return o; }, {});
  return c.online === 4 && c.retail === 144;
})());
t('channel filter: online only = 4 receipts, all tagged online', (() => {
  const r = DA.filterReceipts(built.receipts, Object.assign({}, state, { ch: 'online' }));
  return r.length === 4 && r.every(x => x.channel === 'online');
})());

t('fmtRange same-year', DA.fmtRange('2026-07-11', '2026-09-05') === 'Jul 11 – Sep 5, 2026');
t('fmtDT 13:59:59', DA.fmtDT('2026-07-18 13:59:59') === 'Jul 18, 2026 · 1:59 PM');
t('hourLabel 12 AM / 12 PM / 9 AM / 22', DA.hourLabel(0) === '12 AM' && DA.hourLabel(12) === '12 PM' &&
  DA.hourLabel(9) === '9 AM' && DA.hourLabel(22) === '10 PM');
t('parseAmount variants', DA.parseAmount('($1,234.50)') === -1234.5 && DA.parseAmount('€ 12,50') === 12.5 &&
  DA.parseAmount('57.28') === 57.28 && DA.parseAmount('') === null);

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nAll tests passed.');
process.exit(fails ? 1 : 0);
