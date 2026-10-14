/* =============================================================================
 * Runs every test suite and prints a summary.
 *   node tests/run-all.js
 * ========================================================================== */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  ['engine', 'DataFrame, statistics, parsing, datasets'],
  ['ops', 'every operation, its code generation and the expression language'],
  ['charts', 'chart geometry, axes, bucketing and themes'],
  ['xlsx', 'the ZIP + XLSX reader'],
  ['python-equivalence', 'runs the generated pandas code with real pandas'],
  ['ui', 'translation keys, icons, styles, script order'],
  ['ui-boot', 'boots the whole interface against a DOM shim'],
  ['e2e-core', 'real browser: boot, loading, all operations, code, table'],
  ['e2e-ui', 'real browser: charts, profile, builders, joins, exports, layout']
];

let failedSuites = 0;
const results = [];

SUITES.forEach(function (suite) {
  const file = path.join(__dirname, suite[0] + '.test.js');
  const res = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  const output = (res.stdout || '') + (res.stderr || '');
  const m = /(\d+) passed, (\d+) failed/.exec(output);
  const passed = m ? Number(m[1]) : 0;
  const failed = m ? Number(m[2]) : 0;
  if (res.status !== 0 || failed) failedSuites += 1;
  results.push({ name: suite[0], about: suite[1], passed: passed, failed: failed, ok: res.status === 0 });
  if (res.status !== 0) {
    console.log('\n=== ' + suite[0] + ' failed ===');
    console.log(output.split('\n').slice(-24).join('\n'));
  }
});

console.log('\nVisual Pandas — test summary');
console.log('-'.repeat(74));
let totalPassed = 0, totalFailed = 0;
results.forEach(function (r) {
  totalPassed += r.passed;
  totalFailed += r.failed;
  console.log((r.ok ? '  ok  ' : ' FAIL ') + r.name.padEnd(10) +
    String(r.passed).padStart(5) + ' passed  ' + String(r.failed).padStart(3) + ' failed   ' + r.about);
});
console.log('-'.repeat(74));
console.log('  ' + totalPassed + ' checks passed, ' + totalFailed + ' failed, ' +
  failedSuites + ' suite(s) with problems');
process.exit(failedSuites ? 1 : 0);
