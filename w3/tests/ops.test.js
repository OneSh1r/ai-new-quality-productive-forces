/* =============================================================================
 * Operation + code-generation tests.
 *   node tests/ops.test.js
 * Every registered operation is applied with its own defaults to the default
 * dataset, and its generated pandas code is inspected.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', 'js');
['util', 'i18n', 'stats', 'df', 'io', 'datasets', 'expr', 'ops'].forEach(function (name) {
  eval(fs.readFileSync(path.join(JS, name + '.js'), 'utf8')); // eslint-disable-line no-eval
});

const PV = globalThis.PV;
const D = PV.df, DS = PV.datasets, OPS = PV.ops, EXPR = PV.expr;

let passed = 0, failed = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { passed += 1; return; }
  failed += 1;
  failures.push(label + (extra !== undefined ? '  ->  ' + JSON.stringify(extra) : ''));
}
function eq(a, b, label) { ok(a === b, label, { got: a, want: b }); }
function group(label, fn) { console.log('\n' + label); fn(); }

const retail = DS.build('retail');
const employees = DS.build('employees');
const iris = DS.build('iris');
const datasets = [
  { id: 'retail', name: 'retail_orders', nameZh: '全球零售订单', nameEn: 'Global retail orders', df: retail, source: { kind: 'sample', name: 'retail_orders', file: 'retail_orders.csv' } },
  { id: 'employees', name: 'regional_managers', nameZh: '区域负责人', nameEn: 'Regional managers', df: employees, source: { kind: 'sample', name: 'regional_managers', file: 'regional_managers.csv' } }
];
const ctx = { datasets: datasets, activeId: 'retail' };

/* ---------------------------------------------------- operation smoke ---- */
group('every operation applies with its defaults', () => {
  PV.i18n.setLang('zh', true);
  OPS.REGISTRY.forEach(function (def) {
    const params = OPS.defaults(def.id, retail, ctx);
    let out = null, err = null;
    try {
      out = OPS.applyPipeline(retail, [{ id: 's1', type: def.id, params: params }], ctx);
    } catch (e) { err = e.message; }
    ok(!err, 'op ' + def.id + ' runs', err);
    if (out) {
      const stage = out.stages[0];
      ok(stage.ok, 'op ' + def.id + ' stage ok', stage.error);
      ok(out.df && out.df.nrows >= 0, 'op ' + def.id + ' returns a frame');
      const code = OPS.buildCode(retail, [{ id: 's1', type: def.id, params: params }], ctx, { stages: out.stages });
      ok(code.steps[0].code.length > 0 || def.id === 'rename', 'op ' + def.id + ' generates code');
      code.steps[0].code.forEach(function (line) {
        ok(typeof line === 'string' && line.length > 0, 'op ' + def.id + ' code line is text');
        ok(line.indexOf('undefined') < 0, 'op ' + def.id + ' code has no undefined', line);
        ok(line.indexOf('[object') < 0, 'op ' + def.id + ' code has no [object]', line);
      });
    }
    // i18n keys used by the palette must exist
    ok(PV.i18n.has('op.' + def.id), 'i18n: op.' + def.id);
    ok(PV.i18n.has('op.' + def.id + '.desc'), 'i18n: op.' + def.id + '.desc');
  });
});

/* ----------------------------------------------------------- filtering --- */
group('filter: visual conditions match the code', () => {
  const step = {
    id: 'f1', type: 'filter',
    params: {
      mode: 'visual', match: 'all',
      conds: [
        { col: 'region', op: 'eq', value: 'East' },
        { col: 'revenue', op: 'gt', value: '2500' }
      ]
    }
  };
  const res = OPS.applyPipeline(retail, [step], ctx);
  ok(res.stages[0].ok, 'filter applies', res.stages[0].error);
  ok(res.df.nrows > 0 && res.df.nrows < retail.nrows, 'filter reduces rows', res.df.nrows);
  ok(res.df.col('region').every((v) => v === 'East'), 'string condition holds');
  ok(res.df.col('revenue').every((v) => v > 2500), 'numeric condition holds');
  const code = OPS.buildCode(retail, [step], ctx, { stages: res.stages }).steps[0].code.join('\n');
  ok(code.indexOf('df["region"] == "East"') >= 0, 'code quotes strings', code);
  ok(code.indexOf('df["revenue"] > 2500') >= 0, 'code keeps numbers unquoted', code);
  // between / isin / isna
  const between = OPS.applyPipeline(retail, [{
    id: 'f2', type: 'filter',
    params: { mode: 'visual', match: 'all', conds: [{ col: 'units', op: 'between', value: '5', value2: '10' }] }
  }], ctx);
  ok(between.df.nrows > 0 && between.df.col('units').every((v) => v >= 5 && v <= 10), 'between');
  const isna = OPS.applyPipeline(retail, [{
    id: 'f3', type: 'filter',
    params: { mode: 'visual', match: 'all', conds: [{ col: 'rating', op: 'isna' }] }
  }], ctx);
  ok(isna.df.col('rating').every((v) => v === null), 'isna finds the gaps');
  eq(isna.df.nrows, retail.col('rating').filter((v) => v === null).length, 'isna row count');
  // text mode
  const text = OPS.applyPipeline(retail, [{
    id: 'f4', type: 'filter', params: { mode: 'text', expr: 'revenue > 2500 and region == "East"' }
  }], ctx);
  ok(text.stages[0].ok, 'expression filter applies', text.stages[0].error);
  eq(text.df.nrows, res.df.nrows, 'expression and visual filter agree');
  const py = OPS.buildCode(retail, [{
    id: 'f4', type: 'filter', params: { mode: 'text', expr: 'revenue > 2500 and region == "East"' }
  }], ctx).steps[0].code.join('');
  ok(py.indexOf('df["revenue"] > 2500') > 0 && py.indexOf('&') > 0, 'expression translates to pandas', py);
});

/* ------------------------------------------------------------ groupby ---- */
group('groupby: results, chart shape and code', () => {
  const step = {
    id: 'g1', type: 'groupby',
    params: { keys: ['region', 'channel'], aggs: [{ col: 'revenue', fn: 'sum', out: 'revenue_total' }, { col: 'profit', fn: 'mean', out: '' }] }
  };
  const res = OPS.applyPipeline(retail, [step], ctx);
  ok(res.stages[0].ok, 'groupby applies', res.stages[0].error);
  eq(res.df.nrows, 12, 'region x channel');
  ok(res.df.names.indexOf('revenue_total') >= 0, 'custom output column');
  const code = OPS.buildCode(retail, [step], ctx, { stages: res.stages }).steps[0].code.join('\n');
  ok(code.indexOf('groupby(["region", "channel"], as_index=False)') > 0, 'code groups', code);
  ok(code.indexOf('revenue_total=("revenue", "sum")') > 0, 'code names the aggregation', code);
  const total = res.df.col('revenue_total').reduce((a, b) => a + b, 0);
  ok(Math.abs(total - PV.stats.sum(PV.stats.numeric(retail.col('revenue')))) < 0.5, 'totals preserved');
});

/* ------------------------------------------------------------- pivot ----- */
group('pivot and crosstab operations', () => {
  const res = OPS.applyPipeline(retail, [{
    id: 'p1', type: 'pivot',
    params: { index: 'region', columns: 'channel', values: 'revenue', aggfunc: 'mean', margins: true, fillValue: '0' }
  }], ctx);
  ok(res.stages[0].ok, 'pivot applies', res.stages[0].error);
  eq(res.df.nrows, 5, 'four regions + totals');
  ok(res.df.names.indexOf('All') > 0, 'margins column');
  const code = OPS.buildCode(retail, [{
    id: 'p1', type: 'pivot',
    params: { index: 'region', columns: 'channel', values: 'revenue', aggfunc: 'mean', margins: true, fillValue: '0' }
  }], ctx).steps[0].code.join('\n');
  ok(code.indexOf('pivot_table') > 0 && code.indexOf('margins=True') > 0, 'pivot code', code);
  const ct = OPS.applyPipeline(retail, [{
    id: 'c1', type: 'crosstab', params: { row: 'region', col: 'channel', margins: true }
  }], ctx);
  ok(ct.stages[0].ok, 'crosstab applies', ct.stages[0].error);
  ok(ct.df.nrows === 5, 'crosstab with totals');
});

/* ------------------------------------------------------------- merges ---- */
group('merge / concat operations', () => {
  const params = OPS.defaults('merge', retail, ctx);
  eq(params.other, 'employees', 'merge defaults to the other dataset');
  eq(params.leftOn[0], 'region', 'merge auto-detects a shared key');
  const res = OPS.applyPipeline(retail, [{ id: 'm1', type: 'merge', params: params }], ctx);
  ok(res.stages[0].ok, 'merge applies', res.stages[0].error);
  eq(res.df.nrows, retail.nrows, 'left join keeps all rows');
  const code = OPS.buildCode(retail, [{ id: 'm1', type: 'merge', params: params }], ctx, { stages: res.stages });
  ok(code.steps[0].code.join('\n').indexOf('df.merge(') > 0, 'merge code');
  eq(code.referenced[0], 'employees', 'merge tracks the referenced dataset');
  const script = OPS.fullScript(datasets, 'retail', [{ id: 'm1', type: 'merge', params: params }], { stages: res.stages });
  ok(script.text.indexOf('regional_managers = pd.read_csv') > 0, 'full script loads the second table', script.text.slice(0, 400));
  ok(script.text.indexOf('df = df.merge(') > 0, 'full script contains the join');
  const cc = OPS.applyPipeline(retail, [{ id: 'c1', type: 'concat', params: { other: 'retail' } }], ctx);
  ok(cc.stages[0].ok, 'concat applies', cc.stages[0].error);
  eq(cc.df.nrows, retail.nrows * 2, 'concat doubles the rows');
});

/* ---------------------------------------------------- chained pipeline --- */
group('chained pipeline + stages + code', () => {
  const steps = [
    { id: 's1', type: 'filter', params: { mode: 'visual', match: 'all', conds: [{ col: 'returned', op: 'eq', value: 'false' }] } },
    { id: 's2', type: 'assign', params: { name: 'margin', expr: 'profit / revenue', position: 'end' } },
    { id: 's3', type: 'filter', params: { mode: 'visual', match: 'all', conds: [{ col: 'margin', op: 'gt', value: '0.2' }] } },
    { id: 's4', type: 'groupby', params: { keys: ['region'], aggs: [{ col: 'margin', fn: 'mean', out: 'avg_margin' }, { col: 'revenue', fn: 'sum', out: 'revenue_sum' }] } },
    { id: 's5', type: 'sort', params: { keys: [{ col: 'revenue_sum', ascending: false }] } },
    { id: 's6', type: 'missing', params: { mode: 'fillna', columns: ['avg_margin'], method: 'mean', value: '' } }
  ];
  const res = OPS.applyPipeline(retail, steps, ctx);
  equalStages(res);
  function equalStages(r) {
    r.stages.forEach(function (s, i) {
      ok(s.ok, 'chain step ' + (i + 1) + ' (' + s.type + ') ok', s.error);
    });
  }
  ok(res.df.nrows <= 4, 'final result is per-region', res.df.nrows);
  ok(res.df.has('margin') === false, 'margin was aggregated away');
  const built = OPS.buildCode(retail, steps, ctx, { stages: res.stages });
  ok(built.steps.length === 6, 'six code blocks');
  const script = OPS.fullScript(datasets, 'retail', steps, { stages: res.stages });
  ['df["margin"] = (df["profit"] / df["revenue"])', 'groupby', 'sort_values', 'fillna', 'pd.read_csv'].forEach(function (needle) {
    ok(script.text.indexOf(needle) > 0, 'script mentions ' + needle);
  });
  ok(script.text.indexOf('def ') < 0, 'script is plain pandas, no scaffolding');
  const result = OPS.applyPipeline(retail, steps, ctx);
  eq(result.df.fullSignature(), res.df.fullSignature(), 'pipeline is deterministic');
});

/* -------------------------------------------------------- expressions ---- */
group('expression language', () => {
  const cases = [
    ['units * unit_price', (v) => v.units * v.unit_price],
    // round() follows numpy: half to even, not half up
    ['round(revenue / units, 2)', (v) => PV.util.roundHalfEven(v.revenue / v.units, 2)],
    ['where(returned, 0, profit)', (v) => (v.returned ? 0 : v.profit)],
    ['year(date) * 100 + month(date)', (v) => v.date.getFullYear() * 100 + (v.date.getMonth() + 1)],
    ['upper(region) + "-" + upper(channel)', (v) => v.region.toUpperCase() + '-' + v.channel.toUpperCase()],
    ['contains(country, "U")', (v) => v.country.indexOf('U') >= 0],
    ['isnull(rating)', (v) => v.rating === null],
    ['revenue > 1000 and not returned', (v) => v.revenue > 1000 && !v.returned],
    ['len(category) * 2', (v) => v.category.length * 2],
    ['clip(units, 2, 5) * 10', (v) => Math.min(5, Math.max(2, v.units)) * 10],
    ['df.revenue - df.cost', (v) => v.revenue - v.cost],
    ['[unit price] > 100', null]
  ];
  const sample = retail.slice(0, 200);
  cases.forEach(function (pair) {
    const src = pair[0], fn = pair[1];
    if (!fn) return;
    const res = EXPR.evaluate(src, sample);
    let bad = 0;
    for (let i = 0; i < sample.nrows; i++) {
      const expect = fn(sample.rowObject(i));
      const got = res.values[i];
      if (typeof expect === 'number' && isNaN(expect)) continue;
      if (got === null && expect === null) continue;
      if (typeof expect === 'number' && typeof got === 'number') {
        if (Math.abs(expect - got) > 1e-9) bad += 1;
      } else if (String(got) !== String(expect)) bad += 1;
    }
    ok(bad === 0, 'expr `' + src + '` matches plain JS', { mismatches: bad });
    ok(res.python.length > 0, 'expr `' + src + '` has python');
  });
  const py = EXPR.compile('where(profit / revenue > 0.3, "high", "low")').python('df');
  ok(py.indexOf('np.where(') === 0, 'where → np.where', py);
  ok(EXPR.compile('profit / revenue').python('df') === '(df["profit"] / df["revenue"])', 'column refs become df[...]');
  let threw = false;
  try { EXPR.evaluate('revenue >', sample); } catch (e) { threw = true; }
  ok(threw, 'syntax errors are reported');
  threw = false;
  try { EXPR.evaluate('nope + 1', sample); } catch (e) { threw = true; }
  ok(threw, 'unknown columns are reported');
});

/* --------------------------------------------------------- step errors --- */
group('bad steps are reported, not fatal', () => {
  const steps = [
    { id: 'a', type: 'drop', params: { columns: ['region'] } },
    { id: 'b', type: 'filter', params: { mode: 'visual', match: 'all', conds: [{ col: 'ghost', op: 'gt', value: '1' }] } },
    { id: 'c', type: 'sample', params: { mode: 'head', n: 5 } }
  ];
  const res = OPS.applyPipeline(retail, steps, ctx);
  ok(res.stages[0].ok, 'first step ok');
  eq(res.stages[1].ok, false, 'broken step marked failed');
  ok(!!res.stages[1].error, 'error message present', res.stages[1].error);
  ok(res.stages[2].ok, 'later steps still run');
  eq(res.df.nrows, 5, 'the pipeline kept going');
  ok(res.df.has('region') === false, 'earlier step kept');
});

/* -------------------------------------------------------- disabled step -- */
group('disabled steps are skipped everywhere', () => {
  const steps = [{ id: 's', type: 'sample', params: { mode: 'head', n: 10 }, enabled: false }];
  const res = OPS.applyPipeline(retail, steps, ctx);
  eq(res.df.nrows, retail.nrows, 'disabled step does not run');
  eq(res.stages[0].skipped, true, 'stage marked skipped');
  const built = OPS.buildCode(retail, steps, ctx, { stages: res.stages });
  eq(built.steps[0].code.length, 0, 'no code for a disabled step');
  const script = OPS.fullScript(datasets, 'retail', steps, { stages: res.stages });
  ok(script.text.indexOf('.head(10)') < 0, 'disabled step absent from the script');
});

console.log('\n' + '-'.repeat(60));
if (failed) {
  console.log(failed + ' failing checks:');
  failures.forEach((f) => console.log('  x ' + f));
}
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
