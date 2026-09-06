/* csv.js — minimal RFC4180 CSV parser (handles quoted fields, escaped quotes, CRLF).
 * Exposes: window.CSV.parse(text) -> { headers: string[], rows: string[][] }
 */
(function (global) {
  'use strict';

  function parse(text) {
    const rows = [];
    let row = [], cur = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { row.push(cur); cur = ''; }
        else if (c === '\n') { row.push(cur); if (row.some(x => x.trim() !== '')) rows.push(row); row = []; cur = ''; }
        else if (c !== '\r') cur += c;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); if (row.some(x => x.trim() !== '')) rows.push(row); }
    if (!rows.length) return { headers: [], rows: [] };
    // strip BOM from first header cell
    rows[0][0] = rows[0][0].replace(/^\uFEFF/, '');
    return { headers: rows[0], rows: rows.slice(1) };
  }

  const api = { parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.CSV = api;
})(typeof self !== 'undefined' ? self : this);
