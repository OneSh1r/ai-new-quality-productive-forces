/* =============================================================================
 * Visual Pandas — ops.js
 * The operation registry. Every visual operation knows:
 *   • params   — declarative form fields (rendered by forms.js)
 *   • defaults — sensible starting values for a given frame
 *   • apply    — how it transforms a DataFrame
 *   • code     — the equivalent pandas code
 *   • summary  — a short label for the pipeline list
 * A pipeline is just an ordered list of {type, params} — the same structure
 * feeds the table, the charts, the exports and the Python code tab.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, D = PV.df, S = PV.stats;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  var DTYPES = ['int64', 'float64', 'object', 'category', 'bool', 'datetime64[ns]'];
  var AGG_FNS = ['sum', 'mean', 'median', 'min', 'max', 'std', 'var', 'count', 'nunique', 'first', 'last', 'size', 'sem', 'prod', 'skew'];
  var FILTER_OPS = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'between', 'contains', 'startswith', 'endswith', 'notcontains', 'regex', 'isin', 'isna', 'notna'];
  var STR_OPS = ['upper', 'lower', 'title', 'strip', 'len', 'contains', 'startswith', 'endswith', 'replace', 'replace_regex', 'slice', 'split', 'extract', 'cat', 'pad'];
  var DT_OPS = ['year', 'quarter', 'month', 'month_name', 'week', 'day', 'dayofyear', 'weekday', 'weekday_name', 'hour', 'minute', 'date', 'month_start', 'week_start'];
  var NUM_OPS = ['abs', 'round', 'floor', 'ceil', 'clip', 'log', 'log1p', 'sqrt', 'exp', 'square', 'zscore', 'minmax', 'cumsum', 'diff', 'pct_change', 'shift', 'cummax', 'cummin', 'neg', 'sign'];
  var FREQS = ['hour', 'day', 'week', 'month', 'quarter', 'year'];
  var RANK_METHODS = ['average', 'min', 'max', 'dense', 'first'];

  /* ============================ helpers ================================= */
  function pyLit(v, dtype) {
    if (v === null || v === undefined || v === '') return 'np.nan';
    if (dtype === 'datetime64[ns]') return 'pd.Timestamp("' + String(v) + '")';
    if (dtype === 'bool') return (v === true || v === 'true' || v === 'True') ? 'True' : 'False';
    if (dtype === 'int64' || dtype === 'float64' || (typeof v === 'number' && !isNaN(v))) {
      var n = Number(v);
      if (!isNaN(n)) return String(n);
    }
    return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  function pyListValues(values, dtype) {
    return '[' + values.map(function (v) { return pyLit(v, dtype); }).join(', ') + ']';
  }

  function pyStr(v) { return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

  // The generated script can use any variable name; the code generators below
  // are synchronous, so a module-level variable keeps every helper in sync.
  var CURRENT_VAR = 'df';
  function pyCol(v) { return CURRENT_VAR + '[' + pyStr(v) + ']'; }
  /** The variable the generated script assigns to (df by default). */
  function V() { return CURRENT_VAR; }
  function assignRHS(rhs) { return [V() + ' = ' + rhs]; }

  function sanitize(name, fallback) {
    var s = String(name || '').toLowerCase().trim()
      .replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!s || /^[0-9]/.test(s)) s = (fallback || 'df') + (s ? '_' + s : '');
    if (/^(class|def|import|from|return|for|while|if|else|in|is|and|or|not|lambda|None|True|False|global|pass|with|as|try|except|raise)$/.test(s)) s = s + '_';
    return s;
  }

  /** Convert a raw filter value to the column's own type. */
  function coerceCompare(v, dtype) {
    if (v === null || v === '') return null;
    if (dtype === 'datetime64[ns]') return D.parseDate(v) || v;
    if (dtype === 'int64' || dtype === 'float64') {
      var n = Number(String(v).replace(/,/g, ''));
      return isNaN(n) ? v : n;
    }
    if (dtype === 'bool') return D.toBool(v);
    return v;
  }

  function cmp(a, b) {
    if (a instanceof Date || b instanceof Date) {
      var da = a instanceof Date ? a : D.parseDate(a);
      var db = b instanceof Date ? b : D.parseDate(b);
      if (da && db) return da.getTime() - db.getTime();
      if (da) return 1;
      if (db) return -1;
    }
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'boolean' || typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
    if (typeof a === 'number' && typeof b !== 'number') {
      var nb = Number(b);
      if (!isNaN(nb)) return a - nb;
    }
    if (typeof b === 'number' && typeof a !== 'number') {
      var na = Number(a);
      if (!isNaN(na)) return na - b;
    }
    var sa = String(a), sb = String(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }

  /** One filter condition → boolean mask. */
  function conditionMask(values, cond, dtype) {
    var op = cond.op;
    var target = coerceCompare(cond.value, dtype);
    var target2 = coerceCompare(cond.value2, dtype);
    var out = new Array(values.length);
    var needle = cond.value === null || cond.value === undefined ? '' : String(cond.value);
    var rx = null;
    if (op === 'regex') {
      try { rx = new RegExp(needle); } catch (e) { rx = null; }
    }
    var isinSet = null;
    if (op === 'isin') {
      isinSet = new Set();
      String(cond.value === null || cond.value === undefined ? '' : cond.value)
        .split(',').forEach(function (piece) {
          var trimmed = piece.trim();
          if (trimmed === '') return;
          var coerced = coerceCompare(trimmed, dtype);
          isinSet.add(typeof coerced === 'string' ? 's' + coerced
            : 'v' + String(coerced instanceof Date ? coerced.getTime() : coerced));
        });
    }
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      var missing = D.valueKey(v) === '\u0000na';
      switch (op) {
        case 'isna': out[i] = missing; break;
        case 'notna': out[i] = !missing; break;
        default:
          if (missing) { out[i] = false; break; }
          switch (op) {
            case 'eq': out[i] = cmp(v, target) === 0; break;
            case 'ne': out[i] = cmp(v, target) !== 0; break;
            case 'gt': out[i] = cmp(v, target) > 0; break;
            case 'ge': out[i] = cmp(v, target) >= 0; break;
            case 'lt': out[i] = cmp(v, target) < 0; break;
            case 'le': out[i] = cmp(v, target) <= 0; break;
            case 'between':
              out[i] = target2 === null ? cmp(v, target) >= 0 : (cmp(v, target) >= 0 && cmp(v, target2) <= 0);
              break;
            case 'contains': out[i] = String(v).indexOf(needle) >= 0; break;
            case 'notcontains': out[i] = String(v).indexOf(needle) < 0; break;
            case 'startswith': out[i] = String(v).indexOf(needle) === 0; break;
            case 'endswith': out[i] = String(v).slice(-needle.length) === needle; break;
            case 'regex': out[i] = rx ? rx.test(String(v)) : false; break;
            case 'isin':
              out[i] = isinSet.has(typeof v === 'string' ? 's' + v
                : 'v' + String(v instanceof Date ? v.getTime() : v));
              break;
            default: out[i] = false;
          }
      }
    }
    return out;
  }

  /** Python text for one filter condition. */
  function conditionCode(cond, dtype) {
    var c = pyCol(cond.col);
    switch (cond.op) {
      case 'eq': return c + ' == ' + pyLit(cond.value, dtype);
      case 'ne': return c + ' != ' + pyLit(cond.value, dtype);
      case 'gt': return c + ' > ' + pyLit(cond.value, dtype);
      case 'ge': return c + ' >= ' + pyLit(cond.value, dtype);
      case 'lt': return c + ' < ' + pyLit(cond.value, dtype);
      case 'le': return c + ' <= ' + pyLit(cond.value, dtype);
      case 'between': return c + '.between(' + pyLit(cond.value, dtype) + ', ' + pyLit(cond.value2, dtype) + ')';
      case 'contains': return c + '.astype(str).str.contains(' + pyStr(cond.value) + ', na=False)';
      case 'notcontains': return '~' + c + '.astype(str).str.contains(' + pyStr(cond.value) + ', na=False)';
      case 'startswith': return c + '.astype(str).str.startswith(' + pyStr(cond.value) + ', na=False)';
      case 'endswith': return c + '.astype(str).str.endswith(' + pyStr(cond.value) + ', na=False)';
      case 'regex': return c + '.astype(str).str.match(r' + pyStr(cond.value) + ')';
      case 'isin':
        return c + '.isin([' + String(cond.value || '').split(',')
          .map(function (x) { return pyLit(x.trim(), dtype); }).join(', ') + '])';
      case 'isna': return c + '.isna()';
      case 'notna': return c + '.notna()';
    }
    return c + ' == ' + pyLit(cond.value, dtype);
  }

  function summaryValue(v) {
    if (v === null || v === undefined || v === '') return '∅';
    return String(v);
  }

  function periodCode(freq) {
    return { hour: 'h', day: 'D', week: 'W-MON', month: 'MS', quarter: 'QS', year: 'YS' }[freq] || 'D';
  }

  /** The variable a second table is bound to in the generated script. */
  function otherVarName(otherId, ctx) {
    var other = ((ctx && ctx.datasets) || []).filter(function (d) { return d.id === otherId; })[0];
    return other ? sanitize(other.pyName || other.name, 'other') : 'other_df';
  }

  /* ============================= registry ============================== */
  var REGISTRY = [];
  function op(def) {
    def.params = def.params || [];
    def.icon = def.icon || 'function';
    REGISTRY.push(def);
    return def;
  }

  /* -------------------------------- rows -------------------------------- */
  op({
    id: 'filter', group: 'rows', icon: 'filter',
    params: [
      { key: 'mode', type: 'select', label: 'f.mode', options: ['visual', 'text'], labels: { visual: 'expr.visual', text: 'expr.text' }, width: 'half' },
      { key: 'match', type: 'select', label: 'f.match', options: ['all', 'any'], labels: { all: 'f.all_and', any: 'f.any_or' }, width: 'half', when: function (p) { return p.mode !== 'text'; } },
      { key: 'conds', type: 'conds', when: function (p) { return p.mode !== 'text'; } },
      { key: 'expr', type: 'expression', label: 'f.expression', placeholder: 'revenue > 1000 and region == "East"', when: function (p) { return p.mode === 'text'; } }
    ],
    defaults: function (df) {
      var numeric = df.numericColumns();
      var col = numeric.length ? numeric[0] : df.names[0];
      return {
        mode: 'visual', match: 'all',
        conds: [{ col: col, op: 'gt', value: '', value2: '' }],
        expr: numeric.length ? numeric[0] + ' > 0' : ''
      };
    },
    apply: function (df, p) {
      if (p.mode === 'text') {
        if (!p.expr || !String(p.expr).trim()) throw new Error(t('err.empty_selection'));
        var res = PV.expr.evaluate(p.expr, df);
        return df.filter(res.values.map(function (v) { return v === true || v === 1 || v === 'True'; }));
      }
      var conds = (p.conds || []).filter(function (c) { return c && c.col && c.op; });
      if (!conds.length) return df.copy();
      var mask = null;
      conds.forEach(function (c) {
        var m = conditionMask(df.col(c.col), c, df.dtype(c.col));
        if (!mask) mask = m;
        else {
          for (var i = 0; i < mask.length; i++) {
            mask[i] = p.match === 'any' ? (mask[i] || m[i]) : (mask[i] && m[i]);
          }
        }
      });
      return df.filter(mask);
    },
    code: function (p, ctx, varName) {
      var v = varName || CURRENT_VAR;
      if (p.mode === 'text') {
        var py = PV.expr.compile(p.expr).python(v);
        return [v + ' = ' + v + '[' + py + ']'];
      }
      var condsAll = (p.conds || []).filter(function (c) { return c && c.col && c.op; });
      if (!condsAll.length) return [];
      var dtypeOf = ctx && ctx.dtypeOf ? ctx.dtypeOf : null;
      var body = condsAll.map(function (c) {
        // each condition needs its own parentheses: in Python `&` binds tighter
        // than `==`/`>`, so `a == b & c > d` would not mean what it looks like
        return '(' + conditionCode(c, dtypeOf ? dtypeOf(c.col) : undefined) + ')';
      })
        .join('\n    ' + (p.match === 'any' ? '|' : '&') + ' ');
      return [v + ' = ' + v + '[\n    ' + body + '\n]'];
    },
    summary: function (p) {
      if (p.mode === 'text') return String(p.expr || '').slice(0, 60);
      return (p.conds || []).filter(function (c) { return c && c.col; }).map(function (c) {
        var sym = {
          eq: '=', ne: '≠', gt: '>', ge: '≥', lt: '<', le: '≤', between: '∈',
          contains: '⊃', notcontains: '⊅', startswith: '^=', endswith: '=$',
          regex: '~', isin: '∈', isna: 'isna', notna: 'notna'
        }[c.op] || c.op;
        var v = c.op === 'between'
          ? summaryValue(c.value) + '…' + summaryValue(c.value2)
          : summaryValue(c.value);
        if (c.op === 'isna' || c.op === 'notna') v = '';
        return c.col + ' ' + sym + ' ' + v;
      }).join(p.match === 'any' ? '  |  ' : '  &  ');
    }
  });

  op({
    id: 'sort', group: 'rows', icon: 'sort',
    params: [{ key: 'keys', type: 'sortkeys' }],
    defaults: function (df) {
      var numeric = df.numericColumns();
      return { keys: [{ col: numeric.length ? numeric[0] : df.names[0], ascending: false }] };
    },
    apply: function (df, p) {
      var keys = (p.keys || []).filter(function (k) { return k && k.col && df.has(k.col); });
      if (!keys.length) return df.copy();
      return df.sortValues(keys);
    },
    code: function (p) {
      var keys = (p.keys || []).filter(function (k) { return k && k.col; });
      if (!keys.length) return [];
      var cols = '[' + keys.map(function (k) { return pyStr(k.col); }).join(', ') + ']';
      var asc = '[' + keys.map(function (k) { return k.ascending === false ? 'False' : 'True'; }).join(', ') + ']';
      // kind="mergesort" is a stable sort, which is what the app's engine does:
      // it keeps the generated code reproducible for ties as well.
      return [V() + ' = ' + V() + '.sort_values(' + cols + ', ascending=' + asc +
        ', kind="mergesort").reset_index(drop=True)'];
    },
    summary: function (p) {
      return (p.keys || []).filter(function (k) { return k && k.col; })
        .map(function (k) { return k.col + (k.ascending === false ? ' ↓' : ' ↑'); }).join(', ');
    }
  });

  op({
    id: 'sample', group: 'rows', icon: 'sample',
    params: [
      { key: 'mode', type: 'select', label: 'f.mode', options: ['head', 'tail', 'sample'], labels: { head: 'f.mode.head', tail: 'f.mode.tail', sample: 'f.mode.sample' } },
      { key: 'n', type: 'number', label: 'f.n_rows', min: 1, step: 1, when: function (p) { return p.mode !== 'sample'; } },
      { key: 'n2', type: 'number', label: 'f.n_rows', min: 1, step: 1, when: function (p) { return p.mode === 'sample'; } },
      { key: 'seed', type: 'text', label: 'f.random_state', when: function (p) { return p.mode === 'sample'; } }
    ],
    defaults: function () { return { mode: 'head', n: 100, n2: 100, seed: '42' }; },
    apply: function (df, p) {
      var n = Math.max(1, Math.round(Number(p.mode === 'sample' ? p.n2 : p.n) || 100));
      if (p.mode === 'tail') return df.tail(n);
      if (p.mode === 'sample') return df.sample(Math.min(n, df.nrows), { seed: p.seed || 'sample' });
      return df.head(n);
    },
    code: function (p) {
      var n = Math.max(1, Math.round(Number(p.mode === 'sample' ? p.n2 : p.n) || 100));
      if (p.mode === 'tail') return [V() + ' = ' + V() + '.tail(' + n + ')'];
      if (p.mode === 'sample') {
        var seed = Number(p.seed);
        return [V() + ' = ' + V() + '.sample(n=' + n + (isNaN(seed) ? '' : ', random_state=' + seed) + ')'];
      }
      return [V() + ' = ' + V() + '.head(' + n + ')'];
    },
    summary: function (p) {
      var n = p.mode === 'sample' ? p.n2 : p.n;
      return (p.mode === 'tail' ? 'tail' : p.mode === 'sample' ? 'sample' : 'head') + '(' + n + ')';
    }
  });

  op({
    id: 'dedup', group: 'rows', icon: 'dedup',
    params: [
      { key: 'columns', type: 'columns', label: 'f.subset', optional: true },
      { key: 'keep', type: 'select', label: 'f.keep_option', options: ['first', 'last', 'none'], labels: { first: "keep='first'", last: "keep='last'", none: 'keep=False' } }
    ],
    defaults: function () { return { columns: [], keep: 'first' }; },
    apply: function (df, p) {
      var keep = p.keep === 'none' ? false : (p.keep || 'first');
      return df.dropDuplicates(p.columns || [], keep);
    },
    code: function (p) {
      var keep = p.keep === 'none' ? 'False' : "'" + (p.keep || 'first') + "'";
      var sub = (p.columns && p.columns.length)
        ? 'subset=[' + p.columns.map(pyStr).join(', ') + '], ' : '';
      return [V() + ' = ' + V() + '.drop_duplicates(' + sub + 'keep=' + keep + ')'];
    },
    summary: function (p) {
      return 'drop_duplicates' + ((p.columns && p.columns.length) ? '(' + p.columns.join(', ') + ')' : '()');
    }
  });

  op({
    id: 'missing', group: 'rows', icon: 'missing',
    params: [
      { key: 'mode', type: 'select', label: 'f.method', options: ['dropna', 'fillna'], labels: { dropna: 'df.dropna()', fillna: 'df.fillna()' } },
      { key: 'columns', type: 'columns', label: 'f.subset' },
      { key: 'how', type: 'select', label: 'f.method', options: ['any', 'all'], labels: { any: "how='any'", all: "how='all'" }, when: function (p) { return p.mode === 'dropna'; } },
      { key: 'method', type: 'select', label: 'f.method', options: ['value', 'mean', 'median', 'mode', 'ffill', 'bfill'], labels: { value: 'value', mean: 'mean()', median: 'median()', mode: 'mode()', ffill: 'ffill()', bfill: 'bfill()' }, when: function (p) { return p.mode === 'fillna'; } },
      { key: 'value', type: 'text', label: 'f.constant', placeholder: '0', when: function (p) { return p.mode === 'fillna' && p.method === 'value'; } }
    ],
    defaults: function (df) {
      var withNa = df.info().filter(function (c) { return c.missing > 0; }).map(function (c) { return c.name; });
      return { mode: 'dropna', columns: withNa, how: 'any', method: 'mean', value: '' };
    },
    apply: function (df, p) {
      var cols = (p.columns && p.columns.length) ? p.columns : df.names;
      if (p.mode === 'dropna') return df.dropna(cols, p.how || 'any');
      var spec = {};
      cols.forEach(function (c) { spec[c] = { method: p.method || 'mean', value: p.value }; });
      return df.fillna(spec);
    },
    code: function (p) {
      var cols = (p.columns && p.columns.length) ? p.columns : null;
      if (p.mode === 'dropna') {
        return [V() + ' = ' + V() + '.dropna(' + (cols ? 'subset=' + pyListValues(cols) + ', ' : '') +
          "how='" + (p.how || 'any') + "')"];
      }
      if (!cols) return [V() + ' = ' + V() + '.fillna(' + V() + '.mean(numeric_only=True))'];
      return cols.map(function (c) {
        if (p.method === 'ffill' || p.method === 'bfill') return pyCol(c) + ' = ' + pyCol(c) + '.' + p.method + '()';
        var filler = p.method === 'value' ? pyLit(p.value, 'object') : pyCol(c) + '.' + p.method + '()';
        return pyCol(c) + ' = ' + pyCol(c) + '.fillna(' + filler + ')';
      });
    },
    summary: function (p) {
      if (p.mode === 'dropna') return 'dropna(' + (p.columns || []).join(', ') + ')';
      return 'fillna(' + (p.method || 'mean') + ') → ' + (p.columns || []).join(', ');
    }
  });

  /* ------------------------------ columns ------------------------------- */
  op({
    id: 'select', group: 'columns', icon: 'columns',
    params: [{ key: 'columns', type: 'columns', label: 'f.pick_columns' }],
    defaults: function (df) { return { columns: df.names.slice(0, Math.min(df.ncols, 6)) }; },
    apply: function (df, p) {
      if (!p.columns || !p.columns.length) throw new Error(t('err.empty_selection'));
      return df.select(p.columns);
    },
    code: function (p) { return [V() + ' = ' + V() + '[' + pyListValues(p.columns || []) + ']']; },
    summary: function (p) { return (p.columns || []).join(', '); }
  });

  op({
    id: 'drop', group: 'columns', icon: 'trash',
    params: [{ key: 'columns', type: 'columns', label: 'f.pick_columns' }],
    defaults: function (df) {
      // Pre-select the last column as a hint; the user can change it freely.
      return { columns: df.ncols ? [df.names[df.names.length - 1]] : [] };
    },
    apply: function (df, p) {
      if (!p.columns || !p.columns.length) throw new Error(t('err.empty_selection'));
      if (p.columns.length >= df.ncols) throw new Error(t('err.empty_selection'));
      return df.drop(p.columns);
    },
    code: function (p) { return [V() + ' = ' + V() + '.drop(columns=' + pyListValues(p.columns || []) + ')']; },
    summary: function (p) { return '− ' + (p.columns || []).join(', '); }
  });

  op({
    id: 'rename', group: 'columns', icon: 'rename',
    params: [{ key: 'pairs', type: 'colmap' }],
    // `to` starts empty so the placeholder prompts for a new name, and an
    // unchanged pair is simply a no-op rather than a surprise rename
    defaults: function (df) { return { pairs: [{ from: df.names[0], to: '' }] }; },
    apply: function (df, p) {
      var map = {};
      (p.pairs || []).forEach(function (pair) {
        if (pair && pair.from && pair.to && pair.from !== pair.to && df.has(pair.from)) map[pair.from] = pair.to;
      });
      return df.rename(map);
    },
    code: function (p) {
      var pairs = (p.pairs || []).filter(function (x) { return x && x.from && x.to && x.from !== x.to; });
      if (!pairs.length) return [];
      return [V() + ' = ' + V() + '.rename(columns={' + pairs.map(function (x) {
        return pyStr(x.from) + ': ' + pyStr(x.to);
      }).join(', ') + '})'];
    },
    summary: function (p) {
      var pairs = (p.pairs || []).filter(function (x) { return x && x.from !== x.to; });
      return pairs.map(function (x) { return x.from + '→' + x.to; }).join(', ') || '—';
    }
  });

  op({
    id: 'cast', group: 'columns', icon: 'type',
    params: [
      { key: 'col', type: 'select', source: 'columns', label: 'f.column' },
      { key: 'dtype', type: 'select', options: DTYPES, labelKeyPrefix: 'cols.dtype.', label: 'f.dtype' }
    ],
    defaults: function (df) { return { col: df.names[0], dtype: 'object' }; },
    apply: function (df, p) {
      if (!df.has(p.col)) throw new Error(t('err.column_missing', { col: p.col }));
      return df.astype(p.col, p.dtype);
    },
    code: function (p) { return [pyCol(p.col) + ' = ' + pyCol(p.col) + '.astype("' + p.dtype + '")']; },
    summary: function (p) { return p.col + ' → ' + p.dtype; }
  });

  op({
    id: 'assign', group: 'columns', icon: 'fn',
    params: [
      { key: 'name', type: 'text', label: 'f.column_name', placeholder: 'profit_margin' },
      { key: 'expr', type: 'expression', label: 'f.expression', placeholder: 'profit / revenue' },
      { key: 'position', type: 'select', label: 'f.method', options: ['end', 'start'], labels: { end: 'df["new"] = …', start: 'df.insert(0, …)' } }
    ],
    defaults: function (df) {
      var numeric = df.numericColumns();
      return {
        name: 'new_column',
        expr: numeric.length >= 2 ? numeric[0] + ' / ' + numeric[1] : (df.names[0] || ''),
        position: 'end'
      };
    },
    apply: function (df, p) {
      if (!p.name) throw new Error(t('err.empty_selection'));
      if (!p.expr || !String(p.expr).trim()) throw new Error(t('err.empty_selection'));
      var res = PV.expr.evaluate(p.expr, df);
      var name = df.uniqueName(p.name);
      if (p.position === 'start') return df.insertColumn(name, res.values, undefined, 0);
      return df.withColumn(name, res.values);
    },
    code: function (p, ctx, varName) {
      var v = varName || CURRENT_VAR;
      var py = PV.expr.compile(p.expr).python(v);
      if (p.position === 'start') return [v + '.insert(0, ' + pyStr(p.name) + ', ' + py + ')'];
      return [pyCol(p.name) + ' = ' + py];
    },
    summary: function (p) { return p.name + ' = ' + String(p.expr || '').slice(0, 48); }
  });

  op({
    id: 'bin', group: 'columns', icon: 'bin',
    params: [
      { key: 'col', type: 'select', source: 'numericColumns', label: 'f.column' },
      { key: 'method', type: 'select', label: 'f.method', options: ['cut', 'qcut'], labels: { cut: 'pd.cut()', qcut: 'pd.qcut()' } },
      { key: 'bins', type: 'number', label: 'f.bins', min: 2, max: 60, step: 1 },
      { key: 'name', type: 'text', label: 'f.new_col', placeholder: 'revenue_bin' }
    ],
    defaults: function (df) {
      var numeric = df.numericColumns();
      return { col: numeric[0] || df.names[0], method: 'qcut', bins: 5, name: (numeric[0] || 'value') + '_bin' };
    },
    apply: function (df, p) {
      if (!df.has(p.col)) throw new Error(t('err.column_missing', { col: p.col }));
      var res = df.bins(p.col, { bins: p.bins, method: p.method });
      return df.withColumn(df.uniqueName(p.name || p.col + '_bin'), res.values, 'object');
    },
    code: function (p) {
      var fn = p.method === 'qcut' ? 'pd.qcut' : 'pd.cut';
      var arg = p.method === 'qcut' ? 'q=' + p.bins : 'bins=' + p.bins;
      return [pyCol(p.name || p.col + '_bin') + ' = ' + fn + '(' + pyCol(p.col) + ', ' + arg + ')'];
    },
    summary: function (p) { return (p.method === 'qcut' ? 'qcut' : 'cut') + '(' + p.col + ', ' + p.bins + ')'; }
  });

  op({
    id: 'strops', group: 'columns', icon: 'text',
    params: [
      { key: 'col', type: 'select', source: 'categoricalColumns', label: 'f.column' },
      { key: 'op', type: 'select', options: STR_OPS, label: 'f.method', labels: {
        upper: 'str.upper()', lower: 'str.lower()', title: 'str.title()', strip: 'str.strip()',
        len: 'str.len()', contains: 'str.contains()', startswith: 'str.startswith()',
        endswith: 'str.endswith()', replace: 'str.replace()', replace_regex: 'str.replace(regex)',
        slice: 'str.slice()', split: 'str.split()', extract: 'str.extract()', cat: 'str.cat()', pad: 'str.zfill()'
      } },
      { key: 'text', type: 'text', label: 'f.pattern', when: function (p) { return ['contains', 'startswith', 'endswith', 'replace', 'replace_regex', 'cat', 'pad'].indexOf(p.op) >= 0; } },
      { key: 'to', type: 'text', label: 'f.replace_with', when: function (p) { return ['replace', 'replace_regex'].indexOf(p.op) >= 0; } },
      { key: 'sep', type: 'text', label: 'f.sep', when: function (p) { return p.op === 'split'; } },
      { key: 'index', type: 'number', label: 'f.n', min: -10, max: 20, when: function (p) { return p.op === 'split'; } },
      { key: 'pattern', type: 'text', label: 'f.regex', when: function (p) { return p.op === 'extract' || p.op === 'replace_regex'; } },
      { key: 'group', type: 'number', label: 'f.n', min: 0, max: 9, when: function (p) { return p.op === 'extract'; } },
      { key: 'name', type: 'text', label: 'f.new_col', placeholder: 'empty = overwrite' }
    ],
    defaults: function (df) {
      var cats = df.categoricalColumns();
      return { col: cats[0] || df.names[0], op: 'upper', text: '', to: '', sep: '', index: 0, pattern: '', group: 1, name: '' };
    },
    apply: function (df, p) {
      if (!df.has(p.col)) throw new Error(t('err.column_missing', { col: p.col }));
      var values = df.strOp(p.col, p.op, {
        text: p.text, to: p.to, sep: p.sep, index: p.index, pattern: p.pattern, group: p.group
      });
      var name = p.name ? df.uniqueName(p.name) : p.col;
      var dtype = df.dtype(p.col);
      if (['len'].indexOf(p.op) >= 0) dtype = 'int64';
      else if (['contains', 'startswith', 'endswith', 'regex_contains'].indexOf(p.op) >= 0) dtype = 'bool';
      return df.withColumn(name, values, dtype);
    },
    code: function (p) {
      var c = pyCol(p.col);
      var py;
      switch (p.op) {
        case 'upper': py = c + '.str.upper()'; break;
        case 'lower': py = c + '.str.lower()'; break;
        case 'title': py = c + '.str.title()'; break;
        case 'strip': py = c + '.str.strip()'; break;
        case 'len': py = c + '.str.len()'; break;
        case 'contains': py = c + '.str.contains(' + pyStr(p.text) + ', na=False)'; break;
        case 'startswith': py = c + '.str.startswith(' + pyStr(p.text) + ', na=False)'; break;
        case 'endswith': py = c + '.str.endswith(' + pyStr(p.text) + ', na=False)'; break;
        case 'replace': py = c + '.str.replace(' + pyStr(p.text) + ', ' + pyStr(p.to) + ', regex=False)'; break;
        case 'replace_regex': py = c + '.str.replace(r' + pyStr(p.pattern) + ', ' + pyStr(p.to) + ', regex=True)'; break;
        case 'slice': py = c + '.str.slice(0, 3)'; break;
        case 'split': py = c + '.str.split(' + pyStr(p.sep || ' ') + ').str[' + (p.index || 0) + ']'; break;
        case 'extract': py = c + '.str.extract(r' + pyStr(p.pattern || '(.*)') + ')[0]'; break;
        case 'cat': py = c + '.str.cat(sep=' + pyStr(p.text) + ')'; break;
        case 'pad': py = c + '.str.zfill(' + (p.text || 2) + ')'; break;
        default: py = c;
      }
      return [pyCol(p.name || p.col) + ' = ' + py];
    },
    summary: function (p) {
      var arg = [p.text, p.pattern].filter(Boolean)[0] || '';
      return p.col + ' → ' + p.op + (arg ? '("' + arg + '")' : '()');
    }
  });

  op({
    id: 'dt', group: 'columns', icon: 'calendar',
    params: [
      { key: 'col', type: 'select', source: 'dateColumns', label: 'f.time_col' },
      { key: 'op', type: 'select', options: DT_OPS, label: 'f.method',
        labels: {
          year: 'dt.year', quarter: 'dt.quarter', month: 'dt.month', month_name: 'dt.month_name()',
          week: 'dt.isocalendar().week', day: 'dt.day', dayofyear: 'dt.dayofyear',
          weekday: 'dt.weekday', weekday_name: 'dt.day_name()', hour: 'dt.hour', minute: 'dt.minute',
          date: 'dt.date', month_start: 'dt.to_period("M")', week_start: 'dt.to_period("W")'
        } },
      { key: 'name', type: 'text', label: 'f.new_col', placeholder: 'empty = overwrite' }
    ],
    defaults: function (df) {
      var dates = df.dateColumns();
      return { col: dates[0] || df.names[0], op: 'month', name: '' };
    },
    apply: function (df, p) {
      if (!df.has(p.col)) throw new Error(t('err.column_missing', { col: p.col }));
      var values = df.dtOp(p.col, p.op);
      var name = p.name ? df.uniqueName(p.name) : p.col;
      var intParts = { year: 1, quarter: 1, month: 1, week: 1, day: 1, dayofyear: 1, weekday: 1, hour: 1, minute: 1 };
      var dtype = intParts[p.op] ? 'int64' : 'object';
      if (p.op === 'date' || p.op === 'month_start' || p.op === 'week_start') dtype = 'datetime64[ns]';
      return df.withColumn(name, values, dtype);
    },
    code: function (p) {
      var map = {
        year: '.dt.year', quarter: '.dt.quarter', month: '.dt.month', month_name: '.dt.month_name()',
        week: '.dt.isocalendar().week', day: '.dt.day', dayofyear: '.dt.dayofyear',
        weekday: '.dt.weekday', weekday_name: '.dt.day_name()', hour: '.dt.hour', minute: '.dt.minute',
        date: '.dt.date', month_start: '.dt.to_period("M")', week_start: '.dt.to_period("W")'
      }[p.op] || '.dt.year';
      return [pyCol(p.name || p.col) + ' = pd.to_datetime(' + pyCol(p.col) + ')' + map];
    },
    summary: function (p) { return p.col + ' → dt.' + p.op; }
  });

  op({
    id: 'map', group: 'columns', icon: 'map',
    params: [
      { key: 'col', type: 'select', source: 'categoricalColumns', label: 'f.column' },
      { key: 'rules', type: 'mapping', label: 'f.mapping' },
      { key: 'keep', type: 'switch', label: 'f.else_keep' },
      { key: 'name', type: 'text', label: 'f.new_col', placeholder: 'empty = overwrite' }
    ],
    defaults: function (df) {
      var cats = df.categoricalColumns();
      var col = cats[0] || df.names[0];
      var top = df.valueCounts(col, { limit: 3 });
      var rules = top.filter(function (r) { return !r.isOther; })
        .map(function (r) { return D.displayKey(r.value) + ' = '; }).join('\n');
      return { col: col, rules: rules, keep: true, name: '' };
    },
    apply: function (df, p) {
      if (!df.has(p.col)) throw new Error(t('err.column_missing', { col: p.col }));
      var mapping = {};
      String(p.rules || '').split('\n').forEach(function (line) {
        var idx = line.indexOf('=');
        if (idx < 0) return;
        var from = line.slice(0, idx).trim();
        var to = line.slice(idx + 1).trim();
        if (from === '') return;
        mapping[from] = (to === '' || to === 'null' || to === 'NaN') ? null : to;
      });
      var values = df.mapValues(p.col, mapping, { keep: p.keep !== false });
      var dtype = df.dtype(p.col) === 'category' ? 'object' : df.dtype(p.col);
      return df.withColumn(p.name ? df.uniqueName(p.name) : p.col, values, dtype);
    },
    code: function (p) {
      var pairs = [];
      String(p.rules || '').split('\n').forEach(function (line) {
        var idx = line.indexOf('=');
        if (idx < 0) return;
        var from = line.slice(0, idx).trim(), to = line.slice(idx + 1).trim();
        if (from === '') return;
        pairs.push(pyStr(from) + ': ' + (to === '' ? 'np.nan' : pyStr(to)));
      });
      return [pyCol(p.name || p.col) + ' = ' + pyCol(p.col) + '.replace({' + pairs.join(', ') + '})'];
    },
    summary: function (p) {
      var n = String(p.rules || '').split('\n').filter(function (l) { return l.indexOf('=') > 0; }).length;
      return p.col + ' ⇄ ' + n + ' rules';
    }
  });

  op({
    id: 'rank', group: 'columns', icon: 'rank',
    params: [
      { key: 'col', type: 'select', source: 'numericColumns', label: 'f.value_col' },
      { key: 'method', type: 'select', options: RANK_METHODS, label: 'f.rank_method', labels: { average: "method='average'", min: "method='min'", max: "method='max'", dense: "method='dense'", first: "method='first'" } },
      { key: 'ascending', type: 'switch', label: 'f.rank_asc' },
      { key: 'name', type: 'text', label: 'f.new_col', placeholder: 'revenue_rank' }
    ],
    defaults: function (df) {
      var numeric = df.numericColumns();
      return { col: numeric[0] || df.names[0], method: 'dense', ascending: false, name: (numeric[0] || 'value') + '_rank' };
    },
    apply: function (df, p) {
      if (!df.has(p.col)) throw new Error(t('err.column_missing', { col: p.col }));
      return df.withColumn(df.uniqueName(p.name || p.col + '_rank'),
        df.rankCol(p.col, p.method, p.ascending !== false), 'float64');
    },
    code: function (p) {
      return [pyCol(p.name || p.col + '_rank') + ' = ' + pyCol(p.col) + '.rank(method="' + p.method +
        '", ascending=' + (p.ascending === false ? 'False' : 'True') + ')'];
    },
    summary: function (p) { return 'rank(' + p.col + ')'; }
  });

  op({
    id: 'clip', group: 'columns', icon: 'sigma',
    params: [
      { key: 'col', type: 'select', source: 'numericColumns', label: 'f.column' },
      { key: 'op', type: 'select', options: NUM_OPS, label: 'f.transform', labels: {
        abs: 'abs()', round: 'round(n)', floor: 'floor()', ceil: 'ceil()', clip: 'clip(lo, hi)',
        log: 'log()', log1p: 'log1p()', sqrt: 'sqrt()', exp: 'exp()', square: 'x ** 2',
        zscore: 'zscore', minmax: 'min-max 0..1', cumsum: 'cumsum()', diff: 'diff(n)',
        pct_change: 'pct_change(n)', shift: 'shift(n)', cummax: 'cummax()', cummin: 'cummin()',
        neg: 'x * -1', sign: 'sign()'
      } },
      { key: 'lower', type: 'text', label: 'f.lower', when: function (p) { return p.op === 'clip'; } },
      { key: 'upper', type: 'text', label: 'f.upper', when: function (p) { return p.op === 'clip'; } },
      { key: 'decimals', type: 'number', label: 'f.decimals', min: 0, max: 8, when: function (p) { return p.op === 'round'; } },
      { key: 'periods', type: 'number', label: 'f.n', min: 1, max: 50, when: function (p) { return ['diff', 'pct_change', 'shift'].indexOf(p.op) >= 0; } },
      { key: 'name', type: 'text', label: 'f.new_col', placeholder: 'empty = overwrite' }
    ],
    defaults: function (df) {
      var numeric = df.numericColumns();
      return { col: numeric[0] || df.names[0], op: 'round', decimals: 2, periods: 1, lower: '', upper: '', name: '' };
    },
    apply: function (df, p) {
      if (!df.has(p.col)) throw new Error(t('err.column_missing', { col: p.col }));
      var values = df.numericTransform(p.col, p.op, {
        lower: p.lower, upper: p.upper, decimals: p.decimals, periods: p.periods
      });
      return df.withColumn(p.name ? df.uniqueName(p.name) : p.col, values, 'float64');
    },
    code: function (p) {
      var c = pyCol(p.col);
      var py = {
        abs: 'np.abs(' + c + ')',
        round: c + '.round(' + (p.decimals || 0) + ')',
        floor: 'np.floor(' + c + ')',
        ceil: 'np.ceil(' + c + ')',
        clip: c + '.clip(' + (p.lower === '' ? 'None' : p.lower) + ', ' + (p.upper === '' ? 'None' : p.upper) + ')',
        log: 'np.log(' + c + ')', log1p: 'np.log1p(' + c + ')', sqrt: 'np.sqrt(' + c + ')',
        exp: 'np.exp(' + c + ')', square: c + ' ** 2',
        zscore: '((' + c + ' - ' + c + '.mean()) / ' + c + '.std())',
        minmax: '((' + c + ' - ' + c + '.min()) / (' + c + '.max() - ' + c + '.min()))',
        cumsum: c + '.cumsum()', cummax: c + '.cummax()', cummin: c + '.cummin()',
        diff: c + '.diff(' + (p.periods || 1) + ')',
        pct_change: c + '.pct_change(' + (p.periods || 1) + ')',
        shift: c + '.shift(' + (p.periods || 1) + ')',
        neg: c + ' * -1', sign: 'np.sign(' + c + ')'
      }[p.op] || c;
      return [pyCol(p.name || p.col) + ' = ' + py];
    },
    summary: function (p) { return p.col + ' → ' + p.op; }
  });

  op({
    id: 'dummies', group: 'columns', icon: 'dummies',
    params: [
      { key: 'columns', type: 'columns', label: 'f.pick_columns', filter: 'categorical' },
      { key: 'prefix', type: 'text', label: 'f.prefix' },
      { key: 'dropFirst', type: 'switch', label: 'drop_first=True' }
    ],
    defaults: function (df) {
      var info = df.info();
      var cats = df.categoricalColumns().filter(function (c) {
        var rec = info.filter(function (i) { return i.name === c; })[0];
        return rec && rec.unique <= 12;
      });
      return { columns: cats.slice(0, 1), prefix: '', dropFirst: false };
    },
    apply: function (df, p) {
      if (!p.columns || !p.columns.length) throw new Error(t('err.empty_selection'));
      return df.oneHot(p.columns, { prefix: p.prefix, dropFirst: !!p.dropFirst });
    },
    code: function (p) {
      return [V() + ' = pd.get_dummies(' + V() + ', columns=' + pyListValues(p.columns || []) +
        (p.prefix ? ', prefix=' + pyStr(p.prefix) : '') +
        ', drop_first=' + (p.dropFirst ? 'True' : 'False') + ')'];
    },
    summary: function (p) { return 'get_dummies(' + (p.columns || []).join(', ') + ')'; }
  });

  /* ----------------------------- aggregate ------------------------------ */
  op({
    id: 'groupby', group: 'aggregate', icon: 'group',
    params: [
      { key: 'keys', type: 'columns', label: 'f.group_keys', filter: 'categorical' },
      { key: 'aggs', type: 'aggspec', label: 'f.aggs' }
    ],
    defaults: function (df) {
      var info = df.info();
      var cats = df.categoricalColumns();
      var cat = cats.filter(function (c) {
        var rec = info.filter(function (i) { return i.name === c; })[0];
        return rec && rec.unique <= 30;
      })[0] || cats[0] || df.names[0];
      var numeric = df.numericColumns();
      var aggs = numeric.slice(0, 2).map(function (c, i) {
        return { col: c, fn: i === 0 ? 'sum' : 'mean', out: '' };
      });
      if (!aggs.length && df.names.length) aggs = [{ col: df.names[0], fn: 'count', out: '' }];
      return { keys: cat ? [cat] : [], aggs: aggs };
    },
    apply: function (df, p) {
      var keys = (p.keys || []).filter(function (k) { return df.has(k); });
      var aggs = (p.aggs || []).filter(function (a) { return a && a.col && a.fn; });
      if (!keys.length) throw new Error(t('group.no_key'));
      if (!aggs.length) throw new Error(t('group.no_agg'));
      return df.groupby(keys).agg(aggs);
    },
    code: function (p) {
      var keys = (p.keys || []).filter(Boolean);
      var aggs = (p.aggs || []).filter(function (a) { return a && a.col && a.fn; });
      var perCol = {};
      aggs.forEach(function (a) { perCol[a.col] = (perCol[a.col] || 0) + 1; });
      var named = aggs.map(function (a) {
        var name = a.out || (perCol[a.col] > 1 ? a.col + '_' + a.fn : a.col);
        return name + '=(' + pyStr(a.col) + ', ' + pyStr(a.fn) + ')';
      });
      return [V() + ' = (\n    ' + V() + '.groupby(' + pyListValues(keys) + ', as_index=False)\n      .agg(\n        ' +
        named.join(',\n        ') + ',\n      )\n)'];
    },
    summary: function (p) {
      var keys = (p.keys || []).join(' × ');
      var aggs = (p.aggs || []).filter(function (a) { return a && a.col; })
        .map(function (a) { return a.fn + '(' + a.col + ')'; }).join(', ');
      return 'by ' + keys + ' → ' + aggs;
    }
  });

  op({
    id: 'pivot', group: 'aggregate', icon: 'pivot',
    params: [
      { key: 'index', type: 'select', source: 'categoricalColumns', label: 'f.index' },
      { key: 'columns', type: 'select', source: 'categoricalColumns', label: 'f.pivot_cols' },
      { key: 'values', type: 'select', source: 'numericColumns', label: 'f.pivot_values' },
      { key: 'aggfunc', type: 'select', options: ['sum', 'mean', 'median', 'min', 'max', 'count', 'nunique', 'std'], label: 'f.agg' },
      { key: 'margins', type: 'switch', label: 'f.margins' },
      { key: 'fillValue', type: 'text', label: 'f.fill_value', placeholder: '0' }
    ],
    defaults: function (df) {
      var cats = df.categoricalColumns();
      var numeric = df.numericColumns();
      return {
        index: cats[0] || df.names[0],
        columns: cats[1] || cats[0] || df.names[0],
        values: numeric[0] || df.names[0],
        aggfunc: 'sum', margins: true, fillValue: '0'
      };
    },
    apply: function (df, p) {
      if (!df.has(p.values)) throw new Error(t('group.pivot.no_value'));
      return df.pivotTable({
        index: p.index ? [p.index] : [],
        columns: p.columns ? [p.columns] : [],
        values: p.values,
        aggfunc: p.aggfunc || 'sum',
        margins: !!p.margins,
        fillValue: p.fillValue === '' ? undefined : p.fillValue
      });
    },
    code: function (p) {
      return [V() + ' = ' + V() + '.pivot_table(\n' +
        '    index=' + pyStr(p.index) + ',\n' +
        '    columns=' + pyStr(p.columns) + ',\n' +
        '    values=' + pyStr(p.values) + ',\n' +
        '    aggfunc=' + pyStr(p.aggfunc || 'sum') +
        (p.margins ? ',\n    margins=True, margins_name="All"' : '') +
        (p.fillValue === '' ? '' : ',\n    fill_value=' +
          (isNaN(Number(p.fillValue)) ? pyStr(p.fillValue) : p.fillValue)) +
        ',\n).reset_index()'];
    },
    summary: function (p) { return (p.aggfunc || 'sum') + '(' + p.values + ') : ' + p.index + ' × ' + p.columns; }
  });

  op({
    id: 'crosstab', group: 'aggregate', icon: 'grid',
    params: [
      { key: 'row', type: 'select', source: 'categoricalColumns', label: 'f.index' },
      { key: 'col', type: 'select', source: 'categoricalColumns', label: 'f.pivot_cols' },
      { key: 'margins', type: 'switch', label: 'f.margins' }
    ],
    defaults: function (df) {
      var cats = df.categoricalColumns();
      return { row: cats[0] || df.names[0], col: cats[1] || cats[0] || df.names[0], margins: true };
    },
    apply: function (df, p) { return df.crosstab(p.row, p.col, { margins: !!p.margins }); },
    code: function (p) {
      return [V() + ' = pd.crosstab(' + V() + '[' + pyStr(p.row) + '], ' + V() + '[' + pyStr(p.col) + ']' +
        (p.margins ? ', margins=True, margins_name="All"' : '') + ').reset_index()'];
    },
    summary: function (p) { return 'crosstab(' + p.row + ', ' + p.col + ')'; }
  });

  op({
    id: 'rolling', group: 'aggregate', icon: 'window',
    params: [
      { key: 'col', type: 'select', source: 'numericColumns', label: 'f.value_col' },
      { key: 'window', type: 'number', label: 'f.window', min: 2, max: 365, step: 1 },
      { key: 'fn', type: 'select', options: ['mean', 'sum', 'min', 'max', 'std', 'median'], label: 'f.agg' },
      { key: 'minPeriods', type: 'number', label: 'f.min_periods', min: 1, max: 365, step: 1 },
      { key: 'name', type: 'text', label: 'f.new_col', placeholder: 'revenue_ma7' }
    ],
    defaults: function (df) {
      var numeric = df.numericColumns();
      return {
        col: numeric[0] || df.names[0], window: 7, fn: 'mean', minPeriods: 1,
        name: (numeric[0] || 'value') + '_ma7'
      };
    },
    apply: function (df, p) {
      if (!df.has(p.col)) throw new Error(t('err.column_missing', { col: p.col }));
      var fn = D.aggFn(p.fn || 'mean');
      var nums = df.col(p.col).map(function (v) { return typeof v === 'number' ? v : D.toNumber(v); });
      var values = S.rolling(nums, Math.max(2, p.window || 7), fn, p.minPeriods || 1);
      return df.withColumn(df.uniqueName(p.name || p.col + '_ma'), values, 'float64');
    },
    code: function (p) {
      return [pyCol(p.name || p.col + '_ma') + ' = ' + pyCol(p.col) + '.rolling(window=' + p.window +
        ', min_periods=' + (p.minPeriods || 1) + ').' + (p.fn || 'mean') + '()'];
    },
    summary: function (p) { return 'rolling(' + p.window + ').' + p.fn + '(' + p.col + ')'; }
  });

  op({
    id: 'resample', group: 'aggregate', icon: 'calendar',
    params: [
      { key: 'timeCol', type: 'select', source: 'dateColumns', label: 'f.time_col' },
      { key: 'freq', type: 'select', options: FREQS, label: 'f.period', labels: { hour: 'h', day: 'D', week: 'W', month: 'MS', quarter: 'QS', year: 'YS' } },
      { key: 'col', type: 'select', source: 'numericColumns', label: 'f.value_col' },
      { key: 'fn', type: 'select', options: ['sum', 'mean', 'median', 'min', 'max', 'count'], label: 'f.agg' },
      { key: 'name', type: 'text', label: 'f.new_col', placeholder: 'optional' }
    ],
    defaults: function (df) {
      var dates = df.dateColumns(), numeric = df.numericColumns();
      return { timeCol: dates[0] || df.names[0], freq: 'day', col: numeric[0] || df.names[0], fn: 'sum', name: '' };
    },
    apply: function (df, p) {
      if (!df.has(p.timeCol) || !df.has(p.col)) throw new Error(t('err.column_missing', { col: p.col }));
      return df.resample(p.timeCol, p.freq || 'day',
        [{ col: p.col, fn: p.fn || 'sum', out: p.name || (p.col + '_' + (p.fn || 'sum')) }]);
    },
    code: function (p) {
      var out = p.name || (p.col + '_' + (p.fn || 'sum'));
      return [V() + ' = (\n    ' + V() + '.set_index(' + pyStr(p.timeCol) + ')\n      .resample("' + periodCode(p.freq) + '")\n' +
        '      .agg(' + out + '=(' + pyStr(p.col) + ', ' + pyStr(p.fn) + '))\n      .reset_index()\n)'];
    },
    summary: function (p) { return 'resample("' + periodCode(p.freq) + '").' + p.fn + '(' + p.col + ')'; }
  });

  /* ------------------------------ combine ------------------------------- */
  op({
    id: 'merge', group: 'combine', icon: 'merge',
    params: [
      { key: 'other', type: 'dataset', label: 'f.other_dataset' },
      { key: 'how', type: 'select', options: ['inner', 'left', 'right', 'outer'], label: 'f.join_how',
        labels: { inner: 'combine.how.inner', left: 'combine.how.left', right: 'combine.how.right', outer: 'combine.how.outer' } },
      { key: 'leftOn', type: 'columns', label: 'f.left_on', maxOne: true },
      { key: 'rightOn', type: 'columns', label: 'f.right_on', maxOne: true, fromOther: true },
      { key: 'suffixes', type: 'text', label: 'f.suffixes', placeholder: '_x, _y' },
      { key: 'indicator', type: 'switch', label: 'f.indicator' }
    ],
    defaults: function (df, ctx) {
      var others = (ctx.datasets || []).filter(function (d) { return d.id !== ctx.activeId; });
      var other = others[0];
      var common = other ? df.names.filter(function (n) { return other.df.has(n); }) : [];
      return {
        other: other ? other.id : '',
        how: 'left',
        leftOn: common.slice(0, 1),
        rightOn: common.slice(0, 1),
        suffixes: '_x, _y',
        indicator: false
      };
    },
    apply: function (df, p, ctx) {
      var other = (ctx.datasets || []).filter(function (d) { return d.id === p.other; })[0];
      if (!other) throw new Error(t('combine.need_second'));
      var leftOn = (p.leftOn || []).filter(Boolean);
      var rightOn = (p.rightOn || []).filter(Boolean);
      if (!leftOn.length || !rightOn.length) throw new Error(t('combine.key_required'));
      var sfx = String(p.suffixes || '_x, _y').split(',');
      return df.merge(other.df, {
        how: p.how || 'inner', leftOn: leftOn, rightOn: rightOn,
        suffixes: [sfx[0] || '_x', sfx[1] ? sfx[1].trim() : '_y'],
        indicator: !!p.indicator
      });
    },
    code: function (p, ctx, varName) {
      var otherVar = otherVarName(p.other, ctx);
      var sfx = String(p.suffixes || '_x, _y').split(',');
      var parts = [
        '    ' + otherVar + ',',
        '    how=' + pyStr(p.how || 'inner') + ',',
        '    left_on=' + pyListValues(p.leftOn || []) + ',',
        '    right_on=' + pyListValues(p.rightOn || []) + ','
      ];
      if (p.suffixes) parts.push('    suffixes=(' + pyStr(sfx[0] || '_x') + ', ' + pyStr((sfx[1] || '_y').trim()) + '),');
      if (p.indicator) parts.push('    indicator="_merge",');
      return [V() + ' = ' + V() + '.merge(\n' + parts.join('\n') + '\n)'];
    },
    summary: function (p, ctx) {
      var other = (ctx.datasets || []).filter(function (d) { return d.id === p.other; })[0];
      var nm = other ? (PV.i18n.lang === 'zh' ? other.nameZh : other.nameEn) : '?';
      return (p.how || 'inner') + ' join ' + nm + ' on ' + (p.leftOn || []).join(', ');
    }
  });

  op({
    id: 'concat', group: 'combine', icon: 'concat',
    params: [{ key: 'other', type: 'dataset', label: 'f.other_dataset' }],
    defaults: function (df, ctx) {
      var others = (ctx.datasets || []).filter(function (d) { return d.id !== ctx.activeId; });
      return { other: others.length ? others[0].id : '' };
    },
    apply: function (df, p, ctx) {
      var other = (ctx.datasets || []).filter(function (d) { return d.id === p.other; })[0];
      if (!other) throw new Error(t('combine.need_second'));
      return df.concat([other.df], {});
    },
    code: function (p, ctx) {
      return [V() + ' = pd.concat([' + V() + ', ' + otherVarName(p.other, ctx) +
        '], ignore_index=True)'];
    },
    summary: function (p, ctx) {
      var other = (ctx.datasets || []).filter(function (d) { return d.id === p.other; })[0];
      return 'concat(' + (other ? (PV.i18n.lang === 'zh' ? other.nameZh : other.nameEn) : '?') + ')';
    }
  });

  /* ============================== registry API ========================== */
  var BY_ID = {};
  REGISTRY.forEach(function (def) { BY_ID[def.id] = def; });

  var GROUPS = ['rows', 'columns', 'aggregate', 'combine'];

  function defaults(type, df, ctx) {
    var def = BY_ID[type];
    if (!def) return {};
    try {
      return U.deepClone(def.defaults ? def.defaults(df, ctx || {}) : {});
    } catch (e) {
      return {};
    }
  }

  /** Human readable pipeline summary for a step. */
  function summarize(step, ctx) {
    var def = BY_ID[step.type];
    if (!def) return step.type;
    try {
      return def.summary ? def.summary(step.params, ctx) : '';
    } catch (e) {
      return '';
    }
  }

  /** Run every enabled step, collecting per-step diagnostics. */
  function applyPipeline(base, steps, ctx) {
    var df = base;
    var stages = [];
    var clock = function () {
      return (root.performance && root.performance.now) ? root.performance.now() : Date.now();
    };
    var started = clock();
    steps.forEach(function (step, index) {
      var def = BY_ID[step.type];
      var rec = {
        index: index, id: step.id, type: step.type,
        rowsIn: df.nrows, colsIn: df.ncols, rows: df.nrows, cols: df.ncols,
        ok: true, skipped: false, ms: 0, frameIn: df
      };
      if (!def) {
        rec.ok = false;
        rec.error = t('err.unknown_op', { op: step.type });
        stages.push(rec);
        return;
      }
      if (step.enabled === false) {
        rec.skipped = true;
        stages.push(rec);
        return;
      }
      var t0 = clock();
      try {
        var localCtx = Object.assign({}, ctx, { dfRef: df, frame: df });
        var next = def.apply(df, step.params, localCtx);
        if (!next || !next.shape) throw new Error('operation did not return a DataFrame');
        df = next;
        rec.rows = df.nrows;
        rec.cols = df.ncols;
      } catch (e) {
        rec.ok = false;
        rec.error = e && e.message ? e.message : String(e);
      }
      rec.ms = Math.round((clock() - t0) * 10) / 10;
      stages.push(rec);
    });
    return { df: df, stages: stages, ms: Math.round((clock() - started) * 10) / 10 };
  }

  /** Build the pandas code for a pipeline. */
  function buildCode(base, steps, ctx, opts) {
    opts = opts || {};
    var varName = opts.varName || 'df';
    var stepBlocks = [];
    var referenced = [];
    steps.forEach(function (step, index) {
      var def = BY_ID[step.type];
      if (!def) return;
      var stage = opts.stages && opts.stages[index];
      var frameIn = (stage && stage.frameIn) ? stage.frameIn : base;
      var localCtx = Object.assign({}, ctx || {}, {
        frameIn: frameIn,
        dtypeOf: frameIn ? function (col) { return frameIn.dtype(col); } : null
      });
      var rec = {
        index: index, type: step.type,
        summary: summarize(step, localCtx),
        code: [],
        enabled: step.enabled !== false
      };
      if (step.enabled === false) {
        rec.code = [];
      } else {
        try {
          CURRENT_VAR = varName;
          rec.code = def.code ? def.code(step.params, localCtx, varName) : [];
        } catch (e) {
          rec.code = ['# ' + (e && e.message ? e.message : 'error')];
        }
      }
      if (stage) {
        rec.rowsIn = stage.rowsIn;
        rec.rows = stage.rows;
        rec.error = stage.ok === false ? stage.error : null;
        rec.skipped = !!stage.skipped;
      }
      if (step.params && step.params.other && referenced.indexOf(step.params.other) < 0) {
        referenced.push(step.params.other);
      }
      stepBlocks.push(rec);
    });
    return { steps: stepBlocks, varName: varName, referenced: referenced };
  }

  function loaderCode(dataset, varName) {
    var src = dataset.source || {};
    var zh = PV.i18n.lang === 'zh';
    if (src.kind === 'file') {
      var name = src.name || 'data.csv';
      if (/\.xlsx$|\.xlsm$/i.test(name)) return varName + ' = pd.read_excel("' + name + '")';
      if (/\.jsonl$|\.ndjson$/i.test(name)) return varName + ' = pd.read_json("' + name + '", lines=True)';
      if (/\.json$/i.test(name)) return varName + ' = pd.read_json("' + name + '")';
      if (/\.tsv$|\.tab$/i.test(name)) return varName + ' = pd.read_csv("' + name + '", sep="\\t")';
      return varName + ' = pd.read_csv("' + name + '")';
    }
    if (src.kind === 'url') return varName + ' = pd.read_csv("' + src.url + '")';
    if (src.kind === 'sample') {
      return (zh ? '# 内置示例数据：' : '# built-in sample data: ') + src.name + '\n' +
        varName + ' = pd.read_csv("' + src.file + '")  ' +
        (zh ? '# 先在界面上导出为 CSV，即可直接读取' : '# export it as CSV from the app first');
    }
    return varName + ' = pd.DataFrame()  ' + (zh ? '# 这里放你的数据' : '# put your data here');
  }

  /** Full, runnable script: imports, loaders and every enabled step. */
  function fullScript(datasets, activeId, steps, opts) {
    opts = opts || {};
    var zh = PV.i18n.lang === 'zh';
    var varName = opts.varName || 'df';
    var active = datasets.filter(function (d) { return d.id === activeId; })[0];
    var ctx = { datasets: datasets, activeId: activeId };
    var built = buildCode(active ? active.df : null, steps, ctx, { varName: varName, stages: opts.stages });
    var out = ['import numpy as np', 'import pandas as pd', ''];
    if (active) {
      out.push('# ' + (zh ? '数据来源' : 'source') + ': ' + sourceLabel(active, zh));
      out.push('# ' + (zh ? '原始数据' : 'input') + ': ' + U.fmtInt(active.df.nrows) + ' ' +
        (zh ? '行' : 'rows') + ' × ' + active.df.ncols + ' ' + (zh ? '列' : 'columns'));
      out.push('');
    }
    if (opts.withLoader !== false && active) {
      out.push(loaderCode(active, varName));
      // A join/concat can reference the active dataset as the "other" table:
      // it needs its own variable too, since the pipeline works on a copy.
      datasets.forEach(function (d) {
        if (built.referenced.indexOf(d.id) < 0) return;
        var name = sanitize(d.pyName || d.name, 'other');
        if (name === varName) return;
        out.push(loaderCode(d, name));
      });
      out.push('');
    }
    var enabledSteps = built.steps.filter(function (s) { return s.enabled && s.code.length; });
    enabledSteps.forEach(function (s) {
      out.push('# ' + (zh ? '步骤 ' : 'step ') + (built.steps.indexOf(s) + 1) + ' · ' + s.summary);
      s.code.forEach(function (line) { out.push(line); });
      out.push('');
    });
    var result = opts.result;
    if (result) {
      out.push('# ' + (zh ? '结果' : 'result') + ': ' + U.fmtInt(result.nrows) + ' ' +
        (zh ? '行' : 'rows') + ' × ' + result.ncols + ' ' + (zh ? '列' : 'columns'));
    } else if (!enabledSteps.length && active) {
      out.push('# ' + (zh ? '还没有添加任何操作，脚本目前只是把原始数据读进来。'
        : 'No operations yet — the script only loads the data as it is.'));
    }
    out.push('print(' + varName + '.shape)');
    out.push('# ' + varName + '.to_csv("result.csv", index=False)   ' +
      (zh ? '# 需要保存结果时取消注释' : '# uncomment to save the result'));
    return { text: out.join('\n'), blocks: built.steps };
  }

  function sourceLabel(dataset, zh) {
    var s = dataset.source || {};
    if (s.kind === 'file') return s.name || 'file';
    if (s.kind === 'url') return s.url;
    if (s.kind === 'sample') return (zh ? '内置示例数据 · ' : 'built-in sample · ') + s.name;
    if (s.kind === 'generated') return 'generated(seed=' + s.seed + ')';
    if (s.kind === 'derived') return zh ? '由流水线结果保存' : 'saved from a pipeline result';
    return zh ? '自定义数据' : 'custom data';
  }

  PV.ops = {
    REGISTRY: REGISTRY,
    BY_ID: BY_ID,
    GROUPS: GROUPS,
    DTYPES: DTYPES,
    AGG_FNS: AGG_FNS,
    FILTER_OPS: FILTER_OPS,
    STR_OPS: STR_OPS,
    DT_OPS: DT_OPS,
    NUM_OPS: NUM_OPS,
    FREQS: FREQS,
    RANK_METHODS: RANK_METHODS,
    defaults: defaults,
    summarize: summarize,
    applyPipeline: applyPipeline,
    buildCode: buildCode,
    fullScript: fullScript,
    loaderCode: loaderCode,
    pyLit: pyLit,
    pyStr: pyStr,
    pyCol: pyCol,
    sanitize: sanitize,
    conditionMask: conditionMask,
    conditionCode: conditionCode,
    coerceCompare: coerceCompare,
    periodCode: periodCode
  };
})(typeof window !== 'undefined' ? window : globalThis);
