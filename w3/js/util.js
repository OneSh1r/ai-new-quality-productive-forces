/* =============================================================================
 * Visual Pandas — util.js
 * Small, dependency-free helpers: DOM building, formatting, math, randomness.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});

  /* ---------- missing values ------------------------------------------- */
  // A missing cell is `null`. Numeric columns may also carry NaN.
  function isNA(v) {
    return v === null || v === undefined || (typeof v === 'number' && isNaN(v));
  }

  /* ---------- ids ------------------------------------------------------- */
  var _seq = 0;
  function uid(prefix) {
    _seq += 1;
    return (prefix || 'id') + '_' + _seq.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------- DOM ------------------------------------------------------- */
  var SVGNS = 'http://www.w3.org/2000/svg';

  function h(spec, props, children) {
    // h('div.card', [children]) is allowed: arrays, nodes and text in the
    // props slot are treated as children.
    if (isChildren(props)) { children = props; props = null; }
    var parts = String(spec).split(/(?=[.#])/);
    var tag = /^[a-zA-Z]/.test(parts[0]) ? parts[0] : 'div';
    var node = document.createElement(tag);
    var i0 = /^[a-zA-Z]/.test(parts[0]) ? 1 : 0;
    for (var i = i0; i < parts.length; i++) {
      var p = parts[i];
      if (p.charAt(0) === '.') node.classList.add(p.slice(1));
      else if (p.charAt(0) === '#') node.id = p.slice(1);
    }
    applyProps(node, props);
    append(node, children);
    return node;
  }

  function s(spec, props, children) {
    if (isChildren(props)) { children = props; props = null; }
    // Same 'tag.class#id' syntax as h(), but createElementNS only accepts the
    // bare tag name — classes and ids are applied afterwards.
    var parts = String(spec).split(/(?=[.#])/);
    var tag = /^[a-zA-Z]/.test(parts[0]) ? parts[0] : 'g';
    var node = document.createElementNS(SVGNS, tag);
    var i0 = /^[a-zA-Z]/.test(parts[0]) ? 1 : 0;
    for (var i = i0; i < parts.length; i++) {
      var p = parts[i];
      if (p.charAt(0) === '.') node.classList.add(p.slice(1));
      else if (p.charAt(0) === '#') node.setAttribute('id', p.slice(1));
    }
    applyProps(node, props, true);
    append(node, children);
    return node;
  }

  function isChildren(value) {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return true;
    if (typeof value === 'string' || typeof value === 'number') return true;
    return !!(value.nodeType);
  }

  function applyProps(node, props, isSvg) {
    if (!props) return;
    for (var k in props) {
      var v = props[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'class' || k === 'className') {
        String(v).split(/\s+/).forEach(function (c) { if (c) node.classList.add(c); });
      } else if (k === 'style') {
        if (typeof v === 'string') node.setAttribute('style', v);
        else for (var sk in v) node.style.setProperty(sk.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }), v[sk]);
      } else if (k === 'dataset') {
        for (var dk in v) node.dataset[dk] = v[dk];
      } else if (k === 'on') {
        for (var ev in v) node.addEventListener(ev, v[ev]);
      } else if (k === 'ref') {
        v(node);
      } else if (isSvg) {
        node.setAttribute(k, v);
      } else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' ||
                 k === 'placeholder' || k === 'multiple' || k === 'readOnly' || k === 'indeterminate') {
        try { node[k] = v; } catch (e) { node.setAttribute(k, v); }
      } else if (k.indexOf('data-') === 0 || k.indexOf('aria-') === 0 || k === 'role' ||
                 k === 'for' || k === 'tabindex' || k === 'colspan' || k === 'rowspan' ||
                 k === 'viewBox' || k === 'preserveAspectRatio' || k === 'fill' ||
                 k === 'xmlns') {
        node.setAttribute(k, v);
      } else if (k in node) {
        try { node[k] = v; } catch (e) { node.setAttribute(k, v); }
      } else {
        node.setAttribute(k, v);
      }
    }
  }

  function append(node, children) {
    if (children === null || children === undefined || children === false) return;
    if (Array.isArray(children)) {
      children.forEach(function (c) { append(node, c); });
      return;
    }
    if (typeof children === 'string' || typeof children === 'number') {
      node.appendChild(document.createTextNode(String(children)));
      return;
    }
    if (children.nodeType) node.appendChild(children);
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function mount(node, children) {
    clear(node);
    append(node, children);
    return node;
  }

  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function closest(node, sel) {
    while (node && node.nodeType === 1) {
      if (node.matches && node.matches(sel)) return node;
      node = node.parentNode;
    }
    return null;
  }

  /* ---------- events ---------------------------------------------------- */
  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, wait || 180);
    };
  }

  function raf(fn) {
    var pending = false;
    return function () {
      if (pending) return;
      pending = true;
      var self = this, args = arguments;
      (root.requestAnimationFrame || function (cb) { setTimeout(cb, 16); })(function () {
        pending = false;
        fn.apply(self, args);
      });
    };
  }

  /* ---------- random ---------------------------------------------------- */
  function hashString(str) {
    var hsh = 2166136261;
    for (var i = 0; i < str.length; i++) {
      hsh ^= str.charCodeAt(i);
      hsh = Math.imul(hsh, 16777619);
    }
    return hsh >>> 0;
  }

  // Deterministic PRNG (mulberry32) — lets sample data reproduce exactly.
  function rng(seed) {
    var a = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed === undefined ? 'pv' : seed));
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRandom(seed) {
    var r = rng(seed);
    var api = {
      next: r,
      float: function (a, b) { return a + (b - a) * r(); },
      int: function (a, b) { return Math.floor(a + (b - a + 1) * r()); },
      bool: function (p) { return r() < (p === undefined ? 0.5 : p); },
      pick: function (arr) { return arr[Math.floor(r() * arr.length) % arr.length]; },
      // Box–Muller normal
      normal: function (mu, sigma) {
        var u = 1 - r(), v = r();
        return (mu || 0) + (sigma === undefined ? 1 : sigma) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      },
      // Pick an index following weights
      weighted: function (weights) {
        var total = 0, i;
        for (i = 0; i < weights.length; i++) total += weights[i];
        var x = r() * total;
        for (i = 0; i < weights.length; i++) { x -= weights[i]; if (x <= 0) return i; }
        return weights.length - 1;
      },
      shuffle: function (arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
          var j = Math.floor(r() * (i + 1));
          var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
      }
    };
    return api;
  }

  /* ---------- numbers --------------------------------------------------- */
  var _nf = {};
  function numberFormat(opts) {
    var key = JSON.stringify(opts);
    if (_nf[key]) return _nf[key];
    try { _nf[key] = new Intl.NumberFormat(opts.locale || 'en-US', opts); }
    catch (e) { _nf[key] = new Intl.NumberFormat('en-US', opts); }
    return _nf[key];
  }

  /** pandas-flavoured scalar formatting for table cells. */
  function fmtValue(v, opts) {
    opts = opts || {};
    if (isNA(v)) return 'NaN';
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    if (v instanceof Date) return fmtDate(v, opts.dateFormat);
    if (typeof v === 'number') return fmtNumber(v, opts);
    return String(v);
  }

  function fmtNumber(v, opts) {
    opts = opts || {};
    if (typeof v !== 'number' || isNaN(v)) return 'NaN';
    if (!isFinite(v)) return v > 0 ? 'inf' : '-inf';
    var abs = Math.abs(v);
    var maxFrac = opts.maxFrac === undefined ? 4 : opts.maxFrac;
    var minFrac = opts.minFrac === undefined ? 0 : opts.minFrac;
    if (Number.isInteger(v) && maxFrac >= 0) {
      return numberFormat({ maximumFractionDigits: 0, useGrouping: opts.group !== false }).format(v);
    }
    if (opts.compact && (abs >= 1e5 || (abs > 0 && abs < 1e-3))) {
      return numberFormat({
        notation: 'compact', maximumFractionDigits: 2, minimumFractionDigits: 0
      }).format(v);
    }
    if ((abs >= 1e9 || (abs < 1e-4 && abs > 0)) && opts.sci !== false) {
      var digits = Math.max(0, Math.min(6, opts.sciDigits === undefined ? 4 : opts.sciDigits));
      return v.toExponential(digits < 1 ? undefined : digits).replace('e', 'e+').replace('e+-', 'e-');
    }
    return numberFormat({
      maximumFractionDigits: maxFrac,
      minimumFractionDigits: minFrac,
      useGrouping: opts.group !== false
    }).format(v);
  }

  /** Compact form for axes / chips. */
  function fmtShort(v, unit) {
    if (isNA(v)) return 'NaN';
    if (typeof v !== 'number') return String(v);
    var abs = Math.abs(v), out;
    if (abs >= 1e12) out = (v / 1e12).toFixed(1).replace(/\.0$/, '') + 'T';
    else if (abs >= 1e9) out = (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    else if (abs >= 1e6) out = (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    else if (abs >= 1e4) out = (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    else if (Number.isInteger(v)) out = String(v);
    else if (abs >= 100) out = v.toFixed(1);
    else if (abs >= 1) out = v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    else out = v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    return out + (unit ? ' ' + unit : '');
  }

  function fmtPercent(x, digits) {
    if (isNA(x)) return 'NaN';
    return (x * 100).toFixed(digits === undefined ? 1 : digits) + '%';
  }

  function fmtInt(v) {
    if (isNA(v)) return 'NaN';
    return numberFormat({ maximumFractionDigits: 0 }).format(v);
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function fmtDate(d, pattern) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return 'NaT';
    pattern = pattern || 'YYYY-MM-DD';
    var map = {
      YYYY: String(d.getFullYear()),
      MM: pad2(d.getMonth() + 1),
      DD: pad2(d.getDate()),
      HH: pad2(d.getHours()),
      mm: pad2(d.getMinutes()),
      ss: pad2(d.getSeconds())
    };
    return pattern.replace(/YYYY|MM|DD|HH|mm|ss/g, function (m) { return map[m]; });
  }

  function fmtDateTime(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return 'NaT';
    var s2 = fmtDate(d, 'YYYY-MM-DD HH:mm');
    return s2;
  }

  /* ---------- math ------------------------------------------------------ */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /**
   * Round half to even — the rule numpy/pandas use (`np.around`, `.round()`),
   * so numbers produced in the browser match the generated Python.
   */
  function roundHalfEven(x, decimals) {
    if (typeof x !== 'number' || !isFinite(x)) return x;
    var m = Math.pow(10, decimals || 0);
    var scaled = x * m;
    var floor = Math.floor(scaled);
    var diff = scaled - floor;
    var rounded;
    if (Math.abs(diff - 0.5) < 1e-9) rounded = (Math.abs(floor % 2) === 0) ? floor : floor + 1;
    else rounded = Math.round(scaled);
    return rounded / m;
  }
  function sum(arr) { var t = 0; for (var i = 0; i < arr.length; i++) t += arr[i]; return t; }
  function mean(arr) { return arr.length ? sum(arr) / arr.length : NaN; }
  function min(arr) { return arr.length ? Math.min.apply(null, arr) : NaN; }
  function max(arr) { return arr.length ? Math.max.apply(null, arr) : NaN; }

  /** "Nice" axis ticks — 1/2/5 × 10^k steps. */
  function niceTicks(lo, hi, count) {
    count = count || 6;
    if (!isFinite(lo) || !isFinite(hi)) return { lo: 0, hi: 1, step: 1, ticks: [0, 1] };
    if (lo === hi) {
      var pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.05 : 0.5;
      lo -= pad; hi += pad;
    }
    var span = hi - lo;
    var rawStep = span / Math.max(1, count);
    var mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep) || 1)));
    var norm = rawStep / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    var start = Math.floor(lo / step) * step;
    var end = Math.ceil(hi / step) * step;
    var ticks = [];
    for (var v = start; v <= end + step * 1e-6; v += step) {
      ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
      if (ticks.length > 400) break;
    }
    return { lo: start, hi: end, step: step, ticks: ticks };
  }

  /* ---------- strings --------------------------------------------------- */
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function truncate(str, n) {
    str = String(str);
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
  }

  function titleCase(str) {
    return String(str).replace(/[_-]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  /* ---------- files ---------------------------------------------------- */
  function download(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }

  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsText(file);
    });
  }

  function readFileArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsArrayBuffer(file);
    });
  }

  /* ---------- csv writer ------------------------------------------------ */
  function csvEscape(v, sep, quoteAll) {
    if (isNA(v)) return '';
    var str;
    if (v instanceof Date) str = fmtDateTime(v);
    else str = String(v);
    var needs = quoteAll || str.indexOf(sep) >= 0 || /["\n\r]/.test(str);
    if (/^[\s]|[\s]$/.test(str)) needs = true;
    if (needs) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  }

  function toCSV(header, rows, sep) {
    sep = sep || ',';
    var out = [header.map(function (c) { return csvEscape(c, sep, true); }).join(sep)];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i], line = [];
      for (var j = 0; j < row.length; j++) line.push(csvEscape(row[j], sep));
      out.push(line.join(sep));
    }
    return out.join('\n');
  }

  /* ---------- misc ------------------------------------------------------ */
  function deepClone(v) {
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Date) return new Date(v.getTime());
    if (Array.isArray(v)) return v.map(deepClone);
    var o = {};
    for (var k in v) o[k] = deepClone(v[k]);
    return o;
  }

  function chunk(arr, size) {
    var out = [];
    for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function uniq(arr) {
    var seen = Object.create(null), out = [];
    for (var i = 0; i < arr.length; i++) {
      var k = typeof arr[i] + ':' + String(arr[i]);
      if (!seen[k]) { seen[k] = 1; out.push(arr[i]); }
    }
    return out;
  }

  /** Human readable byte / count labels. */
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /** Ask the browser for a frame so long tasks can yield. */
  function nextFrame() {
    return new Promise(function (resolve) {
      (root.requestAnimationFrame || function (cb) { setTimeout(cb, 16); })(function () { resolve(); });
    });
  }

  PV.util = {
    NA: null,
    isNA: isNA,
    uid: uid,
    h: h,
    s: s,
    clear: clear,
    mount: mount,
    qs: qs,
    qsa: qsa,
    closest: closest,
    debounce: debounce,
    raf: raf,
    rng: rng,
    makeRandom: makeRandom,
    hashString: hashString,
    fmtValue: fmtValue,
    fmtNumber: fmtNumber,
    fmtShort: fmtShort,
    fmtPercent: fmtPercent,
    fmtInt: fmtInt,
    fmtDate: fmtDate,
    fmtDateTime: fmtDateTime,
    fmtBytes: fmtBytes,
    numberFormat: numberFormat,
    clamp: clamp,
    roundHalfEven: roundHalfEven,
    sum: sum,
    mean: mean,
    min: min,
    max: max,
    niceTicks: niceTicks,
    escapeHtml: escapeHtml,
    truncate: truncate,
    titleCase: titleCase,
    download: download,
    readFileText: readFileText,
    readFileArrayBuffer: readFileArrayBuffer,
    toCSV: toCSV,
    csvEscape: csvEscape,
    deepClone: deepClone,
    chunk: chunk,
    uniq: uniq,
    sleep: sleep,
    nextFrame: nextFrame
  };
})(typeof window !== 'undefined' ? window : globalThis);
