/* =============================================================================
 * Visual Pandas — io.js
 * Reading and writing data with no external libraries:
 *   • RFC-4180 delimited text (CSV / TSV / semicolon / pipe / space …)
 *   • JSON (records, columns, split) and JSON Lines
 *   • XLSX — a minimal ZIP + deflate reader over DecompressionStream
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, D = PV.df;
  if (!U || !D) throw new Error('io.js requires util.js, stats.js and df.js');
  var DataFrame = D.DataFrame;

  var DEFAULT_NA = D.NA_MARKERS.slice();

  /* ============================ delimited text ========================== */
  var DELIMS = [
    { key: 'comma', char: ',' },
    { key: 'semicolon', char: ';' },
    { key: 'tab', char: '\t' },
    { key: 'pipe', char: '|' },
    { key: 'space', char: ' ' }
  ];

  function delimChar(key) {
    for (var i = 0; i < DELIMS.length; i++) if (DELIMS[i].key === key) return DELIMS[i].char;
    return key && key.length === 1 ? key : ',';
  }

  /** Count characters outside quotes across the first few lines. */
  function countOutside(text, ch, maxLines) {
    var counts = [], inQuotes = false, cur = 0, lines = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (c === '"') {
        if (inQuotes && text.charAt(i + 1) === '"') { i += 1; continue; }
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes) {
        if (c === ch) cur += 1;
        else if (c === '\n') {
          counts.push(cur); cur = 0; lines += 1;
          if (lines >= (maxLines || 12)) break;
        }
      }
    }
    if (cur > 0 || !counts.length) counts.push(cur);
    return counts;
  }

  /** Guess the delimiter by consistency of counts across lines. */
  function detectDelimiter(text, sample) {
    sample = sample || text.slice(0, 20000);
    var best = { key: 'comma', char: ',', score: -1 };
    DELIMS.forEach(function (d) {
      var counts = countOutside(sample, d.char);
      if (!counts.length) return;
      var first = counts[0];
      if (first === 0) return;
      var same = counts.filter(function (c) { return c === first; }).length;
      var consistency = same / counts.length;
      var score = first * 2 * consistency + consistency;
      if (d.key === 'space') score *= 0.4; // spaces are ambiguous
      if (score > best.score) best = { key: d.key, char: d.char, score: score, fields: first + 1 };
    });
    if (best.score <= 0) {
      // fall back: whitespace separated
      return { key: 'space', char: ' ', score: 0, fields: 0 };
    }
    return best;
  }

  /**
   * Parse delimited text into a grid of raw cells.
   * opts: {delimiter, header, na, skipBlankLines, quote}
   */
  function parseDelimited(text, opts) {
    opts = opts || {};
    var delim = opts.delimiter && opts.delimiter !== 'auto'
      ? delimChar(opts.delimiter)
      : detectDelimiter(text).char;
    var quote = opts.quote === undefined ? '"' : opts.quote;
    var naSet = opts.na ? opts.na.slice() : DEFAULT_NA.slice();
    var naLookup = Object.create(null);
    naSet.forEach(function (m) { naLookup[String(m).trim().toLowerCase()] = true; });

    var grid = [], row = [], field = '', inQuotes = false;
    var i = 0, n = text.length;
    var pushField = function () {
      var v = field;
      field = '';
      if (opts.trim !== false) v = v.trim();
      row.push(naLookup[v.toLowerCase()] === true ? null : v);
    };
    var pushRow = function () {
      pushField();
      var hasContent = row.some(function (c) { return c !== null && c !== ''; });
      if (hasContent || !opts.skipBlankLines) grid.push(row);
      row = [];
    };
    while (i < n) {
      var c = text.charAt(i);
      if (inQuotes) {
        if (c === quote) {
          if (text.charAt(i + 1) === quote) { field += quote; i += 2; continue; }
          inQuotes = false; i += 1; continue;
        }
        field += c; i += 1; continue;
      }
      if (c === quote && field === '') { inQuotes = true; i += 1; continue; }
      if (c === delim) { pushField(); i += 1; continue; }
      if (c === '\r') { i += 1; continue; }
      if (c === '\n') { pushRow(); i += 1; continue; }
      field += c; i += 1;
    }
    if (field !== '' || row.length) pushRow();

    var width = grid.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    grid.forEach(function (r) { while (r.length < width) r.push(null); });

    var header = opts.header !== false;
    var columns;
    var body;
    if (header) {
      columns = makeUnique((grid[0] || []).map(function (c, idx) {
        return c === null || c === '' ? 'Unnamed: ' + idx : String(c);
      }));
      body = grid.slice(1);
    } else {
      columns = [];
      for (var k = 0; k < width; k++) columns.push('Column' + (k + 1));
      body = grid.slice();
    }
    return {
      columns: columns,
      rows: body,
      delimiter: delim,
      delimiterKey: DELIMS.filter(function (d) { return d.char === delim; })[0]
        ? DELIMS.filter(function (d) { return d.char === delim; })[0].key : 'comma',
      width: width,
      headerRow: header ? (grid[0] || []) : null,
      totalRows: body.length
    };
  }

  function makeUnique(names) {
    var seen = Object.create(null), out = [];
    names.forEach(function (nm) {
      var name = nm;
      if (seen[name]) {
        var k = seen[name];
        while (seen[name + '.' + k]) k += 1;
        seen[nm] = k + 1;
        name = nm + '.' + k;
      } else {
        seen[name] = 1;
      }
      out.push(name);
      seen[name] = Math.max(1, seen[name] || 1);
    });
    return out;
  }

  /** Grid (+ column names) → DataFrame, inferring dtypes. */
  function frameFromGrid(grid, columns, opts) {
    opts = opts || {};
    if (!grid.length) return new DataFrame([], columns || [], []);
    var cols = columns.map(function (nm, j) {
      var arr = new Array(grid.length);
      for (var i = 0; i < grid.length; i++) {
        var v = grid[i][j];
        arr[i] = v === undefined ? null : v;
      }
      return arr;
    });
    var dtypes = cols.map(function (c) { return opts.infer === false ? 'object' : D.inferDtype(c); });
    cols = cols.map(function (c, i) { return D.coerceToDtype(c, dtypes[i]); });
    return new DataFrame(cols, columns, dtypes);
  }

  /* ============================== JSON ================================== */
  function frameFromJSON(text, opts) {
    opts = opts || {};
    var data = typeof text === 'string' ? JSON.parse(text) : text;
    // JSON Lines
    if (typeof text === 'string' && /^\s*[\[{]/.test(text) === false) {
      return frameFromJSONL(text, opts);
    }
    if (Array.isArray(data)) {
      if (!data.length) return new DataFrame([], [], []);
      if (Array.isArray(data[0])) {
        // array of arrays: first row may be the header
        var header = data[0].map(String);
        return frameFromGrid(data.slice(1), header, opts);
      }
      if (typeof data[0] !== 'object') {
        return frameFromGrid(data.map(function (v) { return [v]; }), ['value'], opts);
      }
      var names = [];
      data.slice(0, 500).forEach(function (rec) {
        Object.keys(rec).forEach(function (k) { if (names.indexOf(k) < 0) names.push(k); });
      });
      var grid = data.map(function (rec) {
        return names.map(function (nm) { return rec[nm] === undefined ? null : rec[nm]; });
      });
      return frameFromGrid(grid, names, opts);
    }
    if (data && typeof data === 'object') {
      if (Array.isArray(data.data)) {
        var cols2 = data.columns || null;
        var grid3 = cols2 ? data.data.map(function (r) { return r.map(function (v) { return v; }); })
          : data.data.map(function (r) { return Array.isArray(r) ? r : Object.keys(r).map(function (k) { return r[k]; }); });
        if (cols2) return frameFromGrid(grid3, cols2, opts);
        return frameFromJSON(grid3, opts);
      }
      // columns orient: {col: [values]}
      var keys = Object.keys(data);
      var arrs = keys.map(function (k) { return Array.isArray(data[k]) ? data[k] : [data[k]]; });
      var len = arrs.reduce(function (m, a) { return Math.max(m, a.length); }, 0);
      var grid4 = new Array(len);
      for (var i = 0; i < len; i++) {
        grid4[i] = arrs.map(function (a) { return i < a.length ? a[i] : null; });
      }
      return frameFromGrid(grid4, keys, opts);
    }
    throw new Error('unsupported JSON shape');
  }

  function frameFromJSONL(text, opts) {
    var lines = String(text).split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    var recs = lines.map(function (l) { return JSON.parse(l); });
    return frameFromJSON(recs, opts);
  }

  /* ============================== XLSX ================================== */
  function readU16(view, off) { return view.getUint16(off, true); }
  function readU32(view, off) { return view.getUint32(off, true); }

  async function inflateRaw(bytes) {
    if (typeof root.DecompressionStream === 'undefined') {
      throw new Error('this browser cannot decompress xlsx files');
    }
    var ds = new root.DecompressionStream('deflate-raw');
    var stream = new root.Blob([bytes]).stream().pipeThrough(ds);
    var buf = await new root.Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  var _textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;

  /** Minimal ZIP reader: returns {name: Uint8Array} for every entry. */
  async function unzip(buffer) {
    var view = new DataView(buffer);
    var bytes = new Uint8Array(buffer);
    // find End Of Central Directory
    var eocd = -1;
    for (var i = buffer.byteLength - 22; i >= 0 && i > buffer.byteLength - 66000; i--) {
      if (readU32(view, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip archive');
    var count = readU16(view, eocd + 10);
    var cdOffset = readU32(view, eocd + 16);
    var files = {};
    var off = cdOffset;
    for (var e = 0; e < count; e++) {
      if (readU32(view, off) !== 0x02014b50) break;
      var method = readU16(view, off + 10);
      var compSize = readU32(view, off + 20);
      var nameLen = readU16(view, off + 28);
      var extraLen = readU16(view, off + 30);
      var commentLen = readU16(view, off + 32);
      var localOff = readU32(view, off + 42);
      var name = _textDecoder.decode(bytes.subarray(off + 46, off + 46 + nameLen));
      // local header
      var lNameLen = readU16(view, localOff + 26);
      var lExtraLen = readU16(view, localOff + 28);
      var dataStart = localOff + 30 + lNameLen + lExtraLen;
      var raw = bytes.subarray(dataStart, dataStart + compSize);
      files[name] = { method: method, raw: raw };
      off += 46 + nameLen + extraLen + commentLen;
    }
    var out = {};
    var names = Object.keys(files);
    for (var k = 0; k < names.length; k++) {
      var f = files[names[k]];
      out[names[k]] = f.method === 0 ? f.raw : await inflateRaw(f.raw);
    }
    return out;
  }

  function xmlUnescape(str) {
    return str.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(+d); })
      .replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&amp;/g, '&');
  }

  /** Pull shared strings: <si> may contain several <t> runs. */
  function parseSharedStrings(xml) {
    var out = [];
    if (!xml) return out;
    var siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
    var m;
    while ((m = siRe.exec(xml))) {
      var body = m[1] || '';
      var text = '', tRe = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g, tm;
      while ((tm = tRe.exec(body))) text += xmlUnescape(tm[1] || '');
      out.push(text);
    }
    return out;
  }

  function colLetterToIndex(ref) {
    var m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return null;
    var s = m[1], idx = 0;
    for (var i = 0; i < s.length; i++) idx = idx * 26 + (s.charCodeAt(i) - 64);
    return idx - 1;
  }

  /** Parse a worksheet into a grid of typed values. */
  function parseSheet(xml, sharedStrings) {
    var grid = [];
    var rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g, rm;
    while ((rm = rowRe.exec(xml))) {
      var rowAttrs = rm[1] || '';
      var rIdx = /r="(\d+)"/.exec(rowAttrs);
      var rowNum = rIdx ? +rIdx[1] - 1 : grid.length;
      var cells = [];
      var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, cm;
      var auto = 0;
      while ((cm = cellRe.exec(rm[2]))) {
        var attrs = cm[1] || '';
        var body = cm[2] || '';
        var refM = /r="([A-Z]+\d+)"/.exec(attrs);
        var col = refM ? colLetterToIndex(refM[1]) : auto;
        auto = (col === null ? auto : col) + 1;
        var typeM = /t="([^"]+)"/.exec(attrs);
        var type = typeM ? typeM[1] : 'n';
        var value = null;
        if (type === 'inlineStr') {
          var isM = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body);
          if (isM) {
            var tRe2 = /<t\b[^>]*>([\s\S]*?)<\/t>/g, tm2, txt = '';
            while ((tm2 = tRe2.exec(isM[1]))) txt += xmlUnescape(tm2[1]);
            value = txt;
          }
        } else {
          var vM = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
          var raw = vM ? xmlUnescape(vM[1]) : null;
          if (raw === null || raw === '') value = type === 's' ? null : null;
          else if (type === 's') value = sharedStrings[+raw] === undefined ? null : sharedStrings[+raw];
          else if (type === 'str') value = raw;
          else if (type === 'b') value = raw === '1';
          else if (type === 'e') value = null;
          else {
            var num = Number(raw);
            value = isNaN(num) ? raw : num;
          }
        }
        if (value !== null && typeof value === 'string' && value.trim() === '') value = null;
        if (col !== null && col >= 0) cells[col] = value;
      }
      for (var c = 0; c < cells.length; c++) if (cells[c] === undefined) cells[c] = null;
      grid[rowNum] = cells;
    }
    for (var r = 0; r < grid.length; r++) if (!grid[r]) grid[r] = [];
    var width = grid.reduce(function (m, row) { return Math.max(m, row.length); }, 0);
    grid.forEach(function (row) { while (row.length < width) row.push(null); });
    return grid;
  }

  /** List sheets: [{name, path}] */
  function listSheets(zipFiles) {
    var wb = zipFiles['xl/workbook.xml'];
    var rels = zipFiles['xl/_rels/workbook.xml.rels'];
    if (!wb) return [{ name: 'Sheet1', path: 'xl/worksheets/sheet1.xml' }];
    var xml = _textDecoder.decode(wb);
    var relXml = rels ? _textDecoder.decode(rels) : '';
    var relMap = {};
    var relRe = /<Relationship\b[^>]*\/>/g, m;
    while ((m = relRe.exec(relXml))) {
      var id = /Id="([^"]+)"/.exec(m[0]);
      var target = /Target="([^"]+)"/.exec(m[0]);
      if (id && target) relMap[id[1]] = target[1];
    }
    var sheets = [];
    var sheetRe = /<sheet\b[^>]*\/?>/g;
    while ((m = sheetRe.exec(xml))) {
      var nameM = /name="([^"]*)"/.exec(m[0]);
      var ridM = /r:id="([^"]+)"/.exec(m[0]);
      var target2 = ridM ? relMap[ridM[1]] : null;
      if (target2 && target2.charAt(0) === '/') target2 = target2.slice(1);
      var path = target2 ? (target2.indexOf('xl/') === 0 ? target2 : 'xl/' + target2) : null;
      sheets.push({ name: nameM ? xmlUnescape(nameM[1]) : 'Sheet' + (sheets.length + 1), path: path });
    }
    sheets.forEach(function (s, i) {
      if (!s.path || !zipFiles[s.path]) s.path = 'xl/worksheets/sheet' + (i + 1) + '.xml';
    });
    return sheets;
  }

  async function readXLSX(arrayBuffer, sheetIndex) {
    var zipFiles;
    try {
      zipFiles = await unzip(arrayBuffer);
    } catch (e) {
      throw new Error('xlsx-unzip-failed: ' + e.message);
    }
    var sheets = listSheets(zipFiles);
    var idx = sheetIndex || 0;
    var sheet = sheets[Math.min(idx, sheets.length - 1)];
    var sheetXml = zipFiles[sheet.path];
    if (!sheetXml) throw new Error('xlsx-sheet-missing');
    var shared = parseSharedStrings(zipFiles['xl/sharedStrings.xml'] ? _textDecoder.decode(zipFiles['xl/sharedStrings.xml']) : '');
    var grid = parseSheet(_textDecoder.decode(sheetXml), shared);
    var header = grid.length ? grid[0].map(function (c, i) {
      return c === null || c === '' ? 'Unnamed: ' + i : String(c);
    }) : [];
    var columns = makeUnique(header);
    var frame = frameFromGrid(grid.slice(1), columns, {});
    frame._sheets = sheets.map(function (s) { return s.name; });
    frame._sheetIndex = idx;
    return frame;
  }

  /* ============================ entry points ============================ */
  /** Sniff a file's format from its name / content. */
  function detectFormat(filename, text) {
    var ext = (filename || '').toLowerCase().replace(/^.*\./, '');
    if (ext === 'json') return 'json';
    if (ext === 'jsonl' || ext === 'ndjson') return 'jsonl';
    if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx';
    if (ext === 'tsv' || ext === 'tab') return 'tsv';
    if (ext === 'csv') return 'csv';
    if (ext === 'txt' || ext === 'dat') return 'text';
    if (typeof text === 'string') {
      var head = text.slice(0, 200).trim();
      if (/^[\[{]/.test(head)) {
        if (/^\{[^\n]*\}\s*(\n|$)/.test(head) && head.indexOf('":"') > 0 && !/\n\s*[[{]/.test(head.slice(0, 200))) return 'jsonl';
        return 'json';
      }
      return 'text';
    }
    return 'text';
  }

  function frameFromText(text, opts) {
    opts = opts || {};
    var format = opts.format || detectFormat(opts.filename, text);
    if (format === 'json') return frameFromJSON(text, opts);
    if (format === 'jsonl') return frameFromJSONL(text, opts);
    var res = parseDelimited(text, opts);
    var frame = frameFromGrid(res.rows, res.columns, opts);
    frame._parse = {
      delimiter: res.delimiterKey,
      delimiterChar: res.delimiter,
      header: opts.header !== false,
      rows: res.totalRows
    };
    return frame;
  }

  /** Load a File/Blob: async because xlsx needs decompression. */
  async function frameFromFile(file, opts) {
    opts = opts || {};
    var name = file.name || '';
    var format = detectFormat(name);
    if (format === 'xlsx') {
      var buf = await U.readFileArrayBuffer(file);
      var frame = await readXLSX(buf, opts.sheetIndex || 0);
      frame._source = { kind: 'file', name: name, size: file.size, format: 'xlsx' };
      return frame;
    }
    var text = await U.readFileText(file);
    var fr = frameFromText(text, Object.assign({}, opts, { format: format === 'tsv' ? 'text' : format, filename: name }));
    fr._source = { kind: 'file', name: name, size: file.size, format: format };
    return fr;
  }

  /** Fetch a URL (works when the page is served over http/https). */
  async function frameFromURL(url, opts) {
    var res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var text = await res.text();
    var frame = frameFromText(text, Object.assign({}, opts, { filename: url }));
    frame._source = { kind: 'url', name: url.split('/').pop() || url, url: url };
    return frame;
  }

  /* ============================ writers ================================= */
  function toCSVFrame(df, opts) {
    opts = opts || {};
    return U.toCSV(df.names, df.rows(0, df.nrows), opts.sep || ',');
  }

  function toMarkdown(df, limit) {
    var rows = df.rows(0, Math.min(df.nrows, limit || 20));
    var header = '| ' + df.names.join(' | ') + ' |';
    var sep = '| ' + df.names.map(function () { return '---'; }).join(' | ') + ' |';
    var body = rows.map(function (r) {
      return '| ' + r.map(function (v) { return U.fmtValue(v); }).join(' | ') + ' |';
    });
    return [header, sep].concat(body).join('\n');
  }

  PV.io = {
    DEFAULT_NA: DEFAULT_NA,
    DELIMS: DELIMS,
    delimChar: delimChar,
    detectDelimiter: detectDelimiter,
    parseDelimited: parseDelimited,
    frameFromGrid: frameFromGrid,
    frameFromJSON: frameFromJSON,
    frameFromJSONL: frameFromJSONL,
    frameFromText: frameFromText,
    frameFromFile: frameFromFile,
    frameFromURL: frameFromURL,
    detectFormat: detectFormat,
    toCSVFrame: toCSVFrame,
    toMarkdown: toMarkdown,
    makeUnique: makeUnique,
    readXLSX: readXLSX,
    unzip: unzip,
    parseSheet: parseSheet,
    parseSharedStrings: parseSharedStrings
  };
})(typeof window !== 'undefined' ? window : globalThis);
