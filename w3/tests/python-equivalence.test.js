/* =============================================================================
 * The strongest test in the suite: run the app's generated pandas code with a
 * real pandas and check the result matches what the visual pipeline produced.
 *
 *   node tests/python-equivalence.test.js
 *
 * Requires python with pandas on PATH (the script is skipped with a clear
 * message when it is missing).
 * ========================================================================== */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const JS = path.join(__dirname, '..', 'js');
['util', 'i18n', 'stats', 'df', 'io', 'datasets', 'expr', 'icons', 'ops'].forEach(function (name) {
  eval(fs.readFileSync(path.join(JS, name + '.js'), 'utf8')); // eslint-disable-line no-eval
});
const PV = global.PV;
PV.i18n.setLang('zh', true);

let passed = 0, failed = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { passed += 1; return; }
  failed += 1;
  failures.push(label + (extra !== undefined ? '  ->  ' + JSON.stringify(extra) : ''));
}

/* ------------------------------- python probe --------------------------- */
function pythonCmd() {
  for (const cmd of ['python', 'python3', 'py']) {
    const res = spawnSync(cmd, ['-c', 'import pandas; print(pandas.__version__)'], { encoding: 'utf8' });
    if (res.status === 0) return { cmd: cmd, version: (res.stdout || '').trim() };
  }
  return null;
}

const PY = pythonCmd();
if (!PY) {
  console.log('python + pandas not found - skipping the equivalence suite');
  process.exit(0);
}
console.log('using ' + PY.cmd + ' with pandas ' + PY.version);

/* ------------------------------- fixtures ------------------------------- */
const retail = PV.datasets.build('retail');
const employees = PV.datasets.build('employees');
const datasets = [
  { id: 'retail', name: 'retail', nameZh: '全球零售订单', nameEn: 'Global retail orders', pyName: 'retail',
    df: retail, source: { kind: 'sample', name: 'Global retail orders', file: 'retail.csv' } },
  { id: 'employees', name: 'employees', nameZh: '区域负责人', nameEn: 'Regional managers', pyName: 'employees',
    df: employees, source: { kind: 'sample', name: 'Regional managers', file: 'employees.csv' } }
];
const ctx = { datasets: datasets, activeId: 'retail' };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-py-'));
fs.writeFileSync(path.join(TMP, 'retail.csv'), PV.io.toCSVFrame(retail));
fs.writeFileSync(path.join(TMP, 'employees.csv'), PV.io.toCSVFrame(employees));

/* --------------------------------- cases -------------------------------- */
const CASES = [
  {
    name: 'filter with AND',
    steps: [{ type: 'filter', params: { mode: 'visual', match: 'all', conds: [
      { col: 'region', op: 'eq', value: 'East', value2: '' },
      { col: 'revenue', op: 'gt', value: '2500', value2: '' }] } }]
  },
  {
    name: 'filter with OR and between',
    steps: [{ type: 'filter', params: { mode: 'visual', match: 'any', conds: [
      { col: 'category', op: 'eq', value: 'Sports', value2: '' },
      { col: 'units', op: 'between', value: '30', value2: '40' }] } }]
  },
  {
    name: 'filter with isin and contains',
    steps: [{ type: 'filter', params: { mode: 'visual', match: 'all', conds: [
      { col: 'channel', op: 'isin', value: 'Online, Partner', value2: '' },
      { col: 'country', op: 'contains', value: 'United', value2: '' }] } }]
  },
  {
    name: 'dropna + cast + sort',
    steps: [
      { type: 'missing', params: { mode: 'dropna', columns: ['customer_age'], how: 'any' } },
      { type: 'cast', params: { col: 'customer_age', dtype: 'int64' } },
      { type: 'sort', params: { keys: [{ col: 'revenue', ascending: false }, { col: 'units', ascending: true }] } }
    ]
  },
  {
    name: 'assign + filter on the new column',
    steps: [
      { type: 'assign', params: { name: 'margin', expr: 'profit / revenue', position: 'end' } },
      { type: 'filter', params: { mode: 'visual', match: 'all', conds: [
        { col: 'margin', op: 'gt', value: '0.3', value2: '' }] } }
    ]
  },
  {
    name: 'dedup + select + rename',
    steps: [
      { type: 'dedup', params: { columns: [], keep: 'first' } },
      { type: 'select', params: { columns: ['region', 'category', 'revenue'] } },
      { type: 'rename', params: { pairs: [{ from: 'revenue', to: 'sales' }] } }
    ]
  },
  {
    name: 'groupby with several aggregations',
    sortBy: ['region', 'channel'],
    steps: [{ type: 'groupby', params: { keys: ['region', 'channel'], aggs: [
      { col: 'revenue', fn: 'sum', out: 'total' },
      { col: 'profit', fn: 'mean', out: 'avg_profit' },
      { col: 'order_id', fn: 'nunique', out: 'orders' },
      { col: 'returned', fn: 'sum', out: 'returns' }] } }]
  },
  {
    name: 'groupby after filtering and filling',
    sortBy: ['category'],
    steps: [
      { type: 'filter', params: { mode: 'visual', match: 'all', conds: [
        { col: 'returned', op: 'eq', value: 'false', value2: '' }] } },
      { type: 'missing', params: { mode: 'fillna', columns: ['rating'], method: 'mean', value: '' } },
      { type: 'groupby', params: { keys: ['category'], aggs: [
        { col: 'rating', fn: 'mean', out: 'avg_rating' },
        { col: 'revenue', fn: 'sum', out: 'total' }] } }
    ]
  },
  {
    name: 'pivot table with margins',
    sortBy: ['region'],
    steps: [{ type: 'pivot', params: { index: 'region', columns: 'channel', values: 'revenue',
      aggfunc: 'sum', margins: true, fillValue: '0' } }]
  },
  {
    name: 'crosstab with margins',
    sortBy: ['region'],
    steps: [{ type: 'crosstab', params: { row: 'region', col: 'channel', margins: true } }]
  },
  {
    name: 'merge with indicator then group',
    sortBy: ['manager'],
    steps: [
      { type: 'merge', params: { other: 'employees', how: 'left', leftOn: ['region'], rightOn: ['region'],
        suffixes: '_x, _y', indicator: true } },
      { type: 'groupby', params: { keys: ['manager'], aggs: [{ col: 'revenue', fn: 'sum', out: 'total' }] } }
    ]
  },
  {
    name: 'inner merge drops unmatched rows',
    sortBy: ['region'],
    steps: [{ type: 'merge', params: { other: 'employees', how: 'inner', leftOn: ['region'],
      rightOn: ['region'], suffixes: '_x, _y', indicator: false } }]
  },
  {
    name: 'datetime features and resample',
    steps: [
      { type: 'dt', params: { col: 'date', op: 'month', name: 'month' } },
      { type: 'groupby', params: { keys: ['month'], aggs: [{ col: 'revenue', fn: 'sum', out: 'total' }] } },
      { type: 'sort', params: { keys: [{ col: 'month', ascending: true }] } }
    ]
  },
  {
    name: 'rolling mean and rank',
    // pandas' default sort is not stable, so pin the order before comparing
    sortBy: ['order_id'],
    steps: [
      { type: 'sort', params: { keys: [{ col: 'date', ascending: true }] } },
      { type: 'rolling', params: { col: 'revenue', window: 7, fn: 'mean', minPeriods: 1, name: 'rev_ma7' } },
      { type: 'rank', params: { col: 'revenue', method: 'dense', ascending: false, name: 'rev_rank' } }
    ]
  },
  {
    name: 'string ops and value mapping',
    steps: [
      { type: 'strops', params: { col: 'region', op: 'upper', text: '', to: '', sep: '', index: 0, pattern: '', group: 1, name: 'region_up' } },
      { type: 'map', params: { col: 'channel', rules: 'Online = Web\nRetail = Store', keep: true, name: 'channel2' } },
      { type: 'select', params: { columns: ['region', 'region_up', 'channel', 'channel2'] } },
      { type: 'dedup', params: { columns: [], keep: 'first' } }
    ]
  },
  {
    name: 'clip, round and bin',
    steps: [
      { type: 'clip', params: { col: 'revenue', op: 'clip', lower: '0', upper: '3000', decimals: 2, periods: 1, name: 'rev_clipped' } },
      { type: 'clip', params: { col: 'unit_price', op: 'round', lower: '', upper: '', decimals: 1, periods: 1, name: 'price_round' } },
      { type: 'select', params: { columns: ['revenue', 'rev_clipped', 'unit_price', 'price_round'] } }
    ]
  },
  {
    name: 'concat of two tables',
    steps: [
      { type: 'select', params: { columns: ['region', 'category', 'revenue'] } },
      { type: 'concat', params: { other: 'retail' } }
    ],
    compare: 'shape'
  },
  {
    name: 'sample with a fixed random_state',
    steps: [{ type: 'sample', params: { mode: 'sample', n: 200, n2: 200, seed: '7' } }],
    compare: 'shape'
  }
];

/* ------------------------------ comparison ------------------------------ */
function cellKey(v) {
  if (v === null || v === undefined) return 'NA';
  if (v instanceof Date) return 'D' + v.toISOString().slice(0, 10);
  if (typeof v === 'number') return 'N' + v.toFixed(6);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return 'S' + String(v);
}

function compareFrames(appFrame, pyFrame, label, opts) {
  const sortBy = opts.sortBy || null;
  let a = appFrame, b = pyFrame;
  if (sortBy) {
    a = a.sortValues(sortBy.map(function (c) { return { col: c, ascending: true }; }));
    b = b.sortValues(sortBy.map(function (c) { return { col: c, ascending: true }; }));
  }
  const aNames = a.names.slice().sort();
  const bNames = b.names.slice().sort();
  ok(aNames.join(',') === bNames.join(','), label + ': same columns',
    { app: aNames, python: bNames });
  ok(a.nrows === b.nrows, label + ': same row count', { app: a.nrows, python: b.nrows });
  if (opts.compare === 'shape' || a.nrows !== b.nrows) return;
  const limit = Math.min(a.nrows, 400);
  let mismatches = 0, firstMismatch = null;
  for (let i = 0; i < limit; i++) {
    for (const col of aNames) {
      if (!b.has(col)) continue;
      const av = a.col(col)[i], bv = b.col(col)[i];
      let same;
      if (typeof av === 'number' && typeof bv === 'number') same = Math.abs(av - bv) <= Math.max(1e-6, Math.abs(av) * 1e-9);
      else same = cellKey(av) === cellKey(bv);
      if (!same) {
        mismatches += 1;
        if (!firstMismatch) firstMismatch = { row: i, col: col, app: cellKey(av), python: cellKey(bv) };
      }
    }
  }
  ok(mismatches === 0, label + ': same values (checked ' + limit + ' rows)', firstMismatch);
}

/* -------------------------------- runner -------------------------------- */
console.log('\nrunning ' + CASES.length + ' pipelines through real pandas');
CASES.forEach(function (c, index) {
  const steps = c.steps.map(function (s) { return { id: 's' + Math.random().toString(36).slice(2), type: s.type, params: s.params, enabled: true }; });
  let appRes;
  try {
    appRes = PV.ops.applyPipeline(retail, steps, ctx);
  } catch (e) {
    ok(false, c.name + ': the app pipeline runs', e.message);
    return;
  }
  const badStage = appRes.stages.filter(function (s) { return !s.ok; })[0];
  ok(!badStage, c.name + ': app pipeline has no failing step', badStage && badStage.error);
  if (badStage) return;

  const script = PV.ops.fullScript(datasets, 'retail', steps, {
    withLoader: true, varName: 'df', stages: appRes.stages,
    result: { nrows: appRes.df.nrows, ncols: appRes.df.ncols }
  });
  const file = path.join(TMP, 'case_' + index + '.py');
  fs.writeFileSync(file, script.text + '\ndf.to_csv("__out.csv", index=False)\n');
  const run = spawnSync(PY.cmd, [path.basename(file)], { cwd: TMP, encoding: 'utf8', timeout: 180000 });
  if (run.status !== 0) {
    ok(false, c.name + ': python runs the generated script', (run.stderr || '').split('\n').slice(-4).join(' | '));
    return;
  }
  let pyFrame;
  try {
    pyFrame = PV.io.frameFromText(fs.readFileSync(path.join(TMP, '__out.csv'), 'utf8'), {});
  } catch (e) {
    ok(false, c.name + ': the python result can be read back', e.message);
    return;
  }
  compareFrames(appRes.df, pyFrame, c.name, c);
});

fs.rmSync(TMP, { recursive: true, force: true });

console.log('\n' + '-'.repeat(60));
if (failed) {
  console.log(failed + ' failing checks:');
  failures.forEach(function (f) { console.log('  x ' + f); });
}
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
