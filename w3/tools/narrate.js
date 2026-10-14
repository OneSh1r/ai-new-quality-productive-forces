/* =============================================================================
 * Visual Pandas — narrated walkthrough recorder

 *   node tools/narrate.js [outDir]

 * Drives the real app in headless Chrome through a short tour, capturing a few
 * frames per scene (actions themselves are the same ones the test suite uses).
 * The manifest it writes is consumed by tools/build-video.py, which synthesises
 * the Chinese narration with the Windows speech engine, stretches each scene to
 * the length of its sentence and muxes an MP4.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const cdp = require('../tests/cdp.js');

const OUT = process.argv[2] || path.join(__dirname, '..', 'video');
const FRAMES = path.join(OUT, 'frames');
const GAP = 0.3;           // silence after each sentence, in seconds
const SHOT_GAP = 240;      // ms between the captures inside one scene

/** Five frames per scene: the action, then the settled result. */
const SHOTS = 3;

const SCENES = [
  {
    id: '01-start',
    text: '可视化 Pandas：数据来自示例、粘贴或拖拽，鼠标完成分析并生成 pandas 代码。',
    run: "PV.app.state.datasets.slice().forEach(function (d) { PV.app.removeDataset(d.id); });"
      + " PV.app.emit();",
    after: "PV.app.loadSample('retail'); PV.app.setTab('table'); PV.app.emit();"
  },
  {
    id: '02-table',
    text: '数据表：类型、缺失、热力着色一眼看清，点表头排序。',
    run: "PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + " PV.app.setTab('table'); PV.app.emit();"
  },
  {
    id: '03-profile',
    text: '数据概览：关键指标、列图谱、缺失矩阵、关联矩阵。',
    run: "PV.app.setTab('profile');"
  },
  {
    id: '04-focus',
    text: '点列名变成当前列，可以送到图表、分组或连接。',
    run: "(function () { var cells = document.querySelectorAll('.center .atlas-cell');"
      + " if (cells[8]) { cells[8].scrollIntoView({ block: 'center' }); cells[8].click(); } })();"
  },
  {
    id: '05-chart',
    text: '十六种图形：悬停看数值，点柱子直接筛选。',
    run: "(function () {"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + " PV.app.state.charts.spec = { type: 'bar', x: 'category', y: ['profit'], agg: 'sum', color: null,"
      + "   size: null, sort: 'value_desc', limit: 12, stacked: false, horizontal: false, labels: true };"
      + " PV.app.setTab('charts'); PV.app.emit();"
      + " var bar = document.querySelector('.chart-bar');"
      + " if (bar) bar.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 700, clientY: 300 }));"
      + " })();",
    after: "(function () { var bar = document.querySelector('.chart-bar');"
      + " if (bar) bar.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 700, clientY: 300 })); })();"
  },
  {
    id: '06-visual',
    text: '密度图点格子筛两列，平行坐标沿轴拖动筛选。',
    run: "(function () {"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + " PV.app.state.charts.spec = { type: 'density', x: 'revenue', y: ['profit'], agg: 'sum', limit: 0 };"
      + " PV.app.emit();"
      + " var cells = document.querySelectorAll('.chart-cell');"
      + " if (cells.length) cells[Math.floor(cells.length / 3)].dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 700, clientY: 320 }));"
      + " })();"
  },
  {
    id: '07-group',
    text: '汇总支持分组、透视、交叉表；多表可以左连接。',
    run: "(function () {"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + " PV.app.setTab('group'); PV.app.emit();"
      + " var tabs = document.querySelectorAll('.center .section-tab');"
      + " if (tabs[1]) tabs[1].click();"
      + " })();",
    after: "(function () {"
      + " PV.app.loadSample('employees');"
      + " PV.app.setActive(PV.app.state.datasets[0].id);"
      + " PV.app.setTab('combine');"
      + " var btn = Array.prototype.filter.call(document.querySelectorAll('.center .panel-foot .btn'),"
      + "   function (b) { return /合并|Join/.test(b.textContent); })[0];"
      + " if (btn) btn.click();"
      + " })();"
  },
  {
    id: '08-code',
    text: '每一步操作都对应一行 pandas 代码，可整段复制。',
    run: "(function () {"
      + " PV.app.setTab('code');"
      + " })();"
  },
  {
    id: '09-datasets',
    text: '左侧可以放多张表，点一下切换；删除先确认。',
    run: "(function () {"
      + " PV.app.loadSample('iris'); PV.app.loadSample('air');"
      + " PV.app.setTab('table'); PV.app.emit();"
      + " var rows = document.querySelectorAll('.side .ds-row');"
      + " if (rows[0]) rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));"
      + " })();",
    after: "(function () {"
      + " var del = document.querySelectorAll('.side .ds-row .ds-del');"
      + " if (del[del.length - 1]) del[del.length - 1].click();"
      + " })();"
  },
  {
    id: '10-undo',
    text: '撤销重做写明上一步，可连续撤销，也能找回删除。',
    run: "(function () {"
      + " var ok = document.querySelector('.dialog-footer .btn-primary');"
      + " if (ok) ok.click();"
      + " PV.app.resetHistory();"
      + " PV.app.addStep('filter', { mode: 'visual', match: 'all', conds: [{ col: 'region', op: 'eq', value: 'East', value2: '' }] });"
      + " PV.app.addStep('sort', { by: ['revenue'], ascending: [false] });"
      + " })();",
    after: "(function () {"
      + " document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));"
      + " document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));"
      + " })();"
  },
  {
    id: '11-bilingual',
    text: '中英双语、深浅主题、完全离线，检查全部通过。',
    run: "(function () {"
      + " var icons = document.querySelectorAll('.topbar-right .btn-icon');"
      + " if (document.documentElement.getAttribute('data-theme') !== 'dark') icons[0].click();"
      + " })();"
  }
];

async function main() {
  if (!cdp.findBrowser()) {
    console.log('no Chrome/Edge found — cannot record');
    return;
  }
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  const app = await cdp.launch({ width: 1280, height: 800 });
  const ev = (code) => app.evaluate(code);
  const scenes = [];

  async function capture(scene, tag) {
    const files = [];
    for (let i = 0; i < SHOTS; i++) {
      const buf = await app.frameBuffer('png');
      const name = scene.id + tag + '-' + i + '.png';
      fs.writeFileSync(path.join(FRAMES, name), buf);
      files.push(name);
      if (i < SHOTS - 1) await app.settle(SHOT_GAP);
    }
    return files;
  }

  try {
    await app.settle(1200);
    await ev(HELPER);
    for (const scene of SCENES) {
      process.stdout.write('· ' + scene.id + ' ');
      await ev('clearToasts()');
      await ev(scene.run);
      await app.settle(650);
      const frames = await capture(scene, 'a');
      if (scene.after) {
        await ev(scene.after);
        await app.settle(600);
        frames.push.apply(frames, await capture(scene, 'b'));
      }
      scenes.push({ id: scene.id, text: scene.text, frames: frames });
      process.stdout.write('(' + frames.length + ' frames)\n');
    }
    fs.writeFileSync(path.join(OUT, 'narration.json'), JSON.stringify({
      width: 1280, height: 800, gap: GAP, scenes: scenes, errors: app.errors
    }, null, 1));
    console.log('wrote ' + scenes.length + ' scenes to ' + path.join(OUT, 'narration.json'));
    if (app.errors.length) console.log('console errors: ' + JSON.stringify(app.errors.slice(0, 4)));
  } catch (e) {
    console.log('failed: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
  } finally {
    await app.close();
  }
}

/** Injected once: a toast from the previous scene must not bleed into this one. */
const HELPER = "window.clearToasts = function () {"
  + " Array.prototype.forEach.call(document.querySelectorAll('.toast'), function (t) {"
  + "   if (t.parentNode) t.parentNode.removeChild(t); }); };";

main();
