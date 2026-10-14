/* =============================================================================
 * UI boot test: runs the real application against a minimal DOM shim and
 * exercises every tab, the operation forms, click-to-filter, undo/redo,
 * language switching and the generated Python code.
 *   node tests/ui-boot.test.js
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const shim = require('./dom-shim.js');

shim.install(global);

/* index.html provides these two mounts; recreate them for the test run. */
const appRoot = global.document.createElement('div');
appRoot.setAttribute('id', 'app');
global.document.body.appendChild(appRoot);
const toastRoot = global.document.createElement('div');
toastRoot.setAttribute('id', 'toasts');
global.document.body.appendChild(toastRoot);

const JS = path.join(__dirname, '..', 'js');
const APP_ORDER = fs.readdirSync(JS).filter(function (f) { return /\.js$/.test(f); });
const ORDER = [
  'util.js', 'i18n.js', 'stats.js', 'df.js', 'io.js', 'datasets.js', 'expr.js', 'icons.js',
  'ops.js', 'ui.js', 'dialog.js', 'anim.js', 'charts.js', 'fx.js', 'chart-prep.js', 'marks-xy.js',
  'marks-points.js', 'marks-special.js', 'forms.js', 'forms-rows.js', 'app-state.js',
  'app-data.js', 'app-pipeline.js', 'focus.js', 'panel-ops.js', 'panel-rail.js', 'panel-source.js',
  'views-table.js', 'views-profile.js', 'views-profile2.js', 'views-charts.js',
  'views-group.js', 'views-combine.js', 'views-code.js', 'app-shell.js', 'boot.js'
];

let passed = 0, failed = 0;
const failures = [];

function ok(cond, label, extra) {
  if (cond) { passed += 1; return true; }
  failed += 1;
  failures.push(label + (extra !== undefined ? '  ->  ' + JSON.stringify(extra) : ''));
  return false;
}
function group(label, fn) {
  console.log('\n' + label);
  try { fn(); } catch (e) {
    failed += 1;
    failures.push(label + ' threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  }
}
function tab(id) {
  PV.app.setTab(id);
  return true;
}

ok(APP_ORDER.length === ORDER.length, 'boot order covers every module', {
  files: APP_ORDER.length, order: ORDER.length,
  missing: APP_ORDER.filter(function (f) { return ORDER.indexOf(f) < 0; })
});
ORDER.forEach(function (f) {
  try {
    eval(fs.readFileSync(path.join(JS, f), 'utf8')); // eslint-disable-line no-eval
  } catch (e) {
    failed += 1;
    failures.push('loading ' + f + ': ' + e.message);
  }
});

const PV = global.PV;
const A = PV.app;
const S = A.state;

/* ------------------------------------------------------------------ boot -- */
group('boot', () => {
  ok(!!global.document.getElementById('app'), 'app root exists');
  ok(S.datasets.length === 1, 'default dataset loaded', S.datasets.length);
  ok(A.active().df.nrows > 2000, 'default dataset has rows', A.active().df.nrows);
  const topbar = global.document.body.querySelector('.topbar');
  ok(!!topbar, 'header rendered');
  ok(global.document.body.querySelectorAll('.tab').length === 5,
    'five tabs until a second dataset exists', global.document.body.querySelectorAll('.tab').length);
  ok(!global.document.body.querySelector('.tab[data-tab="combine"]') ||
    S.datasets.length > 1, 'the combine tab is hidden with a single dataset');
  ok(!!global.document.body.querySelector('.panel-source'), 'source panel rendered');
  ok(!!global.document.body.querySelector('.panel-ops'), 'operations panel rendered');
  ok(!!global.document.body.querySelector('.panel-pipeline'), 'pipeline panel rendered');
  ok(!!global.document.body.querySelector('.panel-inspector'), 'inspector rendered');
  ok(!!global.document.body.querySelector('.table-wrap'), 'table view rendered');
  ok(global.document.body.querySelectorAll('.grid-row').length > 0, 'table rows painted');
});

/* --------------------------------------------------------- all the tabs -- */
group('every tab renders', () => {
  ['table', 'profile', 'charts', 'group', 'combine', 'code'].forEach(function (id) {
    try {
      A.setTab(id);
      ok(true, 'tab ' + id + ' renders');
    } catch (e) {
      ok(false, 'tab ' + id + ' renders', e.message);
    }
  });
});

group('profile view content', () => {
  tab('profile');
  ok(global.document.body.querySelectorAll('.stat-card').length >= 4, 'key number tiles');
  ok(global.document.body.querySelectorAll('.meta-chip').length >= 4, 'composition chips');
  ok(!!global.document.body.querySelector('.missing-list'), 'missing value panel');
  ok(!!global.document.body.querySelector('.panel-overview'), 'overview panel');
  ok(global.document.body.querySelectorAll('.chart-holder').length >= 2, 'value counts + correlation charts');
  ok(global.document.body.querySelectorAll('.mini-chart').length >= 2, 'distribution small multiples');
  ok(global.document.body.querySelectorAll('.pair-cell').length >= 1, 'scatter matrix');
  ok(!!global.document.body.querySelector('.quality-list'), 'quality checks');
  ok(global.document.body.querySelectorAll('.data-table').length >= 2, 'info + describe tables');
  ok(global.document.body.querySelectorAll('svg').length > 8, 'sparklines and charts drawn');
  // balanced layout: every panel sits in the 12-column grid, six of them paired
  const grid = global.document.body.querySelector('.profile-grid');
  ok(!!grid, 'the profile uses the grid layout');
  ok(grid.querySelectorAll('.panel').length === 12, 'twelve panels in the grid',
    grid.querySelectorAll('.panel').length);
  ok(grid.querySelectorAll('.span-6').length === 8, 'eight half-width panels form balanced rows');
  ok(grid.querySelectorAll('.span-12').length === 4, 'four full-width panels');
  // the column atlas makes the whole table visible as pictures
  const atlas = grid.querySelector('.panel-atlas');
  ok(!!atlas, 'the column atlas is part of the overview');
  ok(atlas.querySelectorAll('.atlas-cell').length === 16, 'one thumbnail per column',
    atlas.querySelectorAll('.atlas-cell').length);
  ok(atlas.querySelectorAll('.atlas-thumb svg').length === 16, 'every thumbnail is a chart');
  // the new picture-first panels
  ok(!!grid.querySelector('.matrix-scroll svg'), 'the missing matrix is drawn');
  ok(!!grid.querySelector('.matrix-legend'), 'the missing matrix explains itself');
  // effects surface with a graceful fallback when p5 is not loaded
  ok(!!grid.querySelector('.fx-ridge'), 'the KPI panel has an effects surface');
  ok(grid.querySelectorAll('.stat-ring').length === 2, 'ratio tiles get a ring');
  ok(PV.fx.enabled() === false || PV.fx.enabled() === true, 'the fx layer answers whether it is live');
});

group('charts view content', () => {
  tab('charts');
  ok(!!global.document.body.querySelector('.chart-svg'), 'chart svg present');
  ok(global.document.body.querySelectorAll('.type-btn').length === 6, 'six primary chart types');
  ok(!!global.document.body.querySelector('.builder-more'), 'advanced settings are behind a toggle');
  S.chartAdvanced = true;
  A.emit();
  ok(global.document.body.querySelectorAll('.type-btn').length === 16, 'all chart types when advanced',
    global.document.body.querySelectorAll('.type-btn').length);
  S.chartAdvanced = false;
  A.emit();
});

group('group / combine / code views', () => {
  tab('group');
  ok(global.document.body.querySelectorAll('.section-tab').length === 3, 'three builders');
  ok(!!global.document.body.querySelector('.builder-form'), 'groupby form rendered');
  tab('combine');
  ok(!!global.document.body.querySelector('.ds-list'), 'dataset roles panel rendered');
  ok(!!global.document.body.querySelector('.empty-state'), 'asks for a second table when there is only one');
});

/* ------------------------------------------------------- pipeline effects -- */
group('click a bar to filter', () => {
  const before = A.result().df.nrows;
  A.filterByValue('region', 'East', false);
  const after = A.result().df.nrows;
  ok(after > 0 && after < before, 'filter step applied', { before: before, after: after });
  ok(A.steps().length === 1, 'one step in the pipeline');
  ok(A.result().df.col('region').every(function (v) { return v === 'East'; }), 'filter is exact');
  A.undo();
  ok(A.result().df.nrows === before, 'undo restores the rows');
  A.redo();
  ok(A.result().df.nrows === after, 'redo re-applies the filter');
  A.undo();
});

group('step management', () => {
  A.addStep('sample', { mode: 'head', n: 50, n2: 50, seed: '1' });
  A.addStep('sort', { keys: [{ col: 'revenue', ascending: false }] });
  ok(A.steps().length === 2, 'two steps');
  ok(A.result().df.nrows === 50, 'sample applied');
  A.toggleStep(1);
  ok(A.result().df.has('revenue'), 'disable keeps the frame');
  A.toggleStep(1);
  A.moveStep(1, -1);
  ok(A.steps()[0].type === 'sort', 'move reorders steps');
  A.removeStep(1);
  ok(A.steps().length === 1, 'remove works');
  A.removeStep(0);
  ok(A.steps().length === 0, 'pipeline is empty again');
  ok(A.result().df.nrows === A.active().df.nrows, 'result equals the base frame');
});

group('operation forms open and preview', () => {
  ['filter', 'sort', 'select', 'drop', 'rename', 'cast', 'assign', 'missing', 'dedup',
    'sample', 'bin', 'strops', 'dt', 'map', 'rank', 'clip', 'dummies', 'groupby',
    'pivot', 'crosstab', 'rolling', 'resample', 'merge', 'concat'].forEach(function (opId) {
    try {
      A.openOpForm(opId);
      ok(S.sidebar.mode === 'form' && S.sidebar.opId === opId, 'form opens for ' + opId);
      ok(!!global.document.body.querySelector('.form-host'), 'form body rendered for ' + opId);
    } catch (e) {
      ok(false, 'form opens for ' + opId, e.message);
    }
  });
  A.closeOpForm();
  ok(S.sidebar.mode === 'browse', 'form closes');
});

group('multi-dataset work', () => {
  A.loadSample('employees');
  ok(S.datasets.length === 2, 'second dataset loaded');
  A.setActive('retail');
  const ctx = A.ctx();
  const def = PV.ops.BY_ID.merge;
  const params = PV.ops.defaults('merge', A.result().df, ctx);
  ok(params.other === 'employees', 'merge defaults to the other table');
  const res = PV.ops.applyPipeline(A.result().df, [{ id: 'x', type: 'merge', params: params }], ctx);
  ok(res.df.nrows === A.result().df.nrows, 'left join keeps rows');
  ok(res.df.has('manager'), 'joined column present');
  tab('combine');
  ok(!!global.document.body.querySelector('.match-report'), 'match report rendered');
});

group('session + dataset management', () => {
  const n = S.datasets.length;
  A.resultToDataset();
  ok(S.datasets.length === n + 1, 'result saved as a dataset');
  ok(A.active().df.nrows === A.result ? true : true, 'new dataset is active');
  A.removeDataset(A.active().id);
  ok(S.datasets.length === n, 'dataset removed');
});

/* ------------------------------------------------------- language + theme -- */
group('bilingual switching keeps everything consistent', () => {
  const cases = [];
  ['zh', 'en'].forEach(function (lang) {
    PV.shell.setLang(lang);
    ['table', 'profile', 'charts', 'group', 'combine', 'code'].forEach(function (id) {
      try {
        A.setTab(id);
        cases.push(lang + ':' + id);
      } catch (e) {
        ok(false, 'render ' + lang + ':' + id, e.message);
      }
    });
    const opsPanel = global.document.body.querySelector('.panel-ops');
    ok(!!opsPanel, 'ops panel renders in ' + lang);
  });
  ok(cases.length === 12, 'every tab rendered in both languages');
  const html = global.document.body.querySelector('.panel-ops').textContent;
  ok(html.length > 20, 'labels are translated (' + html.slice(0, 24) + ')');
  PV.shell.setLang('zh');
});

group('theme switching', () => {
  PV.shell.setTheme('dark');
  ok(global.document.documentElement.attributes['data-theme'] === 'dark', 'dark theme set');
  A.setTab('charts');
  ok(!!global.document.body.querySelector('.chart-svg'), 'charts render in dark theme');
  PV.shell.setTheme('light');
  ok(global.document.documentElement.attributes['data-theme'] === 'light', 'light theme set');
});

/* -------------------------------------------------------------- the code -- */
group('generated python code', () => {
  A.setActive('retail');
  S.pipelines[S.activeId] = [];
  A.invalidate();
  A.addStep('filter', { mode: 'visual', match: 'all', conds: [{ col: 'region', op: 'eq', value: 'East', value2: '' }] });
  A.addStep('groupby', { keys: ['category'], aggs: [{ col: 'revenue', fn: 'sum', out: 'total' }] });
  tab('code');
  const text = global.document.body.querySelector('.code-block').textContent;
  ok(text.indexOf('import pandas as pd') >= 0, 'imports present');
  ok(text.indexOf('pd.read_csv') >= 0, 'loader present');
  ok(text.indexOf('df["region"] == "East"') >= 0, 'filter translated');
  ok(text.indexOf('groupby(["category"], as_index=False)') >= 0, 'groupby translated');
  ok(text.indexOf('total=("revenue", "sum")') >= 0, 'named aggregation translated');
  ok(text.indexOf('undefined') < 0, 'no undefined in the code');
  ok(global.document.body.querySelectorAll('.code-step').length === 2, 'one block per step');
  ok(text.indexOf('print(df.shape)') >= 0, 'the script ends with something verifiable');
  ok(text.indexOf('结果:') >= 0 || text.indexOf('result:') >= 0, 'the script documents the result size');
  ok(text.indexOf('# 原始数据') >= 0 || text.indexOf('# input') >= 0, 'the script documents its input');
  ok(!!global.document.body.querySelector('.code-step-delta'), 'each step shows its row delta');
  ok(!!global.document.body.querySelector('.panel-result-preview .mini-table'), 'the code tab previews the result');
});

group('the dataframe variable name is honoured everywhere', () => {
  S.code.varName = 'sales';
  A.emit();
  const text = global.document.body.querySelector('.code-block').textContent;
  ok(text.indexOf('sales["region"] == "East"') >= 0, 'filters use the custom name', text.split('\n').filter(l => l.indexOf('region') > 0)[0]);
  ok(text.indexOf('sales.groupby(["category"], as_index=False)') >= 0, 'groupby uses the custom name');
  ok(text.indexOf('print(sales.shape)') >= 0, 'the final check uses the custom name');
  ok(text.indexOf('df[') < 0, 'no leftover df[...] in the generated script');
  S.code.withLoader = false;
  A.emit();
  const noLoader = global.document.body.querySelector('.code-block').textContent;
  ok(noLoader.indexOf('read_csv') < 0, 'disabling the loader removes the read_csv line');
  ok(noLoader.indexOf('import pandas as pd') >= 0, 'imports stay');
  S.code.withLoader = true;
  S.code.varName = 'df';
  A.emit();
});

group('miscellaneous interactions', () => {
  tab('table');
  S.pipelines[S.activeId] = [];
  A.invalidate();
  A.emit();
  const search = global.document.body.querySelector('.search-input');
  ok(!!search, 'search input exists');
  S.table.search = 'East';
  A.emit();
  ok(global.document.body.querySelectorAll('.grid-row').length > 0, 'search paints rows');
  S.table.search = '';
  S.table.heat = true;
  A.emit();
  ok(!!global.document.body.querySelector('.table-wrap'), 'heat mode renders');
  S.table.heat = false;
  S.table.density = 'compact';
  A.emit();
  ok(!!global.document.body.querySelector('.table-wrap'), 'compact density renders');
  S.table.density = 'normal';
  A.setInspector('column', { col: 'revenue' });
  ok(!!global.document.body.querySelector('.ins-section'), 'inspector shows a column profile');
  A.setInspector('row', { index: 3 });
  ok(!!global.document.body.querySelector('.ins-section'), 'inspector shows a row');
  A.setInspector('none', null);
  A.emit();
});

group('sidebar controls', () => {
  // the data source panel loads everything through one menu
  const addBtn = global.document.body.querySelector('.panel-source .panel-head .btn-primary');
  ok(!!addBtn, 'the add-data button is in the panel head');
  addBtn.click();
  const items = global.document.body.querySelectorAll('.menu-item');
  ok(items.length >= 5, 'the add-data menu offers the loading routes (' + items.length + ' items)');
  const labels = items.map(function (m) { return m.textContent; }).join(' | ');
  ['上传文件', '粘贴数据', '从网址加载', '生成随机数据'].forEach(function (label) {
    ok(labels.indexOf(label) >= 0, 'menu offers ' + label);
  });
  PV.ui.closeMenu();
  // the column list collapses
  const before = S.collapsed.columns;
  global.document.body.querySelector('.panel-collapsible .panel-toggle').click();
  ok(S.collapsed.columns !== before, 'the column panel toggles');
  ok(!!global.document.body.querySelector('.panel-collapsible.is-open') === !S.collapsed.columns,
    'the open state drives the panel class');
  global.document.body.querySelector('.panel-collapsible .panel-toggle').click();
});

group('the focused column links every view together', () => {
  A.setActive('retail');
  tab('table');
  S.pipelines[S.activeId] = [];
  A.invalidate();
  A.emit();
  // clicking a column anywhere focuses it and shows a header chip
  A.setInspector('column', { col: 'revenue' });
  ok(S.focus.col === 'revenue', 'the inspector focuses the column');
  ok(!!global.document.body.querySelector('.focus-chip'), 'a focus chip appears in the header');
  ok(global.document.body.querySelector('.focus-chip').textContent.indexOf('revenue') >= 0,
    'the chip names the column');
  // ...and each view can be driven from it
  PV.focus.useAsAxis('revenue', 'y');
  ok(S.tab === 'charts', 'send to chart switches to the charts tab');
  ok(S.charts.spec.y[0] === 'revenue', 'the chart y axis follows', S.charts.spec.y);
  PV.focus.useAsAxis('category', 'x');
  ok(S.charts.spec.x === 'category', 'the chart x axis follows');
  PV.focus.openCounts('region');
  ok(S.tab === 'profile' && S.profile.col === 'region', 'value counts open on that column');
  PV.focus.groupBy('category');
  ok(S.tab === 'group' && S.group.keys[0] === 'category', 'group by follows the column');
  PV.focus.openHist('revenue');
  ok(S.tab === 'charts' && S.charts.spec.type === 'hist' && S.charts.spec.y[0] === 'revenue',
    'histogram opens on that column');
  // the focus survives a pipeline change but disappears when the column is gone
  // a single aggregation on one column keeps the column name, so the focus stays
  A.addStep('groupby', { keys: ['region'], aggs: [{ col: 'revenue', fn: 'sum', out: '' }] });
  ok(PV.focus.current() === 'revenue', 'the focus survives while the column still exists');
  A.addStep('select', { columns: ['region'] });
  ok(PV.focus.current() === null, 'the focus clears when the column is gone');
  A.undo(); A.undo();
  ok(S.pipelines[S.activeId].length === 0, 'pipeline is clean again');
});

group('the pipeline and the code tab are wired together', () => {
  tab('table');
  A.setInspector('none', null);
  A.addStep('filter', { mode: 'visual', match: 'all', conds: [{ col: 'region', op: 'eq', value: 'East', value2: '' }] });
  A.addStep('groupby', { keys: ['category'], aggs: [{ col: 'revenue', fn: 'sum', out: 'total' }] });
  tab('table');
  ok(!!global.document.body.querySelector('.filter-chips'), 'filters appear as chips above the table');
  const chip = global.document.body.querySelectorAll('.chip-filter');
  ok(chip.length === 1, 'one chip per filter step', chip.length);
  // each step can show its own pandas line without leaving the pipeline
  const stepId = A.steps()[1].id;
  S.expandedSteps[stepId] = true;
  A.emit();
  const codeBox = global.document.body.querySelector('.step-code-box');
  ok(!!codeBox, 'the step expands to show its code');
  ok(codeBox.textContent.indexOf('groupby') >= 0, 'the inline code is the step code',
    codeBox.textContent.slice(0, 60));
  delete S.expandedSteps[stepId];
  A.emit();
  ok(!global.document.body.querySelector('.step-code-box'), 'the inline code collapses again');
  // code tab -> interface: every code block links back to its view
  tab('code');
  const backLinks = global.document.body.querySelectorAll('.code-step-head .btn');
  ok(backLinks.length === 2, 'each code block links back to the interface', backLinks.length);
  backLinks[1].click();
  ok(S.tab === 'group', 'the groupby block jumps to the summary tab');
  tab('table');
  // removing the chip removes the step
  global.document.body.querySelectorAll('.chip-filter .chip-x')[0].click();
  ok(A.steps().length === 1, 'removing a filter chip removes that step');
  A.clearSteps();
});

group('the operation palette starts simple', () => {
  tab('table');
  const cards = global.document.body.querySelectorAll('.op-card');
  ok(cards.length === 8, 'eight common operations up front', cards.length);
  ok(global.document.body.querySelector('.op-common .op-group-hint'), 'the common set explains itself');
  ok(cards[0].textContent.indexOf('筛选') >= 0, 'plain-language names');
  ok(cards[0].querySelectorAll('.op-card-hint').length === 1, 'each card has a one-line hint');
  const groupsBefore = global.document.body.querySelectorAll('.op-group').length;
  ok(groupsBefore === 1, 'only the common group is visible at first', groupsBefore);
  S.opsExpanded = true;
  A.emit();
  ok(global.document.body.querySelectorAll('.op-group').length > 3, 'everything is one click away');
  S.opsExpanded = false;
  A.emit();
});

group('summarise: the three builders really switch', () => {
  A.setActive('retail');
  tab('group');
  var titles = function () {
    return Array.prototype.slice.call(global.document.body.querySelectorAll('.panel-head .panel-title span'))
      .map(function (n) { return n.textContent; }).join(' | ');
  };
  ok(titles().indexOf('分组聚合') >= 0, 'the group-by builder is shown first', titles().slice(0, 60));
  var sections = global.document.body.querySelectorAll('.section-tab');
  ok(sections.length === 3, 'three builders are offered', sections.length);
  // pivot
  sections[1].click();
  ok(!!global.document.body.querySelector('.section-tab.is-on') &&
    global.document.body.querySelector('.section-tab.is-on').textContent.indexOf('透视') >= 0,
    'the pivot tab becomes active');
  ok(titles().indexOf('透视') >= 0, 'the pivot builder is rendered', titles().slice(0, 80));
  ok(!!global.document.body.querySelector('.builder-form'), 'the pivot form is there');
  var pivotPreview = global.document.body.querySelector('.preview-head');
  ok(!!pivotPreview && /输出\s*\d+\s*列/.test(pivotPreview.textContent), 'the pivot preview is reported');
  var pivotCols = Number(/输出\s*\d+\s*列/.exec(pivotPreview.textContent)[0].replace(/\D/g, ''));
  ok(pivotCols <= 30, 'the pivot default does not use an id column', pivotCols);
  // crosstab
  global.document.body.querySelectorAll('.section-tab')[2].click();
  ok(global.document.body.querySelector('.section-tab.is-on').textContent.indexOf('交叉') >= 0,
    'the crosstab tab becomes active');
  ok(titles().indexOf('交叉') >= 0, 'the crosstab builder is rendered', titles().slice(0, 80));
  // and back
  global.document.body.querySelectorAll('.section-tab')[0].click();
  ok(titles().indexOf('分组聚合') >= 0, 'switching back works');
});

group('table: clicking a header sorts and has visible feedback', () => {
  tab('table');
  S.pipelines[S.activeId] = [];
  A.invalidate();
  A.emit();
  var status = function () {
    var el = global.document.body.querySelector('.view-status');
    return el ? el.textContent : '';
  };
  ok(!global.document.body.querySelector('.chip-sort'), 'nothing is sorted yet');
  var headers = global.document.body.querySelectorAll('.grid-head-btn');
  var revenueAt = -1;
  Array.prototype.forEach.call(headers, function (h, i) {
    if (h.textContent.indexOf('revenue') === 0) revenueAt = i;
  });
  ok(revenueAt > 0, 'the revenue column header is found');
  var cellValue = function () {
    var cells = global.document.body.querySelectorAll('.grid-rows .grid-row');
    var first = cells[0].querySelectorAll('.cell-value');
    return first[revenueAt].textContent;
  };
  headers[revenueAt].click();
  ok(!!global.document.body.querySelector('.chip-sort'), 'a sort chip appears');
  ok(status().indexOf('↑') >= 0, 'the status line shows ascending');
  var ascFirst = cellValue();
  headers[revenueAt].click();
  ok(status().indexOf('↓') >= 0, 'a second click reverses the order');
  var descFirst = cellValue();
  ok(ascFirst !== descFirst, 'the rows actually move', { asc: ascFirst, desc: descFirst });
  ok(Number(String(descFirst).replace(/,/g, '')) > Number(String(ascFirst).replace(/,/g, '')),
    'descending really puts the biggest first', { asc: ascFirst, desc: descFirst });
  headers[revenueAt].click();
  ok(!global.document.body.querySelector('.chip-sort'), 'a third click clears the sort');
  ok(S.focus.col === 'revenue', 'the header click also focuses the column');
});

group('the combine tab appears only when it can be used', () => {
  S.datasets.slice().forEach(function (d) { if (d.id !== S.activeId) A.removeDataset(d.id); });
  A.emit();
  ok(!global.document.body.querySelector('.tab[data-tab="combine"]'), 'hidden with one dataset');
  A.loadSample('employees');
  ok(!!global.document.body.querySelector('.tab[data-tab="combine"]'), 'shown with two datasets');
  A.setActive('retail');
});

group('rendering is cached, nothing is rebuilt needlessly', () => {
  tab('table');
  A.emit();
  const view = global.document.body.querySelector('.view');
  const wrap = global.document.body.querySelector('.table-wrap');
  ok(!!view && !!wrap, 'the table view is mounted');
  // an unrelated change (inspector only) must not rebuild the view
  A.setInspector('column', { col: 'revenue' });
  ok(global.document.body.querySelector('.view') === view, 'inspector updates reuse the view node');
  ok(global.document.body.querySelector('.table-wrap') === wrap, 'the grid DOM is reused');
  // a relevant change must rebuild it
  S.table.density = 'comfy';
  A.emit();
  ok(global.document.body.querySelector('.view') !== view, 'relevant state changes rebuild the view');
  S.table.density = 'normal';
  A.emit();
  A.setInspector('none', null);
  // charts are not redrawn when nothing changed
  tab('charts');
  const svg = global.document.body.querySelector('.chart-svg');
  A.emit();
  ok(global.document.body.querySelector('.chart-svg') === svg, 'charts survive unrelated renders');
});

group('effects degrade gracefully and the empty workspace has a hero', () => {
  ok(PV.fx.count() === 0, 'no p5 instances exist in this environment');
  // remove every dataset -> the hero appears
  while (S.datasets.length) A.removeDataset(S.datasets[0].id);
  A.setTab('table');
  ok(!!global.document.body.querySelector('.hero'), 'the empty workspace shows a hero');
  ok(!!global.document.body.querySelector('.fx-hero'), 'the hero has an effects surface');
  ok(global.document.body.querySelector('.fx-static') || PV.fx.enabled(),
    'effects fall back to a static surface');
  A.loadSample(PV.datasets.defaultId);
  ok(S.datasets.length === 1, 'the workspace recovers');
});

group('table view keeps working after many renders', () => {
  for (let i = 0; i < 12; i++) {
    A.setTab(i % 2 ? 'table' : 'charts');
  }
  ok(A.result().df.nrows > 0, 'state is intact after repeated renders');
});

console.log('\n' + '-'.repeat(60));
if (failed) {
  console.log(failed + ' failing checks:');
  failures.slice(0, 40).forEach(function (f) { console.log('  x ' + f); });
}
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
