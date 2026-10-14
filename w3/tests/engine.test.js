/* =============================================================================
 * Engine tests for Visual Pandas.
 *   node tests/engine.test.js
 * The browser modules are classic scripts that attach to `PV`, so they can be
 * evaluated directly in Node for headless testing of the data engine.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', 'js');
['util', 'i18n', 'stats', 'df', 'io', 'datasets'].forEach(function (name) {
  const code = fs.readFileSync(path.join(JS, name + '.js'), 'utf8');
  eval(code); // eslint-disable-line no-eval
});

const PV = globalThis.PV;
const U = PV.util, i18n = PV.i18n, S = PV.stats, D = PV.df, IO = PV.io, DS = PV.datasets;
const DataFrame = D.DataFrame;

let passed = 0, failed = 0;
const failures = [];

function ok(cond, label, extra) {
  if (cond) { passed += 1; return; }
  failed += 1;
  failures.push(label + (extra !== undefined ? '  ->  ' + JSON.stringify(extra) : ''));
}
function near(a, b, tol, label) {
  const same = Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
  ok(same, label, { got: a, want: b });
}
function eq(a, b, label) {
  ok(a === b, label, { got: a, want: b });
}
function group(label, fn) {
  console.log('\n' + label);
  fn();
}

/* ---------------------------------------------------------------- util --- */
group('rounding matches numpy (half to even)', () => {
  eq(U.roundHalfEven(0.5, 0), 0, 'np.around(0.5) -> 0');
  eq(U.roundHalfEven(1.5, 0), 2, 'np.around(1.5) -> 2');
  eq(U.roundHalfEven(2.5, 0), 2, 'np.around(2.5) -> 2');
  eq(U.roundHalfEven(-2.5, 0), -2, 'np.around(-2.5) -> -2');
  near(U.roundHalfEven(452.65, 1), 452.6, 1e-9, '452.65 -> 452.6 (half to even)');
  near(U.roundHalfEven(452.75, 1), 452.8, 1e-9, '452.75 -> 452.8');
  near(U.roundHalfEven(1.005, 2), 1.0, 1e-9, 'two decimals');
});

/* ---------------------------------------------------------------- i18n --- */
group('i18n: zh and en describe the same product', () => {
  const res = i18n.check();
  ok(res.ok, 'dictionary parity', res);
  ok(res.total > 400, 'dictionary is substantial (' + res.total + ' keys)');
  i18n.setLang('en', true);
  eq(i18n.t('op.groupby'), 'Group & aggregate', 'english lookup');
  i18n.setLang('zh', true);
  eq(i18n.t('op.groupby'), '分组聚合', 'chinese lookup');
  eq(i18n.t('misc.value_n', { n: 12 }), '12 个值', 'interpolation');
});

/* --------------------------------------------------------------- stats --- */
group('stats: pandas-compatible formulas', () => {
  const xs = [2, 4, 4, 4, 5, 5, 7, 9];
  near(S.mean(xs), 5, 1e-12, 'mean');
  near(S.std(xs), 2.138089935299395, 1e-12, 'std ddof=1');
  near(S.variance(xs), 4.571428571428571, 1e-12, 'variance ddof=1');
  near(S.median(xs), 4.5, 1e-12, 'median (linear interpolation)');
  near(S.quantile(xs, 0.25), 4, 1e-12, 'q25');
  near(S.skew(xs), 0.8184875533567996, 1e-12, 'unbiased skew');
  near(S.kurtosis(xs), 0.940625, 1e-9, 'unbiased excess kurtosis');
  near(S.pearson([1, 2, 3], [2, 4, 7]), 0.9933992677987828, 1e-12, 'pearson');
  near(S.spearman([1, 2, 3, 4], [1, 3, 2, 4]), 0.8, 1e-12, 'spearman with ties');
  const bx = S.boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
  near(bx.q1, 3.25, 1e-12, 'box q1');
  eq(bx.outliers.length, 1, 'IQR outlier count');
  eq(bx.outliers[0], 100, 'IQR outlier value');
  const h = S.histogram([1, 2, 2, 3, 3, 3, 4, 4, 5], 4);
  eq(h.counts.reduce((a, b) => a + b, 0), 9, 'histogram keeps every point');
});

/* --------------------------------------------------------- type infer --- */
group('dtypes: read_csv-style inference', () => {
  eq(D.inferDtype(['1', '2', '3']), 'int64', 'ints');
  eq(D.inferDtype(['1', '2', null]), 'float64', 'ints with NA promote to float');
  eq(D.inferDtype(['1.5', '2', '3']), 'float64', 'mixed int/float');
  eq(D.inferDtype(['true', 'False', 'yes']), 'bool', 'booleans');
  eq(D.inferDtype(['2024-01-05', '2024-02-11']), 'datetime64[ns]', 'dates');
  eq(D.inferDtype(['a', 'b', '1']), 'object', 'mixed stays object');
  eq(D.inferDtype(['North', 'North', 'South']), 'object', 'text stays object');
  ok(D.parseDate('2024-03-05') instanceof Date, 'ISO date parse');
  ok(D.parseDate('3/5/2024').getMonth() === 2, 'US date parse');
  ok(D.parseDate('not a date') === null, 'non-date rejected');
});

/* ------------------------------------------------------------ default --- */
const retail = DS.build('retail');
group('default dataset: retail orders', () => {
  eq(retail.shape[0], 2614, 'row count (2600 + 14 duplicates)');
  ok(retail.ncols >= 15, 'column count', retail.ncols);
  eq(retail.dtype('date'), 'datetime64[ns]', 'date dtype');
  eq(retail.dtype('units'), 'int64', 'units dtype');
  eq(retail.dtype('customer_age'), 'float64', 'age has NA -> float64');
  eq(retail.dtype('returned'), 'bool', 'returned dtype');
  eq(retail.dtype('region'), 'object', 'region dtype');
  eq(retail.duplicated([], 'first').filter(Boolean).length, 14, 'exactly 14 duplicates');
  near(retail.col('revenue')[10] - retail.col('cost')[10] - retail.col('profit')[10], 0, 0.011,
    'revenue - cost = profit');
  // defaults must never pick an id or free-text column
  eq(D.preferredCategoryColumn(retail), 'category', 'a real category is preferred over an id');
  ok(D.categoryColumns(retail).indexOf('order_id') < 0, 'id columns are excluded from grouping');
  ok(D.categoryColumns(retail).length >= 4, 'the usable categories are offered', D.categoryColumns(retail));
  eq(D.primaryNumericColumn(retail), 'revenue', 'the widest-spread measure is the default y');
  eq(D.preferredCategoryColumn(DS.build('iris')), 'species', 'works on iris too');
});

/* ------------------------------------------------------------- filter --- */
group('filter / sort / slice', () => {
  const east = retail.filter(retail.col('region').map((r) => r === 'East'));
  ok(east.nrows > 0 && east.nrows < retail.nrows, 'region filter reduces rows', east.nrows);
  ok(east.col('region').every((r) => r === 'East'), 'filter is exact');
  const sorted = retail.sortValues([{ col: 'revenue', ascending: false }]);
  ok(sorted.col('revenue')[0] >= sorted.col('revenue')[sorted.nrows - 1], 'descending sort');
  eq(retail.head(3).nrows, 3, 'head');
  eq(retail.tail(3).nrows, 3, 'tail');
  eq(retail.slice(5, 9).nrows, 4, 'slice');
  const s = retail.sample(10, { seed: 7 });
  eq(s.nrows, 10, 'sample size');
  eq(retail.sample(10, { seed: 7 }).col('order_id')[0], s.col('order_id')[0], 'sample is reproducible');
});

/* --------------------------------------------------------- groupby ------ */
group('groupby / agg', () => {
  const g = retail.groupby(['region']).agg([
    { col: 'revenue', fn: 'sum' },
    { col: 'profit', fn: 'mean' },
    { col: 'order_id', fn: 'count', out: 'orders' }
  ]);
  eq(g.nrows, 4, 'four regions');
  eq(g.names[0], 'region', 'key column first');
  ok(g.names.indexOf('orders') >= 0, 'custom output name');
  const total = g.col('revenue').reduce((a, b) => a + b, 0);
  near(total, S.sum(S.numeric(retail.col('revenue'))), 0.01, 'group sums equal the grand total');
  const multi = retail.groupby(['region', 'channel']).size();
  eq(multi.nrows, 12, 'region x channel groups');
  eq(multi.names[multi.names.length - 1], 'size', 'size column');
  const sizes = multi.col('size').reduce((a, b) => a + b, 0);
  eq(sizes, retail.dropna(['region', 'channel']).nrows, 'group sizes account for every row');
});

/* ------------------------------------------------------------ pivot ----- */
group('pivot_table / crosstab', () => {
  const p = retail.pivotTable({ index: ['region'], columns: ['channel'], values: 'revenue', aggfunc: 'sum' });
  eq(p.names[0], 'region', 'pivot index column');
  eq(p.ncols, 4, '3 channels + index');
  const dataCells = p.rows(0, p.nrows).map((r) => r.slice(1));
  near(dataCells.reduce((acc, r) => acc.concat(r), []).reduce((a, b) => a + b, 0),
    S.sum(S.numeric(retail.col('revenue'))), 0.1, 'pivot preserves the total');
  const pm = retail.pivotTable({
    index: ['region'], columns: ['channel'], values: 'revenue', aggfunc: 'mean', margins: true
  });
  eq(pm.col('All').length, 5, 'margins add a totals row');
  const ct = retail.crosstab('region', 'channel');
  eq(ct.nrows, 5, 'crosstab rows + All');
  ok(ct.chiSquare && ct.chiSquare.p >= 0 && ct.chiSquare.p <= 1, 'chi-square p-value is a probability');
});

/* ------------------------------------------------------------ merge ----- */
group('merge / concat', () => {
  const emp = DS.build('employees');
  eq(emp.dtype('since'), 'datetime64[ns]', 'astype to datetime');
  const m = retail.merge(emp, { leftOn: ['region'], rightOn: ['region'], how: 'left', indicator: true });
  eq(m.nrows, retail.nrows, 'left join keeps every left row');
  ok(m.names.indexOf('manager') >= 0, 'joined columns present');
  ok(m.names.indexOf('_merge') >= 0, 'indicator column');
  const managers = new Set(m.col('manager').filter(Boolean));
  eq(managers.size, 4, 'four regions matched, Central has no orders');
  const inner = retail.merge(emp, { leftOn: ['region'], rightOn: ['region'], how: 'inner' });
  eq(inner.nrows, m.col('manager').filter(Boolean).length, 'inner join row count');
  const outer = retail.merge(emp, { leftOn: ['region'], rightOn: ['region'], how: 'outer' });
  eq(outer.nrows, inner.nrows + 1, 'outer adds the unmatched Central row');
  const cat = retail.head(10).concat([retail.tail(5)], {});
  eq(cat.nrows, 15, 'concat stacks rows');
  const narrow = retail.select(['region']).head(3);
  const wide = narrow.concat([retail.head(2).select(['revenue'])], {});
  eq(wide.ncols, 2, 'concat unions columns');
  eq(wide.col('revenue').slice(0, 3).filter((v) => v === null).length, 3, 'concat fills missing with NaN');
});

/* --------------------------------------------------- missing / dedup ---- */
group('missing values and duplicates', () => {
  const noAge = retail.dropna(['customer_age'], 'any');
  ok(noAge.nrows < retail.nrows, 'dropna removes rows');
  ok(noAge.col('customer_age').every((v) => v !== null), 'dropna is complete');
  const filled = retail.fillna({ customer_age: { method: 'mean' }, rating: { method: 'value', value: '3' } });
  ok(filled.col('customer_age').every((v) => v !== null), 'fillna mean');
  eq(filled.col('rating').filter((v) => v === null).length, 0, 'fillna with a constant fills every gap');
  ok(filled.col('rating').filter((v) => v === 3).length >= retail.col('rating').filter((v) => v === null).length,
    'filled values land on the constant');
  const ff = DataFrame.fromColumns({ x: [1, null, null, 4] });
  eq(ff.fillna({ x: { method: 'ffill' } }).col('x').join(','), '1,1,1,4', 'forward fill');
  eq(ff.fillna({ x: { method: 'bfill' } }).col('x').join(','), '1,4,4,4', 'backward fill');
  const dd = DataFrame.fromColumns({ a: [1, 1, 2, 2, 3], b: ['x', 'x', 'y', 'z', 'z'] });
  eq(dd.dropDuplicates(['a', 'b'], 'first').nrows, 4, 'drop_duplicates first');
  eq(dd.dropDuplicates(['a'], 'last').nrows, 3, 'drop_duplicates last');
  eq(dd.dropDuplicates([], false).nrows, 3, 'drop_duplicates keep=False');
});

/* ---------------------------------------------------- describe / corr --- */
group('describe / corr / value_counts', () => {
  const desc = retail.describeNumeric(['units', 'revenue', 'profit']);
  eq(desc.statistic.length, 8, 'eight summary rows');
  eq(desc.columns.length, 3, 'three described columns');
  const meanRow = desc.values[desc.statistic.indexOf('mean')];
  near(meanRow[1], S.mean(S.numeric(retail.col('revenue'))), 0.01, 'describe mean matches');
  const cd = retail.describeCategorical(['region']);
  eq(cd.values[cd.statistic.indexOf('unique')][0], 4, 'categorical unique count');
  const cor = retail.corr(['units', 'unit_price', 'revenue', 'profit']);
  eq(cor.matrix[0][0], 1, 'self correlation is 1');
  near(cor.matrix[1][0], cor.matrix[0][1], 1e-12, 'matrix is symmetric');
  ok(Math.abs(cor.matrix[2][3]) > Math.abs(cor.matrix[0][1]), 'revenue and profit correlate strongly');
  near(S.corr([1, 2, 3, 4, 5], [2, 4, 6, 8, 10], 'pearson'), 1, 1e-12, 'perfect positive correlation');
  const vc = retail.valueCounts('region');
  eq(vc.length, 4, 'value_counts categories');
  ok(vc[0].count >= vc[1].count, 'sorted by frequency');
  near(vc[vc.length - 1].cumulative, 1, 1e-9, 'cumulative share reaches 1');
  const limited = retail.valueCounts('country', { limit: 3 });
  eq(limited.length, 4, 'limit buckets the tail into "other"');
  ok(limited[3].isOther === true, 'other row flagged');
});

/* --------------------------------------------------------- dtypes 2 ----- */
group('casts', () => {
  const f = DataFrame.fromRecords([
    { name: '  apple ', qty: '3', when: '2024-01-05' },
    { name: 'Banana', qty: '4', when: '2024-02-11' }
  ]);
  eq(f.astype('qty', 'int64').col('qty')[0], 3, 'cast string to int');
  eq(f.astype('when', 'datetime64[ns]').dtype('when'), 'datetime64[ns]', 'cast to datetime');
  const b = DataFrame.fromColumns({ flag: ['true', 'false', 'yes'] });
  eq(b.astype('flag', 'bool').col('flag')[2], true, 'cast to bool');
});

/* ------------------------------------------------------- resample ------- */
group('resample / rolling', () => {
  const air = DS.build('air');
  eq(air.nrows, 3 * 90 * 24, 'air quality rows');
  ok(air.col('pm25').filter((v) => v === null).length > 40, 'sensor outages left gaps');
  const perCity = air.groupby(['city']).agg([{ col: 'pm25', fn: 'mean' }]);
  eq(perCity.nrows, 3, 'one row per city');
  const beijing = air.filter(air.col('city').map((c) => c === 'Beijing'));
  const daily = beijing.resample('timestamp', 'day', [{ col: 'pm25', fn: 'mean', out: 'pm25_mean' }]);
  ok(daily.nrows === 90 || daily.nrows === 91, 'resampled to ~90 days', daily.nrows);
  eq(daily.dtype('timestamp'), 'datetime64[ns]', 'resampled index is datetime');
  const roll = S.rolling([1, 2, 3, 4, 5], 3, (w) => S.mean(w));
  eq(roll.slice(0, 3).join('|'), '||2', 'rolling mean warms up like pandas');
  eq(roll.slice(3).join(','), '3,4', 'rolling mean values');
});

/* ------------------------------------------------------------- CSV ----- */
group('csv / json round trip', () => {
  const csv = IO.toCSVFrame(retail.slice(0, 100));
  const back = IO.frameFromText(csv, {});
  eq(back.nrows, 100, 'csv row count');
  eq(back.ncols, retail.ncols, 'csv column count');
  eq(back.dtype('units'), 'int64', 'csv dtype inference');
  eq(back.dtype('date'), 'datetime64[ns]', 'csv datetime inference');
  const messy = 'a,b\n1,"hello, world"\n2,"say ""hi"""\n';
  const parsed = IO.frameFromText(messy, {});
  eq(parsed.col('b')[0], 'hello, world', 'quoted comma');
  eq(parsed.col('b')[1], 'say "hi"', 'escaped quotes');
  const semi = 'a;b;c\n1;2;3\n4;5;6';
  eq(IO.detectDelimiter(semi).char, ';', 'detects semicolons');
  eq(IO.frameFromText(semi, {}).ncols, 3, 'parses semicolon files');
  eq(IO.frameFromText('x\ty\n1\t2', {}).ncols, 2, 'parses tabs');
  const json = IO.frameFromText(JSON.stringify([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]), {});
  eq(json.nrows, 2, 'json records');
  const cols = IO.frameFromText(JSON.stringify({ a: [1, 2, 3], b: ['x', 'y', 'z'] }), {});
  eq(cols.nrows, 3, 'json columns orient');
  eq(IO.frameFromText('{"a":1}\n{"a":2}\n', { filename: 'x.jsonl' }).nrows, 2, 'json lines');
  eq(IO.frameFromText('1,2,3\n4,5,6', { header: false }).names[0], 'Column1', 'header=false names');
  eq(IO.frameFromText('a,b\n1,NA\n2,\n', {}).col('b').filter((v) => v === null).length, 2,
    'NA markers become null');
});

/* ------------------------------------------------------- generators ---- */
group('random data generator', () => {
  const g = DS.generate({ rows: 800, cols: 10, seed: 'abc', nullPct: 0.05, pattern: 'trend' });
  eq(g.nrows, 800, 'generated rows');
  eq(g.ncols, 10, 'generated columns');
  eq(g.dtype('date'), 'datetime64[ns]', 'generator makes dates');
  ok(g.info().some((c) => c.missing > 0), 'generator injects missing values');
  const g2 = DS.generate({ rows: 50, cols: 8, seed: 'abc' });
  const g3 = DS.generate({ rows: 50, cols: 8, seed: 'abc' });
  eq(g2.col('metric_1')[3], g3.col('metric_1')[3], 'generator is deterministic');
});

/* ------------------------------------------------------------ irises ---- */
group('iris sample', () => {
  const iris = DS.build('iris');
  eq(iris.nrows, 150, 'iris rows');
  eq(iris.valueCounts('species').length, 3, 'three species');
  const setosa = iris.filter(iris.col('species').map((s) => s === 'setosa'));
  const versi = iris.filter(iris.col('species').map((s) => s === 'versicolor'));
  ok(S.mean(S.numeric(setosa.col('petal_length'))) < S.mean(S.numeric(versi.col('petal_length'))),
    'setosa petals are shorter');
});

console.log('\n' + '-'.repeat(60));
if (failed) {
  console.log(failed + ' failing checks:');
  failures.forEach((f) => console.log('  x ' + f));
}
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
