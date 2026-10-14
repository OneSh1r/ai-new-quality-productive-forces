/* =============================================================================
 * XLSX reader tests. The reader is written from scratch (ZIP central directory
 * + DecompressionStream), so it gets its own synthetic workbook: one entry
 * stored, one deflated, shared strings, inline strings, numbers and booleans.
 *   node tests/xlsx.test.js
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const JS = path.join(__dirname, '..', 'js');
['util', 'i18n', 'stats', 'df', 'io', 'datasets'].forEach(function (name) {
  eval(fs.readFileSync(path.join(JS, name + '.js'), 'utf8')); // eslint-disable-line no-eval
});
const PV = global.PV;
const IO = PV.io;

let passed = 0, failed = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { passed += 1; return; }
  failed += 1;
  failures.push(label + (extra !== undefined ? '  ->  ' + JSON.stringify(extra) : ''));
}
function eq(a, b, label) { ok(a === b, label, { got: a, want: b }); }
const groups = [];
function group(label, fn) { groups.push({ label: label, fn: fn }); }

/* ------------------------------ zip builder ---------------------------- */
function zipStore(entries) {
  return buildZip(entries, function () { return 0; }, function (buf) { return buf; });
}

function buildZip(entries, methodOf, compress) {
  var chunks = [];
  var central = [];
  var offset = 0;
  entries.forEach(function (entry, index) {
    var nameBuf = Buffer.from(entry.name, 'utf8');
    var raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    var method = methodOf(entry, index);
    var data = method === 8 ? compress(raw) : raw;
    var local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);
    var cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(0, 12);
    cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  });
  var cdSize = central.reduce(function (a, b) { return a + b.length; }, 0);
  var eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat(chunks.concat(central, [eocd]));
}

/* --------------------------- a tiny workbook --------------------------- */
var SHEET = [
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>',
  '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>12.5</v></c><c r="C2" t="b"><v>1</v></c></row>',
  '<row r="3"><c r="A3" t="inlineStr"><is><t>West</t></is></c><c r="B3"><v>7.5</v></c><c r="C3" t="b"><v>0</v></c></row>',
  '<row r="4"><c r="A4" t="s"><v>4</v></c><c r="B4"><v>3</v></c><c r="C4" t="b"><v>1</v></c></row>',
  '</sheetData></worksheet>'
].join('');

var SHARED = '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<si><t>region</t></si><si><t>revenue</t></si><si><t>returned</t></si>' +
  '<si><r><t>Ea</t></r><r><t>st</t></r></si><si><t>North</t></si>' +
  '<si><t>Sheet2 label</t></si></sst>';

var WORKBOOK = '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<sheets><sheet name="Sales" sheetId="1" r:id="rId1"/>' +
  '<sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>';

var RELS = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/>' +
  '<Relationship Id="rId2" Target="worksheets/sheet2.xml" Type="x"/></Relationships>';

var SHEET2 = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>5</v></c></row>' +
  '<row r="2"><c r="A2"><v>1</v></c></row></sheetData></worksheet>';

group('zip reader', () => {
  const zip = zipStore([
    { name: 'a.txt', data: 'hello' },
    { name: 'nested/b.txt', data: 'world' }
  ]);
  return IO.unzip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length)).then(function (files) {
    ok(!!files['a.txt'], 'stored entry is readable');
    eq(Buffer.from(files['a.txt']).toString('utf8'), 'hello', 'stored content matches');
    eq(Buffer.from(files['nested/b.txt']).toString('utf8'), 'world', 'nested entry matches');
  });
});

group('deflate support (DecompressionStream)', () => {
  const zip = buildZip(
    [{ name: 'x.txt', data: 'compressed payload' }],
    function () { return 8; },
    function (buf) { return zlib.deflateRawSync(buf); }
  );
  return IO.unzip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length)).then(function (files) {
    eq(Buffer.from(files['x.txt']).toString('utf8'), 'compressed payload', 'deflated entry inflates');
  });
});

function workbookZip() {
  return buildZip([
    { name: 'xl/workbook.xml', data: WORKBOOK },
    { name: 'xl/_rels/workbook.xml.rels', data: RELS },
    { name: 'xl/sharedStrings.xml', data: SHARED },
    { name: 'xl/worksheets/sheet1.xml', data: SHEET },
    { name: 'xl/worksheets/sheet2.xml', data: SHEET2 }
  ], function (entry) { return entry.name.indexOf('sheet1') >= 0 ? 8 : 0; },
    function (buf) { return zlib.deflateRawSync(buf); });
}

group('xlsx parsing', () => {
  const buf = workbookZip();
  return IO.readXLSX(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), 0).then(function (frame) {
    eq(frame.nrows, 3, 'three data rows');
    eq(frame.ncols, 3, 'three columns');
    eq(frame.names.join(','), 'region,revenue,returned', 'header row becomes column names');
    eq(frame.dtype('revenue'), 'float64', 'numbers are typed');
    eq(frame.dtype('returned'), 'bool', 'booleans are typed');
    eq(frame.col('region')[0], 'East', 'shared strings with runs are joined');
    eq(frame.col('region')[1], 'West', 'inline strings are read');
    eq(frame.col('region')[2], 'North', 'shared strings are read');
    eq(frame.col('revenue')[0], 12.5, 'float cell');
    eq(frame.col('revenue')[2], 3, 'int cell');
    eq(frame.col('returned')[1], false, 'false cell');
    eq(frame._sheets.join(','), 'Sales,Notes', 'sheet list is exposed');
  });
});

group('xlsx second sheet', () => {
  const buf = workbookZip();
  return IO.readXLSX(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), 1).then(function (frame) {
    eq(frame.names[0], 'Sheet2 label', 'second sheet header');
    eq(frame.nrows, 1, 'second sheet rows');
  });
});

group('broken input is rejected, not thrown wildly', () => {
  const junk = Buffer.from('this is not a zip file at all');
  return IO.readXLSX(junk.buffer.slice(junk.byteOffset, junk.byteOffset + junk.length), 0)
    .then(function () { ok(false, 'junk should fail'); })
    .catch(function (e) { ok(!!e && /unzip|xlsx/i.test(String(e.message)), 'a clear error is raised', String(e && e.message)); });
});

/* The reader is async (ZIP + DecompressionStream), so run the groups in order. */
(async function run() {
  for (const g of groups) {
    console.log('\n' + g.label);
    try {
      await g.fn();
    } catch (e) {
      failed += 1;
      failures.push(g.label + ' threw: ' + (e && e.message));
    }
  }
  console.log('\n' + '-'.repeat(60));
  if (failed) {
    console.log(failed + ' failing checks:');
    failures.forEach(function (f) { console.log('  x ' + f); });
  }
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
