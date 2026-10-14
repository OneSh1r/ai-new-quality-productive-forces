/* =============================================================================
 * Visual Pandas — df.js
 * A small, column-oriented DataFrame with pandas-compatible behaviour:
 * dtypes, NA handling, groupby/agg, pivot_table, merge, crosstab, resample.
 * All operations return new frames; column arrays are shared when untouched.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, S = PV.stats;
  if (!U || !S) throw new Error('df.js requires util.js and stats.js');
  var isNA = U.isNA;

  var NA_MARKERS = ['', 'na', 'n/a', 'nan', 'null', 'none', 'nil', '-', '--', '?', '#n/a', 'missing'];

  /* ---------- dtype helpers -------------------------------------------- */
  var NUMERIC = { int64: 1, float64: 1 };
  function isNumericDtype(d) { return !!NUMERIC[d]; }
  function isDateDtype(d) { return d === 'datetime64[ns]'; }
  function isCategorical(d) { return d === 'category'; }
  function isBoolDtype(d) { return d === 'bool'; }

  /** Coarse UI classification (not a pandas dtype). */
  function kindOf(dtype, values) {
    if (isNumericDtype(dtype)) return 'numeric';
    if (isDateDtype(dtype)) return 'datetime';
    if (isBoolDtype(dtype)) return 'bool';
    var uniq = uniqCount(values, 400);
    if (dtype === 'category') return 'category';
    if (uniq <= 24 && uniq <= Math.max(1, values.length / 10)) return 'category';
    return 'text';
  }

  function uniqCount(values, cap) {
    var seen = new Set(), c = 0;
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (isNA(v)) continue;
      var k = valueKey(v);
      if (!seen.has(k)) {
        seen.add(k);
        c += 1;
        if (cap && c > cap) return c;
      }
    }
    return c;
  }

  /** Canonical hash key for grouping / unique counting. */
  function valueKey(v) {
    if (isNA(v)) return '\u0000na';
    if (v instanceof Date) return 'd' + v.getTime();
    return typeof v + '\u0000' + String(v);
  }

  function displayKey(v) {
    if (isNA(v)) return 'NaN';
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    if (v instanceof Date) return U.fmtDateTime(v);
    return String(v);
  }

  /** Parse a date-ish scalar; returns null when it does not look like a date. */
  function parseDate(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v !== 'string') return null;
    var s = v.trim();
    if (!s) return null;
    // ISO / common formats: 2019-05-04, 2019/5/4, 2019.05.04 07:30(:12)
    var m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(s);
    if (m) {
      var y = +m[1], mo = +m[2], d = +m[3];
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2200) {
        var dt = new Date(y, mo - 1, d, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
        if (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d) return dt;
      }
      return null;
    }
    // US style M/D/YYYY (or D/M/YYYY when the first part exceeds 12)
    m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?\s*(am|pm)?$/i.exec(s);
    if (m) {
      var a = +m[1], b = +m[2];
      var yy = +m[3]; if (yy < 100) yy += yy < 70 ? 2000 : 1900;
      var mo2 = 1, d2 = 1;
      if (a > 12 && b <= 12) { d2 = a; mo2 = b; }
      else { mo2 = a; d2 = b; }
      if (mo2 < 1 || mo2 > 12 || d2 < 1 || d2 > 31) return null;
      var hh = +(m[4] || 0);
      var ampm = m[7] ? m[7].toLowerCase() : null;
      if (ampm === 'pm' && hh < 12) hh += 12;
      if (ampm === 'am' && hh === 12) hh = 0;
      var dt2 = new Date(yy, mo2 - 1, d2, hh, +(m[5] || 0), +(m[6] || 0));
      if (dt2.getMonth() === mo2 - 1 && dt2.getDate() === d2) return dt2;
      return null;
    }
    // Compact: 20190504, 20190504T0730
    m = /^(\d{4})(\d{2})(\d{2})(?:[ T](\d{2})(\d{2})(\d{2})?)?$/.exec(s);
    if (m) {
      var y3 = +m[1], m3 = +m[2], d3 = +m[3];
      var dt3 = new Date(y3, m3 - 1, d3, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
      if (dt3.getMonth() === m3 - 1 && dt3.getDate() === d3) return dt3;
    }
    return null;
  }

  function looksLikeDateString(v) {
    return typeof v === 'string' && parseDate(v) !== null;
  }

  function looksLikeInt(v) {
    if (typeof v === 'number') return Number.isInteger(v);
    if (typeof v !== 'string') return false;
    return /^[+-]?\d{1,15}$/.test(v.trim());
  }

  function toNumber(v) {
    if (isNA(v)) return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    var s = String(v).trim().replace(/,/g, '').replace(/^\$/, '').replace(/%$/, '');
    if (!s) return null;
    var n = Number(s);
    return isNaN(n) ? null : n;
  }

  function toBool(v) {
    if (isNA(v)) return null;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    var s = String(v).trim().toLowerCase();
    if (['true', 't', 'yes', 'y', '1'].indexOf(s) >= 0) return true;
    if (['false', 'f', 'no', 'n', '0'].indexOf(s) >= 0) return false;
    return null;
  }

  /** pandas read_csv style type inference over a raw value array. */
  function inferDtype(values) {
    var n = values.length;
    var ints = 0, floats = 0, bools = 0, dates = 0, total = 0, nulls = 0;
    var step = n > 20000 ? Math.ceil(n / 20000) : 1;
    for (var i = 0; i < n; i += step) {
      var v = values[i];
      if (isNA(v)) { nulls += 1; continue; }
      total += 1;
      if (typeof v === 'boolean') { bools += 1; continue; }
      if (typeof v === 'number') {
        if (!isNaN(v)) { if (Number.isInteger(v)) ints += 1; else floats += 1; }
        continue;
      }
      if (v instanceof Date) { dates += 1; continue; }
      if (typeof v === 'string') {
        if (looksLikeInt(v)) { ints += 1; continue; }
        var num = Number(v.replace(/,/g, ''));
        if (v.trim() !== '' && !isNaN(num)) { if (Number.isInteger(num)) ints += 1; else floats += 1; continue; }
        if (toBool(v) !== null) { bools += 1; continue; }
        if (looksLikeDateString(v)) { dates += 1; continue; }
      }
    }
    if (total === 0) return 'object';
    if (bools === total) return 'bool';
    if (dates === total) return 'datetime64[ns]';
    if (ints === total) return hasAnyNull(values) ? 'float64' : 'int64';
    if (ints + floats === total) return 'float64';
    return 'object';
  }

  function hasAnyNull(values) {
    for (var i = 0; i < values.length; i++) if (isNA(values[i])) return true;
    return false;
  }

  function castValues(values, fromDtype, toDtype) {
    var out = new Array(values.length);
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (isNA(v)) { out[i] = null; continue; }
      switch (toDtype) {
        case 'int64':
          var n = toNumber(v);
          out[i] = n === null ? null : Math.trunc(n);
          break;
        case 'float64':
          out[i] = toNumber(v);
          break;
        case 'object':
          if (v instanceof Date) out[i] = U.fmtDateTime(v);
          else out[i] = typeof v === 'boolean' ? (v ? 'True' : 'False') : String(v);
          break;
        case 'bool':
          out[i] = toBool(v);
          break;
        case 'datetime64[ns]':
          if (v instanceof Date) out[i] = v;
          else if (typeof v === 'number') { var d = new Date(v); out[i] = isNaN(d.getTime()) ? null : d; }
          else out[i] = parseDate(v);
          break;
        case 'category':
          out[i] = v;
          break;
        default:
          out[i] = v;
      }
    }
    if (toDtype === 'int64' && hasAnyNull(out)) toDtype = 'float64'; // pandas promotes
    return { values: out, dtype: toDtype };
  }

  /** Convert raw parsed strings into typed values according to a dtype. */
  function coerceToDtype(values, dtype) {
    if (dtype === 'int64') {
      return values.map(function (v) {
        if (isNA(v)) return null;
        var n = toNumber(v);
        return n === null ? null : Math.trunc(n);
      });
    }
    if (dtype === 'float64') return values.map(toNumber);
    if (dtype === 'bool') return values.map(toBool);
    if (dtype === 'datetime64[ns]') return values.map(function (v) { return isNA(v) ? null : parseDate(v); });
    return values;
  }

  /* ---------- comparison / sorting -------------------------------------- */
  function compare(a, b) {
    var an = isNA(a), bn = isNA(b);
    if (an && bn) return 0;
    if (an) return 1;   // NaNs sort last, like pandas
    if (bn) return -1;
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
    if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    var sa = String(a), sb = String(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }

  function isNumericValue(v) {
    return typeof v === 'number' || typeof v === 'boolean' || v instanceof Date;
  }

  /* ---------- DataFrame ------------------------------------------------- */
  function DataFrame(cols, names, dtypes) {
    if (!(this instanceof DataFrame)) return new DataFrame(cols, names, dtypes);
    this._cols = cols || [];
    this._names = names || [];
    this._dtypes = dtypes || [];
    this._nrows = this._cols.length ? this._cols[0].length : 0;
    this._kinds = null;
  }

  DataFrame.fromRecords = function (records, opts) {
    opts = opts || {};
    if (!records || !records.length) {
      return new DataFrame([], opts.columns ? opts.columns.slice() : [], []);
    }
    var names = opts.columns ? opts.columns.slice() : Object.keys(records[0]);
    var cols = names.map(function (nm) {
      var arr = new Array(records.length);
      for (var i = 0; i < records.length; i++) {
        var v = records[i][nm];
        arr[i] = v === undefined ? null : v;
      }
      return arr;
    });
    var dtypes = names.map(function (nm, i) {
      return opts.dtypes && opts.dtypes[i] ? opts.dtypes[i] : inferDtype(cols[i]);
    });
    cols = cols.map(function (c, i) { return coerceToDtype(c, dtypes[i]); });
    return new DataFrame(cols, names, dtypes);
  };

  DataFrame.fromColumns = function (map, names, dtypes) {
    names = names || Object.keys(map);
    var cols = names.map(function (nm) { return map[nm] || []; });
    var n = cols.length ? cols[0].length : 0;
    cols = cols.map(function (c) {
      if (c.length === n) return c;
      var out = new Array(n);
      for (var i = 0; i < n; i++) out[i] = i < c.length ? c[i] : null;
      return out;
    });
    dtypes = dtypes || names.map(function (nm, i) { return inferDtype(cols[i]); });
    return new DataFrame(cols, names.slice(), dtypes.slice());
  };

  DataFrame.prototype = {
    constructor: DataFrame,

    get shape() { return [this._nrows, this._names.length]; },
    get nrows() { return this._nrows; },
    get ncols() { return this._names.length; },
    get names() { return this._names.slice(); },
    get dtypes() { return this._dtypes.slice(); },
    get columns() { return this._names.slice(); },

    colIndex: function (name) {
      var i = this._names.indexOf(name);
      return i;
    },
    has: function (name) { return this._names.indexOf(name) >= 0; },
    col: function (name) {
      var i = this._names.indexOf(name);
      if (i < 0) throw new Error('column not found: ' + name);
      return this._cols[i];
    },
    dtype: function (name) {
      var i = this._names.indexOf(name);
      return i < 0 ? null : this._dtypes[i];
    },
    dtypesAt: function (i) { return this._dtypes[i]; },
    kind: function (name) {
      if (!this._kinds) {
        var self = this;
        this._kinds = this._names.map(function (nm, i) { return kindOf(self._dtypes[i], self._cols[i]); });
      }
      return this._kinds[this._names.indexOf(name)];
    },
    kinds: function () {
      var self = this;
      return this._names.map(function (nm, i) { return self.kind(nm); });
    },
    numericColumns: function () {
      if (this._numericCols) return this._numericCols;
      var self = this;
      this._numericCols = this._names.filter(function (nm, i) {
        return isNumericDtype(self._dtypes[i]) || isBoolDtype(self._dtypes[i]);
      });
      return this._numericCols;
    },
    dateColumns: function () {
      if (this._dateCols) return this._dateCols;
      var self = this;
      this._dateCols = this._names.filter(function (nm, i) { return isDateDtype(self._dtypes[i]); });
      return this._dateCols;
    },
    categoricalColumns: function () {
      if (this._catCols) return this._catCols;
      var self = this;
      this._catCols = this._names.filter(function (nm, i) {
        var dt = self._dtypes[i];
        return dt === 'object' || dt === 'category' || dt === 'bool';
      });
      return this._catCols;
    },

    /** Shallow clone: column arrays are shared, never mutated in place. */
    copy: function () {
      var df = new DataFrame(this._cols.slice(), this._names.slice(), this._dtypes.slice());
      df._kinds = this._kinds ? this._kinds.slice() : null;
      return df;
    },

    /* ---- structural -------------------------------------------------- */
    rename: function (map) {
      var names = this._names.map(function (nm) {
        return Object.prototype.hasOwnProperty.call(map, nm) && map[nm] ? map[nm] : nm;
      });
      return new DataFrame(this._cols.slice(), names, this._dtypes.slice());
    },

    select: function (list) {
      var self = this, idx = [];
      list.forEach(function (nm) {
        var i = self._names.indexOf(nm);
        if (i >= 0 && idx.indexOf(i) < 0) idx.push(i);
      });
      var cols = idx.map(function (i) { return self._cols[i]; });
      var names = idx.map(function (i) { return self._names[i]; });
      var dts = idx.map(function (i) { return self._dtypes[i]; });
      return new DataFrame(cols, names, dts);
    },

    drop: function (list) {
      var self = this, keep = [], kd = [];
      this._names.forEach(function (nm, i) {
        if (list.indexOf(nm) < 0) { keep.push(i); kd.push(i); }
      });
      return new DataFrame(keep.map(function (i) { return self._cols[i]; }),
        keep.map(function (i) { return self._names[i]; }),
        keep.map(function (i) { return self._dtypes[i]; }));
    },

    /** Add or replace a column (values length must match nrows). */
    withColumn: function (name, values, dtype) {
      var cols = this._cols.slice(), names = this._names.slice(), dts = this._dtypes.slice();
      dtype = dtype || inferDtype(values);
      var vals = coerceToDtype(values, dtype);
      var i = names.indexOf(name);
      if (i >= 0) { cols[i] = vals; dts[i] = dtype; }
      else { cols.push(vals); names.push(name); dts.push(dtype); }
      return new DataFrame(cols, names, dts);
    },

    /** Insert at a position (used by assign-insert). */
    insertColumn: function (name, values, dtype, at) {
      var df = this.withColumn(name, values, dtype);
      if (at === undefined || at === null) return df;
      var order = df._names.slice();
      order.splice(order.indexOf(name), 1);
      order.splice(Math.max(0, Math.min(order.length, at)), 0, name);
      return df.select(order);
    },

    assign: function (name, fn, dtype) {
      var vals = new Array(this._nrows);
      for (var i = 0; i < this._nrows; i++) {
        vals[i] = fn(this.rowObject(i), i);
      }
      return this.withColumn(name, vals, dtype);
    },

    /** Materialise a row as an object (used by assign / row inspector). */
    rowObject: function (i) {
      var o = {};
      for (var j = 0; j < this._names.length; j++) o[this._names[j]] = this._cols[j][i];
      return o;
    },

    /** Array of row objects for a range (used by the table + exports). */
    records: function (from, to) {
      from = from === undefined ? 0 : Math.max(0, from);
      to = to === undefined ? this._nrows : Math.min(this._nrows, to);
      var out = new Array(Math.max(0, to - from));
      for (var i = from; i < to; i++) out[i - from] = this.rowObject(i);
      return out;
    },

    rows: function (from, to) {
      from = from === undefined ? 0 : Math.max(0, from);
      to = to === undefined ? this._nrows : Math.min(this._nrows, to);
      var out = new Array(Math.max(0, to - from));
      for (var i = from; i < to; i++) {
        var r = new Array(this._names.length);
        for (var j = 0; j < this._names.length; j++) r[j] = this._cols[j][i];
        out[i - from] = r;
      }
      return out;
    },

    head: function (n) { return this.slice(0, n === undefined ? 5 : n); },
    tail: function (n) {
      n = n === undefined ? 5 : n;
      return this.slice(Math.max(0, this._nrows - n), this._nrows);
    },

    slice: function (from, to) {
      var self = this;
      return new DataFrame(
        this._cols.map(function (c) { return c.slice(from, to); }),
        this._names.slice(), this._dtypes.slice()
      );
    },

    take: function (indices) {
      var self = this;
      var cols = this._cols.map(function (c) {
        return indices.map(function (i) { return c[i]; });
      });
      return new DataFrame(cols, this._names.slice(), this._dtypes.slice());
    },

    /** sample(n) / sample(frac) — deterministic for a given random_state. */
    sample: function (n, opts) {
      opts = opts || {};
      if (opts.frac !== undefined && opts.frac !== null && opts.frac !== '' && n === undefined) {
        n = Math.round(this._nrows * Number(opts.frac));
      }
      n = U.clamp(Math.round(n === undefined ? 1 : n), 0, this._nrows);
      var R = U.makeRandom(opts.seed === undefined ? 'sample' : opts.seed);
      var idx = new Array(this._nrows);
      for (var i = 0; i < this._nrows; i++) idx[i] = i;
      if (opts.replace) {
        var pick = new Array(n);
        for (var k = 0; k < n; k++) pick[k] = idx[Math.floor(R.next() * this._nrows)];
        return this.take(pick);
      }
      for (var j = 0; j < n; j++) {
        var swap = j + Math.floor(R.next() * (this._nrows - j));
        var t = idx[j]; idx[j] = idx[swap]; idx[swap] = t;
      }
      return this.take(idx.slice(0, n));
    },

    /* ---- column transforms (used by the visual operation pipeline) ---- */
    strOp: function (col, op, args) {
      args = args || {};
      var vals = this.col(col);
      var out = new Array(vals.length);
      var regex = null;
      if (op === 'regex_contains' || op === 'extract' || op === 'replace_regex') {
        try { regex = new RegExp(args.pattern || '', args.ignoreCase ? 'i' : ''); }
        catch (e) { regex = null; }
      }
      for (var i = 0; i < vals.length; i++) {
        var v = vals[i];
        if (isNA(v)) { out[i] = null; continue; }
        var s0 = v instanceof Date ? U.fmtDateTime(v) : String(v);
        switch (op) {
          case 'upper': out[i] = s0.toUpperCase(); break;
          case 'lower': out[i] = s0.toLowerCase(); break;
          case 'title': out[i] = s0.replace(/\b\w/g, function (c) { return c.toUpperCase(); }); break;
          case 'strip': out[i] = s0.trim(); break;
          case 'len': out[i] = s0.length; break;
          case 'contains': out[i] = args.ignoreCase ? s0.toLowerCase().indexOf(String(args.text || '').toLowerCase()) >= 0
            : s0.indexOf(String(args.text || '')) >= 0; break;
          case 'startswith': out[i] = s0.indexOf(String(args.text || '')) === 0; break;
          case 'endswith': out[i] = s0.slice(-String(args.text || '').length) === String(args.text || ''); break;
          case 'replace': out[i] = s0.split(String(args.text === undefined ? '' : args.text)).join(String(args.to === undefined ? '' : args.to)); break;
          case 'replace_regex': out[i] = regex ? s0.replace(regex, args.to === undefined ? '' : String(args.to)) : s0; break;
          case 'regex_contains': out[i] = regex ? regex.test(s0) : false; break;
          case 'slice': out[i] = s0.slice(args.start === undefined ? 0 : args.start,
            args.end === undefined || args.end === '' ? undefined : args.end); break;
          case 'split': {
            var parts = s0.split(args.sep === undefined || args.sep === '' ? ' ' : String(args.sep));
            var at = args.index === undefined || args.index === '' ? 0 : Number(args.index);
            out[i] = at < 0 ? (parts.length + at >= 0 ? parts[parts.length + at] : null) : (parts[at] === undefined ? null : parts[at]);
            break;
          }
          case 'extract': {
            var m = regex ? regex.exec(s0) : null;
            var g = args.group === undefined || args.group === '' ? 1 : Number(args.group);
            out[i] = m && m[g] !== undefined ? m[g] : null;
            break;
          }
          case 'cat': out[i] = s0 + String(args.text === undefined ? '' : args.text); break;
          case 'pad': {
            var w = Number(args.width || 2);
            while (s0.length < w) s0 = String(args.fill === undefined ? '0' : args.fill) + s0;
            out[i] = s0;
            break;
          }
          default: out[i] = s0;
        }
      }
      return out;
    },

    /** Datetime parts, mirroring pandas' .dt accessor. */
    dtOp: function (col, op) {
      var vals = this.col(col);
      var out = new Array(vals.length);
      var WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
        'August', 'September', 'October', 'November', 'December'];
      var allDates = true;
      for (var i = 0; i < vals.length; i++) {
        var v = vals[i];
        if (isNA(v)) { out[i] = null; continue; }
        var d = v instanceof Date ? v : parseDate(v);
        if (!d) { out[i] = null; allDates = false; continue; }
        switch (op) {
          case 'year': out[i] = d.getFullYear(); break;
          case 'quarter': out[i] = Math.floor(d.getMonth() / 3) + 1; break;
          case 'month': out[i] = d.getMonth() + 1; break;
          case 'month_name': out[i] = MONTHS[d.getMonth()]; break;
          case 'week': out[i] = isoWeek(d); break;
          case 'day': out[i] = d.getDate(); break;
          case 'dayofyear': out[i] = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000); break;
          case 'weekday': out[i] = (d.getDay() + 6) % 7; break;
          case 'weekday_name': out[i] = WEEKDAYS[(d.getDay() + 6) % 7]; break;
          case 'hour': out[i] = d.getHours(); break;
          case 'minute': out[i] = d.getMinutes(); break;
          case 'date': out[i] = new Date(d.getFullYear(), d.getMonth(), d.getDate()); break;
          case 'month_start': out[i] = new Date(d.getFullYear(), d.getMonth(), 1); break;
          case 'week_start': {
            var s0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            s0.setDate(s0.getDate() - ((d.getDay() + 6) % 7));
            out[i] = s0;
            break;
          }
          case 'days_since_start': out[i] = Math.round((d - new Date(2020, 0, 1)) / 86400000); break;
          default: out[i] = d;
        }
      }
      return out;
    },

    /** cut / qcut style binning → interval labels like pandas: (0.9, 5.0] */
    bins: function (col, opts) {
      opts = opts || {};
      var nums = S.numeric(this.col(col));
      if (!nums.length) return { values: this.col(col).map(function () { return null; }), edges: [], labels: [] };
      var n = Math.max(1, Math.min(60, opts.bins || 5));
      var edges = [];
      if (opts.method === 'qcut') {
        var sorted = nums.slice().sort(function (a, b) { return a - b; });
        for (var i = 0; i <= n; i++) edges.push(S.quantileSorted(sorted, i / n));
        edges = U.uniq(edges);
        if (edges.length < 2) edges = [sorted[0], sorted[sorted.length - 1] + 1];
      } else {
        var lo = S.min(nums), hi = S.max(nums);
        if (lo === hi) { lo -= 0.5; hi += 0.5; }
        for (var k = 0; k <= n; k++) edges.push(lo + (hi - lo) * k / n);
      }
      var labels = [];
      for (var j = 0; j + 1 < edges.length; j++) {
        labels.push('(' + U.fmtNumber(edges[j], { maxFrac: 3 }) + ', ' + U.fmtNumber(edges[j + 1], { maxFrac: 3 }) + ']');
      }
      var src = this.col(col);
      var values = src.map(function (v) {
        var x = isNA(v) ? null : S.numeric([v])[0];
        if (x === null || x === undefined || isNaN(x)) return null;
        if (x <= edges[0]) return labels[0];
        for (var b = 0; b + 1 < edges.length; b++) {
          if (x <= edges[b + 1]) return labels[b];
        }
        return labels[labels.length - 1];
      });
      return { values: values, edges: edges, labels: labels };
    },

    /** get_dummies */
    oneHot: function (cols, opts) {
      opts = opts || {};
      var out = this.copy();
      var prefix = opts.prefix || '';
      var multi = cols.length > 1;
      cols.forEach(function (col) {
        var vals = this.col(col);
        var cats = uniqueSorted(vals);
        if (opts.dropFirst) cats = cats.slice(0);
        cats.forEach(function (cat, ci) {
          if (opts.dropFirst && ci === 0) return;
          var name = (prefix ? prefix + '_' : '') + (multi ? col + '_' : '') + displayKey(cat).replace(/\s+/g, '_');
          var arr = vals.map(function (v) { return isNA(v) ? 0 : (valueKey(v) === valueKey(cat) ? 1 : 0); });
          out = out.withColumn(name, arr, 'int64');
        });
      }, this);
      return out.drop(cols);
    },

    /** Series.map / replace with a lookup object. */
    mapValues: function (col, mapping, opts) {
      opts = opts || {};
      var vals = this.col(col);
      var lookup = new Map();
      Object.keys(mapping).forEach(function (k) { lookup.set(k, mapping[k]); });
      return vals.map(function (v) {
        if (isNA(v)) return isNA(opts.naValue) && opts.naValue !== undefined ? opts.naValue : v;
        var k = displayKey(v);
        if (lookup.has(k)) return lookup.get(k);
        if (lookup.has(String(v))) return lookup.get(String(v));
        if (opts.keep !== false) return v;
        return opts.fill === undefined ? null : opts.fill;
      });
    },

    rankCol: function (col, method, ascending) {
      return S.rank(this.col(col), method || 'average', ascending !== false);
    },

    /** abs/round/clip/log/standardise and running transforms. */
    numericTransform: function (col, op, args) {
      args = args || {};
      var vals = this.col(col);
      var nums = vals.map(function (v) { var n = S.numeric([v]); return n.length ? n[0] : null; });
      var out = new Array(vals.length);
      var mn = null, sd = null, lo = null, hi = null;
      if (op === 'zscore' || op === 'minmax') {
        var clean = S.numeric(vals);
        mn = S.mean(clean);
        sd = S.std(clean);
        lo = S.min(clean);
        hi = S.max(clean);
      }
      if (op === 'cumsum' || op === 'cummax' || op === 'cummin' || op === 'cumprod' ||
          op === 'diff' || op === 'pct_change' || op === 'shift') {
        var acc = null;
        var periods = args.periods === undefined || args.periods === '' ? 1 : Number(args.periods);
        for (var i = 0; i < nums.length; i++) {
          var v = nums[i];
          switch (op) {
            case 'cumsum':
              out[i] = v === null ? null : (acc = (acc === null ? 0 : acc) + v);
              break;
            case 'cumprod':
              out[i] = v === null ? null : (acc = (acc === null ? 1 : acc) * v);
              break;
            case 'cummax':
              out[i] = v === null ? acc : (acc = acc === null ? v : Math.max(acc, v));
              break;
            case 'cummin':
              out[i] = v === null ? acc : (acc = acc === null ? v : Math.min(acc, v));
              break;
            case 'diff': {
              var prev = i - periods >= 0 ? nums[i - periods] : null;
              out[i] = v === null || prev === null ? null : v - prev;
              break;
            }
            case 'pct_change': {
              var prev2 = i - periods >= 0 ? nums[i - periods] : null;
              out[i] = v === null || prev2 === null || prev2 === 0 ? null : v / prev2 - 1;
              break;
            }
            case 'shift':
              out[i] = i - periods >= 0 ? nums[i - periods] : null;
              break;
          }
        }
        return out;
      }
      for (var k = 0; k < nums.length; k++) {
        var x = nums[k];
        if (x === null) { out[k] = null; continue; }
        switch (op) {
          case 'abs': out[k] = Math.abs(x); break;
          case 'round': out[k] = U.roundHalfEven(x, args.decimals || 0); break;
          case 'floor': out[k] = Math.floor(x); break;
          case 'ceil': out[k] = Math.ceil(x); break;
          case 'neg': out[k] = -x; break;
          case 'sign': out[k] = Math.sign(x); break;
          case 'sqrt': out[k] = x < 0 ? null : Math.sqrt(x); break;
          case 'exp': out[k] = Math.exp(x); break;
          case 'log': out[k] = x <= 0 ? null : Math.log(x); break;
          case 'log1p': out[k] = x <= -1 ? null : Math.log1p(x); break;
          case 'square': out[k] = x * x; break;
          case 'clip': {
            var l = args.lower === undefined || args.lower === '' ? -Infinity : Number(args.lower);
            var h = args.upper === undefined || args.upper === '' ? Infinity : Number(args.upper);
            out[k] = Math.min(h, Math.max(l, x));
            break;
          }
          case 'zscore': out[k] = sd ? (x - mn) / sd : null; break;
          case 'minmax': out[k] = hi > lo ? (x - lo) / (hi - lo) : null; break;
          default: out[k] = x;
        }
      }
      return out;
    },

    /* ---- row-wise ---------------------------------------------------- */
    filter: function (mask) {
      var n = Math.min(mask.length, this._nrows);
      var idx = [];
      for (var i = 0; i < n; i++) if (mask[i]) idx.push(i);
      return this.take(idx);
    },

    sortValues: function (keys) {
      // keys: [{col, ascending}] — pandas-style stable multi-key sort.
      var self = this;
      keys = keys.filter(function (k) { return self._names.indexOf(k.col) >= 0; });
      if (!keys.length) return this.copy();
      var idx = new Array(this._nrows);
      for (var i = 0; i < this._nrows; i++) idx[i] = i;
      var cols = keys.map(function (k) { return self.col(k.col); });
      idx.sort(function (a, b) {
        for (var k = 0; k < keys.length; k++) {
          var c = compare(cols[k][a], cols[k][b]);
          if (c !== 0) return keys[k].ascending === false ? -c : c;
        }
        return a - b;
      });
      return this.take(idx);
    },

    /** Boolean mask of duplicated rows (pandas duplicated()). */
    duplicated: function (subset, keep) {
      keep = keep === undefined ? 'first' : keep;
      var cacheKey = (subset && subset.length ? subset.join('\u0001') : '*') + '|' + keep;
      if (this._dupCache && this._dupCache.key === cacheKey) return this._dupCache.mask;
      var cols = (subset && subset.length ? subset : this._names).map(this.col, this);
      var seen = new Map(), mask = new Array(this._nrows).fill(false);
      var order = [];
      for (var i = 0; i < this._nrows; i++) {
        var key = cols.map(function (c) { return valueKey(c[i]); }).join('\u0001');
        order.push(key);
      }
      if (keep === 'last' || keep === false) {
        for (var j = order.length - 1; j >= 0; j--) {
          var k = order[j];
          if (seen.has(k)) mask[j] = true;
          else if (keep === 'last') seen.set(k, true);
          if (keep === false && !seen.has(k)) { /* keep none */ }
        }
        if (keep === false) {
          // keep=False marks every row that participates in a duplicate set
          var counts = new Map();
          order.forEach(function (k) { counts.set(k, (counts.get(k) || 0) + 1); });
          for (var m = 0; m < order.length; m++) mask[m] = counts.get(order[m]) > 1;
        }
      } else {
        for (var p = 0; p < order.length; p++) {
          var kk = order[p];
          if (seen.has(kk)) mask[p] = true;
          else seen.set(kk, true);
        }
      }
      this._dupCache = { key: cacheKey, mask: mask };
      return mask;
    },

    dropDuplicates: function (subset, keep) {
      var mask = this.duplicated(subset, keep);
      return this.filter(mask.map(function (d) { return !d; }));
    },

    dropna: function (subset, how, thresh) {
      var cols = (subset && subset.length ? subset : this._names).map(this.col, this);
      how = how || 'any';
      var mask = new Array(this._nrows).fill(true);
      for (var i = 0; i < this._nrows; i++) {
        var miss = 0, tot = 0;
        for (var c = 0; c < cols.length; c++) {
          tot += 1;
          if (isNA(cols[c][i])) miss += 1;
        }
        if (thresh !== undefined && thresh !== null && thresh !== '') {
          var nonNull = tot - miss;
          mask[i] = nonNull >= thresh;
        } else {
          mask[i] = how === 'all' ? (miss < tot) : (miss === 0);
        }
      }
      return this.filter(mask);
    },

    /** Fill NA per column: spec[col] = {method, value, limit} */
    fillna: function (spec) {
      var self = this;
      var out = this.copy();
      Object.keys(spec).forEach(function (name) {
        var i = self._names.indexOf(name);
        if (i < 0) return;
        var cfg = spec[name];
        var src = self._cols[i];
        var arr = src.slice();
        var fillVal = null;
        if (cfg.method === 'value') {
          fillVal = coerceFillValue(cfg.value, self._dtypes[i]);
        } else if (cfg.method === 'mean' || cfg.method === 'median' || cfg.method === 'mode' ||
                   cfg.method === 'min' || cfg.method === 'max' || cfg.method === 'std') {
          var nums = S.numeric(src);
          if (!nums.length) return;
          if (cfg.method === 'mean') fillVal = S.mean(nums);
          else if (cfg.method === 'median') fillVal = S.median(nums);
          else if (cfg.method === 'min') fillVal = S.min(nums);
          else if (cfg.method === 'max') fillVal = S.max(nums);
          else if (cfg.method === 'std') fillVal = S.std(nums);
          else { var m = S.mode(src); fillVal = m ? m.value : null; }
        } else if (cfg.method === 'ffill' || cfg.method === 'bfill') {
          var limit = cfg.limit || Infinity;
          var last = null, gap = 0;
          if (cfg.method === 'ffill') {
            for (var a = 0; a < arr.length; a++) {
              if (isNA(arr[a])) { if (last !== null && gap < limit) { arr[a] = last; gap += 1; } }
              else { last = arr[a]; gap = 0; }
            }
          } else {
            var next = null, gap2 = 0;
            for (var b = arr.length - 1; b >= 0; b--) {
              if (isNA(arr[b])) { if (next !== null && gap2 < limit) { arr[b] = next; gap2 += 1; } }
              else { next = arr[b]; gap2 = 0; }
            }
          }
          out._cols[i] = arr;
          return;
        } else if (cfg.method === 'ffill_group') {
          return;
        }
        for (var k = 0; k < arr.length; k++) if (isNA(arr[k])) arr[k] = fillVal;
        out._cols[i] = arr;
      });
      var dt = out._dtypes.slice();
      out._dtypes = dt.map(function (d, i) {
        return d;
      });
      return out;
    },

    /* ---- columns ops ------------------------------------------------- */
    astype: function (col, dtype) {
      var i = this._names.indexOf(col);
      if (i < 0) return this.copy();
      var res = castValues(this._cols[i], this._dtypes[i], dtype);
      var cols = this._cols.slice(), dts = this._dtypes.slice();
      cols[i] = res.values; dts[i] = res.dtype;
      return new DataFrame(cols, this._names.slice(), dts);
    },

    /** make a column unique-safe name */
    uniqueName: function (base) {
      if (this._names.indexOf(base) < 0) return base;
      var n = 2;
      while (this._names.indexOf(base + '_' + n) >= 0) n += 1;
      return base + '_' + n;
    },

    /* ---- describe / stats -------------------------------------------- */
    describeNumeric: function (cols) {
      var self = this;
      var list = (cols && cols.length ? cols : this.numericColumns())
        .filter(function (c) { return isNumericDtype(self.dtype(c)); });
      var stats = ['count', 'mean', 'std', 'min', '25%', '50%', '75%', 'max'];
      var out = { statistic: stats, columns: list, values: [] };
      out.values = stats.map(function (s0) {
        return list.map(function (c) {
          var nums = S.numeric(self.col(c));
          if (!nums.length) return null;
          switch (s0) {
            case 'count': return nums.length;
            case 'mean': return S.mean(nums);
            case 'std': return S.std(nums);
            case 'min': return S.min(nums);
            case '25%': return S.quantile(nums, 0.25);
            case '50%': return S.median(nums);
            case '75%': return S.quantile(nums, 0.75);
            case 'max': return S.max(nums);
          }
          return null;
        });
      });
      return out;
    },

    describeCategorical: function (cols) {
      var self = this;
      var list = (cols && cols.length ? cols : this._names).filter(function (c) {
        var d = self.dtype(c);
        return !isNumericDtype(d);
      });
      var info = this.info();
      var stats = ['count', 'unique', 'top', 'freq'];
      var out = { statistic: stats, columns: list, values: [], extra: {} };
      out.values = stats.map(function (s0) {
        return list.map(function (c) {
          var rec = info.filter(function (i) { return i.name === c; })[0];
          var m = S.mode(self.col(c));
          switch (s0) {
            case 'count': return rec ? rec.nonNull : 0;
            case 'unique': return rec ? rec.unique : 0;
            case 'top': return m ? m.value : null;
            case 'freq': return m ? m.count : null;
          }
          return null;
        });
      });
      return out;
    },

    info: function () {
      // Profiling a frame is pure, and the UI asks for it from several panels:
      // compute once per frame instance.
      if (this._infoCache) return this._infoCache;
      var self = this;
      this._infoCache = this._names.map(function (nm, i) {
        var vals = self._cols[i];
        var nn = 0, sampleVals = [];
        for (var k = 0; k < vals.length; k++) {
          if (!isNA(vals[k])) { nn += 1; if (sampleVals.length < 4 && sampleVals.indexOf(vals[k]) < 0) sampleVals.push(vals[k]); }
        }
        var nums = isNumericDtype(self._dtypes[i]) ? S.numeric(vals) : null;
        var q = nums && nums.length > 3 ? S.quantiles(nums, [0.25, 0.5, 0.75]) : null;
        return {
          name: nm,
          dtype: self._dtypes[i],
          kind: kindOf(self._dtypes[i], vals),
          nonNull: nn,
          missing: vals.length - nn,
          unique: uniqCount(vals, 100000),
          sample: sampleVals,
          min: nums && nums.length ? S.min(nums) : null,
          max: nums && nums.length ? S.max(nums) : null,
          mean: nums && nums.length ? S.mean(nums) : null,
          median: nums && nums.length ? S.median(nums) : null,
          std: nums && nums.length ? S.std(nums) : null,
          q1: q ? q[0] : null,
          q2: q ? q[1] : null,
          q3: q ? q[2] : null
        };
      });
      return this._infoCache;
    },

    valueCounts: function (col, opts) {
      opts = opts || {};
      var vals = this.col(col);
      var rows = S.counts(vals, { dropna: opts.dropna !== false });
      var total = rows.total;
      var out = rows.map(function (r, i) {
        return {
          value: r.value,
          count: r.n,
          percent: total ? r.n / total : 0,
          cumulative: 0,
          rank: i + 1
        };
      });
      var acc = 0;
      out.forEach(function (r) { acc += r.percent; r.cumulative = acc; });
      if (opts.limit && out.length > opts.limit) {
        var head = out.slice(0, opts.limit);
        var rest = out.slice(opts.limit);
        var otherCount = rest.reduce(function (a, b) { return a + b.count; }, 0);
        var otherPct = rest.reduce(function (a, b) { return a + b.percent; }, 0);
        head.push({ value: null, count: otherCount, percent: otherPct, cumulative: 1, rank: 0, isOther: true, otherN: rest.length });
        out = head;
      }
      out.total = total;
      out.uniqueCount = rows.length;
      return out;
    },

    corr: function (cols, method) {
      var self = this;
      var list = (cols && cols.length ? cols : this.numericColumns())
        .filter(function (c) { return self.numericColumns().indexOf(c) >= 0; });
      var data = list.map(function (c) { return S.numeric(self.col(c)); });
      var m = list.map(function (_, i) {
        return list.map(function (__, j) {
          if (i === j) return 1;
          return S.corr(self.col(list[i]), self.col(list[j]), method || 'pearson');
        });
      });
      return { names: list, matrix: m, method: method || 'pearson' };
    },

    /**
     * Association matrix that works on mixed data: |Pearson| for numeric
     * pairs, Cramér's V for categorical pairs and the correlation ratio η when
     * a numeric column is explained by a categorical one. Everything lands in
     * [0, 1], so one colour scale is meaningful across the whole matrix.
     */
    assocMatrix: function (cols) {
      var self = this;
      var list = (cols && cols.length ? cols : this.names).slice(0, 10);
      var kinds = list.map(function (c) { return self.kind(c); });
      var matrix = [], methods = [];
      list.forEach(function (a, i) {
        matrix.push([]);
        methods.push([]);
        list.forEach(function (b, j) {
          if (i === j) { matrix[i].push(1); methods[i].push(''); return; }
          var ka = kinds[i], kb = kinds[j];
          var numericA = ka === 'numeric' || ka === 'bool';
          var numericB = kb === 'numeric' || kb === 'bool';
          var v = null, m = '';
          if (numericA && numericB) {
            var r = S.pearson(self.col(a), self.col(b));
            v = isNaN(r) ? null : Math.abs(r);
            m = 'pearson';
          } else if (!numericA && !numericB) {
            v = cramersV(self, a, b);
            m = "cramer's v";
          } else {
            v = eta(self, numericA ? a : b, numericA ? b : a);
            m = 'eta';
          }
          matrix[i].push(v);
          methods[i].push(m);
        });
      });
      return { names: list, matrix: matrix, methods: methods, method: 'mixed' };
    },

    /* ---- grouping ---------------------------------------------------- */
    groupby: function (keys) {
      return new GroupBy(this, keys);
    },

    crosstab: function (a, b, opts) {
      opts = opts || {};
      var av = this.col(a), bv = this.col(b);
      var aVals = uniqueSorted(av), bVals = uniqueSorted(bv);
      if (opts.limit) {
        var aCounts = S.counts(av);
        aVals = aCounts.slice(0, opts.limit).map(function (r) { return r.value; }).sort(compare);
      }
      var aIdx = new Map(), bIdx = new Map();
      aVals.forEach(function (v, i) { aIdx.set(valueKey(v), i); });
      bVals.forEach(function (v, i) { bIdx.set(valueKey(v), i); });
      var table = aVals.map(function () { return new Array(bVals.length).fill(0); });
      for (var i = 0; i < this._nrows; i++) {
        var ka = aIdx.get(valueKey(av[i])), kb = bIdx.get(valueKey(bv[i]));
        if (ka === undefined || kb === undefined) continue;
        table[ka][kb] += 1;
      }
      var res = new DataFrame([], [], []);
      // pandas names the reset index column after the row variable
      var cols = [a];
      var dtypes = ['object'];
      var data = [aVals.slice()];
      bVals.forEach(function (bv2, j) {
        cols.push(displayKey(bv2));
        dtypes.push('int64');
        data.push(table.map(function (row) { return row[j]; }));
      });
      if (opts.margins !== false) {
        cols.push('All'); dtypes.push('int64');
        data.push(table.map(function (row) { return row.reduce(function (x, y) { return x + y; }, 0); }));
      }
      var stats = S.chiSquare(table);
      if (opts.margins !== false) {
        // append the "All" row: column totals, then the grand total
        var colTotals = bVals.map(function (bv3, j2) {
          return table.reduce(function (acc, row) { return acc + row[j2]; }, 0);
        });
        var grand = colTotals.reduce(function (x, y) { return x + y; }, 0);
        data[0] = data[0].concat(['All']);
        for (var c = 1; c < data.length; c++) {
          data[c] = data[c].concat([c - 1 < bVals.length ? colTotals[c - 1] : grand]);
        }
      }
      var out = new DataFrame(data, cols, dtypes);
      out.chiSquare = stats;
      return out;
    },

    pivotTable: function (opts) {
      var self = this;
      var index = opts.index || [];
      var columns = opts.columns || [];
      var values = opts.values;
      var aggfunc = opts.aggfunc || 'mean';
      if (!values || (index.length === 0 && columns.length === 0)) return this.copy();
      var idxVals = index.length ? uniqueSorted(this.col(index[0])) : [null];
      var colVals = columns.length ? uniqueSorted(this.col(columns[0])) : [null];
      var iIdx = new Map(), cIdx = new Map();
      idxVals.forEach(function (v, i) { iIdx.set(valueKey(v), i); });
      colVals.forEach(function (v, i) { cIdx.set(valueKey(v), i); });
      var buckets = idxVals.map(function () { return colVals.map(function () { return []; }); });
      var icol = index.length ? this.col(index[0]) : null;
      var ccol = columns.length ? this.col(columns[0]) : null;
      var vcol = this.col(values);
      for (var i = 0; i < this._nrows; i++) {
        var rk = icol ? iIdx.get(valueKey(icol[i])) : 0;
        var ck = ccol ? cIdx.get(valueKey(ccol[i])) : 0;
        if (rk === undefined || ck === undefined) continue;
        var v = vcol[i];
        if (isNA(v)) continue;
        buckets[rk][ck].push(v);
      }
      var agg = aggFn(aggfunc);
      var fill = opts.fillValue !== undefined && opts.fillValue !== null && opts.fillValue !== ''
        ? coerceFillValue(opts.fillValue, 'float64') : (aggfunc === 'count' || aggfunc === 'size' || aggfunc === 'sum' || aggfunc === 'nunique' ? 0 : null);
      var data = [idxVals.slice()];
      var cols = [index.length ? index[0] : 'index'];
      var dtypes = ['object'];
      var rowTotals = idxVals.map(function () { return []; });
      colVals.forEach(function (cv, j) {
        cols.push(columns.length ? displayKey(cv) : values);
        dtypes.push('float64');
        data.push(idxVals.map(function (iv, ii) {
          var bucket = buckets[ii][j];
          rowTotals[ii] = rowTotals[ii].concat(bucket);
          var r = agg(bucket);
          return r === null || r === undefined || (typeof r === 'number' && isNaN(r)) ? fill : r;
        }));
      });
      var out = new DataFrame(data, cols, dtypes);
      if (opts.margins) {
        var rowTotalsAgg = rowTotals.map(function (bucket) {
          var r = agg(bucket);
          return r === null || r === undefined || (typeof r === 'number' && isNaN(r)) ? fill : r;
        });
        var colTotals = colVals.map(function (cv, j) {
          var bucket = buckets.reduce(function (a, row) { return a.concat(row[j]); }, []);
          var r = agg(bucket);
          return r === null || r === undefined || (typeof r === 'number' && isNaN(r)) ? fill : r;
        });
        var grand = rowTotals.reduce(function (a, b) { return a.concat(b); }, []);
        var grandAgg = agg(grand);
        if (grandAgg === null || grandAgg === undefined || (typeof grandAgg === 'number' && isNaN(grandAgg))) grandAgg = fill;
        // append the "All" row to every existing column …
        out._cols = out._cols.map(function (arr, i) {
          return i === 0 ? arr.concat(['All']) : arr.concat([colTotals[i - 1]]);
        });
        // … then add the "All" column (row totals) and the grand total.
        out._cols = out._cols.concat([rowTotalsAgg.concat([grandAgg])]);
        out._names = out._names.concat(['All']);
        out._dtypes = out._dtypes.concat(['float64']);
        out._nrows += 1;
      }
      return out;
    },

    /* ---- joins ------------------------------------------------------- */
    merge: function (other, opts) {
      opts = opts || {};
      var selfFrame = this;
      var leftOn = opts.leftOn || [], rightOn = opts.rightOn || [];
      if (!leftOn.length || !rightOn.length || leftOn.length !== rightOn.length) {
        throw new Error('merge requires matching left/right keys');
      }
      var how = opts.how || 'inner';
      var sfx = opts.suffixes || ['_x', '_y'];
      var leftKeyCols = leftOn.map(this.col, this);
      var rightKeyCols = rightOn.map(other.col, other);
      var leftRest = this._names.filter(function (n) { return leftOn.indexOf(n) < 0; });
      var rightRest = other._names.filter(function (n) { return rightOn.indexOf(n) < 0; });
      var common = leftRest.filter(function (n) { return rightRest.indexOf(n) >= 0 && leftOn.indexOf(n) < 0; });
      var lRen = {}, rRen = {};
      common.forEach(function (n) {
        if (leftOn.indexOf(n) < 0 && rightOn.indexOf(n) < 0) {
          lRen[n] = n + sfx[0];
          rRen[n] = n + sfx[1];
        }
      });
      // Output schema: left keys (as left names) -> remaining left -> remaining right
      var outNames = leftOn.slice();
      leftRest.forEach(function (n) { outNames.push(lRen[n] || n); });
      rightRest.forEach(function (n) { outNames.push(rRen[n] || n); });
      var outCols = outNames.map(function () { return []; });
      var flags = [];
      var rightIdx = new Map();
      var rKey = new Array(other.nrows);
      for (var i = 0; i < other.nrows; i++) {
        var kparts = rightKeyCols.map(function (c) { return valueKey(c[i]); });
        var key = kparts.join('\u0001');
        rKey[i] = kparts.some(function (p) { return p === '\u0000na'; }) ? null : key;
        if (key === null) continue;
        if (!rightIdx.has(key)) rightIdx.set(key, []);
        rightIdx.get(key).push(i);
      }
      var leftMatches = new Array(this.nrows).fill(false);
      var rightMatched = new Array(other.nrows).fill(false);

      function pushRow(li, ri, flag) {
        var k = 0;
        for (var a = 0; a < leftOn.length; a++) {
          outCols[k++].push(li === null ? null : leftKeyCols[a][li]);
        }
        leftRest.forEach(function (n) {
          outCols[k++].push(li === null ? null : selfFrame.col(n)[li]);
        });
        rightRest.forEach(function (n) {
          outCols[k++].push(ri === null ? null : other.col(n)[ri]);
        });
        flags.push(flag);
      }

      for (var l = 0; l < this.nrows; l++) {
        var lparts = leftKeyCols.map(function (c) { return valueKey(c[l]); });
        var lkey = lparts.join('\u0001');
        var hasNullKey = lparts.some(function (p) { return p === '\u0000na'; });
        var match = hasNullKey ? null : rightIdx.get(lkey);
        if (match && match.length) {
          leftMatches[l] = true;
          for (var m = 0; m < match.length; m++) {
            rightMatched[match[m]] = true;
            pushRow(l, match[m], 'both');
          }
        } else if (how === 'left' || how === 'outer') {
          pushRow(l, null, 'left_only');
        }
      }
      if (how === 'right' || how === 'outer') {
        for (var r = 0; r < other.nrows; r++) {
          if (!rightMatched[r]) pushRow(null, r, 'right_only');
        }
      }
      var dtypes = outNames.map(function (n, i) {
        var li = this._names.indexOf(n);
        if (li >= 0) return this._dtypes[li];
        var lp = leftOn.indexOf(n);
        if (lp >= 0) return this._dtypes[this._names.indexOf(leftOn[lp])];
        var src = n;
        var got = null;
        rightRest.forEach(function (rn) { if ((rRen[rn] || rn) === n) got = rn; });
        if (got !== null) return other._dtypes[other._names.indexOf(got)];
        return 'object';
      }, this);
      var out = new DataFrame(outCols, outNames, dtypes);
      if (opts.indicator) {
        out = out.withColumn('_merge', flags, 'object');
      }
      out.matchReport = {
        both: flags.filter(function (f) { return f === 'both'; }).length,
        leftOnly: flags.filter(function (f) { return f === 'left_only'; }).length,
        rightOnly: flags.filter(function (f) { return f === 'right_only'; }).length,
        leftRows: this.nrows,
        rightRows: other.nrows,
        leftKeyUnique: uniqCount(leftOn.length ? leftKeyCols[0] : []) === 0 ? 0 :
          (function (cols, n) {
            var seen = new Set(), dup = 0;
            for (var i = 0; i < n; i++) {
              var k = cols.map(function (c) { return valueKey(c[i]); }).join('\u0001');
              if (seen.has(k)) dup += 1; else seen.add(k);
            }
            return dup;
          })(leftKeyCols, this.nrows),
        rightKeyDup: (function (cols, n) {
          var seen = new Set(), dup = 0;
          for (var i = 0; i < n; i++) {
            var k = cols.map(function (c) { return valueKey(c[i]); }).join('\u0001');
            if (seen.has(k)) dup += 1; else seen.add(k);
          }
          return dup;
        })(rightKeyCols, other.nrows)
      };
      out.commonRenamed = common.length;
      return out;
    },

    concat: function (others, opts) {
      opts = opts || {};
      var frames = [this].concat(others);
      var names = [];
      frames.forEach(function (f) {
        f._names.forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
      });
      var cols = names.map(function (n) {
        var out = [];
        frames.forEach(function (f) {
          var i = f._names.indexOf(n);
          if (i < 0) { for (var k = 0; k < f.nrows; k++) out.push(null); }
          else { for (var k2 = 0; k2 < f.nrows; k2++) out.push(f._cols[i][k2]); }
        });
        return out;
      });
      var dtypes = names.map(function (n, i) {
        var f = frames.find(function (fr) { return fr._names.indexOf(n) >= 0; });
        return f ? f._dtypes[f._names.indexOf(n)] : 'object';
      });
      return new DataFrame(cols, names, dtypes);
    },

    /* ---- numerics ---------------------------------------------------- */
    quantile: function (col, q) {
      var nums = S.numeric(this.col(col));
      return S.quantile(nums, q);
    },

    /* ---- time series ------------------------------------------------- */
    resample: function (timeCol, freq, specs) {
      var times = this.col(timeCol);
      var keys = new Array(this.nrows);
      var bucketTimes = new Map();
      for (var i = 0; i < this.nrows; i++) {
        var t = times[i];
        if (!(t instanceof Date) || isNaN(t.getTime())) { keys[i] = null; continue; }
        var b = floorToPeriod(t, freq);
        keys[i] = b.getTime();
        if (!bucketTimes.has(keys[i])) bucketTimes.set(keys[i], b);
      }
      var uniqTimes = Array.from(bucketTimes.values()).sort(function (a, b) { return a - b; });
      var idxMap = new Map();
      uniqTimes.forEach(function (d, i) { idxMap.set(d.getTime(), i); });
      var data = [uniqTimes];
      var names = [timeCol];
      var dtypes = ['datetime64[ns]'];
      specs.forEach(function (sp) {
        var vcol = this.col(sp.col);
        var buckets = uniqTimes.map(function () { return []; });
        for (var r = 0; r < this.nrows; r++) {
          if (keys[r] === null) continue;
          var bi = idxMap.get(keys[r]);
          if (bi === undefined) continue;
          var v = vcol[r];
          if (isNA(v)) continue;
          buckets[bi].push(v);
        }
        var fn = aggFn(sp.fn);
        data.push(buckets.map(function (b) { return fn(b); }));
        names.push(sp.out || (sp.col + '_' + sp.fn));
        dtypes.push('float64');
      }, this);
      return new DataFrame(data, names, dtypes);
    },

    /* ---- export ------------------------------------------------------ */
    toCSV: function (sep) {
      return U.toCSV(this._names, this.rows(0, this._nrows), sep);
    },

    toJSON: function (orient, limit) {
      var recs = this.records(0, limit === undefined ? this._nrows : limit);
      var clean0 = function (o) {
        var out = {};
        for (var k in o) {
          var v = o[k];
          out[k] = v instanceof Date ? U.fmtDateTime(v) : (isNA(v) ? null : v);
        }
        return out;
      };
      if (orient === 'columns') {
        var obj = {};
        this._names.forEach(function (n, i) { obj[n] = this._cols[i].map(function (v) { return v instanceof Date ? U.fmtDateTime(v) : (isNA(v) ? null : v); }); }, this);
        return obj;
      }
      return recs.map(clean0);
    },

    memoryBytes: function () {
      var total = 0;
      for (var i = 0; i < this._cols.length; i++) {
        total += this._cols[i].length * 8;
      }
      return total;
    },

    /** Cheap but stable signature used for cache keys. */
    signature: function () {
      return this._nrows + 'x' + this._names.length + ':' + this._names.join('|') + ':' + this._dtypes.join('|');
    },

    fullSignature: function () {
      var h = 0;
      for (var i = 0; i < this._names.length; i++) {
        h = (h * 31 + U.hashString(this._names[i]) + U.hashString(this._dtypes[i])) >>> 0;
        var col = this._cols[i];
        var step = Math.max(1, Math.floor(col.length / 64));
        for (var j = 0; j < col.length; j += step) {
          var v = col[j];
          var k = isNA(v) ? 'NaN' : (v instanceof Date ? 'd' + v.getTime() : String(v));
          h = (h * 31 + U.hashString(k)) >>> 0;
        }
      }
      return this._nrows + 'x' + this._names.length + '-' + h.toString(36);
    }
  };

  /* ---------- fill helpers --------------------------------------------- */
  function coerceFillValue(v, dtype) {
    if (typeof v === 'string') {
      var s = v.trim();
      if (s === '') return null;
      if (s.toLowerCase() === 'nan' || s.toLowerCase() === 'na' || s.toLowerCase() === 'null') return null;
      if (dtype === 'datetime64[ns]') return parseDate(s);
      if (dtype === 'bool') return toBool(s);
      var n = toNumber(s);
      if (n !== null && (dtype === 'int64' || dtype === 'float64')) return n;
      return s;
    }
    return v;
  }

  /** Cramér's V between two categorical columns (0 = independent, 1 = linked). */
  function cramersV(df, a, b) {
    var av = df.col(a), bv = df.col(b);
    var aVals = uniqueSorted(av).slice(0, 40);
    var bVals = uniqueSorted(bv).slice(0, 40);
    if (aVals.length < 2 || bVals.length < 2) return null;
    var aIdx = new Map(), bIdx = new Map();
    aVals.forEach(function (v, i) { aIdx.set(valueKey(v), i); });
    bVals.forEach(function (v, i) { bIdx.set(valueKey(v), i); });
    var table = aVals.map(function () { return new Array(bVals.length).fill(0); });
    var n = 0;
    for (var i = 0; i < df.nrows; i++) {
      var ai = aIdx.get(valueKey(av[i])), bi = bIdx.get(valueKey(bv[i]));
      if (ai === undefined || bi === undefined) continue;
      table[ai][bi] += 1;
      n += 1;
    }
    if (!n) return null;
    var chi = S.chiSquare(table);
    if (!chi) return null;
    var denom = n * Math.min(table.length - 1, table[0].length - 1);
    return denom > 0 ? U.clamp(Math.sqrt(chi.chi2 / denom), 0, 1) : null;
  }

  /** Correlation ratio η: how much of a numeric column a category explains. */
  function eta(df, numCol, catCol) {
    var nums = df.col(numCol), cats = df.col(catCol);
    var groups = new Map(), all = [];
    for (var i = 0; i < df.nrows; i++) {
      var x = S.numeric([nums[i]])[0];
      if (x === null || x === undefined || isNaN(x)) continue;
      var k = valueKey(cats[i]);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
      all.push(x);
    }
    if (all.length < 2 || groups.size < 2) return null;
    var mean = S.mean(all), ssTotal = 0, ssBetween = 0;
    all.forEach(function (x) { ssTotal += (x - mean) * (x - mean); });
    groups.forEach(function (vals) {
      var m = S.mean(vals);
      ssBetween += vals.length * (m - mean) * (m - mean);
    });
    if (ssTotal === 0) return null;
    return U.clamp(Math.sqrt(Math.max(0, ssBetween / ssTotal)), 0, 1);
  }

  function uniqueSorted(values) {
    var seen = new Set(), out = [];
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (isNA(v)) continue;
      var k = valueKey(v);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    out.sort(compare);
    return out;
  }

  /** Map an aggregation name to a function over a bucket of values. */
  function aggFn(name) {
    return function (bucket) {
      var nums = null;
      switch (name) {
        case 'count': return S.clean(bucket).length;
        case 'size': return bucket.length;
        case 'nunique': return uniqCount(S.clean(bucket));
        case 'sum':
          nums = S.numeric(bucket);
          return nums.length ? S.sum(nums) : 0;
        case 'mean':
          nums = S.numeric(bucket); return nums.length ? S.mean(nums) : null;
        case 'median':
          nums = S.numeric(bucket); return nums.length ? S.median(nums) : null;
        case 'min':
          nums = S.numeric(bucket); return nums.length ? S.min(nums) : null;
        case 'max':
          nums = S.numeric(bucket); return nums.length ? S.max(nums) : null;
        case 'std':
          nums = S.numeric(bucket); return nums.length > 1 ? S.std(nums) : null;
        case 'var':
          nums = S.numeric(bucket); return nums.length > 1 ? S.variance(nums) : null;
        case 'sem':
          nums = S.numeric(bucket); return nums.length > 1 ? S.sem(nums) : null;
        case 'skew':
          nums = S.numeric(bucket); return nums.length > 2 ? S.skew(nums) : null;
        case 'prod':
          nums = S.numeric(bucket); return nums.length ? S.prod(nums) : null;
        case 'first':
          for (var i = 0; i < bucket.length; i++) if (!isNA(bucket[i])) return bucket[i];
          return null;
        case 'last':
          for (var j = bucket.length - 1; j >= 0; j--) if (!isNA(bucket[j])) return bucket[j];
          return null;
        case 'any':
          return S.clean(bucket).some(function (v) { return v === true || v === 1 || v === 'True'; });
        case 'all':
          return S.clean(bucket).every(function (v) { return v === true || v === 1 || v === 'True'; });
      }
      return null;
    };
  }

  /* ---------- GroupBy --------------------------------------------------- */
  function GroupBy(df, keys) {
    this.df = df;
    this.keys = (keys || []).filter(function (k) { return df.has(k); });
    if (!this.keys.length) throw new Error('groupby requires at least one key column');
  }

  GroupBy.prototype = {
    constructor: GroupBy,
    /** Build group buckets once; reused by every aggregation. */
    _buckets: function () {
      if (this._cache) return this._cache;
      var df = this.df;
      var keyCols = this.keys.map(df.col, df);
      var map = new Map(), order = [];
      for (var i = 0; i < df.nrows; i++) {
        var parts = keyCols.map(function (c) { return valueKey(c[i]); });
        if (parts.some(function (p) { return p === '\u0000na'; })) continue; // pandas dropna=True
        var key = parts.join('\u0001');
        var rec = map.get(key);
        if (!rec) {
          rec = { key: key, rows: [], values: this.keys.map(function (k, j) { return keyCols[j][i]; }) };
          map.set(key, rec);
          order.push(rec);
        }
        rec.rows.push(i);
      }
      this._cache = { buckets: order, map: map };
      return this._cache;
    },

    size: function () {
      var df0 = this.df;
      var b = this._buckets().buckets;
      var cols = this.keys.map(function (k, j) { return b.map(function (r) { return r.values[j]; }); });
      cols.push(b.map(function (r) { return r.rows.length; }));
      var names = this.keys.concat(['size']);
      var dtypes = this.keys.map(function (k) { return df0.dtype(k); });
      dtypes.push('int64');
      return new DataFrame(cols, names, dtypes);
    },

    /**
     * agg(spec) — spec is [{col, fn, out}] plus optional {name} for the size column.
     * Mirrors `df.groupby(keys, as_index=False).agg({...})` with flattened names.
     */
    agg: function (spec) {
      var df = this.df;
      var b = this._buckets().buckets;
      var cols = this.keys.map(function (k, j) { return b.map(function (r) { return r.values[j]; }); });
      var names = this.keys.slice();
      var dtypes = this.keys.map(function (k) { return df.dtype(k); });
      var perCol = {};
      spec.forEach(function (s) { perCol[s.col] = (perCol[s.col] || 0) + 1; });
      spec.forEach(function (s) {
        if (!df.has(s.col)) return;
        var fn = aggFn(s.fn);
        var src = df.col(s.col);
        var vals = b.map(function (r) {
          var bucket = new Array(r.rows.length);
          for (var i = 0; i < r.rows.length; i++) bucket[i] = src[r.rows[i]];
          return fn(bucket);
        });
        var name = s.out || (perCol[s.col] > 1 ? s.col + '_' + s.fn : (s.fn === 'size' || s.fn === 'count' ? s.col : s.col));
        while (names.indexOf(name) >= 0) name = name + '_';
        names.push(name);
        cols.push(vals);
        var dt = df.dtype(s.col);
        var numericFns = { sum: 1, mean: 1, median: 1, min: 1, max: 1, std: 1, var: 1, sem: 1, prod: 1, skew: 1, count: 1, size: 1, nunique: 1 };
        dtypes.push(numericFns[s.fn] ? 'float64' : dt);
      });
      return new DataFrame(cols, names, dtypes);
    },

    /** Aggregate a single column with a single function (result: keys + value col). */
    aggOne: function (col, fn, out) {
      return this.agg([{ col: col, fn: fn, out: out }]);
    },

    /** Row indices per group (for detailed drill-down). */
    indices: function () {
      var b = this._buckets().buckets;
      return b.map(function (r) {
        return { values: r.values, rows: r.rows, size: r.rows.length };
      });
    }
  };

  /* ---------- date helpers ---------------------------------------------- */
  function floorToPeriod(date, freq) {
    var d = new Date(date.getTime());
    switch (freq) {
      case 'hour': d.setMinutes(0, 0, 0); break;
      case 'day': d.setHours(0, 0, 0, 0); break;
      case 'week': {
        d.setHours(0, 0, 0, 0);
        var day = (d.getDay() + 6) % 7; // Monday = 0
        d.setDate(d.getDate() - day);
        break;
      }
      case 'month': d.setHours(0, 0, 0, 0); d.setDate(1); break;
      case 'quarter': d.setHours(0, 0, 0, 0); d.setDate(1); d.setMonth(Math.floor(d.getMonth() / 3) * 3); break;
      case 'year': d.setHours(0, 0, 0, 0); d.setDate(1); d.setMonth(0); break;
      default: d.setHours(0, 0, 0, 0);
    }
    return d;
  }

  function isoWeek(d) {
    var date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  }

  PV.df = {
    DataFrame: DataFrame,
    GroupBy: GroupBy,
    /**
     * The categorical column that makes the best default grouping/facet:
     * a real category with a handful of values (not an id or free text).
     */
    preferredCategoryColumn: function (df) {
      if (!df || !df.names.length) return null;
      var info = df.info();
      var cats = df.categoricalColumns();
      var scored = [];
      cats.forEach(function (c) {
        var rec = info.filter(function (i) { return i.name === c; })[0];
        if (!rec || rec.unique < 2 || rec.unique > 24) return;
        // a group-by default reads best with 3–12 real categories; booleans are
        // valid but make a dull default chart
        var ideal = Math.abs(rec.unique - 6);
        if (rec.unique < 3) ideal += 4;
        if (df.dtype(c) === 'bool') ideal += 2;
        scored.push({ col: c, score: ideal });
      });
      if (scored.length) {
        scored.sort(function (a, b) { return a.score - b.score; });
        return scored[0].col;
      }
      return cats[0] || df.numericColumns()[0] || df.names[0];
    },
    /**
     * The categorical columns that are usable as grouping/facet dimensions
     * (ids and free text are excluded, they produce unreadable output).
     */
    categoryColumns: function (df, maxUnique) {
      if (!df) return [];
      var info = df.info();
      return df.categoricalColumns().filter(function (c) {
        var rec = info.filter(function (i) { return i.name === c; })[0];
        return rec && rec.unique > 1 && rec.unique <= (maxUnique || 24);
      });
    },
    /**
     * The numeric column a chart should show by default: the one with the
     * widest spread (usually the "interesting" measure, not a count or id).
     */
    primaryNumericColumn: function (df) {
      if (!df) return null;
      var numeric = df.numericColumns().filter(function (c) {
        // ids and small counts make poor default measures
        var d = df.dtype(c);
        return d === 'int64' || d === 'float64';
      });
      if (!numeric.length) return df.numericColumns()[0] || df.names[0] || null;
      var info = df.info();
      var best = numeric[0], bestSpan = -1;
      numeric.forEach(function (c) {
        var rec = info.filter(function (i) { return i.name === c; })[0];
        if (!rec || rec.min === null || rec.max === null) return;
        var span = rec.max - rec.min;
        var penalty = /(^|_)(id|index|code|zip|year|month|day)$/i.test(c) ? 0.3 : 1;
        span = span * penalty;
        if (span > bestSpan) { bestSpan = span; best = c; }
      });
      return best;
    },
    inferDtype: inferDtype,
    castValues: castValues,
    coerceToDtype: coerceToDtype,
    parseDate: parseDate,
    toNumber: toNumber,
    toBool: toBool,
    compare: compare,
    valueKey: valueKey,
    displayKey: displayKey,
    kindOf: kindOf,
    uniqCount: uniqCount,
    isNumericDtype: isNumericDtype,
    isDateDtype: isDateDtype,
    isCategorical: isCategorical,
    isBoolDtype: isBoolDtype,
    aggFn: aggFn,
    uniqueSorted: uniqueSorted,
    floorToPeriod: floorToPeriod,
    isoWeek: isoWeek,
    NA_MARKERS: NA_MARKERS,
    coerceFillValue: coerceFillValue
  };
})(typeof window !== 'undefined' ? window : globalThis);
