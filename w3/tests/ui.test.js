/* =============================================================================
 * Static consistency tests for the UI layer.
 *   node tests/ui.test.js
 * The browser UI cannot run in Node, so instead of executing it we scan every
 * module and verify the things that would break silently in a browser:
 *   - every literal t('key') exists in the dictionary
 *   - every icon name exists in PV.icons
 *   - every operation id used by the UI exists in the registry
 *   - every PV.<module> reference is defined somewhere
 *   - index.html loads the modules in a working order
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', 'js');
const files = fs.readdirSync(JS).filter(f => /\.js$/.test(f));
const sources = {};
files.forEach(f => { sources[f] = fs.readFileSync(path.join(JS, f), 'utf8'); });

['util', 'i18n', 'stats', 'df', 'io', 'datasets', 'expr', 'icons', 'ops'].forEach(name => {
  eval(sources[name + '.js']); // eslint-disable-line no-eval
});
const PV = globalThis.PV;

let passed = 0, failed = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { passed += 1; return; }
  failed += 1;
  failures.push(label + (extra !== undefined ? '  ->  ' + JSON.stringify(extra) : ''));
}
function group(label, fn) { console.log('\n' + label); fn(); }

function scan(pattern) {
  const rx = new RegExp(pattern.source, pattern.flags);
  const hits = [];
  files.forEach(f => {
    let m;
    rx.lastIndex = 0;
    while ((m = rx.exec(sources[f]))) hits.push({ file: f, key: m[1] });
  });
  return hits;
}

group('every literal translation key exists', () => {
  const hits = scan(/\bt\('([A-Za-z0-9_.]+)'\)/g);
  PV.i18n.setLang('zh', true);
  const missingZh = hits.filter(h => !PV.i18n.has(h.key));
  PV.i18n.setLang('en', true);
  const missingEn = hits.filter(h => !PV.i18n.has(h.key));
  PV.i18n.setLang('zh', true);
  ok(missingZh.length === 0, 'zh dictionary covers every key',
    missingZh.map(h => h.file + ':' + h.key));
  ok(missingEn.length === 0, 'en dictionary covers every key',
    missingEn.map(h => h.file + ':' + h.key));
  ok(hits.length > 150, 'scanner found many keys (' + hits.length + ')');
});

group('no duplicated keys inside a dictionary', () => {
  // A repeated key silently wins in JS, so the *literal* is what has to be
  // checked: two entries with the same name meant one text never showed up.
  const src = sources['i18n.js'];
  const blocks = [['zh', /var zh = \{([\s\S]*?)\n  \};/.exec(src)],
    ['en', /var en = \{([\s\S]*?)\n  \};/.exec(src)]];
  ok(blocks[0][1] && blocks[1][1], 'both dictionaries were found');
  blocks.forEach(function (pair) {
    if (!pair[1]) return;
    const seen = {};
    const dupes = [];
    const re = /^\s*'([^']+)':/gm;
    let hit;
    while ((hit = re.exec(pair[1][1]))) {
      if (seen[hit[1]]) dupes.push(hit[1]);
      seen[hit[1]] = true;
    }
    ok(dupes.length === 0, pair[0] + ' dictionary has no duplicate keys', dupes);
    ok(Object.keys(seen).length > 400, pair[0] + ' dictionary is populated (' + Object.keys(seen).length + ')');
  });
});

group('index.html translation attributes', () => {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  if (!fs.existsSync(htmlPath)) { ok(false, 'index.html exists'); return; }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const re = /data-i18n(?:-[\w-]+)?="([A-Za-z0-9_.]+)"/g;
  const keys = [];
  let m;
  while ((m = re.exec(html))) keys.push(m[1]);
  const missing = keys.filter(k => !PV.i18n.has(k));
  ok(missing.length === 0, 'html keys exist in the dictionary', missing);
});

group('icon names', () => {
  const hits = scan(/\bicon(?:Button)?\('([A-Za-z0-9_]+)'/g);
  const missing = hits.filter(h => !PV.icons[h.key]);
  ok(missing.length === 0, 'all icon() names exist', missing.map(h => h.file + ':' + h.key));
  const opMissing = PV.ops.REGISTRY.filter(d => !PV.icons[d.icon]);
  ok(opMissing.length === 0, 'all operation icons exist', opMissing.map(d => d.id + ':' + d.icon));
  // Shape check: icons.js holds bare "M..." path data, and the two places that
  // build <svg> markup have to wrap it in a <path>. Putting the data straight
  // inside <svg> paints nothing — every icon in the app disappears.
  const names = Object.keys(PV.icons);
  const bad = names.filter(n => /[<>&"]/.test(PV.icons[n]) || !/^[Mm]/.test(String(PV.icons[n]).trim()));
  ok(bad.length === 0, 'every icon is bare SVG path data', bad.slice(0, 6));
  ok(names.length > 40, 'the icon set is complete (' + names.length + ' icons)');
  ['ui.js', 'charts.js'].forEach(f => {
    const src = sources[f];
    ok(/<path d="/.test(src), f + ' wraps icon path data in a <path> element');
  });
});

group('chart type coverage', () => {
  const src = sources['views-charts.js'];
  const listMatch = /var TYPES = \[([^\]]+)\]/.exec(src);
  ok(!!listMatch, 'TYPES list found');
  const types = listMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
  const engine = sources['charts.js'] + sources['chart-prep.js'] + sources['marks-xy.js'] +
    sources['marks-points.js'] + sources['marks-special.js'];
  types.forEach(ty => {
    ok(PV.i18n.has('charts.type.' + ty), 'i18n has charts.type.' + ty);
    ok(new RegExp("'" + ty + "'").test(engine), 'chart engine mentions ' + ty);
  });
  ok(PV.i18n.has('charts.type.bubble') && types.indexOf('bubble') >= 0, 'bubble chart offered');
});

group('operation ids used by the UI', () => {
  const hits = scan(/(?:openOpForm|addStep)\('([a-z_]+)'/g);
  const missing = hits.filter(h => !PV.ops.BY_ID[h.key]);
  ok(missing.length === 0, 'all referenced op ids exist', missing.map(h => h.file + ':' + h.key));
  const badGroup = PV.ops.REGISTRY.filter(d => PV.ops.GROUPS.indexOf(d.group) < 0);
  ok(badGroup.length === 0, 'every operation belongs to a palette group', badGroup.map(d => d.id));
  const allowed = ['select', 'number', 'text', 'textarea', 'mapping', 'switch', 'columns',
    'sortkeys', 'conds', 'aggspec', 'colmap', 'expression', 'dataset'];
  const badType = [];
  PV.ops.REGISTRY.forEach(d => {
    d.params.forEach(f => { if (allowed.indexOf(f.type) < 0) badType.push(d.id + '.' + f.key + ':' + f.type); });
  });
  ok(badType.length === 0, 'all parameter field types are implemented', badType);
  ok(PV.ops.REGISTRY.length >= 20, 'operation registry is rich (' + PV.ops.REGISTRY.length + ' ops)');
});

group('module namespaces', () => {
  const defined = new Set();
  const reDef = /PV\.([A-Za-z0-9_]+)\s*=/g;
  files.forEach(f => {
    let m;
    reDef.lastIndex = 0;
    while ((m = reDef.exec(sources[f]))) defined.add(m[1]);
  });
  const unknown = [];
  const seen = new Set();
  scan(/PV\.([A-Za-z0-9_]+)/g).forEach(h => {
    if (defined.has(h.key) || seen.has(h.key)) return;
    seen.add(h.key);
    unknown.push(h.file + ':PV.' + h.key);
  });
  ok(unknown.length === 0, 'every PV.<module> reference is defined', unknown);
});

group('stylesheets cover the classes the code builds', () => {
  const cssPath = path.join(__dirname, '..', 'assets', 'styles.css');
  if (!fs.existsSync(cssPath)) { ok(false, 'styles.css exists'); return; }
  const css = fs.readFileSync(cssPath, 'utf8');
  const used = new Set();
  const re = /\b[hs]\('([a-zA-Z][\w-]*(?:[.#][\w-]+)+)'/g;
  files.forEach(f => {
    // ignore comments so documentation examples do not count as usage
    const src = sources[f].split('\n').filter(line => line.trim().indexOf('//') !== 0).join('\n');
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(src))) {
      m[1].split('.').slice(1).forEach(part => {
        const cls = part.split('#')[0];
        if (cls) used.add(cls);
      });
    }
  });
  const missing = [];
  used.forEach(cls => {
    // skip fragments that are completed at runtime, e.g. 'match-' + kind
    if (cls.indexOf('"') >= 0 || cls.indexOf('+') >= 0 || /-$/.test(cls)) return;
    if (!new RegExp('\\.' + cls.replace(/[-]/g, '\\-') + '(?![\\w-])').test(css)) missing.push(cls);
  });
  ok(missing.length === 0, 'every class has a style rule', missing);
  ok(used.size > 100, 'styles cover a rich interface (' + used.size + ' classes)');
  // the theme must define both palettes and the chart series colours
  ['data-theme="dark"', 'data-theme="light"', '--c1:', '--c6:', '--accent:'].forEach(token => {
    ok(css.indexOf(token) >= 0, 'stylesheet defines ' + token);
  });
  const open = (css.match(/\{/g) || []).length;
  const close = (css.match(/\}/g) || []).length;
  ok(open === close, 'css braces balance', { open: open, close: close });
});

group('index.html script order', () => {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  if (!fs.existsSync(htmlPath)) return;
  const html = fs.readFileSync(htmlPath, 'utf8');
  const order = [];
  const re = /<script src="js\/([a-z0-9-]+)\.js"><\/script>/g;
  let m;
  while ((m = re.exec(html))) order.push(m[1]);
  ok(order.length >= 15, 'all modules are loaded (' + order.length + ')');
  const pairs = [
    ['util', 'stats'], ['stats', 'df'], ['df', 'io'], ['io', 'datasets'],
    ['df', 'expr'], ['i18n', 'ops'], ['ops', 'app-state'], ['ui', 'dialog'],
    ['dialog', 'forms'], ['forms', 'forms-rows'], ['app-state', 'app-data'],
    ['app-data', 'app-pipeline'], ['app-pipeline', 'panel-ops'],
    ['panel-ops', 'panel-rail'], ['panel-source', 'app-shell'], ['app-shell', 'boot'],
    ['charts', 'chart-prep'], ['charts', 'marks-xy'], ['marks-xy', 'views-charts'],
    ['icons', 'ui']
  ];
  pairs.forEach(p => {
    const a = order.indexOf(p[0]), b = order.indexOf(p[1]);
    ok(a >= 0 && b >= 0 && a < b, p[0] + '.js loads before ' + p[1] + '.js', { a: a, b: b });
  });
});

console.log('\n' + '-'.repeat(60));
if (failed) {
  console.log(failed + ' failing checks:');
  failures.forEach(f => console.log('  x ' + f));
}
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
