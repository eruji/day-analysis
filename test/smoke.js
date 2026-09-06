/* Minimal headless-Chrome smoke test (no deps): loads the local page,
 * clicks "Use sample data", then reports whether the hours outline renders. */
'use strict';
const { spawn } = require('child_process');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.env.TEMP + '/da-smoke',
    'about:blank'
  ], { stdio: 'ignore' });
  try {
    let target;
    for (let i = 0; i < 30; i++) {
      await sleep(250);
      try {
        const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
        target = list.find(t => t.type === 'page');
        if (target) break;
      } catch { /* not up yet */ }
    }
    if (!target) throw new Error('devtools not reachable');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params) => new Promise(res => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
    const evalJS = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error('page JS error: ' + JSON.stringify(r.result.exceptionDetails.exception));
      return r.result.result.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: 'http://127.0.0.1:8000/index.html' });
    await sleep(1200);

    // load the sample dataset
    await evalJS("document.getElementById('sample').click()");
    await sleep(1500);

    const out = await evalJS(`(() => {
      const cells = document.querySelectorAll('td.oh');
      const leg = document.getElementById('leg');
      const rows = [...document.querySelectorAll('#tableWrap tr')].map(tr =>
        [...tr.querySelectorAll('th.d, td')].map(td => td.className).join(' | '));
      const bar = null; // standalone chart removed — day bars now live in row headers
      const dth = document.querySelector('#tableWrap tr:nth-child(2) th.d');
      return {
        ohCells: cells.length,
        firstRowCells: rows[1] || null,
        legHidden: leg ? leg.classList.contains('hidden') : 'NO-EL',
        legText: leg ? leg.textContent.trim() : '',
        dayBars: document.querySelectorAll('#tableWrap th.d .db').length,
        dayNames: [...document.querySelectorAll('#tableWrap th.d .dn')].map(e => e.textContent),
        dayCounts: [...document.querySelectorAll('#tableWrap th.d .db b')].map(e => e.textContent),
        dayAmount0: (dth && dth.querySelector('.dm')) ? dth.querySelector('.dm').textContent : '',
        barFill0: (dth && dth.querySelector('.trk i')) ? [dth.querySelector('.trk i').style.width, dth.querySelector('.trk i').style.background] : null,
        noXmarker: ![...document.querySelectorAll('#tableWrap th.d')].some(e => /\d+x/.test(e.textContent)),
        chOpts: [...document.getElementById('chSel').options].map(o => o.value + '=' + o.textContent),
        status: (document.getElementById('status').textContent || '').trim().slice(0, 120)
      };
    })()`);
    console.log(JSON.stringify(out, null, 2));

    // per-day outline columns from the rendered classes
    const bands = await evalJS(`(() => {
      const res = {};
      document.querySelectorAll('#tableWrap tr').forEach(tr => {
        const th = tr.querySelector('th.d');
        if (!th) return;
        const day = th.childNodes[0].textContent.trim();
        const hours = [...tr.querySelectorAll('td')].map((td, h) =>
          td.classList.contains('oh') ? (h + ':00') : null).filter(Boolean);
        res[day] = hours;
      });
      return res;
    })()`);
    console.log('band columns per day:');
    for (const [d, hs] of Object.entries(bands)) console.log(' ', d, hs.join(' '));

    // channel switch: Online only, then back to All
    const ch = await evalJS(`(() => {
      const sel = document.getElementById('chSel');
      const pick = v => { sel.value = v; sel.dispatchEvent(new Event('change')); };
      pick('online');
      const online = { n: (document.getElementById('kN').textContent || '').trim(),
                       rev: (document.getElementById('kRev').textContent || '').trim() };
      pick('');
      return { online, allN: (document.getElementById('kN').textContent || '').trim() };
    })()`);
    console.log('channel switch:', JSON.stringify(ch));

    // persistence: reload the page — data should come back from localStorage
    await send('Page.navigate', { url: 'http://127.0.0.1:8000/index.html' });
    await sleep(2000);
    const rest = await evalJS(`(() => ({
      count: (document.getElementById('kN').textContent || '').trim(),
      status: (document.getElementById('status').textContent || '').trim(),
      forgetShown: !document.getElementById('forget').classList.contains('hidden'),
      hasTable: document.querySelectorAll('#tableWrap td').length > 40,
      chOpts: [...document.getElementById('chSel').options].map(o => o.value).join(',')
    }))()`);
    console.log('after reload:', JSON.stringify(rest));
    await evalJS(`localStorage.clear()`);   // keep smoke runs deterministic

    const pass = out.ohCells > 0 && !out.legHidden && out.legText.includes('Mon–Fri 10 AM–5 PM') &&
      out.dayBars === 7 && out.dayNames.join(',') === 'Mon,Tue,Wed,Thu,Fri,Sat,Sun' &&
      out.dayCounts.join(',') === '17,10,16,13,15,56,21' && out.noXmarker &&
      /^\$/.test(out.dayAmount0) && out.barFill0 && out.barFill0[0].includes('%') &&
      out.chOpts.join('|') === '=All sales|online=Online|retail=Retail' &&
      ch.online.n === '4' && ch.allN === '148' &&
      rest.count === '148' && rest.forgetShown && rest.hasTable && rest.status.includes('restored') &&
      rest.chOpts === ',online,retail';
    console.log(pass ? 'SMOKE PASS' : 'SMOKE FAIL');
    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch(e => { console.error('SMOKE ERROR', e); process.exit(1); });
