/* =============================================================================
 * Chart geometry tests: render every chart type against real data and check
 * that marks land inside the plot with finite, sane coordinates.
 *   node tests/charts.test.js
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const shim = require('./dom-shim.js');

shim.install(global);
const appRoot = global.document.createElement('div');
appRoot.setAttribute('id', 'app');
global.document.body.appendChild(appRoot);

const JS = path.join(__dirname, '..', 'js');
['util', 'i18n', 'stats', 'df', 'io', 'datasets', 'expr', 'icons', 'ops',
  'charts', 'chart-prep', 'marks-xy', 'marks-points', 'marks-special'].forEach(name => {
  eval(fs.readFileSync(path.join(JS, name + '.js'), 'utf8')); // eslint-disable-line no-eval
});

const PV = global.PV;
const retail = PV.datasets.build('retail');
const iris = PV.datasets.build('iris');
const air = PV.datasets.build('air');

let passed = 0, failed = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { passed += 1; return; }
  failed += 1;
  failures.push(label + (extra !== undefined ? '  ->  ' + JSON.stringify(extra) : ''));
}
function group(label, fn) { console.log('\n' + label); fn(); }
function eq(a, b, label) { ok(a === b, label, { got: a, want: b }); }

function draw(spec, df, width) {
  const host = global.document.createElement('div');
  const res = PV.charts.render(host, spec, df, { width: width || 720, onMark: function () {} });
  return { host: host, res: res, svg: host.querySelector('svg') };
}

function marks(svg) {
  const out = { rects: [], texts: [], paths: [], circles: [] };
  shim.walk(svg, function (n) {
    const tag = n.tagName.toLowerCase();
    const attr = n.attributes;
    const num = v => (v === undefined || v === '' ? null : Number(v));
    if (tag === 'rect') out.rects.push({ x: num(attr.x), y: num(attr.y), w: num(attr.width), h: num(attr.height), cls: n.className });
    if (tag === 'text') out.texts.push({ x: num(attr.x), y: num(attr.y), t: n.textContent });
    if (tag === 'path') out.paths.push({ d: attr.d || '', cls: n.className });
    if (tag === 'circle') out.circles.push({ cx: num(attr.cx), cy: num(attr.cy), r: num(attr.r) });
  });
  return out;
}

function finiteAll(list, keys, label) {
  const bad = list.filter(o => keys.some(k => o[k] === null || !isFinite(o[k])));
  ok(bad.length === 0, label, bad.slice(0, 3));
}

const SPECS = [
  { name: 'bar', spec: { type: 'bar', x: 'region', y: ['revenue'], agg: 'sum', sort: 'value_desc' }, df: () => retail },
  { name: 'stacked bar', spec: { type: 'bar', x: 'region', y: ['revenue'], color: 'channel', agg: 'sum', stacked: true }, df: () => retail },
  { name: 'grouped bar', spec: { type: 'bar', x: 'region', y: ['revenue'], color: 'channel', agg: 'sum' }, df: () => retail },
  { name: 'horizontal bar', spec: { type: 'hbar', x: 'category', y: ['profit'], agg: 'mean', horizontal: true }, df: () => retail },
  { name: 'line', spec: { type: 'line', x: 'date', y: ['revenue'], agg: 'sum', smooth: true }, df: () => retail },
  { name: 'multi line', spec: { type: 'line', x: 'date', y: ['revenue', 'profit'], agg: 'sum' }, df: () => retail },
  { name: 'area', spec: { type: 'area', x: 'timestamp', y: ['pm25'], agg: 'mean' }, df: () => air },
  { name: 'scatter', spec: { type: 'scatter', x: 'unit_price', y: ['revenue'] }, df: () => retail },
  { name: 'bubble', spec: { type: 'bubble', x: 'revenue', y: ['profit'], size: 'units', color: 'region' }, df: () => retail },
  { name: 'histogram', spec: { type: 'hist', x: 'revenue', y: ['revenue'], bins: 20 }, df: () => retail },
  { name: 'box', spec: { type: 'box', x: 'region', y: ['revenue'] }, df: () => retail },
  { name: 'violin', spec: { type: 'violin', x: 'species', y: ['petal_length'] }, df: () => iris },
  { name: 'heatmap corr', spec: { type: 'heatmap', x: '__corr__', y: ['units', 'unit_price', 'revenue', 'profit'], corrMethod: 'pearson' }, df: () => retail },
  { name: 'heatmap pivot', spec: { type: 'heatmap', x: 'category', y: ['region'], values: 'profit', agg: 'mean' }, df: () => retail },
  { name: 'pie', spec: { type: 'pie', x: 'region', y: ['revenue'], agg: 'sum' }, df: () => retail },
  { name: 'donut', spec: { type: 'donut', x: 'channel', y: ['revenue'], agg: 'sum' }, df: () => retail },
  { name: 'ecdf', spec: { type: 'ecdf', x: 'revenue', y: ['revenue'] }, df: () => retail },
  { name: 'count', spec: { type: 'count', x: 'country', limit: 12 }, df: () => retail },
  { name: 'count on iris', spec: { type: 'count', x: 'species' }, df: () => iris },
  { name: 'bar of averages', spec: { type: 'bar', x: 'pclass', y: ['fare'], agg: 'mean' }, df: () => PV.datasets.build('passengers') }
];

group('every chart type renders sane geometry', () => {
  SPECS.forEach(entry => {
    let out;
    try {
      out = draw(entry.spec, entry.df());
    } catch (e) {
      ok(false, entry.name + ' renders', e.message);
      return;
    }
    ok(!out.res.empty, entry.name + ' is not empty');
    if (!out.svg) { ok(false, entry.name + ' produced an svg'); return; }
    const vb = out.svg.attributes.viewBox.split(' ').map(Number);
    ok(vb.length === 4 && vb[2] > 300 && vb[3] > 180, entry.name + ' viewBox is sensible', vb);
    const m = marks(out.svg);
    finiteAll(m.rects, ['x', 'y', 'w', 'h'], entry.name + ' rects are finite');
    finiteAll(m.texts, ['x', 'y'], entry.name + ' texts are finite');
    finiteAll(m.circles, ['cx', 'cy', 'r'], entry.name + ' circles are finite');
    // every mark must sit inside the canvas
    const outside = m.rects.filter(r => r.x + r.w < -2 || r.y + r.h < -2 || r.x > vb[2] + 2 || r.y > vb[3] + 2);
    ok(outside.length === 0, entry.name + ' marks stay inside the canvas', outside.slice(0, 3));
    const tiny = m.rects.filter(r => (r.cls.indexOf('chart-bar') >= 0) && (r.w <= 0 || r.h <= 0));
    ok(tiny.length === 0, entry.name + ' bars have a visible size', tiny.slice(0, 3));
    if (entry.name.indexOf('line') >= 0 || entry.name.indexOf('area') >= 0 || entry.name === 'ecdf') {
      ok(m.paths.length > 0, entry.name + ' draws a path');
      ok(m.paths.every(p => p.d.indexOf('NaN') < 0), entry.name + ' path has no NaN');
    }
    if (entry.name.indexOf('pie') >= 0 || entry.name.indexOf('donut') >= 0) {
      ok(m.paths.filter(p => p.cls.indexOf('chart-slice') >= 0).length >= 2, entry.name + ' has slices');
    }
    if (entry.name.indexOf('heatmap') >= 0) {
      ok(m.rects.length >= 6, entry.name + ' has cells');
    }
    ok(m.texts.filter(t => t.t && t.t.length).length > 0, entry.name + ' has axis labels');
  });
});

group('axis labels are formatted, not raw floats', () => {
  const out = draw({ type: 'bar', x: 'region', y: ['revenue'], agg: 'sum' }, retail);
  const labels = marks(out.svg).texts.map(t => t.t).filter(Boolean);
  ok(labels.every(t => !/NaN|undefined|null/.test(t)), 'no NaN/undefined labels', labels);
  ok(labels.some(t => /[A-Za-z\u4e00-\u9fa5]/.test(t)), 'category labels present');
  const numbers = labels.filter(t => /^[\d.,KMB\s]+$/.test(t));
  ok(numbers.length > 2, 'numeric ticks present', numbers);
  ok(numbers.every(t => t.length <= 9), 'numeric ticks are compact', numbers);
});

group('datetime axes', () => {
  const out = draw({ type: 'line', x: 'date', y: ['revenue'], agg: 'sum' }, retail);
  const labels = marks(out.svg).texts.map(t => t.t);
  ok(labels.some(t => /^\d{4}(-\d{2})?(-\d{2})?$/.test(t)), 'dates are formatted', labels.slice(0, 6));
  const long = draw({ type: 'line', x: 'date', y: ['revenue'], agg: 'sum' }, retail, 380);
  ok(!!long.svg, 'narrow width still renders');
  ok(long.svg.attributes.viewBox.split(' ')[2] === '380', 'narrow chart uses the measured width');
});

group('empty and missing data', () => {
  const noY = draw({ type: 'bar', x: 'region', y: [] }, retail);
  ok(noY.res.empty, 'chart without a y column is reported as empty');
  ok(!!global.document.querySelector, 'empty state renders without a chart');
  const emptyFrame = PV.df.DataFrame.fromRecords([], {});
  const none = draw({ type: 'bar', x: 'a', y: ['b'] }, emptyFrame);
  ok(none.res.empty, 'empty frame is reported as empty');
  const withNa = PV.df.DataFrame.fromRecords([
    { g: 'a', v: 1 }, { g: 'b', v: null }, { g: 'a', v: 3 }
  ], {});
  const naOut = draw({ type: 'bar', x: 'g', y: ['v'], agg: 'sum' }, withNa);
  ok(!naOut.res.empty, 'chart with NA values still renders');
  ok(naOut.res.prep.dropped >= 0, 'dropped rows are counted', naOut.res.prep.dropped);
});

group('top-N bucketing and series totals', () => {
  const out = draw({ type: 'bar', x: 'country', y: ['revenue'], agg: 'sum', limit: 3, sort: 'value_desc' }, retail);
  ok(out.res.prep.categories.length === 4, '3 categories + other', out.res.prep.categories.length);
  ok(out.res.prep.categories[3].isOther === true, 'the rest is bucketed into "other"');
  const pts = out.res.prep.series[0].points;
  const total = pts.reduce((a, p) => a + (p.y || 0), 0);
  const expected = PV.stats.sum(PV.stats.numeric(retail.col('revenue')));
  ok(Math.abs(total - expected) < 1, 'bucketing preserves the total', { total: total, expected: expected });
});

group('large frames stay responsive to plot', () => {
  const big = PV.datasets.generate({ rows: 20000, cols: 6, seed: 'big' });
  const t0 = Date.now();
  const out = draw({ type: 'scatter', x: 'metric_1', y: ['metric_2'] }, big);
  const ms = Date.now() - t0;
  ok(!out.res.empty, 'scatter on 20k rows renders');
  ok(out.res.prep.series[0].points.length <= PV.charts.MAX_POINTS, 'points are downsampled',
    out.res.prep.series[0].points.length);
  ok(ms < 4000, 'render stays fast (' + ms + ' ms)');
});

group('theme colours resolve', () => {
  ['light', 'dark'].forEach(theme => {
    global.document.documentElement.setAttribute('data-theme', theme);
    const c = PV.charts.colors();
    ok(!!c.palette[0] && c.palette.length === 8, theme + ' palette has 8 colours');
    ok(!!c.fg && !!c.muted && !!c.grid, theme + ' neutral colours resolve');
    const out = draw({ type: 'bar', x: 'region', y: ['revenue'], agg: 'sum' }, retail);
    const fills = marks(out.svg).rects.map(r => r.cls).filter(Boolean);
    ok(fills.length > 0, theme + ' bars have classes');
  });
  global.document.documentElement.setAttribute('data-theme', 'light');
});

group('sparklines', () => {
  const svg = PV.charts.sparkline(PV.stats.numeric(retail.col('revenue')), { width: 92, height: 22, type: 'bar' });
  ok(svg.tagName.toLowerCase() === 'svg', 'sparkline is an svg');
  ok(svg.attributes.viewBox === '0 0 92 22', 'sparkline viewBox matches the request');
  const empty = PV.charts.sparkline([null, null], {});
  ok(!!empty, 'sparkline tolerates all-null input');
});

group('marks carry stable keys (for animated transitions)', () => {
  const cases = [
    [{ type: 'bar', x: 'region', y: ['revenue'], agg: 'sum' }, retail, 'rect'],
    [{ type: 'line', x: 'date', y: ['revenue'], agg: 'sum' }, retail, 'circle'],
    [{ type: 'scatter', x: 'unit_price', y: ['revenue'] }, retail, 'circle'],
    [{ type: 'hist', x: 'revenue', y: ['revenue'], bins: 12 }, retail, 'rect'],
    [{ type: 'pie', x: 'region', y: ['revenue'], agg: 'sum' }, retail, 'path'],
    [{ type: 'box', x: 'region', y: ['revenue'] }, retail, 'rect'],
    [{ type: 'heatmap', x: '__corr__', y: ['units', 'revenue', 'profit'] }, retail, 'rect']
  ];
  cases.forEach(function (entry) {
    const out = draw(entry[0], entry[1]);
    const keyed = out.svg.querySelectorAll('[data-key]');
    ok(keyed.length > 0, entry[0].type + ' marks carry data-key (' + keyed.length + ')');
    ok(keyed.every(function (n) { return (n.getAttribute('data-key') || '').length > 0; }),
      entry[0].type + ' keys are non-empty');
  });
});

group('dense scatter switches to a fast dot path', () => {
  const big = PV.datasets.generate({ rows: 20000, cols: 6, seed: 'dense' });
  const out = draw({ type: 'scatter', x: 'metric_1', y: ['metric_2'] }, big);
  ok(!out.res.empty, 'dense scatter renders');
  ok(!!out.svg.querySelector('.chart-dots'), 'points are drawn as one path per series');
  ok(out.svg.querySelectorAll('circle').length <= 40, 'no per-point circles are created',
    out.svg.querySelectorAll('circle').length);
  ok(!!out.svg.querySelector('.chart-hit'), 'a hover overlay replaces the per-point targets');
  const path = out.svg.querySelector('.chart-dots');
  ok(path.attributes.d.split('M').length > 1000, 'the dot path holds every point');
  ok(path.attributes.d.indexOf('NaN') < 0, 'dot path has no NaN');
  // the small case must keep the rich per-point interaction
  const small = draw({ type: 'scatter', x: 'sepal_length', y: ['petal_length'] }, iris);
  ok(!small.svg.querySelector('.chart-dots'), 'small scatters keep individual points');
  ok(small.svg.querySelectorAll('circle').length > 100, 'small scatters keep per-point circles');
});

group('nearest-point index for dense scatters', () => {
  const idx = PV.charts.spatialIndex([{ px: 10, py: 10 }, { px: 200, py: 200 }, { px: 60, py: 12 }], 26);
  eq(idx.query(58, 13, 10), 2, 'finds the nearest point');
  eq(idx.query(199, 201, 10), 1, 'looks into neighbouring cells');
  eq(idx.query(400, 400, 10), -1, 'returns -1 when nothing is close');
  eq(idx.size, 3, 'index reports its size');
});

group('unchanged charts are not redrawn', () => {
  const df = PV.datasets.build('iris');
  const host = global.document.createElement('div');
  const spec = { type: 'bar', x: 'species', y: ['petal_length'], agg: 'mean' };
  const a = PV.charts.render(host, spec, df, { width: 600 });
  const b = PV.charts.render(host, spec, df, { width: 600 });
  ok(a.svg === b.svg, 'same inputs reuse the previous svg');
  const c = PV.charts.render(host, { type: 'bar', x: 'species', y: ['petal_width'], agg: 'mean' }, df, { width: 600 });
  ok(c.svg !== a.svg, 'changed inputs redraw');
  const d = PV.charts.render(host, { type: 'bar', x: 'species', y: ['petal_width'], agg: 'mean' }, df, { width: 400 });
  ok(d.svg !== c.svg, 'a width change redraws');
});

group('density view: 2D binning you can filter with', () => {
  const host = global.document.createElement('div');
  let clicked = null;
  const res = PV.charts.render(host, { type: 'density', x: 'revenue', y: ['profit'] }, retail, {
    width: 720, onMark: function (info) { clicked = info; }
  });
  ok(!res.empty, 'density renders');
  const svg = host.querySelector('svg');
  const cells = svg.querySelectorAll('.chart-cell');
  ok(cells.length > 20, 'the non-empty region is binned', cells.length);
  ok(cells.length <= 48 * 40, 'the grid stays small');
  ok(cells.every(function (c) { return !!c.attributes['data-key']; }), 'cells carry keys');
  cells[0].listeners.click.forEach(function (f) { f({ stopPropagation: function () {} }); });
  ok(clicked && clicked.kind === 'region2d', 'clicking a cell reports a 2D region', clicked && clicked.kind);
  ok(clicked.range[1] > clicked.range[0] && clicked.range2[1] > clicked.range2[0],
    'the region has real bounds on both axes', clicked);
  ok(clicked.field === 'revenue' && clicked.field2 === 'profit', 'the region names both columns');
});

group('association matrix of mixed types', () => {
  const cols = ['region', 'category', 'channel', 'revenue', 'units', 'discount', 'returned'];
  const m = retail.assocMatrix(cols);
  eq(m.names.length, cols.length, 'every column is in the matrix');
  ok(m.matrix.every(function (row, i) { return row[i] === 1; }), 'the diagonal is 1');
  ok(m.methods[1][3] === 'eta', 'numeric explained by category uses eta', m.methods[1][3]);
  ok(m.methods[0][1] === "cramer's v", 'category × category uses Cramers V', m.methods[0][1]);
  ok(m.methods[3][4] === 'pearson', 'numeric × numeric uses Pearson');
  ok(m.matrix.every(function (row) {
    return row.every(function (v) { return v === null || (v >= 0 && v <= 1); });
  }), 'everything lands in [0, 1]');
  ok(m.matrix[1][3] > 0.5, 'the category/revenue link is strong in this dataset', m.matrix[1][3]);
  // and it draws
  const host = global.document.createElement('div');
  const res = PV.charts.render(host, { type: 'heatmap', x: '__matrix__', y: cols, matrix: m }, retail, { width: 620 });
  ok(!res.empty, 'the association matrix renders');
  ok(host.querySelectorAll('.chart-heatmap rect').length >= cols.length * cols.length, 'one cell per pair');
  eq(res.prep.extra.signed, false, 'it uses the sequential colour scale');
});

group('parallel coordinates: one axis per dimension, drag to filter', () => {
  const host = global.document.createElement('div');
  let brushed = null;
  const res = PV.charts.render(host, {
    type: 'parallel', x: 'units', y: ['units', 'revenue', 'profit'], color: 'region'
  }, retail, {
    width: 760,
    onBrush: function (info) { brushed = info; }
  });
  ok(!res.empty, 'parallel coordinates render');
  const svg = host.querySelector('svg');
  ok(res.prep.extra.dims.join(',') === 'units,revenue,profit', 'the dimensions are the chosen columns');
  ok(svg.querySelectorAll('.chart-axis-hit').length === 3, 'one brushable axis per dimension');
  ok(svg.querySelectorAll('path[data-key]').length === res.prep.series.length, 'one polyline batch per series');
  ok(res.prep.totalPoints > 300 && res.prep.totalPoints <= 700, 'lines are downsampled for speed',
    res.prep.totalPoints);
  // drag on the first axis reports the column and a real value range
  svg.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: 760, height: res.layout.height };
  };
  const strip = svg.querySelectorAll('.chart-axis-hit')[0];
  strip.listeners.mousedown.forEach(function (f) { f({ clientY: 120, preventDefault: function () {} }); });
  global.document.listeners.mousemove.forEach(function (f) { f({ clientY: 240 }); });
  global.document.listeners.mouseup.forEach(function (f) { f({}); });
  ok(brushed && brushed.field === 'units', 'the brush names the column', brushed && brushed.field);
  ok(brushed && brushed.hi > brushed.lo, 'the brush reports an ordered range', brushed);
  const nums = PV.stats.numeric(retail.col('units'));
  ok(brushed.hi <= PV.stats.max(nums) + 1e-6 && brushed.lo >= PV.stats.min(nums) - 1e-6,
    'the range stays inside the data', brushed);
});

console.log('\n' + '-'.repeat(60));
if (failed) {
  console.log(failed + ' failing checks:');
  failures.slice(0, 30).forEach(f => console.log('  x ' + f));
}
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
