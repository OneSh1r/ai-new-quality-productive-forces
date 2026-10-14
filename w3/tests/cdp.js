/* =============================================================================
 * Headless Chrome driver over the DevTools protocol.
 * Used by tests/e2e.test.js (functional sweep), tests/visual-check.js
 * (screenshots) and tools/tour.js (captioned walkthrough).
 *
 *   const cdp = require('./cdp.js');
 *   const app = await cdp.launch({ width: 1440, height: 900 });
 *   await app.evaluate('PV.app.setTab("charts")');
 *   await app.shot('charts.png');
 *   app.errors   // console errors + uncaught exceptions
 *   await app.close();
 * ========================================================================== */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

function findBrowser() {
  for (const c of CANDIDATES) if (fs.existsSync(c)) return c;
  return null;
}

function fileUrl(absPath) {
  const parts = path.resolve(absPath).replace(/\\/g, '/').split('/');
  return 'file:///' + parts.map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join('/');
}

function appUrl(hash) {
  return fileUrl(path.join(__dirname, '..', 'index.html')) + (hash || '');
}

async function launch(opts) {
  opts = opts || {};
  const browser = opts.browser || findBrowser();
  if (!browser) throw new Error('no Chrome/Edge found');
  const width = opts.width || 1440;
  const height = opts.height || 900;
  const port = opts.port || (9300 + Math.floor(Math.random() * 400));
  const profile = path.join(os.tmpdir(), 'pv-cdp-' + Date.now() + '-' + port);
  const child = spawn(browser, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--user-data-dir=' + profile,
    '--window-size=' + width + ',' + height,
    '--remote-debugging-port=' + port,
    appUrl(opts.hash || '')
  ], { stdio: 'ignore' });

  const wait = ms => new Promise(r => setTimeout(r, ms || 200));
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await wait(250);
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/list');
      const list = await res.json();
      target = list.filter(t => t.type === 'page' && t.url.indexOf('index.html') >= 0)[0] || null;
    } catch (e) { /* not up yet */ }
  }
  if (!target) {
    child.kill();
    throw new Error('could not attach to the page');
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];
  const logs = [];
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result || {});
      pending.delete(msg.id);
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
      logs.push({ type: msg.params.type, text: text });
      if (msg.params.type === 'error') errors.push(text);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push('exception: ' + (d.text || '') + ' ' + ((d.exception || {}).description || ''));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push(msg.params.entry.text);
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
  await send('Log.enable');

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', {
      expression: expression, awaitPromise: true, returnByValue: true
    });
    if (res.exceptionDetails) {
      throw new Error('eval failed: ' + (res.exceptionDetails.text || '') + ' ' +
        ((res.exceptionDetails.exception || {}).description || ''));
    }
    return res.result ? res.result.value : undefined;
  }

  async function frameBuffer(format) {
    const res = await send('Page.captureScreenshot', { format: format || 'png', captureBeyondViewport: false });
    return Buffer.from(res.data, 'base64');
  }

  async function shot(file, format) {
    const buf = await frameBuffer(format);
    if (file) fs.writeFileSync(file, buf);
    return buf;
  }

  async function setViewport(w, h) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 1, mobile: false
    });
  }

  async function close() {
    try { ws.close(); } catch (e) { /* ignore */ }
    child.kill();
    setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ } }, 300);
  }

  /** Wait until the app reports it is idle (no pending render). */
  async function settle(ms) {
    await wait(ms === undefined ? 420 : ms);
  }

  return {
    browser: browser,
    port: port,
    evaluate: evaluate,
    frameBuffer: frameBuffer,
    shot: shot,
    setViewport: setViewport,
    settle: settle,
    wait: wait,
    send: send,
    errors: errors,
    logs: logs,
    close: close,
    appUrl: appUrl,
    fileUrl: fileUrl
  };
}

module.exports = { launch: launch, findBrowser: findBrowser, appUrl: appUrl, fileUrl: fileUrl };
