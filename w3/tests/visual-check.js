/* =============================================================================
 * Visual check: opens the app in headless Chrome via the DevTools protocol,
 * captures screenshots of any state, and reports console errors.
 *
 *   node tests/visual-check.js [outDir]
 *
 * Needs Chrome or Edge installed. Screenshots land in outDir (default: the
 * thread's visualization folder when available, else ./shots).
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/')
  .split('/').map(function (seg, i) { return i === 0 ? seg : encodeURIComponent(seg); }).join('/');
const OUT = process.argv[2] || path.join(__dirname, '..', 'shots');
const PORT = 9333;

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];

function findBrowser() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  return null;
}

async function main() {
  const browser = findBrowser();
  if (!browser) {
    console.log('no Chrome/Edge found - skipping the visual check');
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });
  const profile = path.join(require('os').tmpdir(), 'pv-visual-' + Date.now());
  const child = spawn(browser, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--user-data-dir=' + profile, '--window-size=1680,1050',
    '--remote-debugging-port=' + PORT, APP
  ], { stdio: 'ignore' });

  const wait = ms => new Promise(r => setTimeout(r, ms));
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await wait(250);
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await res.json();
      target = list.filter(t => t.type === 'page' && t.url.indexOf('index.html') >= 0)[0] || null;
    } catch (e) { /* not up yet */ }
  }
  if (!target) {
    console.log('could not attach to the page');
    child.kill();
    return;
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result || {});
      pending.delete(msg.id);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map(a => a.value || a.description || '').join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('exception: ' + (msg.params.exceptionDetails.text || '') + ' ' +
        ((msg.params.exceptionDetails.exception || {}).description || ''));
    }
  });
  const send = (method, params) => new Promise(resolve => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method: method, params: params || {} }));
  });
  await new Promise(r => ws.addEventListener('open', r));
  await send('Runtime.enable');
  await send('Page.enable');

  const evaluate = async expression => {
    const res = await send('Runtime.evaluate', { expression: expression, awaitPromise: true, returnByValue: true });
    return res.result ? res.result.value : undefined;
  };
  const shot = async name => {
    const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(res.data, 'base64'));
    return name + '.png';
  };

  const views = [
    ['table', "PV.app.setTab('table')"],
    ['profile', "PV.app.setTab('profile')"],
    ['charts', "PV.app.setTab('charts')"],
    ['group', "PV.app.setTab('group')"],
    ['group-pivot', "PV.app.setTab('group'); PV.app.emit(); document.querySelectorAll('.section-tab')[1].click()"],
    ['group-crosstab', "document.querySelectorAll('.section-tab')[2].click()"],
    ['table-sorted', "PV.app.setTab('table'); PV.app.emit();"
      + "var hs = document.querySelectorAll('.grid-head-btn'); hs[hs.length - 6].click()"],
    ['combine', "PV.app.setTab('combine')"],
    ['code', "PV.app.setTab('code')"],
    ['table-dark', "PV.shell.setTheme('dark'); PV.app.setTab('table')"],
    ['focus-link', "PV.shell.setTheme('light'); PV.app.setInspector('column', { col: 'revenue' }); PV.app.setTab('table')"],
    ['pipeline-code', "PV.app.addStep('filter', { mode: 'visual', match: 'all', conds: [{ col: 'region', op: 'eq', value: 'East', value2: '' }] });"
      + "PV.app.addStep('groupby', { keys: ['category'], aggs: [{ col: 'revenue', fn: 'sum', out: '' }] });"
      + "PV.app.state.expandedSteps[PV.app.steps()[1].id] = true; PV.app.setTab('table')"],
    ['chart-density', "PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + "PV.app.state.charts.spec = Object.assign({}, PV.app.defaultChart, { type: 'density', x: 'revenue', y: ['profit'] });"
      + "PV.app.state.chartAdvanced = true; PV.app.setTab('charts'); PV.app.emit()"],
    ['chart-parallel', "PV.app.state.charts.spec = Object.assign({}, PV.app.defaultChart,"
      + " { type: 'parallel', x: 'units', y: ['units', 'revenue', 'profit', 'discount'], color: 'region' });"
      + "PV.app.setTab('charts'); PV.app.emit()"],
    ['table-bars', "PV.app.state.chartAdvanced = false; PV.app.state.table.heat = true; PV.app.setTab('table'); PV.app.emit()"],
    ['empty-hero', "PV.shell.setTheme('light'); PV.app.state.datasets.slice().forEach(function (d) { PV.app.removeDataset(d.id); })"]
  ];
  for (const v of views) {
    await evaluate(v[1]);
    await wait(900);
    const file = await shot(v[0]);
    console.log('captured ' + file);
  }
  const info = await evaluate(
    "JSON.stringify({ fx: PV.fx.count(), anim: PV.anim.enabled(), datasets: PV.app.state.datasets.length })");
  console.log('runtime: ' + info);
  if (consoleErrors.length) {
    console.log('console errors:');
    consoleErrors.slice(0, 20).forEach(e => console.log('  ! ' + e));
  } else {
    console.log('no console errors');
  }
  ws.close();
  child.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exitCode = consoleErrors.length ? 1 : 0;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
