/* =============================================================================
 * Visual Pandas — expr.js
 * A tiny spreadsheet-like language for computed columns, with two back ends:
 *   • evaluate()  — element-wise vectors in JavaScript
 *   • toPython()  — the same expression translated to pandas / numpy code
 * There is no eval(): the source is tokenised and parsed into an AST first.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, D = PV.df, S = PV.stats;

  /* ============================= tokenizer ============================== */
  var PUNCT = [
    '**', '<=', '>=', '==', '!=', '<>', '&&', '||',
    '+', '-', '*', '/', '%', '(', ')', ',', '<', '>', '&', '|', '!', '[', ']', '"', "'", '.'
  ];

  function tokenize(src) {
    var toks = [], i = 0, n = src.length;
    while (i < n) {
      var c = src[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i += 1; continue; }
      if (c === '#') { // comment to end of line
        while (i < n && src[i] !== '\n') i += 1;
        continue;
      }
      if (c >= '0' && c <= '9' || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        var j = i;
        while (j < n && /[0-9._eE]/.test(src[j])) {
          if ((src[j] === 'e' || src[j] === 'E') && /[+-]/.test(src[j + 1] || '')) j += 1;
          j += 1;
        }
        toks.push({ t: 'num', v: parseFloat(src.slice(i, j).replace(/_/g, '')) });
        i = j; continue;
      }
      if (c === '"' || c === "'") {
        var q = c, j2 = i + 1, out = '';
        while (j2 < n && src[j2] !== q) {
          if (src[j2] === '\\' && j2 + 1 < n) {
            var esc = src[j2 + 1];
            out += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
            j2 += 2; continue;
          }
          out += src[j2]; j2 += 1;
        }
        if (j2 >= n) throw new Error('unterminated string');
        toks.push({ t: 'str', v: out });
        i = j2 + 1; continue;
      }
      if (/[A-Za-z_\u4e00-\u9fa5]/.test(c)) {
        var j3 = i;
        while (j3 < n && /[A-Za-z0-9_\u4e00-\u9fa5]/.test(src[j3])) j3 += 1;
        var word = src.slice(i, j3);
        var lw = word.toLowerCase();
        if (lw === 'and') toks.push({ t: 'op', v: '&&' });
        else if (lw === 'or') toks.push({ t: 'op', v: '||' });
        else if (lw === 'not') toks.push({ t: 'op', v: '!' });
        else if (lw === 'true') toks.push({ t: 'bool', v: true });
        else if (lw === 'false') toks.push({ t: 'bool', v: false });
        else if (lw === 'null' || lw === 'none' || lw === 'nan' || lw === 'na') toks.push({ t: 'null', v: null });
        else toks.push({ t: 'ident', v: word });
        i = j3; continue;
      }
      var matched = null;
      for (var p = 0; p < PUNCT.length; p++) {
        if (src.startsWith(PUNCT[p], i)) { matched = PUNCT[p]; break; }
      }
      if (matched) { toks.push({ t: 'op', v: matched }); i += matched.length; continue; }
      throw new Error('unexpected character "' + c + '"');
    }
    toks.push({ t: 'eof', v: null });
    return toks;
  }

  /* ============================== parser =============================== */
  var PRECEDENCE = {
    '||': 1, '|': 2, '&&': 3, '&': 4,
    '==': 5, '!=': 5, '<>': 5, '<': 6, '>': 6, '<=': 6, '>=': 6,
    '+': 7, '-': 7, '*': 8, '/': 8, '%': 8, '**': 10
  };

  function parse(src) {
    var toks = tokenize(src), pos = 0;
    function peek() { return toks[pos]; }
    function next() { return toks[pos++]; }
    function expect(v) {
      var t = toks[pos];
      if (t.t === 'op' && t.v === v) { pos += 1; return t; }
      throw new Error('expected "' + v + '"');
    }

    function parsePrimary() {
      var t = next();
      if (t.t === 'num') return { k: 'num', v: t.v };
      if (t.t === 'str') return { k: 'str', v: t.v };
      if (t.t === 'bool') return { k: 'bool', v: t.v };
      if (t.t === 'null') return { k: 'null', v: null };
      if (t.t === 'op' && t.v === '(') {
        var e = parseBinary(0);
        expect(')');
        return e;
      }
      if (t.t === 'op' && (t.v === '-' || t.v === '+' || t.v === '!')) {
        return { k: 'un', op: t.v, a: parseBinary(t.v === '!' ? 9 : 9) };
      }
      if (t.t === 'op' && t.v === '[') {
        // [column name] — tolerant column reference
        var parts = [];
        while (peek() && !(peek().t === 'op' && peek().v === ']')) parts.push(next().v);
        expect(']');
        return { k: 'col', name: String(parts.join('')) };
      }
      if (t.t === 'ident') {
        var name = t.v;
        if (peek().t === 'op' && peek().v === '(') {
          next();
          var args = [];
          if (!(peek().t === 'op' && peek().v === ')')) {
            args.push(parseBinary(0));
            while (peek().t === 'op' && peek().v === ',') { next(); args.push(parseBinary(0)); }
          }
          expect(')');
          // df.col(...) is not a thing; treat as function call
          return { k: 'call', name: name, args: args };
        }
        if (peek().t === 'op' && peek().v === '.') {
          // df.col  (accept "df.name" as a column reference)
          next();
          var attr = next();
          if (attr.t !== 'ident' && attr.t !== 'num') throw new Error('bad attribute access');
          if (peek().t === 'op' && peek().v === '(') {
            next();
            var args2 = [];
            if (!(peek().t === 'op' && peek().v === ')')) {
              args2.push(parseBinary(0));
              while (peek().t === 'op' && peek().v === ',') { next(); args2.push(parseBinary(0)); }
            }
            expect(')');
            return { k: 'call', name: String(attr.v), args: args2, chained: name };
          }
          return { k: 'col', name: String(attr.v) };
        }
        if (peek().t === 'op' && peek().v === '[') {
          next();
          var key = parseBinary(0);
          expect(']');
          if (key.k === 'str') return { k: 'col', name: key.v };
          return { k: 'call', name: 'at', args: [{ k: 'col', name: name }, key] };
        }
        return { k: 'col', name: name };
      }
      throw new Error('unexpected token');
    }

    function parseBinary(minPrec) {
      var left = parsePrimary();
      for (;;) {
        var t = peek();
        if (t.t !== 'op') break;
        var prec = PRECEDENCE[t.v];
        if (prec === undefined || prec < minPrec) break;
        next();
        var rightAssoc = t.v === '**';
        var right = parseBinary(rightAssoc ? prec : prec + 1);
        left = { k: 'bin', op: t.v, a: left, b: right };
      }
      return left;
    }

    var ast = parseBinary(0);
    if (peek().t !== 'eof') throw new Error('unexpected trailing input');
    return ast;
  }

  /* ============================ evaluation ============================= */
  function isArr(v) { return Array.isArray(v); }

  function broadcast(a, b, fn) {
    if (!isArr(a) && !isArr(b)) return fn(a, b);
    var n = isArr(a) ? a.length : b.length;
    var out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = fn(isArr(a) ? a[i] : a, isArr(b) ? b[i] : b);
    return out;
  }

  function toNum(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof Date) return v.getTime();
    var n = Number(String(v).replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }

  function truthy(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0 && !isNaN(v);
    return String(v) !== '';
  }

  function cmpVals(a, b) {
    if (a instanceof Date || b instanceof Date) {
      var da = a instanceof Date ? a : D.parseDate(a);
      var db = b instanceof Date ? b : D.parseDate(b);
      if (da && db) return da.getTime() - db.getTime();
    }
    var na = toNum(a), nb = toNum(b);
    if (na !== null && nb !== null) return na - nb;
    var sa = a === null ? '' : String(a), sb = b === null ? '' : String(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }

  var FUNCS = {
    abs: function (x) { return broadcast(x, 1, function (v) { var n = toNum(v); return n === null ? null : Math.abs(n); }); },
    round: function (x, d) { return broadcast(x, d === undefined ? 0 : d, function (v, dd) { var n = toNum(v); if (n === null) return null; return U.roundHalfEven(n, toNum(dd) || 0); }); },
    floor: function (x) { return broadcast(x, 1, function (v) { var n = toNum(v); return n === null ? null : Math.floor(n); }); },
    ceil: function (x) { return broadcast(x, 1, function (v) { var n = toNum(v); return n === null ? null : Math.ceil(n); }); },
    sqrt: function (x) { return broadcast(x, 1, function (v) { var n = toNum(v); return n === null || n < 0 ? null : Math.sqrt(n); }); },
    exp: function (x) { return broadcast(x, 1, function (v) { var n = toNum(v); return n === null ? null : Math.exp(n); }); },
    log: function (x) { return broadcast(x, 1, function (v) { var n = toNum(v); return n === null || n <= 0 ? null : Math.log(n); }); },
    log1p: function (x) { return broadcast(x, 1, function (v) { var n = toNum(v); return n === null || n <= -1 ? null : Math.log1p(n); }); },
    sign: function (x) { return broadcast(x, 1, function (v) { var n = toNum(v); return n === null ? null : Math.sign(n); }); },
    clip: function (x, lo, hi) {
      return broadcast(broadcast(x, lo, function (a, b) { return { a: a, b: b }; }), hi, function (rec, h) {
        var v = toNum(rec.a); if (v === null) return null;
        var l = toNum(rec.b); var hh = toNum(h);
        return Math.min(hh === null ? Infinity : hh, Math.max(l === null ? -Infinity : l, v));
      });
    },
    min: function (a, b) {
      if (arguments.length === 1 && isArr(a)) return S.min(S.numeric(a));
      return broadcast(a, b, function (x, y) { var nx = toNum(x), ny = toNum(y); return nx === null ? ny : ny === null ? nx : Math.min(nx, ny); });
    },
    max: function (a, b) {
      if (arguments.length === 1 && isArr(a)) return S.max(S.numeric(a));
      return broadcast(a, b, function (x, y) { var nx = toNum(x), ny = toNum(y); return nx === null ? ny : ny === null ? nx : Math.max(nx, ny); });
    },
    mean: function (x) { return isArr(x) ? S.mean(S.numeric(x)) : toNum(x); },
    sum: function (x) { return isArr(x) ? S.sum(S.numeric(x)) : toNum(x); },
    where: function (c, a, b) {
      return broadcast(broadcast(c, a, function (cc, aa) { return { c: cc, a: aa }; }), b, function (rec, bb) {
        return truthy(rec.c) ? rec.a : bb;
      });
    },
    if: function (c, a, b) { return FUNCS.where(c, a, b); },
    isnull: function (x) { return broadcast(x, 1, function (v) { return v === null || v === undefined || (typeof v === 'number' && isNaN(v)); }); },
    notnull: function (x) { return broadcast(x, 1, function (v) { return !(v === null || v === undefined || (typeof v === 'number' && isNaN(v))); }); },
    coalesce: function () {
      var args = Array.prototype.slice.call(arguments);
      return broadcast(args[0], args[1] || null, function (a, b) { return a === null || a === undefined ? b : a; });
    },
    str: function (x) { return broadcast(x, 1, function (v) { return v === null ? null : (typeof v === 'boolean' ? (v ? 'True' : 'False') : String(v)); }); },
    num: function (x) { return broadcast(x, 1, toNum); },
    len: function (x) { return broadcast(x, 1, function (v) { return v === null ? null : String(v).length; }); },
    upper: function (x) { return broadcast(x, 1, function (v) { return v === null ? null : String(v).toUpperCase(); }); },
    lower: function (x) { return broadcast(x, 1, function (v) { return v === null ? null : String(v).toLowerCase(); }); },
    strip: function (x) { return broadcast(x, 1, function (v) { return v === null ? null : String(v).trim(); }); },
    contains: function (x, sub) {
      return broadcast(x, sub, function (v, s0) { return v === null ? false : String(v).indexOf(String(s0)) >= 0; });
    },
    startswith: function (x, sub) { return broadcast(x, sub, function (v, s0) { return v === null ? false : String(v).indexOf(String(s0)) === 0; }); },
    endswith: function (x, sub) { return broadcast(x, sub, function (v, s0) { return v === null ? false : String(v).slice(-String(s0).length) === String(s0); }); },
    replace: function (x, a, b) { return broadcast(x, a, function (v, s0) { return v === null ? null : String(v).split(String(s0)).join(String(b)); }); },
    concat: function () {
      var args = Array.prototype.slice.call(arguments);
      var n = 1;
      args.forEach(function (a) { if (isArr(a)) n = Math.max(n, a.length); });
      var out = new Array(n);
      for (var i = 0; i < n; i++) {
        var parts = args.map(function (a) { var v = isArr(a) ? a[i] : a; return v === null ? '' : String(v); });
        out[i] = parts.join('');
      }
      return out;
    },
    year: function (x) { return dtPart(x, 'year'); },
    month: function (x) { return dtPart(x, 'month'); },
    day: function (x) { return dtPart(x, 'day'); },
    hour: function (x) { return dtPart(x, 'hour'); },
    minute: function (x) { return dtPart(x, 'minute'); },
    weekday: function (x) { return dtPart(x, 'weekday'); },
    quarter: function (x) { return dtPart(x, 'quarter'); },
    weekofyear: function (x) { return dtPart(x, 'week'); },
    date: function (x) { return dtPart(x, 'date'); },
    days: function (a, b) {
      return broadcast(a, b, function (x, y) {
        var dx = x instanceof Date ? x : D.parseDate(x);
        var dy = y instanceof Date ? y : D.parseDate(y);
        if (!dx || !dy) return null;
        return Math.round((dx - dy) / 86400000);
      });
    },
    bin: function (x, nb) {
      var vals = isArr(x) ? x : [x];
      var nums = S.numeric(vals);
      var lo = S.min(nums), hi = S.max(nums);
      var k = toNum(nb) || 5;
      return broadcast(x, 1, function (v) {
        var n2 = toNum(v);
        if (n2 === null || hi === lo) return null;
        var b = Math.floor((n2 - lo) / ((hi - lo) / k));
        if (b >= k) b = k - 1;
        return b + 1;
      });
    },
    zscore: function (x) {
      var nums = S.numeric(isArr(x) ? x : [x]);
      var m = S.mean(nums), sd = S.std(nums);
      return broadcast(x, 1, function (v) { var n = toNum(v); return n === null || !sd ? null : (n - m) / sd; });
    },
    minmax: function (x) {
      var nums = S.numeric(isArr(x) ? x : [x]);
      var lo = S.min(nums), hi = S.max(nums);
      return broadcast(x, 1, function (v) { var n = toNum(v); return n === null || hi === lo ? null : (n - lo) / (hi - lo); });
    },
    rank: function (x, method) { return isArr(x) ? S.rank(x, isArr(method) ? 'average' : (method || 'average'), true) : null; },
    pct: function (x) { return broadcast(x, 1, function (v) { var n = toNum(v); return n === null ? null : n / 100; }); },
    amount: function (units, price) { return broadcast(units, price, function (a, b) { var na = toNum(a), nb = toNum(b); return na === null || nb === null ? null : na * nb; }); }
  };

  function dtPart(x, part) {
    return broadcast(x, 1, function (v) {
      var d = v instanceof Date ? v : D.parseDate(v);
      if (!d) return null;
      switch (part) {
        case 'year': return d.getFullYear();
        case 'quarter': return Math.floor(d.getMonth() / 3) + 1;
        case 'month': return d.getMonth() + 1;
        case 'day': return d.getDate();
        case 'hour': return d.getHours();
        case 'minute': return d.getMinutes();
        case 'weekday': return (d.getDay() + 6) % 7;
        case 'week': return D.isoWeek(d);
        case 'date': return new Date(d.getFullYear(), d.getMonth(), d.getDate());
      }
      return null;
    });
  }

  var FUNC_NAMES = Object.keys(FUNCS);

  function evalAst(ast, ctx) {
    switch (ast.k) {
      case 'num': case 'str': case 'bool': case 'null': return ast.v;
      case 'col': {
        if (!ctx.vars || !(ast.name in ctx.vars)) {
          throw new Error('unknown column "' + ast.name + '"');
        }
        return ctx.vars[ast.name];
      }
      case 'un': {
        var a0 = evalAst(ast.a, ctx);
        return broadcast(a0, 1, function (v) {
          if (ast.op === '-') { var n = toNum(v); return n === null ? null : -n; }
          if (ast.op === '+') return toNum(v);
          return !truthy(v);
        });
      }
      case 'bin': {
        var A = evalAst(ast.a, ctx), B = evalAst(ast.b, ctx);
        switch (ast.op) {
          case '+': return broadcast(A, B, function (a, b) {
            if (typeof a === 'string' || typeof b === 'string') return (a === null ? '' : String(a)) + (b === null ? '' : String(b));
            var na = toNum(a), nb = toNum(b); return na === null || nb === null ? null : na + nb;
          });
          case '-': return broadcast(A, B, function (a, b) { var na = toNum(a), nb = toNum(b); return na === null || nb === null ? null : na - nb; });
          case '*': return broadcast(A, B, function (a, b) { var na = toNum(a), nb = toNum(b); return na === null || nb === null ? null : na * nb; });
          case '/': return broadcast(A, B, function (a, b) { var na = toNum(a), nb = toNum(b); return na === null || nb === null || nb === 0 ? null : na / nb; });
          case '%': return broadcast(A, B, function (a, b) { var na = toNum(a), nb = toNum(b); return na === null || nb === null || nb === 0 ? null : na % nb; });
          case '**': return broadcast(A, B, function (a, b) { var na = toNum(a), nb = toNum(b); return na === null || nb === null ? null : Math.pow(na, nb); });
          case '==': return broadcast(A, B, function (a, b) { return a === null || b === null ? false : cmpVals(a, b) === 0; });
          case '!=': case '<>': return broadcast(A, B, function (a, b) { return a === null || b === null ? true : cmpVals(a, b) !== 0; });
          case '<': return broadcast(A, B, function (a, b) { return a === null || b === null ? false : cmpVals(a, b) < 0; });
          case '<=': return broadcast(A, B, function (a, b) { return a === null || b === null ? false : cmpVals(a, b) <= 0; });
          case '>': return broadcast(A, B, function (a, b) { return a === null || b === null ? false : cmpVals(a, b) > 0; });
          case '>=': return broadcast(A, B, function (a, b) { return a === null || b === null ? false : cmpVals(a, b) >= 0; });
          case '&': case '&&': return broadcast(A, B, function (a, b) { return truthy(a) && truthy(b); });
          case '|': case '||': return broadcast(A, B, function (a, b) { return truthy(a) || truthy(b); });
        }
        throw new Error('unsupported operator ' + ast.op);
      }
      case 'call': {
        var fn = FUNCS[ast.name.toLowerCase()] || FUNCS[ast.name];
        if (!fn) throw new Error('unknown function "' + ast.name + '"');
        var args = ast.args.map(function (x) { return evalAst(x, ctx); });
        return fn.apply(null, args);
      }
    }
    throw new Error('bad expression');
  }

  /* ========================= python translation ======================== */
  var PY_FUNCS = {
    abs: function (a) { return 'np.abs(' + a[0] + ')'; },
    round: function (a) { return a[0] + '.round(' + (a[1] === undefined ? '0' : a[1]) + ')'; },
    floor: function (a) { return 'np.floor(' + a[0] + ')'; },
    ceil: function (a) { return 'np.ceil(' + a[0] + ')'; },
    sqrt: function (a) { return 'np.sqrt(' + a[0] + ')'; },
    exp: function (a) { return 'np.exp(' + a[0] + ')'; },
    log: function (a) { return 'np.log(' + a[0] + ')'; },
    log1p: function (a) { return 'np.log1p(' + a[0] + ')'; },
    sign: function (a) { return 'np.sign(' + a[0] + ')'; },
    clip: function (a) { return a[0] + '.clip(' + a[1] + ', ' + a[2] + ')'; },
    min: function (a) { return a.length === 1 ? a[0] + '.min()' : 'np.minimum(' + a[0] + ', ' + a[1] + ')'; },
    max: function (a) { return a.length === 1 ? a[0] + '.max()' : 'np.maximum(' + a[0] + ', ' + a[1] + ')'; },
    mean: function (a) { return a[0] + '.mean()'; },
    sum: function (a) { return a[0] + '.sum()'; },
    where: function (a) { return 'np.where(' + a.join(', ') + ')'; },
    if: function (a) { return 'np.where(' + a.join(', ') + ')'; },
    isnull: function (a) { return a[0] + '.isna()'; },
    notnull: function (a) { return a[0] + '.notna()'; },
    coalesce: function (a) { return a[0] + '.fillna(' + a[1] + ')'; },
    str: function (a) { return a[0] + '.astype(str)'; },
    num: function (a) { return 'pd.to_numeric(' + a[0] + ', errors="coerce")'; },
    len: function (a) { return a[0] + '.astype(str).str.len()'; },
    upper: function (a) { return a[0] + '.astype(str).str.upper()'; },
    lower: function (a) { return a[0] + '.astype(str).str.lower()'; },
    strip: function (a) { return a[0] + '.astype(str).str.strip()'; },
    contains: function (a) { return a[0] + '.astype(str).str.contains(' + a[1] + ', na=False)'; },
    startswith: function (a) { return a[0] + '.astype(str).str.startswith(' + a[1] + ', na=False)'; },
    endswith: function (a) { return a[0] + '.astype(str).str.endswith(' + a[1] + ', na=False)'; },
    replace: function (a) { return a[0] + '.astype(str).str.replace(' + a[1] + ', ' + a[2] + ', regex=False)'; },
    concat: function (a) {
      return a.map(function (x) { return x + '.astype(str)'; }).join(' + ');
    },
    year: function (a) { return 'pd.to_datetime(' + a[0] + ').dt.year'; },
    month: function (a) { return 'pd.to_datetime(' + a[0] + ').dt.month'; },
    day: function (a) { return 'pd.to_datetime(' + a[0] + ').dt.day'; },
    hour: function (a) { return 'pd.to_datetime(' + a[0] + ').dt.hour'; },
    minute: function (a) { return 'pd.to_datetime(' + a[0] + ').dt.minute'; },
    weekday: function (a) { return 'pd.to_datetime(' + a[0] + ').dt.weekday'; },
    quarter: function (a) { return 'pd.to_datetime(' + a[0] + ').dt.quarter'; },
    weekofyear: function (a) { return 'pd.to_datetime(' + a[0] + ').dt.isocalendar().week'; },
    date: function (a) { return 'pd.to_datetime(' + a[0] + ').dt.normalize()'; },
    days: function (a) { return '(pd.to_datetime(' + a[0] + ') - pd.to_datetime(' + a[1] + ')).dt.days'; },
    bin: function (a) { return 'pd.cut(' + a[0] + ', bins=' + (a[1] === undefined ? 5 : a[1]) + ').cat.codes + 1'; },
    zscore: function (a) { return '((' + a[0] + ' - ' + a[0] + '.mean()) / ' + a[0] + '.std())'; },
    minmax: function (a) { return '((' + a[0] + ' - ' + a[0] + '.min()) / (' + a[0] + '.max() - ' + a[0] + '.min()))'; },
    rank: function (a) { return a[0] + '.rank(method="average")'; },
    pct: function (a) { return '(' + a[0] + ' / 100)'; },
    amount: function (a) { return '(' + a[0] + ' * ' + a[1] + ')'; }
  };

  var PY_VAR = 'df';

  function pyStr(v) {
    return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  }

  function toPython(ast, varName) {
    var v = varName || PY_VAR;
    function walk(node) {
      switch (node.k) {
        case 'num': return String(node.v);
        case 'str': return pyStr(node.v);
        case 'bool': return node.v ? 'True' : 'False';
        case 'null': return 'np.nan';
        case 'col': return v + '["' + String(node.name).replace(/"/g, '\\"') + '"]';
        case 'un':
          if (node.op === '!') return '~(' + walk(node.a) + ')';
          return node.op + '(' + walk(node.a) + ')';
        case 'bin': {
          var op = node.op === '&&' || node.op === '&' ? '&'
            : node.op === '||' || node.op === '|' ? '|' : node.op === '<>' ? '!=' : node.op;
          var A = walk(node.a), B = walk(node.b);
          if (op === '+' && (isStrNode(node.a) || isStrNode(node.b))) {
            if (!isStrNode(node.a) && node.a.k !== 'call') A = A + '.astype(str)';
            if (!isStrNode(node.b) && node.b.k !== 'call') B = B + '.astype(str)';
          }
          return '(' + A + ' ' + op + ' ' + B + ')';
        }
        case 'call': {
          var key = node.name.toLowerCase();
          var fn = PY_FUNCS[key] || PY_FUNCS[node.name];
          var args = node.args.map(walk);
          if (!fn) return node.name + '(' + args.join(', ') + ')';
          return fn(args);
        }
      }
      return 'None';
    }
    function isStrNode(node) { return !!node && node.k === 'str'; }
    return walk(ast);
  }

  /* ============================== public API =========================== */
  function compile(src) {
    var ast = parse(src);
    return {
      ast: ast,
      source: src,
      eval: function (vars, n) { return evalAst(ast, { vars: vars, n: n }); },
      python: function (varName) { return toPython(ast, varName); }
    };
  }

  /** Evaluate an expression against a DataFrame, returning a value array. */
  function evaluate(src, df) {
    var prog = compile(src);
    var vars = {};
    df.names.forEach(function (nm) { vars[nm] = df.col(nm); });
    // also allow python-ish identifiers for awkward column names
    df.names.forEach(function (nm) {
      var safe = nm.replace(/[^A-Za-z0-9_\u4e00-\u9fa5]/g, '_');
      if (!(safe in vars)) vars[safe] = df.col(nm);
    });
    var out = prog.eval(vars, df.nrows);
    if (!Array.isArray(out)) {
      var fill = out;
      out = new Array(df.nrows);
      for (var i = 0; i < df.nrows; i++) out[i] = fill;
    }
    return { values: out, python: prog.python('df'), ast: prog.ast };
  }

  PV.expr = {
    parse: parse,
    tokenize: tokenize,
    compile: compile,
    evaluate: evaluate,
    toPython: toPython,
    FUNC_NAMES: FUNC_NAMES,
    FUNCS: FUNCS,
    PY_FUNCS: PY_FUNCS
  };
})(typeof window !== 'undefined' ? window : globalThis);
