/* =============================================================================
 * End-to-end sweep, part 1: boot, data loading, every tab, every operation
 * and the table's interactions — all driven through the real UI in headless
 * Chrome (DevTools protocol).
 *
 *   node tests/e2e-core.test.js
 * ========================================================================== */
'use strict';
const cdp = require('./cdp.js');

let passed = 0, failed = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { passed += 1; return true; }
  failed += 1;
  failures.push(label + (extra !== undefined ? '  ->  ' + JSON.stringify(extra) : ''));
  return false;
}
function eq(a, b, label) { return ok(a === b, label, { got: a, want: b }); }

(async function run() {
  if (!cdp.findBrowser()) {
    console.log('no Chrome/Edge found - skipping');
    process.exit(0);
  }
  const app = await cdp.launch({ width: 1500, height: 940 });
  const ev = (expr) => app.evaluate(expr);
  const settle = () => app.settle(280);

  try {
    await app.settle(900);

    console.log('\nboot and default data');
    eq(await ev('PV.app.state.datasets.length'), 1, 'default dataset loaded');
    eq(await ev('PV.app.active().df.nrows'), 2614, 'default row count');
    eq(await ev('document.querySelectorAll(".tab").length'), 5, 'five tabs with one dataset');
    ok(await ev('document.querySelectorAll(".grid-row").length > 3'), 'table painted rows');
    eq(await ev('document.querySelectorAll(".op-card").length'), 8, 'eight common operations');
    eq(await ev('!!document.querySelector(".focus-chip")'), false, 'no focus chip before a column is picked');
    eq(await ev('PV.anim.enabled()'), true, 'd3 loaded');
    ok(await ev('typeof p5 === "function"'), 'p5 loaded');
    // Icons are inline SVG: the path data has to end up in a <path> element,
    // otherwise every glyph in the shell is an empty box.
    const icons = await ev("(function () {"
      + " var svgs = Array.prototype.slice.call(document.querySelectorAll('svg'));"
      + " var shell = Array.prototype.slice.call(document.querySelectorAll('.topbar svg, .tabs svg, .op-card svg, .panel-head svg'));"
      + " return { total: svgs.length,"
      + "   withPath: svgs.filter(function (s) { return s.querySelector('path'); }).length,"
      + "   shell: shell.length,"
      + "   shellWithPath: shell.filter(function (s) { return s.querySelector('path'); }).length,"
      + "   dangling: svgs.filter(function (s) { return !s.querySelector('path,circle,rect,line,polyline') && s.textContent.trim().length > 4; }).length }; })()");
    ok(icons.total > 10 && icons.withPath === icons.total,
      'every icon svg has real geometry inside it', icons);
    ok(icons.shell > 0 && icons.shellWithPath === icons.shell,
      'header, tab and panel icons are drawn', icons);
    eq(icons.dangling, 0, 'no svg is left with bare path data as text');

    console.log('\ndata loading');
    eq(await ev("(function(){ PV.sourcePanel.loadText('a,b\\n1,x\\n2,y\\n3,z', { filename: 'tiny.csv' });"
      + " return PV.app.state.datasets.length; })()"), 2, 'paste/text loading adds a dataset');
    eq(await ev('PV.app.active().df.nrows'), 3, 'text row count');
    eq(await ev('PV.app.active().df.names.join(",")'), 'a,b', 'column names parsed');
    eq(await ev('PV.app.active().df.dtype("a")'), 'int64', 'dtype inferred');
    eq(await ev("(function(){ PV.app.addDataset(PV.datasets.generate({ rows: 500, cols: 6, seed: 'e2e' }),"
      + " { name: 'random_e2e' }); return PV.app.active().df.nrows; })()"), 500, 'random data generator');
    await ev("PV.sourcePanel.loadText(PV.io.toCSVFrame(PV.datasets.build('retail')), { filename: 'roundtrip.csv' })");
    eq(await ev('PV.app.active().df.nrows'), 2614, 'CSV export + import round trip');
    eq(await ev('PV.app.active().df.dtype("date")'), 'datetime64[ns]', 'dates still detected after round trip');
    const beforeDrop = await ev('PV.app.state.datasets.length');
    await ev("(function(){ var f = new File(['x,y\\n1,2\\n3,4'], 'dropped.csv', { type: 'text/csv' });"
      + " var dt = new DataTransfer(); dt.items.add(f);"
      + " window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()");
    await app.settle(700);
    // a text file opens the parse dialog first (delimiter/header/type options)
    ok(await ev('!!document.querySelector(".dialog")'), 'dropping a text file opens the parse dialog');
    ok(await ev('!!document.querySelector(".parse-preview table")'), 'the dialog previews the parsed rows');
    const parsed = await ev("(function () { var b = document.querySelector('.dialog-footer .btn-primary');"
      + " b.click(); return true; })()");
    ok(parsed, 'confirming the dialog loads the data');
    await app.settle(800);
    ok(await ev('PV.app.state.datasets.length') === beforeDrop + 1, 'drag and drop loads a file');
    eq(await ev('PV.app.active().df.names.join(",")'), 'x,y', 'dropped file columns');

    await ev("PV.app.state.datasets.slice().forEach(function (d) { if (d.id !== 'retail') PV.app.removeDataset(d.id); });"
      + " PV.app.setActive('retail'); PV.app.state.pipelines.retail = []; PV.app.invalidate(); PV.app.emit();");
    await settle();
    eq(await ev('PV.app.state.datasets.length'), 1, 'back to the default dataset');

    console.log('\nevery tab');
    for (const t of ['table', 'profile', 'charts', 'group', 'code']) {
      await ev("PV.app.setTab('" + t + "')");
      await settle();
      ok(await ev('document.querySelectorAll(".view *").length > 20'), 'tab ' + t + ' has content');
    }
    await ev("PV.app.setTab('profile')");
    await app.settle(900);
    eq(await ev('document.querySelectorAll(".atlas-cell").length'), 16, 'column atlas: one thumbnail per column');
    ok(await ev('!!document.querySelector(".matrix-scroll svg")'), 'missing matrix drawn');
    ok(await ev('!!document.querySelector(".chart-heatmap")'), 'association matrix drawn');
    ok(await ev('document.querySelectorAll(".stat-card").length >= 4'), 'key number tiles');
    await ev("PV.app.setTab('charts')");
    await app.settle(700);
    ok(await ev('!!document.querySelector(".chart-svg")'), 'chart rendered');

    console.log('\nall operations in the browser');
    // multi-table operations need a second dataset to join with
    await ev("PV.app.loadSample('employees')");
    await app.settle(600);
    await ev("PV.app.setActive('retail')");
    const opIds = await ev('PV.ops.REGISTRY.map(function (d) { return d.id; })');
    const opFailures = [];
    for (const id of opIds) {
      await ev('PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate(); PV.app.emit()');
      const res = await ev("(function () {"
        + " try {"
        + "   var params = PV.ops.defaults('" + id + "', PV.app.result().df, PV.app.ctx());"
        + "   if ('" + id + "' === 'rename') params.pairs = [{ from: PV.app.result().df.names[0], to: 'renamed_col' }];"
        + "   PV.app.addStep('" + id + "', params);"
        + "   var out = PV.app.result();"
        + "   var stage = out.stages[out.stages.length - 1];"
        + "   PV.app.setTab(PV.app.tabForStep('" + id + "'));"
        + "   return { ok: stage.ok, rows: out.df.nrows, cols: out.df.ncols, error: stage.error || null };"
        + " } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()");
      if (!res.ok) opFailures.push(id + ': ' + res.error);
      await app.settle(60);
    }
    ok(opFailures.length === 0, 'every operation runs in the browser', opFailures);
    ok(opIds.length >= 24, 'operation count is ' + opIds.length);
    await ev("PV.app.state.datasets.slice().forEach(function (d) { if (d.id !== 'retail') PV.app.removeDataset(d.id); });"
      + " PV.app.setActive('retail'); PV.app.state.pipelines.retail = []; PV.app.invalidate(); PV.app.emit();");
    const codeFails = await ev("(function () {"
      + " var bad = []; var df = PV.datasets.build('retail');"
      + " PV.ops.REGISTRY.forEach(function (def) {"
      + "   try {"
      + "     var params = PV.ops.defaults(def.id, df, { datasets: PV.app.state.datasets, activeId: 'retail' });"
      + "     if (def.id === 'rename') params.pairs = [{ from: df.names[0], to: 'renamed_col' }];"
      + "     var built = PV.ops.buildCode(df, [{ id: 'x', type: def.id, params: params }],"
      + "       { datasets: PV.app.state.datasets, activeId: 'retail' });"
      + "     if (!built.steps[0].code.length) bad.push(def.id + ':empty');"
      + "     built.steps[0].code.forEach(function (line) {"
      + "       if (String(line).indexOf('undefined') >= 0) bad.push(def.id + ':undefined'); });"
      + "   } catch (e) { bad.push(def.id + ':' + e.message); }"
      + " }); return bad; })()");
    ok(codeFails.length === 0, 'every operation generates code', codeFails);

    console.log('\ntable interactions');
    await ev("PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate(); PV.app.setTab('table')");
    await settle();
    const firstBefore = await ev('document.querySelectorAll(".grid-row .cell-value")[8].textContent');
    await ev("document.querySelectorAll('.grid-head-btn')[10].click()");
    await settle();
    ok(await ev('!!document.querySelector(".chip-sort")'), 'header click shows a sort chip');
    const firstAfter = await ev('document.querySelectorAll(".grid-row .cell-value")[8].textContent');
    ok(firstBefore !== firstAfter, 'sorting changes the first row');
    await ev("(function () { var c = document.querySelectorAll('.grid-row .grid-cell')[3];"
      + " c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 300 })); })()");
    await app.settle(260);
    ok(await ev('!!document.querySelector(".menu")'), 'cell context menu opens');
    await ev('PV.ui.closeMenu()');
    await ev("document.querySelectorAll('.col-menu')[3].click()");
    await app.settle(260);
    const menuItems = await ev('document.querySelectorAll(".menu .menu-item").length');
    ok(menuItems >= 8, 'column menu has every action (' + menuItems + ')');
    await ev('PV.ui.closeMenu()');
    await ev('PV.app.state.table.heat = true; PV.app.emit()');
    await settle();
    ok(await ev('document.querySelectorAll(".cell-bar").length > 20'), 'data bars drawn');
    await ev("PV.app.state.table.density = 'compact'; PV.app.emit()");
    await settle();
    ok(await ev('!!document.querySelector(".table-wrap")'), 'compact density works');
    await ev("PV.app.state.table.density = 'normal'; PV.app.state.table.heat = false; PV.app.emit()");
    await settle();
    await ev("PV.app.state.pipelines[PV.app.state.activeId] = [{ id: 'f1', type: 'filter', enabled: true,"
      + " params: { mode: 'visual', match: 'all', conds: [{ col: 'region', op: 'eq', value: 'East', value2: '' }] } }];"
      + " PV.app.invalidate(); PV.app.emit()");
    await settle();
    ok(await ev('!!document.querySelector(".chip-filter")'), 'filter chip appears');
    ok(await ev('PV.app.result().df.nrows < 2614'), 'filter applied');
    await ev("document.querySelector('.chip-filter .chip-x').click()");
    await settle();
    eq(await ev('PV.app.steps().length'), 0, 'removing the chip removes the step');

    console.log('\nconsole');
    ok(app.errors.length === 0, 'no console errors in this half', app.errors.slice(0, 5));
  } catch (e) {
    failed += 1;
    failures.push('aborted: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  } finally {
    await app.close();
  }

  console.log('\n' + '-'.repeat(60));
  if (failed) {
    console.log(failed + ' failing checks:');
    failures.slice(0, 30).forEach(f => console.log('  x ' + f));
  }
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
