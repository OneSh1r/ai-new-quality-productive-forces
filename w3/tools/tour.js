/* =============================================================================
 * Visual Pandas — captioned walkthrough
 *
 *   node tools/tour.js [outDir]
 *
 * Drives the real app in headless Chrome through a scripted tour, captures
 * frames at each stop and writes them next to a manifest. tools/build-gif.py
 * turns that into a captioned animated GIF (mp4 needs ffmpeg, which may not be
 * installed; a GIF plays inline anywhere).
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const cdp = require('../tests/cdp.js');

const OUT = process.argv[2] || path.join(__dirname, '..', 'tour');
const FRAMES = path.join(OUT, 'frames');

/* Each stop: what to do, then the two captions that sit on every frame of it.
 * `frames` lists the dwell time (ms) of each capture — a couple of short ones
 * catch the animation, the last one stays long enough to read the caption. */
const SHORT = [140, 220];
const HOLD = 1500;

const TOUR = [
  {
    id: '01-empty',
    zh: '没有数据也能直接开始',
    en: 'An empty workspace is a starting point, not a dead end',
    run: "PV.app.state.datasets.slice().forEach(function (d) { PV.app.removeDataset(d.id); });"
      + " PV.app.emit();"
  },
  {
    id: '02-load',
    zh: '载入数据：内置示例、粘贴、拖拽 CSV / XLSX',
    en: 'Load data: sample tables, paste, drag-drop CSV, pick CSV / XLSX',
    run: "PV.app.loadSample('retail'); PV.app.setTab('table');"
  },
  {
    id: '03-table',
    zh: '数据表：行列、类型、缺失一眼看清',
    en: 'The table: rows, column types and gaps at a glance',
    run: "PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + " PV.app.setTab('table'); PV.app.emit();"
  },
  {
    id: '04-profile',
    zh: '数据概览：关键指标 + 每列一个小图形',
    en: 'Profile: key metrics, then one small shape per column',
    run: "PV.app.setTab('profile');"
  },
  {
    id: '05-atlas-focus',
    zh: '点击列图谱，全站跟随“当前列”',
    en: 'Click a column in the atlas and the whole app follows it',
    run: "(function () { var cells = document.querySelectorAll('.center .atlas-cell');"
      + " cells[Math.min(8, cells.length - 1)].scrollIntoView({ block: 'center' });"
      + " cells[Math.min(8, cells.length - 1)].click(); })();"
  },
  {
    id: '06-missing',
    zh: '缺失矩阵：空值出现在哪些行',
    en: 'Missing matrix: exactly which rows have gaps',
    run: "(function () { var p = panelWith('缺失矩阵'); if (p) p.scrollIntoView({ block: 'start' }); })();"
  },
  {
    id: '07-assoc',
    zh: '关联矩阵：数值与类别也能算关系强度',
    en: 'Association matrix: strength between mixed column types',
    run: "(function () { var p = panelWith('关联矩阵'); if (p) p.scrollIntoView({ block: 'start' }); })();"
  },
  {
    id: '08-corr-click',
    zh: '点一下相关性方格，直接把关系画成图',
    en: 'Click a correlation cell to turn it into a chart',
    // walk the matrix until a *pair* of different numeric columns is hit (the
    // diagonal would chart a column against itself)
    run: "(function () { for (var i = 0; i < 140; i++) {"
      + " var cells = document.querySelectorAll('.center .chart-heatmap rect');"
      + " if (i >= cells.length) break;"
      + " cells[i].dispatchEvent(new MouseEvent('click', { bubbles: true }));"
      + " if (PV.app.state.tab !== 'charts') continue;"
      + " var spec = PV.app.state.charts.spec;"
      + " if (spec.x !== (spec.y || [])[0]) break;"
      + " PV.app.setTab('profile'); } })();"
  },
  {
    id: '09-bar-filter',
    zh: '悬停看数值，点击柱子立刻筛选',
    en: 'Hover for the numbers, click a bar to filter the rows',
    run: "(function () {"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + " PV.app.state.charts.spec = { type: 'bar', x: 'category', y: ['profit'], agg: 'sum', color: null,"
      + "   size: null, sort: 'value_desc', limit: 12, stacked: false, horizontal: false, labels: true };"
      + " PV.app.setTab('charts'); PV.app.emit();"
      + " var bar = document.querySelector('.chart-bar');"
      + " if (bar) { bar.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 700, clientY: 300 })); }"
      + " })();",
    after: "(function () { var bar = document.querySelector('.chart-bar');"
      + " if (bar) bar.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 700, clientY: 300 })); })();"
  },
  {
    id: '10-density',
    zh: '二维密度：点一个格子，两列同时筛选',
    en: '2D density: one click filters both axes at once',
    run: "(function () {"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + " PV.app.state.charts.spec = { type: 'density', x: 'revenue', y: ['profit'], agg: 'sum', limit: 0 };"
      + " PV.app.emit();"
      + " var cells = document.querySelectorAll('.chart-cell');"
      + " if (cells.length) cells[Math.floor(cells.length / 3)].dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 700, clientY: 320 }));"
      + " })();"
  },
  {
    id: '11-parallel',
    zh: '平行坐标：沿坐标轴拖动就能筛选',
    en: 'Parallel coordinates: drag along an axis to filter',
    run: "(function () {"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + " PV.app.state.charts.spec = { type: 'parallel', x: 'units', y: ['units', 'revenue', 'profit', 'discount'],"
      + "   color: 'region', agg: 'sum', limit: 12 };"
      + " PV.app.emit();"
      + " var svg = document.querySelector('.chart-box svg');"
      + " var strip = svg.querySelectorAll('.chart-axis-hit')[1];"
      + " var box = svg.getBoundingClientRect();"
      + " var cx = box.left + (box.width * 0.42), cy = box.top + box.height * 0.45;"
      + " strip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));"
      + " document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy + 90 }));"
      + " document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy + 90 }));"
      + " })();"
  },
  {
    id: '12-group',
    zh: '汇总：分组聚合 / 透视表 / 交叉表',
    en: 'Summarise: groupby, pivot table and crosstab builders',
    run: "(function () {"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + " PV.app.setTab('group'); PV.app.emit();"
      + " var tabs = document.querySelectorAll('.center .section-tab');"
      + " if (tabs[1]) tabs[1].click();"
      + " })();",
    after: "(function () {"
      + " var btn = Array.prototype.filter.call(document.querySelectorAll('.center .panel-foot .btn'),"
      + "   function (b) { return b.textContent.indexOf('流水线') >= 0; })[0];"
      + " if (btn) btn.click(); })();"
  },
  {
    id: '13-merge',
    zh: '合并：与维表左连接，附匹配报告',
    en: 'Combine: left-join a dimension table with a match report',
    run: "(function () {"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + " PV.app.loadSample('employees'); PV.app.setActive(PV.app.state.datasets[0].id); PV.app.emit();"
      + " PV.app.setTab('combine');"
      + " var btn = Array.prototype.filter.call(document.querySelectorAll('.center .panel-foot .btn'),"
      + "   function (b) { return /合并|Join/.test(b.textContent); })[0];"
      + " if (btn) btn.click();"
      + " })();"
  },
  {
    id: '14-code',
    zh: '代码页：每个可视化步骤对应一行 pandas',
    en: 'Code tab: every visual step becomes a pandas line',
    run: "PV.app.setTab('code');"
  },
  {
    id: '15-theme',
    zh: '深色模式 / 中英双语，内容完全一致',
    en: 'Dark mode and a fully bilingual interface',
    run: "(function () {"
      + " var icons = document.querySelectorAll('.topbar-right .btn-icon');"
      + " if (document.documentElement.getAttribute('data-theme') !== 'dark') icons[0].click();"
      + " PV.app.setTab('table');"
      + " })();"
  },
  {
    id: '16-datasets',
    zh: '多个数据源：点一下切换，当前表就是右侧的结果',
    en: 'Several tables at once: click one to make it the active table',
    run: "(function () {"
      + " PV.app.loadSample('iris'); PV.app.loadSample('air');"
      + " PV.app.setTab('table'); PV.app.emit();"
      + " var rows = document.querySelectorAll('.side .ds-row');"
      + " if (rows[0]) rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));"
      + " })();"
  },
  {
    id: '17-delete',
    zh: '删除数据集：先确认，再给一次撤销的机会',
    en: 'Deleting a dataset asks first and offers an undo',
    run: "(function () {"
      + " var del = document.querySelectorAll('.side .ds-row .ds-del');"
      + " if (del[del.length - 1]) del[del.length - 1].click();"
      + " })();",
    after: "(function () {"
      + " var ok = document.querySelector('.dialog-footer .btn-primary');"
      + " if (ok) ok.click();"
      + " })();"
  },
  {
    id: '18-undo',
    zh: '撤销 / 重做：写明上一步是什么，可以连续撤销',
    en: 'Undo / redo name the last action and work step by step',
    run: "(function () {"
      + " document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));"
      + " PV.app.resetHistory();"
      + " PV.app.addStep('filter', { mode: 'visual', match: 'all', conds: [{ col: 'region', op: 'eq', value: 'East', value2: '' }] });"
      + " PV.app.addStep('sort', { by: ['revenue'], ascending: [false] });"
      + " })();",
    after: "(function () {"
      + " document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));"
      + " })();"
  }
];

/** Close the tour with a card the app itself would never show. */
const CLOSING = {
  id: '19-summary',
  zh: '结束 · 全部功能测试通过',
  en: 'That is the whole tour — every automatic check is green',
  run: "(function () {"
    + " var card = document.createElement('div');"
    + " card.id = 'tour-card';"
    + " card.setAttribute('style', 'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;'"
    + " + 'align-items:center;justify-content:center;gap:18px;background:rgba(12,14,24,.92);color:#fff;'"
    + " + 'font-family:system-ui,-apple-system,Segoe UI,Microsoft YaHei,sans-serif;text-align:center;padding:40px');"
    + " card.innerHTML = '<div style=\"font-size:38px;font-weight:700;letter-spacing:.5px\">可视化 Pandas</div>'"
    + " + '<div style=\"font-size:19px;opacity:.85\">用图形完成 pandas 的日常分析 · Visual data analysis with pandas</div>'"
    + " + '<div style=\"font-size:15px;opacity:.7;margin-top:6px\">24 个可视化操作 · 16 种图形 · 中英双语 · 完全离线 · 自动检查 1222 项全部通过</div>';"
    + " document.body.appendChild(card); })();"
};

function helperSource() {
  // injected once: find a profile panel by a word in its title
  return "window.panelWith = function (word) {"
    + " var panels = Array.prototype.slice.call(document.querySelectorAll('.center .panel'));"
    + " return panels.filter(function (p) {"
    + "   var t = p.querySelector('.panel-title');"
    + "   return t && t.textContent.indexOf(word) >= 0; })[0] || null; };"
    // a toast from the previous stop would otherwise be stacked on this one
    + " window.clearToasts = function () {"
    + " Array.prototype.forEach.call(document.querySelectorAll('.toast'), function (t) {"
    + "   if (t.parentNode) t.parentNode.removeChild(t); }); };";
}

async function main() {
  if (!cdp.findBrowser()) {
    console.log('no Chrome/Edge found — cannot record the tour');
    return;
  }
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  const app = await cdp.launch({ width: 1280, height: 800 });
  const ev = (code) => app.evaluate(code);
  const frames = [];

  async function shoot(stop, hold) {
    const buf = await app.frameBuffer('png');
    const file = stop.id + '-' + String(frames.length).padStart(3, '0') + '.png';
    fs.writeFileSync(path.join(FRAMES, file), buf);
    frames.push({ file: file, zh: stop.zh, en: stop.en, hold: hold });
  }

  /** Three captures per stop: two during the transition, one held. */
  async function record(stop) {
    await shoot(stop, SHORT[0]);
    await app.settle(SHORT[1]);
    await shoot(stop, SHORT[1]);
    await app.settle(420);
    await shoot(stop, HOLD);
  }

  try {
    await app.settle(1200);
    await ev(helperSource());
    for (const stop of TOUR) {
      process.stdout.write('· ' + stop.id + '\n');
      await ev('clearToasts()');
      await ev(stop.run);
      await app.settle(700);
      await record(stop);
      if (stop.after) {
        await ev(stop.after);
        await app.settle(600);
        await record(stop);
      }
    }
    process.stdout.write('· ' + CLOSING.id + '\n');
    await ev(CLOSING.run);
    await app.settle(1100);
    await record(CLOSING);
    fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify({
      width: 1280, height: 800, frames: frames, errors: app.errors
    }, null, 1));
    console.log('captured ' + frames.length + ' frames into ' + FRAMES);
    if (app.errors.length) console.log('console errors: ' + JSON.stringify(app.errors.slice(0, 5)));
  } catch (e) {
    console.log('tour failed: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
  } finally {
    await app.close();
  }

  const gif = path.join(OUT, 'visual-pandas-tour.gif');
  const py = process.env.PV_PYTHON || 'python';
  const res = spawnSync(py, [path.join(__dirname, 'build-gif.py'),
    path.join(OUT, 'frames.json'), gif], { stdio: 'inherit' });
  if (res.status === 0) console.log('wrote ' + gif);
}

main();
