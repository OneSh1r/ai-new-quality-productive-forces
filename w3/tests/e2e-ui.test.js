/* =============================================================================
 * End-to-end sweep, part 2: chart types and interactions, the profile's
 * linkage, the summarise builders, joins, the code tab, exports, session
 * save/load, language + theme, shortcuts, responsive layout and the empty
 * state — all in a real browser.
 *
 *   node tests/e2e-ui.test.js
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

const ALL_TYPES = ['bar', 'hbar', 'line', 'area', 'scatter', 'bubble', 'density', 'hist',
  'box', 'violin', 'heatmap', 'parallel', 'pie', 'donut', 'ecdf', 'count'];

(async function run() {
  if (!cdp.findBrowser()) {
    console.log('no Chrome/Edge found - skipping');
    process.exit(0);
  }
  const app = await cdp.launch({ width: 1500, height: 940 });
  const ev = (expr) => app.evaluate(expr);
  const settle = () => app.settle(300);

  try {
    await app.settle(900);

    console.log('\nevery built-in sample loads');
    const sampleIds = await ev("PV.datasets.SAMPLES.map(function (s) { return s.id; })");
    for (const id of sampleIds) {
      await ev("PV.app.loadSample('" + id + "')");
      await app.settle(520);
      const r = await ev("(function () { var df = PV.app.active().df;"
        + " return { id: PV.app.state.activeId, rows: df.nrows, cols: df.ncols,"
        + "   grid: document.querySelectorAll('.grid-row').length }; })()");
      // loading a table that is already open gets a fresh id (retail -> retail_2)
      ok(r.id.indexOf(id) === 0 && r.rows > 0 && r.cols > 1 && r.grid > 0,
        'sample "' + id + '" loads and paints', r);
    }
    ok(sampleIds.length >= 5, 'the sample library ships five tables', sampleIds.length);
    await ev("PV.app.state.datasets.slice().forEach(function (d) { if (d.id !== 'retail') PV.app.removeDataset(d.id); });"
      + " PV.app.setActive('retail'); PV.app.state.pipelines = {}; PV.app.invalidate(); PV.app.emit()");
    await app.settle(600);

    await ev("PV.app.loadSample('employees')");
    await app.settle(600);
    await ev("PV.app.setActive('retail')");

    console.log('\ncharts: every type draws');
    await ev("PV.app.setTab('charts'); PV.app.state.chartAdvanced = true; PV.app.emit()");
    await settle();
    const chartFails = [];
    // line / area / ecdf are single-stroke charts: one path per series is a
    // complete drawing, so they only need one mark, everything else needs more
    const PATHY = ['line', 'ecdf', 'area'];
    for (const ty of ALL_TYPES) {
      const r = await ev("(function () {"
        + " var df = PV.app.result().df;"
        + " var numeric = df.numericColumns(), cats = df.categoricalColumns(), dates = df.dateColumns();"
        + " var spec = { type: '" + ty + "', x: cats[0] || df.names[0], y: [numeric[0]], agg: 'sum', color: null,"
        + "   size: null, sort: 'value_desc', limit: 12, stacked: false, horizontal: false, labels: false,"
        + "   smooth: false, trend: false, bins: null, corrMethod: 'pearson' };"
        + " if ('" + ty + "' === 'line' || '" + ty + "' === 'area') spec.x = dates[0] || spec.x;"
        + " if ('" + ty + "' === 'hist' || '" + ty + "' === 'ecdf') { spec.x = numeric[0]; spec.y = [numeric[0]]; }"
        + " if ('" + ty + "' === 'box' || '" + ty + "' === 'violin') { spec.x = cats[0]; spec.y = [numeric[0]]; }"
        + " if (['scatter','bubble','density'].indexOf('" + ty + "') >= 0) { spec.x = numeric[0]; spec.y = [numeric[1]]; }"
        + " if ('" + ty + "' === 'parallel') spec.y = numeric.slice(0, 4);"
        + " if ('" + ty + "' === 'heatmap') { spec.x = '__corr__'; spec.y = numeric.slice(0, 5); }"
        + " if ('" + ty + "' === 'count') { spec.x = cats[0]; spec.y = []; }"
        + " PV.app.state.charts.spec = spec; PV.app.emit();"
        + " var host = document.querySelector('.chart-box'); var svg = host ? host.querySelector('svg') : null;"
        + " return { svg: !!svg, empty: !!(host && host.querySelector('.chart-empty')),"
        + "   nan: svg ? ((svg.outerHTML.match(/NaN/g) || []).length) : -1,"
        + "   marks: svg ? svg.querySelectorAll('rect,path,circle').length : 0 }; })()");
      const need = PATHY.indexOf(ty) >= 0 ? 1 : 2;
      if (!r.svg || r.empty || r.marks < need || r.nan !== 0) chartFails.push(ty + ':' + JSON.stringify(r));
      await app.settle(160);
    }
    ok(chartFails.length === 0, 'all 16 chart types draw', chartFails);

    console.log('\nchart interactions become pipeline steps');
    const chartClick = await ev("(function () {"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + " PV.app.state.charts.spec = { type: 'bar', x: 'region', y: ['revenue'], agg: 'sum', color: null, size: null,"
      + "   sort: 'value_desc', limit: 12, stacked: false, horizontal: false, labels: false };"
      + " PV.app.emit(); var bar = document.querySelector('.chart-bar');"
      + " if (!bar) return { ok: false, why: 'no bar' };"
      + " bar.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 500, clientY: 300 }));"
      + " var tip = document.querySelector('.chart-box .chart-tip');"
      + " var tipText = tip ? tip.textContent : '';"
      + " var tipVisible = !!(tip && tip.classList.contains('is-visible'));"
      + " bar.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 500, clientY: 300 }));"
      + " var steps = PV.app.steps();"
      + " return { ok: true, type: steps[0] && steps[0].type, cond: steps[0] && steps[0].params.conds[0],"
      + "   tipText: tipText, tipVisible: tipVisible, rows: PV.app.result().df.nrows }; })()");
    ok(chartClick.ok && chartClick.type === 'filter', 'clicking a bar adds a filter step', chartClick);
    ok(chartClick.cond && chartClick.cond.col === 'region' && chartClick.cond.value === 'East',
      'the filter uses the category the bar stands for, not its measure', chartClick.cond);
    ok(chartClick.rows < 2614, 'the filter really reduces rows', chartClick);
    ok(chartClick.tipVisible && chartClick.tipText.indexOf('NaN') < 0 &&
      chartClick.tipText.indexOf('revenue') >= 0 && chartClick.tipText.indexOf('East') >= 0,
      'hovering a mark shows a tooltip naming the category and its measure', chartClick.tipText);
    const densityClick = await ev("(function () {"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + " PV.app.state.charts.spec = { type: 'density', x: 'revenue', y: ['profit'], color: null, size: null,"
      + "   agg: 'sum', sort: 'value_desc', limit: 12 };"
      + " PV.app.emit(); var cell = document.querySelector('.chart-cell');"
      + " if (!cell) return { ok: false, why: 'no cell' };"
      + " cell.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 500, clientY: 300 }));"
      + " var p = PV.app.steps()[0].params;"
      + " return { ok: true, conds: p.conds.length, rows: PV.app.result().df.nrows }; })()");
    ok(densityClick.ok && densityClick.conds === 2, 'a density cell filters both axes', densityClick);
    const brush = await ev("(function () {"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + " PV.app.state.charts.spec = { type: 'parallel', x: 'units', y: ['units','revenue','profit'],"
      + "   color: 'region', agg: 'sum', sort: 'value_desc', limit: 12, size: null, stacked: false,"
      + "   horizontal: false, labels: false };"
      + " PV.app.emit(); var svg = document.querySelector('.chart-box svg');"
      + " var strip = svg.querySelectorAll('.chart-axis-hit')[0]; var box = svg.getBoundingClientRect();"
      + " strip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: box.left + 120, clientY: box.top + 80 }));"
      + " document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: box.left + 120, clientY: box.top + 220 }));"
      + " document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: box.left + 120, clientY: box.top + 220 }));"
      + " var steps = PV.app.steps();"
      + " return { n: steps.length, type: steps.length ? steps[0].type : null,"
      + "   cond: steps.length ? steps[0].params.conds[0].op : null,"
      + "   rows: PV.app.result().df.nrows }; })()");
    ok(brush.type === 'filter' && brush.cond === 'between', 'dragging a parallel axis filters that dimension', brush);
    const legend = await ev("(function () {"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + " PV.app.state.charts.spec = { type: 'bar', x: 'region', y: ['revenue'], color: 'channel', agg: 'sum',"
      + "   sort: 'value_desc', limit: 12, stacked: false, horizontal: false, labels: false, size: null };"
      + " PV.app.emit(); var item = document.querySelector('.legend-item');"
      + " if (!item) return { ok: false, why: 'no legend' };"
      + " item.dispatchEvent(new MouseEvent('click', { bubbles: true }));"
      + " return { ok: true, off: document.querySelector('.legend-item').className.indexOf('is-off') >= 0 }; })()");
    ok(legend.ok && legend.off, 'the legend hides a series', legend);
    const exportChart = await ev("(function () {"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + " PV.app.state.charts.spec = { type: 'bar', x: 'region', y: ['revenue'], agg: 'sum', color: null,"
      + "   size: null, sort: 'value_desc', limit: 12, stacked: false, horizontal: false, labels: false };"
      + " PV.app.emit();"
      + " var svg = document.querySelector('.chart-box svg');"
      + " var text = PV.charts.toSVGString(svg);"
      + " return { len: text.length, hasSvg: text.indexOf('<svg') >= 0,"
      + "   rects: (text.match(/<rect/g) || []).length, domRects: svg.querySelectorAll('rect').length }; })()");
    ok(exportChart.hasSvg && exportChart.len > 1200 && exportChart.rects === exportChart.domRects && exportChart.rects >= 3,
      'chart exports to SVG text with every mark', exportChart);

    console.log('\nevery mark family is hoverable and clickable');
    const family = await ev("(function () {"
      + " function hoverData(host, node, cx, cy) {"
      + "   node.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: cx, clientY: cy }));"
      + "   node.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));"
      + "   var tip = host.querySelector('.chart-tip');"
      + "   return tip && tip.classList.contains('is-visible') ? tip.textContent : ''; }"
      + " function grid(host, node, svg) {"
      + "   var box = svg.getBoundingClientRect(); var vb = svg.viewBox.baseVal;"
      + "   var sc = box.width / vb.width, hit = null;"
      + "   for (var gy = 8; gy < vb.height - 8 && !hit; gy += 22) {"
      + "     for (var gx = 20; gx < vb.width - 10 && !hit; gx += 30) {"
      + "       var t = hoverData(host, node, box.left + gx * sc, box.top + gy * sc);"
      + "       if (t) hit = { x: box.left + gx * sc, y: box.top + gy * sc, text: t }; } }"
      + "   return hit; }"
      + " var out = {};"
      + " var specs = { pie: { type: 'pie', x: 'channel', y: ['revenue'], agg: 'sum', limit: 6 },"
      + "   box: { type: 'box', x: 'region', y: ['revenue'], agg: 'sum', limit: 6 },"
      + "   lineCat: { type: 'line', x: 'category', y: ['revenue'], agg: 'sum', limit: 0 },"
      + "   dense: { type: 'scatter', x: 'discount', y: ['profit'], limit: 0 } };"
      + " Object.keys(specs).forEach(function (name) {"
      + "   PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + "   PV.app.state.charts.spec = specs[name]; PV.app.emit();"
      + "   var host = document.querySelector('.chart-box');"
      + "   var svg = host.querySelector('svg');"
      + "   var node = host.querySelector('.chart-slice, .chart-box-hit, .chart-hit, .chart-dot');"
      + "   if (!node) { out[name] = { why: 'no mark' }; return; }"
      + "   var info;"
      + "   if (node.classList.contains('chart-hit')) info = grid(host, node, svg);"
      + "   else { var t = hoverData(host, node, 500, 300); info = t ? { x: 500, y: 300, text: t } : null; }"
      + "   out[name] = { hover: info ? info.text : '', xs: !!host.querySelector('rect[fill=\"transparent\"], circle, path, rect'),"
      + "     nan: (svg.outerHTML.match(/NaN/g) || []).length };"
      + "   if (info) {"
      + "     node.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: info.x, clientY: info.y }));"
      + "     var st = PV.app.steps();"
      + "     out[name].step = st.length ? st[0].type : null;"
      + "     out[name].cond = st.length && st[0].params.conds ? st[0].params.conds[0] : null;"
      + "     out[name].inspector = PV.app.state.inspector.kind;"
      + "     PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + "   }"
      + " });"
      + " return out; })()");
    ok(family.pie.hover.indexOf('NaN') < 0 && family.pie.hover.indexOf('channel') >= 0,
      'a pie slice names its category', family.pie);
    ok(family.pie.step === 'filter' && family.pie.cond.col === 'channel',
      'clicking a pie slice filters that channel', family.pie);
    ok(family.box.hover.indexOf('NaN') < 0 && family.box.hover.indexOf('revenue') >= 0,
      'a box plot names the column it summarises', family.box);
    ok(family.box.step === 'filter' && family.box.cond.col === 'region' && family.box.cond.value,
      'clicking a box filters its category, not its median', family.box);
    ok(family.lineCat.xs && family.lineCat.nan === 0 && family.lineCat.hover.indexOf('category') >= 0,
      'a line over categories draws real geometry and stays hoverable', family.lineCat);
    ok(family.lineCat.step === 'filter' && family.lineCat.cond.col === 'category',
      'clicking a categorical line point filters its category', family.lineCat);
    ok(family.dense.xs && family.dense.nan === 0 && family.dense.hover.indexOf('profit') >= 0,
      'a dense scatter is still hoverable through the shared hit overlay', family.dense);
    ok(family.dense.step === null && family.dense.inspector === 'point',
      'clicking a dense scatter point inspects the row instead of filtering', family.dense);
    const pointRows = await ev("Array.prototype.map.call(document.querySelectorAll('.panel-inspector .ins-row'),"
      + " function (r) { return r.textContent; })");
    ok(pointRows.length >= 2 && pointRows.some(function (r) { return r.indexOf('profit') === 0; }),
      'the point inspector shows the x and y of the clicked point', pointRows);
    await ev("PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate(); PV.app.emit()");

    console.log('\nprofile linkage');
    await ev("PV.app.setTab('profile')");
    await app.settle(900);
    const atlas = await ev("(function () {"
      + " document.querySelectorAll('.atlas-cell')[8].click();"
      + " return { focus: PV.app.state.focus.col, inspector: PV.app.state.inspector.payload.col,"
      + "   chip: !!document.querySelector('.focus-chip') }; })()");
    ok(!!atlas.focus && atlas.focus === atlas.inspector && atlas.chip,
      'clicking an atlas thumbnail focuses the column (chip + inspector)', atlas);
    const vcClick = await ev("(function () {"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + " var bar = document.querySelector('.center .chart-bar'); if (!bar) return { ok: false };"
      + " bar.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 500, clientY: 400 }));"
      + " var steps = PV.app.steps();"
      + " return { ok: true, type: steps.length ? steps[0].type : null,"
      + "   cond: steps.length ? steps[0].params.conds[0] : null, rows: PV.app.result().df.nrows }; })()");
    ok(vcClick.ok && vcClick.type === 'filter' && vcClick.cond && vcClick.cond.value,
      'clicking a value-counts bar filters that value', vcClick);
    ok(vcClick.rows > 0 && vcClick.rows < 2614, 'the value-counts filter really selects rows', vcClick.rows);
    const vcMenu = await ev("(function () {"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate(); PV.app.emit();"
      + " var bar = document.querySelector('.center .chart-bar');"
      + " bar.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 500, clientY: 400 }));"
      + " var items = document.querySelectorAll('.menu .menu-item').length;"
      + " document.body.click();"
      + " return items; })()");
    ok(vcMenu >= 3, 'right-clicking a value-counts bar offers actions', vcMenu);
    await ev("PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate(); PV.app.emit()");
    const corr = await ev("(function () {"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate(); PV.app.emit();"
      + " var cells = document.querySelectorAll('.chart-heatmap rect');"
      + " if (!cells.length) return { ok: false };"
      + " cells[Math.floor(cells.length / 2)].dispatchEvent(new MouseEvent('click', { bubbles: true }));"
      + " return { ok: true, tab: PV.app.state.tab, type: PV.app.state.charts.spec.type }; })()");
    ok(corr.ok, 'clicking a correlation square reacts', corr);
    const useCol = await ev("(function () {"
      + " PV.app.setTab('table'); PV.app.emit();"
      + " PV.app.setInspector('column', { col: 'units' });"
      + " var buttons = Array.prototype.slice.call(document.querySelectorAll('.ins-actions .btn'));"
      + " var axis = buttons.filter(function (b) { return b.textContent.indexOf('X') >= 0; })[0];"
      + " axis.click();"
      + " return { n: buttons.length, tab: PV.app.state.tab, x: PV.app.state.charts.spec.x }; })()");
    ok(useCol.n >= 6 && useCol.tab === 'charts' && useCol.x === 'units',
      'the inspector sends a column to a chart axis', useCol);
    const groupUse = await ev("(function () {"
      + " PV.app.setTab('table'); PV.app.emit();"
      + " PV.app.setInspector('column', { col: 'channel' });"
      + " var btn = Array.prototype.slice.call(document.querySelectorAll('.ins-actions .btn'))"
      + "   .filter(function (b) { return b.textContent.indexOf('分组') >= 0; })[0];"
      + " btn.click();"
      + " return { tab: PV.app.state.tab, keys: PV.app.state.group.keys.join(',') }; })()");
    ok(groupUse.tab === 'group' && groupUse.keys === 'channel', 'the inspector sends a column to group-by', groupUse);

    console.log('\nsummarise builders');
    await settle();
    const sections = await ev("(function () {"
      + " var heads = [], marks = [];"
      + " function head() { return document.querySelector('.center .panel-head .panel-title span').textContent; }"
      + " function on() { var e = document.querySelector('.center .section-tab.is-on'); return e ? e.textContent : ''; }"
      + " document.querySelectorAll('.center .section-tab')[1].click(); heads.push(head()); marks.push(on());"
      + " document.querySelectorAll('.center .section-tab')[2].click(); heads.push(head()); marks.push(on());"
      + " document.querySelectorAll('.center .section-tab')[0].click(); heads.push(head()); marks.push(on());"
      + " return { heads: heads, marks: marks }; })()");
    ok(sections.heads[0].indexOf('透视') >= 0 && sections.heads[1].indexOf('交叉') >= 0 &&
      sections.heads[2].indexOf('分组') >= 0,
      'the three summarise builders switch', sections.heads);
    ok(sections.marks.every(function (m, i) { return m === sections.heads[i]; }),
      'the clicked tab is marked active, so a click visibly lands', sections.marks);

    const perBuilder = await ev("(function () {"
      + " var out = [];"
      + " [[1, 'pivot'], [2, 'crosstab'], [0, 'groupby']].forEach(function (pair) {"
      + "   document.querySelectorAll('.center .section-tab')[pair[0]].click();"
      + "   var head = document.querySelector('.center .panel-title span').textContent;"
      + "   var preview = document.querySelectorAll('.center .builder-preview table, .center .builder-preview svg,"
      + " .center .group-chart svg').length;"
      + "   var err = document.querySelectorAll('.center .form-error').length;"
      + "   var btn = Array.prototype.filter.call(document.querySelectorAll('.center .panel-foot .btn'),"
      + "     function (b) { return b.textContent.indexOf('流水线') >= 0; })[0];"
      + "   if (!btn) { out.push({ head: head, why: 'no apply button' }); return; }"
      + "   btn.click();"
      + "   var steps = PV.app.steps();"
      + "   out.push({ head: head, preview: preview, err: err, want: pair[1],"
      + "     got: steps.length ? steps[0].type : null, rows: PV.app.result().df.nrows,"
      + "     flow: document.querySelectorAll('.step').length,"
      + "     toast: document.querySelectorAll('.toast').length });"
      + "   PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate(); PV.app.emit();"
      + " });"
      + " return out; })()");
    ok(perBuilder.length === 3, 'all three builders were exercised', perBuilder.length);
    perBuilder.forEach(function (b) {
      ok(b.got === b.want && b.rows > 0 && b.flow === 1 && b.toast >= 1 && b.err === 0 && b.preview >= 1,
        'the ' + b.want + ' builder previews, applies and reports back', b);
    });

    await settle();
    const applied = await ev("(function () {"
      + " var btn = Array.prototype.slice.call(document.querySelectorAll('.center .panel-foot .btn'))"
      + "   .filter(function (b) { return b.textContent.indexOf('流水线') >= 0; })[0];"
      + " if (!btn) return { ok: false };"
      + " btn.click(); var steps = PV.app.steps();"
      + " var flow = document.querySelectorAll('.step').length;"
      + " return { ok: true, type: steps[0] && steps[0].type, flow: flow, rows: PV.app.result().df.nrows }; })()");
    ok(applied.ok && applied.type === 'groupby' && applied.flow === 1, 'adding the summary to the pipeline works', applied);
    const stepCode = await ev("(function () {"
      + " var id = PV.app.steps()[0].id; PV.app.state.expandedSteps[id] = true; PV.app.emit();"
      + " var box = document.querySelector('.step-code-box');"
      + " return { open: !!box, text: box ? box.textContent.slice(0, 60) : '' }; })()");
    ok(stepCode.open && stepCode.text.indexOf('groupby') >= 0, 'a pipeline step expands to its pandas line', stepCode);
    const removed = await ev("(function () {"
      + " var id = PV.app.steps()[0].id; delete PV.app.state.expandedSteps[id];"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate(); PV.app.emit();"
      + " return PV.app.steps().length; })()");
    eq(removed, 0, 'pipeline cleared');

    console.log('\njoin and concat');
    const merge = await ev("(function () {"
      + " PV.app.setTab('combine');"
      + " var btn = Array.prototype.slice.call(document.querySelectorAll('.panel-foot .btn'))"
      + "   .filter(function (b) { return /合并|Join/.test(b.textContent); })[0];"
      + " if (!btn) return { ok: false, why: 'no button' };"
      + " btn.click(); var steps = PV.app.steps();"
      + " return { ok: true, type: steps[0] && steps[0].type,"
      + "   hasManager: PV.app.result().df.has('manager'),"
      + "   report: !!document.querySelector('.match-report'), rows: PV.app.result().df.nrows }; })()");
    ok(merge.ok && merge.type === 'merge' && merge.hasManager === true, 'join works', merge);
    ok(merge.report === true, 'match report is shown');
    eq(merge.rows, 2614, 'left join keeps the row count');
    const concat = await ev("(function () {"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate(); PV.app.emit();"
      + " var btn = Array.prototype.slice.call(document.querySelectorAll('.panel-foot .btn'))"
      + "   .filter(function (b) { return /追加|Append/.test(b.textContent); })[0];"
      + " if (!btn) return { ok: false, why: 'no button' };"
      + " btn.click(); var steps = PV.app.steps();"
      + " return { ok: true, type: steps[0] && steps[0].type, rows: PV.app.result().df.nrows }; })()");
    ok(concat.ok && concat.type === 'concat' && concat.rows > 2614, 'append rows works', concat);
    await ev("PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate(); PV.app.emit()");

    console.log('\nundo and redo are visible, labelled and repeatable');
    const undoHead = await ev("(function () {"
      + " PV.app.resetHistory();"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate(); PV.app.emit();"
      + " PV.app.addStep('filter', { mode: 'visual', match: 'all', conds: [{ col: 'region', op: 'eq', value: 'East', value2: '' }] });"
      + " PV.app.addStep('sort', { by: ['revenue'], ascending: [false] });"
      + " PV.app.addStep('sample', { mode: 'head', n: 200, n2: 200, seed: '1' });"
      + " var u = document.querySelector('.panel-pipeline .btn-undo');"
      + " var r = document.querySelector('.panel-pipeline .btn-redo');"
      + " return { steps: PV.app.steps().length, rows: PV.app.result().df.nrows,"
      + "   undoLabel: u ? u.textContent.replace(/[^\\u4e00-\\u9fa5]/g, '') : '',"
      + "   undoTitle: u ? u.getAttribute('title') : '', undoDisabled: u ? u.disabled : null,"
      + "   redoDisabled: r ? r.disabled : null,"
      + "   hint: (document.querySelector('.panel-pipeline .undo-hint') || {}).textContent || '',"
      + "   quickCount: document.querySelectorAll('.panel-pipeline .panel-actions .btn').length }; })()");
    eq(undoHead.steps, 3, 'three steps are in the pipeline');
    ok(undoHead.undoLabel.indexOf('撤销') >= 0 && undoHead.undoDisabled === false,
      'the undo button is labelled and enabled', undoHead.undoLabel);
    ok(undoHead.undoTitle.indexOf('撤销') === 0 && undoHead.undoTitle.indexOf('采样') > 0,
      'its tooltip names the action that will be taken back', undoHead.undoTitle);
    eq(undoHead.redoDisabled, true, 'redo starts disabled');
    ok(undoHead.hint.indexOf('采样') > 0, 'the panel names the last action', undoHead.hint);
    ok(undoHead.quickCount >= 2, 'undo and redo are both visible in the panel head', undoHead.quickCount);

    const pressZ = "(function () { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));"
      + " var u = document.querySelector('.panel-pipeline .btn-undo');"
      + " var r = document.querySelector('.panel-pipeline .btn-redo');"
      + " return { steps: PV.app.steps().length, rows: PV.app.result().df.nrows,"
      + "   undoDisabled: u.disabled, redoDisabled: r.disabled,"
      + "   redoTitle: r.getAttribute('title') }; })()";
    const chain = [];
    for (let i = 0; i < 3; i++) {
      chain.push(await ev(pressZ));
      await app.settle(140);
    }
    eq(chain[0].steps, 2, 'first undo drops the last step');
    eq(chain[1].steps, 1, 'second undo drops another step');
    eq(chain[2].steps, 0, 'third undo empties the pipeline');
    ok(chain.every(function (c) { return c.redoDisabled === false; }),
      'redo stays available after every single undo', chain.map(function (c) { return c.redoDisabled; }));
    ok(chain[0].redoTitle.indexOf('重做') === 0 && chain[0].redoTitle.indexOf('采样') > 0,
      'the redo tooltip names what would come back', chain[0].redoTitle);
    eq(chain[2].rows, 2614, 'undoing everything returns the full table');
    const toastText = await ev("Array.prototype.map.call(document.querySelectorAll('.toast'),"
      + " function (t) { return t.textContent; }).slice(-1)[0]");
    ok(toastText.indexOf('已撤销') >= 0 && toastText.indexOf('条件筛选') > 0,
      'the undo toast says what was taken back', toastText);
    const noop = await ev(pressZ);
    eq(noop.steps, 0, 'an undo with an empty history changes nothing');
    ok(await ev("Array.prototype.map.call(document.querySelectorAll('.toast'), function (t) { return t.textContent; })"
      + ".slice(-1)[0].indexOf('暂不可用') >= 0"), 'and it says so instead of failing silently');

    const redoTwice = await ev("(function () {"
      + " var out = [];"
      + " for (var i = 0; i < 2; i++) {"
      + "   var r = document.querySelector('.panel-pipeline .btn-redo');"
      + "   if (r.disabled) { out.push('disabled'); break; }"
      + "   r.click(); out.push(PV.app.steps().length); }"
      + " return out; })()");
    eq(redoTwice.join(','), '1,2', 'redoing twice by clicking the button works');
    const mixed = await ev("(function () {"
      + " document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, bubbles: true }));"
      + " var upper = PV.app.steps().length;"
      + " document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));"
      + " return { upper: upper, shifted: PV.app.steps().length }; })()");
    eq(mixed.upper, 1, 'Caps Lock (uppercase Z) still undoes');
    eq(mixed.shifted, 2, 'Ctrl+Shift+Z redoes');
    await ev("PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate(); PV.app.emit()");

    console.log('\nmultiple data sources: switching, renaming, deleting');
    await ev("PV.app.loadSample('iris'); PV.app.loadSample('air')");
    await app.settle(600);
    const listBefore = await ev("(function () {"
      + " return { n: PV.app.state.datasets.length, prefix: PV.app.state.activeId,"
      + "   rows: document.querySelectorAll('.side .ds-row').length,"
      + "   ids: PV.app.state.datasets.map(function (d) { return d.id; }),"
      + "   names: Array.prototype.map.call(document.querySelectorAll('.side .ds-row .ds-name'), function (x) { return x.textContent; }),"
      + "   delButtons: document.querySelectorAll('.side .ds-row .ds-del').length,"
      + "   marks: Array.prototype.map.call(document.querySelectorAll('.side .ds-row'), function (r) { return r.classList.contains('is-active'); }) }; })()");
    ok(listBefore.n === 4 && listBefore.delButtons === 4,
      'every dataset row carries its own delete button', listBefore);
    const switched = await ev("(function () {"
      + " var want = PV.app.state.datasets[1].id;"
      + " var wantRows = PV.app.state.datasets[1].df.nrows;"
      + " document.querySelectorAll('.side .ds-row')[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));"
      + " return JSON.stringify({ want: want, wantRows: wantRows, active: PV.app.state.activeId,"
      + "   rows: PV.app.result().df.nrows,"
      + "   marks: Array.prototype.map.call(document.querySelectorAll('.side .ds-row'), function (r) { return r.classList.contains('is-active'); }),"
      + "   shape: document.querySelector('.shape-rows').textContent }); })()").then(JSON.parse);
    await app.settle(300);
    const marksAfter = await ev("Array.prototype.map.call(document.querySelectorAll('.side .ds-row'), function (r) { return r.classList.contains('is-active'); })");
    ok(switched.active === switched.want && switched.rows === switched.wantRows,
      'clicking a dataset row switches the active table', switched);
    ok(marksAfter[1] === true && marksAfter.filter(Boolean).length === 1,
      'the highlight follows the click instead of staying on the old row', marksAfter);
    eq(switched.shape, String(switched.wantRows), 'the header shape chip follows the switch');

    const renameRun = await ev("(function () {"
      + " var btn = document.querySelectorAll('.side .ds-row')[1].querySelector('.ds-more');"
      + " btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));"
      + " var item = Array.prototype.filter.call(document.querySelectorAll('.menu .menu-item'),"
      + "   function (m) { return m.textContent.indexOf('重命名') >= 0; })[0];"
      + " if (!item) return { ok: false };"
      + " item.click();"
      + " var input = document.querySelector('.dialog input');"
      + " input.value = '改名后的表';"
      + " var ok = document.querySelector('.dialog-footer .btn-primary');"
      + " ok.click();"
      + " return { ok: true }; })()");
    await app.settle(300);
    const renameVisible = await ev("Array.prototype.map.call(document.querySelectorAll('.side .ds-row .ds-name'), function (x) { return x.textContent; })");
    ok(renameRun.ok && renameVisible.indexOf('改名后的表') >= 0,
      'renaming a dataset updates the list straight away', renameVisible);

    const deleteStart = await ev("(function () {"
      + " return { n: PV.app.state.datasets.length, rows: PV.app.state.datasets[1].df.nrows,"
      + "   id: PV.app.state.datasets[1].id, label: PV.app.datasetLabel(PV.app.state.datasets[1]) }; })()");
    const asked = await ev("(function () {"
      + " document.querySelectorAll('.side .ds-row .ds-del')[1].click();"
      + " var d = document.querySelector('.dialog');"
      + " return { open: !!d, text: d ? d.textContent : '',"
      + "   confirmLabel: d ? d.querySelector('.dialog-footer .btn-primary').textContent : '' }; })()");
    ok(asked.open && asked.text.indexOf('移除') >= 0 && asked.text.indexOf(deleteStart.label) >= 0,
      'deleting asks first and names the dataset', asked.text.slice(0, 60));
    await ev("document.querySelector('.dialog-footer .btn-primary').click()");
    await app.settle(500);
    const afterDelete = await ev("(function () {"
      + " return { n: PV.app.state.datasets.length,"
      + "   rows: document.querySelectorAll('.side .ds-row').length,"
      + "   toast: Array.prototype.map.call(document.querySelectorAll('.toast'), function (t) { return t.textContent; }).slice(-1)[0],"
      + "   action: (document.querySelectorAll('.toast .toast-action')[0] || {}).textContent || '' }; })()");
    eq(afterDelete.n, deleteStart.n - 1, 'confirming removes the dataset');
    eq(afterDelete.rows, deleteStart.n - 1, 'the list re-renders without it');
    ok(afterDelete.toast.indexOf('已移除数据集') >= 0 && afterDelete.action.indexOf('撤销') >= 0,
      'the removal toast offers an undo', afterDelete);

    await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))");
    await app.settle(500);
    const restored = await ev("(function () {"
      + " var ds = PV.app.state.datasets[1];"
      + " return { n: PV.app.state.datasets.length, rows: ds ? ds.df.nrows : 0,"
      + "   id: ds ? ds.id : '', label: ds ? PV.app.datasetLabel(ds) : '',"
      + "   dom: document.querySelectorAll('.side .ds-row').length,"
      + "   toast: Array.prototype.map.call(document.querySelectorAll('.toast'), function (t) { return t.textContent; }).slice(-1)[0] }; })()");
    eq(restored.n, deleteStart.n, 'undo brings the dataset back');
    eq(restored.rows, deleteStart.rows, 'with its rows intact');
    eq(restored.id, deleteStart.id, 'and in its original position');
    eq(restored.dom, deleteStart.n, 'and it is back in the list');
    ok(restored.toast.indexOf('已撤销') >= 0 && restored.toast.indexOf('移除数据集') > 0,
      'the undo toast names the dataset action', restored.toast);

    // the row itself switches tables, so the row tools must not bubble
    const strayClick = await ev("(function () {"
      + " var before = PV.app.state.activeId;"
      + " document.querySelectorAll('.side .ds-row .ds-del')[2].click();"
      + " var switched = PV.app.state.activeId;"
      + " var d = document.querySelector('.dialog');"
      + " if (d) Array.prototype.filter.call(d.querySelectorAll('.dialog-footer .btn'),"
      + "   function (b) { return !b.classList.contains('btn-primary'); })[0].click();"
      + " return { before: before, after: switched }; })()");
    eq(strayClick.after, strayClick.before,
      'clicking a row tool does not switch the active table');
    await app.settle(300);
    eq(await ev("PV.app.state.datasets.length"), deleteStart.n,
      'cancelling the confirmation keeps the dataset');

    await ev("(function () {"
      + " PV.app.state.datasets.slice().forEach(function (d) {"
      + "   if (['retail', 'employees'].indexOf(d.id) < 0) PV.app.removeDataset(d.id); });"
      + " PV.app.setActive('retail'); PV.app.state.pipelines[PV.app.state.activeId] = [];"
      + " PV.app.invalidate(); PV.app.emit(); })()");
    await app.settle(500);
    ok(await ev("PV.app.state.datasets.length === 2 && PV.app.state.activeId === 'retail'"),
      'back to the two tables the later checks need');

    console.log('\ncode tab');
    // a pipeline that touches both tables, so the script has to load both
    await ev("PV.app.addStep('groupby', PV.ops.defaults('groupby', PV.app.result().df, PV.app.ctx()));"
      + " PV.app.addStep('merge', { other: 'employees', how: 'left', leftOn: ['region'], rightOn: ['region'],"
      + "   suffixes: '_x, _y', indicator: false });"
      + " PV.app.setTab('code')");
    await app.settle(700);
    const code = await ev("document.querySelector('.code-block').textContent");
    ok(code.indexOf('import pandas as pd') >= 0, 'imports present');
    ok(code.indexOf('print(df.shape)') >= 0, 'the script is verifiable');
    ok(code.indexOf('employees') >= 0, 'the second table is loaded in the script');
    const codeSteps = await ev("(function () {"
      + " var block = document.querySelector('.code-block').textContent;"
      + " return { groups: (block.match(/groupby/g) || []).length, merges: (block.match(/merge/g) || []).length,"
      + "   backtrack: document.querySelectorAll('.code-step').length,"
      + "   buttons: document.querySelectorAll('.code-step-head .btn').length }; })()");
    ok(codeSteps.groups >= 1 && codeSteps.merges >= 1 && codeSteps.backtrack === 2,
      'every pipeline step gets its own line in the script', codeSteps);
    const renamed = await ev("(function () {"
      + " PV.app.state.code.varName = 'sales'; PV.app.emit();"
      + " var t = document.querySelector('.code-block').textContent;"
      + " var out = { sales: t.indexOf('sales.groupby') >= 0 || t.indexOf('sales[') >= 0, df: t.indexOf('df[') >= 0 };"
      + " PV.app.state.code.varName = 'df'; PV.app.emit(); return out; })()");
    ok(renamed.sales && !renamed.df, 'the dataframe variable name is honoured', renamed);
    await ev("PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate(); PV.app.emit()");

    console.log('\nexports, session, language, theme, help, shortcuts');
    const exp = await ev("(function () {"
      + " var captured = []; var orig = PV.util.download;"
      + " PV.util.download = function (name, content) {"
      + "   captured.push({ name: name, size: (content && content.size) || String(content).length }); };"
      + " try { PV.sourcePanel.exportFrame(PV.app.result().df, 'result.csv'); }"
      + " catch (e) { PV.util.download = orig; return { ok: false, error: String(e && e.message) }; }"
      + " PV.util.download = orig;"
      + " return { ok: true, downloads: captured.slice() }; })()");
    ok(exp.ok && exp.downloads.length === 1 && exp.downloads[0].name.indexOf('.csv') >= 0,
      'the current result exports to CSV', exp);

    console.log('\nsession round trip through the app itself');
    const roundSave = await ev("(function () {"
      + " PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate();"
      + " PV.app.addStep('groupby', PV.ops.defaults('groupby', PV.app.result().df, PV.app.ctx()));"
      + " window.__pvExportButton = function () {"
      + "   return Array.prototype.filter.call(document.querySelectorAll('.topbar-right .btn'),"
      + "     function (b) { return !b.classList.contains('btn-icon'); })[0]; };"
      + " window.__pvItemNamed = function (re) {"
      + "   return Array.prototype.filter.call(document.querySelectorAll('.menu .menu-item'),"
      + "     function (m) { return re.test(m.textContent); })[0]; };"
      + " window.__pvSaved = null;"
      + " PV.util.download = function (name, content) { window.__pvSaved = content; };"
      + " __pvExportButton().click();"
      + " var save = __pvItemNamed(/保存会话|Save session/);"
      + " if (!save) return { ok: false, why: 'no save item',"
      + "   menu: Array.prototype.map.call(document.querySelectorAll('.menu .menu-item'), function (m) { return m.textContent; }) };"
      + " save.click();"
      + " var before = { datasets: PV.app.state.datasets.length, steps: PV.app.steps().length,"
      + "   active: PV.app.state.activeId, rows: PV.app.result().df.nrows, cols: PV.app.result().df.ncols };"
      + " if (!window.__pvSaved) return { ok: false, why: 'nothing downloaded' };"
      + " PV.app.state.datasets.slice().forEach(function (d) { PV.app.removeDataset(d.id); });"
      + " PV.app.emit();"
      + " window.__pvOrigClick = HTMLInputElement.prototype.click;"
      + " HTMLInputElement.prototype.click = function () {"
      + "   if (this.type !== 'file') return window.__pvOrigClick.call(this);"
      + "   var dt = new DataTransfer();"
      + "   dt.items.add(new File([window.__pvSaved], 'session.json', { type: 'application/json' }));"
      + "   Object.defineProperty(this, 'files', { value: dt.files, configurable: true });"
      + "   window.__pvOrigClick.call(this);"
      + "   this.dispatchEvent(new Event('change', { bubbles: true }));"
      + "   return undefined; };"
      + " __pvExportButton().click();"
      + " var load = __pvItemNamed(/载入会话|Load session/);"
      + " if (!load) { HTMLInputElement.prototype.click = window.__pvOrigClick; return { ok: false, why: 'no load item' }; }"
      + " load.click();"
      + " HTMLInputElement.prototype.click = window.__pvOrigClick;"
      + " return { ok: true, before: before, size: window.__pvSaved.length,"
      + "   wiped: PV.app.state.datasets.length }; })()");
    await app.settle(700);
    const round = {
      ok: roundSave.ok,
      before: roundSave.before,
      size: roundSave.size,
      after: await ev("JSON.stringify({ datasets: PV.app.state.datasets.length, steps: PV.app.steps().length,"
        + " active: PV.app.state.activeId, rows: PV.app.result().df.nrows, cols: PV.app.result().df.ncols })").then(JSON.parse),
      names: await ev("PV.app.state.datasets.map(function (d) { return d.name; }).join('|')")
    };
    ok(round.ok, 'the session menu offers save and load', round);
    ok(round.ok && round.after.datasets === round.before.datasets && round.after.rows === round.before.rows &&
      round.after.cols === round.before.cols && round.after.active === round.before.active &&
      round.after.steps === round.before.steps,
      'saving and re-loading a session restores data, pipeline and shapes', round);
    ok(round.ok && round.size > 500, 'the session file is written to disk', round && round.size);
    await ev("PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate(); PV.app.emit()");

    const lang = await ev("(function () {"
      + " function seg(label) { return Array.prototype.slice.call(document.querySelectorAll('.segmented .seg'))"
      + "   .filter(function (s) { return s.textContent === label; })[0]; }"
      + " seg('EN').click(); var en = document.querySelector('.brand-sub').textContent;"
      + " seg('中文').click(); var zh = document.querySelector('.brand-sub').textContent;"
      + " return { en: en, zh: zh }; })()");
    ok(/data|visual/i.test(lang.en), 'english switch works', lang.en);
    ok(lang.zh.indexOf('图形') >= 0, 'chinese switch works', lang.zh);
    const theme = await ev("(function () {"
      + " var before = document.documentElement.getAttribute('data-theme');"
      + " var b = document.querySelector('.topbar-right .btn-icon'); b.click();"
      + " var mid = document.documentElement.getAttribute('data-theme');"
      + " document.querySelector('.topbar-right .btn-icon').click();"
      + " return { before: before, mid: mid, back: document.documentElement.getAttribute('data-theme') }; })()");
    ok(theme.before !== theme.mid && theme.back === theme.before, 'theme toggle works', theme);
    const help = await ev("(function () {"
      + " document.querySelectorAll('.topbar-right .btn-icon')[1].click();"
      + " var d = document.querySelector('.dialog');"
      + " var text = d ? d.textContent : '';"
      + " if (d) d.querySelector('.dialog-footer .btn').click();"
      + " return { open: !!d, shortcuts: text.indexOf('Ctrl') >= 0 }; })()");
    ok(help.open && help.shortcuts, 'help dialog works', help);
    const shortcuts = await ev("(function () {"
      + " PV.app.addStep('sample', { mode: 'head', n: 20, n2: 20, seed: '1' });"
      + " var a = PV.app.steps().length;"
      + " document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));"
      + " var b = PV.app.steps().length;"
      + " document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));"
      + " var c = PV.app.steps().length;"
      + " document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));"
      + " var focus = document.activeElement ? document.activeElement.className : '';"
      + " return { a: a, b: b, c: c, focus: focus }; })()");
    ok(shortcuts.a === 1 && shortcuts.b === 0 && shortcuts.c === 1, 'undo/redo shortcuts', shortcuts);
    ok(shortcuts.focus.indexOf('search') >= 0, 'ctrl+F focuses the search box', shortcuts.focus);
    await ev("PV.app.state.pipelines[PV.app.state.activeId] = []; PV.app.invalidate(); PV.app.emit()");

    console.log('\nresponsive layout');
    await ev("PV.app.setTab('table'); PV.app.emit()");
    await app.settle(600);
    for (const size of [[1280, 860], [1024, 900], [820, 900]]) {
      await app.setViewport(size[0], size[1]);
      await app.settle(700);
      const r = await ev("(function () { var v = document.querySelector('.view');"
        + " var wrap = document.querySelector('.table-wrap');"
        + " var center = document.querySelector('main.center');"
        + " return { view: !!v, wrap: !!wrap, w: center ? Math.round(center.getBoundingClientRect().width) : 0,"
        + "   rows: document.querySelectorAll('.grid-body .grid-row, .grid-row').length,"
        + "   overflow: document.documentElement.scrollWidth <= window.innerWidth + 1 }; })()");
      ok(r.view && r.wrap && r.w > 240 && r.rows > 4, size[0] + 'x' + size[1] + ' usable', r);
    }
    await app.setViewport(1500, 940);
    await app.settle(500);

    console.log('\nempty state and effects');
    await ev("PV.app.state.datasets.slice().forEach(function (d) { PV.app.removeDataset(d.id); }); PV.app.emit()");
    await app.settle(1300);
    ok(await ev("!!document.querySelector('.hero')"), 'empty workspace shows the hero');
    ok(await ev("PV.fx.count() >= 1"), 'p5 ambient field is running', await ev('PV.fx.count()'));
    await ev("PV.app.loadSample('retail')");
    await app.settle(900);
    eq(await ev('PV.app.state.datasets.length'), 1, 'default data restored');

    console.log('\nconsole');
    ok(app.errors.length === 0, 'no console errors during the whole sweep', app.errors.slice(0, 5));
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
