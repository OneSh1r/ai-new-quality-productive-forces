/* =============================================================================
 * Visual Pandas — stats.js
 * Numeric routines that follow pandas / numpy conventions (ddof=1 by default,
 * linear quantile interpolation, unbiased skew and kurtosis, IQR outliers).
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util;
  if (!U) throw new Error('stats.js requires util.js to be loaded first');

  var isNA = U.isNA;

  /* ---------- cleaning -------------------------------------------------- */
  /** Drop nulls/NaN from an array, keeping order. */
  function clean(values) {
    var out = [];
    for (var i = 0; i < values.length; i++) if (!isNA(values[i])) out.push(values[i]);
    return out;
  }

  /** Non-null values coerced to numbers (non-numeric entries are dropped). */
  function numeric(values) {
    var out = [];
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (isNA(v)) continue;
      if (typeof v === 'number') { if (!isNaN(v)) out.push(v); continue; }
      if (typeof v === 'boolean') { out.push(v ? 1 : 0); continue; }
      var n = Number(v);
      if (String(v).trim() !== '' && !isNaN(n)) out.push(n);
    }
    return out;
  }

  function sortedNumeric(values) {
    return numeric(values).sort(function (a, b) { return a - b; });
  }

  function sum(values) {
    var t = 0;
    for (var i = 0; i < values.length; i++) t += values[i];
    return t;
  }

  function mean(values) {
    return values.length ? sum(values) / values.length : NaN;
  }

  /** variance with ddof (pandas default ddof=1 for Series.var) */
  function variance(values, ddof) {
    ddof = ddof === undefined ? 1 : ddof;
    var n = values.length;
    if (n - ddof <= 0) return NaN;
    var m = mean(values), s = 0;
    for (var i = 0; i < n; i++) { var d = values[i] - m; s += d * d; }
    return s / (n - ddof);
  }

  function std(values, ddof) {
    var v = variance(values, ddof);
    return isNaN(v) ? NaN : Math.sqrt(v);
  }

  function sem(values) {
    var s = std(values);
    return values.length ? s / Math.sqrt(values.length) : NaN;
  }

  function median(values) {
    var s = numeric(values);
    s.sort(numcmp);
    return quantileSorted(s, 0.5);
  }
  function numcmp(a, b) { return a - b; }

  /** numpy/pandas linear-interpolated quantile over an already sorted array. */
  function quantileSorted(sortedVals, q) {
    var n = sortedVals.length;
    if (!n) return NaN;
    if (q <= 0) return sortedVals[0];
    if (q >= 1) return sortedVals[n - 1];
    var pos = (n - 1) * q;
    var lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return sortedVals[lo];
    return sortedVals[lo] + (sortedVals[hi] - sortedVals[lo]) * (pos - lo);
  }

  function quantile(values, q) {
    var s = values.slice().sort(numcmp);
    return quantileSorted(s, q);
  }

  function quantiles(values, qs) {
    var s = values.slice().sort(numcmp);
    return qs.map(function (q) { return quantileSorted(s, q); });
  }

  function min(values) { return values.length ? Math.min.apply(null, values) : NaN; }
  function max(values) { return values.length ? Math.max.apply(null, values) : NaN; }
  function prod(values) { var p = 1; for (var i = 0; i < values.length; i++) p *= values[i]; return values.length ? p : NaN; }

  function skew(values) {
    var n = values.length;
    if (n < 3) return NaN;
    var m = mean(values), s2 = 0, s3 = 0;
    for (var i = 0; i < n; i++) { var d = values[i] - m; s2 += d * d; s3 += d * d * d; }
    if (s2 === 0) return NaN;
    // pandas: sqrt(n(n-1))/(n-2) · m3 / m2**1.5  with biased central moments
    var m2 = s2 / n, m3 = s3 / n;
    return Math.sqrt(n * (n - 1)) / (n - 2) * m3 / Math.pow(m2, 1.5);
  }

  /** Excess kurtosis, unbiased (pandas' Series.kurt). */
  function kurtosis(values) {
    var n = values.length;
    if (n < 4) return NaN;
    var m = mean(values), s2 = 0, s4 = 0;
    for (var i = 0; i < n; i++) { var d = values[i] - m; s2 += d * d; s4 += d * d * d * d; }
    if (s2 === 0) return NaN;
    var m2 = s2 / n, m4 = s4 / n;
    var g2 = m4 / (m2 * m2) - 3;
    return ((n + 1) * g2 + 6) * (n - 1) / ((n - 2) * (n - 3));
  }

  function mode(values) {
    var counts = new Map(), best = null, bestN = 0;
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (isNA(v)) continue;
      var k = typeof v + '\u0000' + String(v);
      var rec = counts.get(k);
      if (rec) rec.n += 1;
      else { rec = { v: v, n: 1 }; counts.set(k, rec); }
      if (rec.n > bestN) { bestN = rec.n; best = rec; }
    }
    return best ? { value: best.v, count: bestN } : null;
  }

  /** Frequency table of arbitrary values (used for value_counts / crosstab). */
  function counts(values, opts) {
    opts = opts || {};
    var map = new Map();
    var nNull = 0, total = 0;
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (isNA(v)) { nNull += 1; total += 1; continue; }
      total += 1;
      var k = typeof v + '\u0000' + String(v);
      var rec = map.get(k);
      if (rec) rec.n += 1;
      else map.set(k, rec = { value: v, n: 1 });
    }
    var rows = Array.from(map.values());
    if (opts.dropna === false && nNull > 0) rows.push({ value: null, n: nNull });
    rows.sort(function (a, b) {
      if (opts.sort === false) return 0;
      if (b.n !== a.n) return b.n - a.n;
      return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
    });
    rows.total = total;
    rows.nullCount = nNull;
    return rows;
  }

  /** Rank with tie handling: average | min | max | dense | first | ordinal. */
  function rank(values, method, ascending) {
    method = method || 'average';
    if (ascending === undefined) ascending = true;
    var idx = [];
    for (var i = 0; i < values.length; i++) {
      if (!isNA(values[i])) idx.push(i);
    }
    idx.sort(function (a, b) {
      var d = values[a] - values[b];
      if (d !== 0) return ascending ? d : -d;
      return a - b;
    });
    var out = new Array(values.length).fill(null);
    var i0 = 0;
    while (i0 < idx.length) {
      var i1 = i0;
      while (i1 + 1 < idx.length && values[idx[i1 + 1]] === values[idx[i0]]) i1 += 1;
      var first = i0 + 1, last = i1 + 1;
      for (var j = i0; j <= i1; j++) {
        if (method === 'average') out[idx[j]] = (first + last) / 2;
        else if (method === 'min') out[idx[j]] = first;
        else if (method === 'max') out[idx[j]] = last;
        else if (method === 'dense') out[idx[j]] = null; // filled below
        else out[idx[j]] = j + 1; // first / ordinal
      }
      i0 = i1 + 1;
    }
    if (method === 'dense') {
      var dense = 0, lastV, seenLast = false;
      var idxSorted = idx.slice().sort(function (a, b) {
        var d = values[a] - values[b];
        return (ascending ? d : -d) || a - b;
      });
      for (var k = 0; k < idxSorted.length; k++) {
        if (!seenLast || values[idxSorted[k]] !== lastV) { dense += 1; lastV = values[idxSorted[k]]; seenLast = true; }
        out[idxSorted[k]] = dense;
      }
    }
    return out;
  }

  /* ---------- association ---------------------------------------------- */
  /** Align two arrays on rows where both are numeric. */
  function paired(x, y) {
    var px = [], py = [];
    var n = Math.min(x.length, y.length);
    for (var i = 0; i < n; i++) {
      var a = x[i], b = y[i];
      if (isNA(a) || isNA(b)) continue;
      if (typeof a === 'boolean') a = a ? 1 : 0;
      if (typeof b === 'boolean') b = b ? 1 : 0;
      var na = typeof a === 'number' ? a : Number(a);
      var nb = typeof b === 'number' ? b : Number(b);
      if (isNaN(na) || isNaN(nb)) continue;
      px.push(na); py.push(nb);
    }
    return { x: px, y: py };
  }

  function covariance(x, y, ddof) {
    ddof = ddof === undefined ? 1 : ddof;
    var n = Math.min(x.length, y.length);
    if (n - ddof <= 0) return NaN;
    var mx = mean(x), my = mean(y), s = 0;
    for (var i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my);
    return s / (n - ddof);
  }

  function pearson(x, y) {
    var p = paired(x, y);
    return pearsonPaired(p.x, p.y);
  }

  function pearsonPaired(x, y) {
    var n = x.length;
    if (n < 2) return NaN;
    var mx = mean(x), my = mean(y), sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) {
      var dx = x[i] - mx, dy = y[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (sxx === 0 || syy === 0) return NaN;
    return sxy / Math.sqrt(sxx * syy);
  }

  function spearman(x, y) {
    var p = paired(x, y);
    if (p.x.length < 2) return NaN;
    var rx = rank(p.x, 'average'), ry = rank(p.y, 'average');
    return pearsonPaired(rx, ry);
  }

  /** Kendall's tau-b (O(n²); caller should cap n). */
  function kendall(x, y) {
    var p = paired(x, y);
    var n = p.x.length;
    if (n < 2) return NaN;
    var nc = 0, nd = 0, nx = 0, ny = 0;
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var a = p.x[i] - p.x[j], b = p.y[i] - p.y[j];
        if (a === 0 && b === 0) continue;
        if (a === 0) { ny += 1; continue; }
        if (b === 0) { nx += 1; continue; }
        if ((a > 0) === (b > 0)) nc += 1; else nd += 1;
      }
    }
    var denom = Math.sqrt((nc + nd + nx) * (nc + nd + ny));
    return denom === 0 ? NaN : (nc - nd) / denom;
  }

  function corr(x, y, method) {
    if (method === 'spearman') return spearman(x, y);
    if (method === 'kendall') return kendall(x, y);
    return pearson(x, y);
  }

  /* ---------- regression ------------------------------------------------ */
  function linearFit(x, y) {
    var p = paired(x, y), n = p.x.length;
    if (n < 2) return { slope: NaN, intercept: NaN, r2: NaN, n: n };
    var mx = mean(p.x), my = mean(p.y), sxy = 0, sxx = 0;
    for (var i = 0; i < n; i++) { var dx = p.x[i] - mx; sxy += dx * (p.y[i] - my); sxx += dx * dx; }
    var slope = sxx === 0 ? NaN : sxy / sxx;
    var intercept = my - slope * mx;
    var r = pearsonPaired(p.x, p.y);
    return { slope: slope, intercept: intercept, r2: r * r, n: n, r: r };
  }

  /* ---------- distributions -------------------------------------------- */
  /** Freedman–Diaconis / Sturges style automatic bin count. */
  function autoBins(n, iqr, span) {
    if (n <= 1) return 1;
    var sturges = Math.ceil(Math.log2(n) + 1);
    if (iqr > 0 && span > 0) {
      var fd = Math.ceil(span / (2 * iqr / Math.pow(n, 1 / 3)));
      if (isFinite(fd) && fd > 1) return U.clamp(fd, 4, 60);
    }
    return U.clamp(sturges, 4, 40);
  }

  /** Histogram with equal-width bins (numpy semantics). */
  function histogram(values, bins, range) {
    var s = values.slice().sort(numcmp);
    var n = s.length;
    if (!n) return { edges: [], counts: [], n: 0 };
    var lo = range && isFinite(range[0]) ? range[0] : s[0];
    var hi = range && isFinite(range[1]) ? range[1] : s[n - 1];
    if (bins === undefined || bins === null) {
      var q = quantiles(s, [0.25, 0.75]);
      bins = autoBins(n, q[1] - q[0], hi - lo);
    }
    bins = Math.max(1, Math.floor(bins));
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    var width = (hi - lo) / bins;
    var edges = new Array(bins + 1);
    for (var i = 0; i <= bins; i++) edges[i] = lo + i * width;
    var c = new Array(bins).fill(0);
    for (var k = 0; k < n; k++) {
      var idx = Math.floor((s[k] - lo) / width);
      if (idx < 0) idx = 0;
      if (idx >= bins) idx = bins - 1;
      c[idx] += 1;
    }
    return { edges: edges, counts: c, n: n, lo: lo, hi: hi, width: width };
  }

  /** Five-number summary + 1.5·IQR whiskers and outlier values. */
  function boxStats(values) {
    var s = values.slice().sort(numcmp), n = s.length;
    if (!n) return null;
    var q1 = quantileSorted(s, 0.25), q2 = quantileSorted(s, 0.5), q3 = quantileSorted(s, 0.75);
    var iqr = q3 - q1;
    var loFence = q1 - 1.5 * iqr, hiFence = q3 + 1.5 * iqr;
    var whiskLo = s[0], whiskHi = s[n - 1];
    for (var i = 0; i < n; i++) { if (s[i] >= loFence) { whiskLo = s[i]; break; } }
    for (var j = n - 1; j >= 0; j--) { if (s[j] <= hiFence) { whiskHi = s[j]; break; } }
    var outliers = [];
    for (var k = 0; k < n; k++) if (s[k] < loFence || s[k] > hiFence) outliers.push(s[k]);
    return {
      n: n, min: s[0], max: s[n - 1], q1: q1, median: q2, q3: q3,
      iqr: iqr, loFence: loFence, hiFence: hiFence,
      whiskLo: whiskLo, whiskHi: whiskHi, outliers: outliers,
      mean: mean(s)
    };
  }

  /** Empirical CDF points, downsampled for very large inputs. */
  function ecdf(values, maxPoints) {
    var s = values.slice().sort(numcmp), n = s.length;
    if (!n) return [];
    maxPoints = maxPoints || 400;
    var step = Math.max(1, Math.ceil(n / maxPoints));
    var out = [{ x: s[0], y: 0 }];
    for (var i = 0; i < n; i += step) out.push({ x: s[i], y: (i + 1) / n });
    out.push({ x: s[n - 1], y: 1 });
    return out;
  }

  /** Kernel density estimate (gaussian kernel) — used by violin/density plots. */
  function kde(values, points, bandwidth) {
    var s = values, n = s.length;
    if (n < 2) return [];
    var sd = std(s);
    var h = bandwidth || 1.06 * sd * Math.pow(n, -1 / 5);
    if (!h || !isFinite(h)) h = (max(s) - min(s)) / 4 || 1;
    points = points || 80;
    var lo = min(s) - h * 2, hi = max(s) + h * 2;
    var out = [];
    for (var i = 0; i < points; i++) {
      var x = lo + (hi - lo) * (i / (points - 1));
      var d = 0;
      for (var j = 0; j < n; j++) {
        var z = (x - s[j]) / h;
        d += Math.exp(-0.5 * z * z);
      }
      out.push({ x: x, y: d / (n * h * Math.sqrt(2 * Math.PI)) });
    }
    return out;
  }

  /* ---------- chi-square (for crosstab) -------------------------------- */
  function lnGamma(x) {
    var cof = [
      76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5
    ];
    var y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    var ser = 1.000000000190015;
    for (var j = 0; j < 6; j++) ser += cof[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  function gammq(a, x) {
    // regularized upper incomplete gamma Q(a, x)
    if (x < 0 || a <= 0) return NaN;
    if (x === 0) return 1;
    if (x < a + 1) {
      var ap = a, sum = 1 / a, del = sum;
      for (var n = 1; n <= 200; n++) {
        ap += 1; del *= x / ap; sum += del;
        if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
      }
      return 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
    }
    var b = x + 1 - a, c = 1e30, d = 1 / b, h0 = d;
    for (var i = 1; i <= 200; i++) {
      var an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-30) d = 1e-30;
      c = b + an / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      var del2 = d * c;
      h0 *= del2;
      if (Math.abs(del2 - 1) < 1e-14) break;
    }
    return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h0;
  }

  /** Pearson chi-square statistic + p-value for a contingency table. */
  function chiSquare(table) {
    var rows = table.length, cols = table[0] ? table[0].length : 0;
    if (rows < 2 || cols < 2) return null;
    var rowSum = new Array(rows).fill(0), colSum = new Array(cols).fill(0), total = 0;
    for (var i = 0; i < rows; i++) {
      for (var j = 0; j < cols; j++) {
        rowSum[i] += table[i][j]; colSum[j] += table[i][j]; total += table[i][j];
      }
    }
    if (total === 0) return null;
    var chi = 0;
    for (var a = 0; a < rows; a++) {
      for (var b = 0; b < cols; b++) {
        var e = rowSum[a] * colSum[b] / total;
        if (e <= 0) continue;
        var d = table[a][b] - e;
        chi += d * d / e;
      }
    }
    var dof = (rows - 1) * (cols - 1);
    return { chi2: chi, dof: dof, p: gammq(dof / 2, chi / 2) };
  }

  /* ---------- time series helpers --------------------------------------- */
  function rolling(values, window, aggFn, minPeriods) {
    var n = values.length;
    minPeriods = minPeriods === undefined || minPeriods === null ? window : minPeriods;
    var out = new Array(n).fill(null);
    for (var i = 0; i < n; i++) {
      var start = i - window + 1;
      if (start < 0 && i + 1 < minPeriods) continue;
      var win = [];
      var s0 = Math.max(0, start);
      var ok = true;
      for (var j = s0; j <= i; j++) {
        if (isNA(values[j])) continue;
        win.push(values[j]);
      }
      if (win.length < minPeriods) continue;
      out[i] = ok ? aggFn(win) : null;
    }
    return out;
  }

  PV.stats = {
    clean: clean,
    numeric: numeric,
    sortedNumeric: sortedNumeric,
    sum: sum,
    mean: mean,
    variance: variance,
    std: std,
    sem: sem,
    median: median,
    quantile: quantile,
    quantileSorted: quantileSorted,
    quantiles: quantiles,
    min: min,
    max: max,
    prod: prod,
    skew: skew,
    kurtosis: kurtosis,
    mode: mode,
    counts: counts,
    rank: rank,
    covariance: covariance,
    pearson: pearson,
    spearman: spearman,
    kendall: kendall,
    corr: corr,
    paired: paired,
    linearFit: linearFit,
    autoBins: autoBins,
    histogram: histogram,
    boxStats: boxStats,
    ecdf: ecdf,
    kde: kde,
    chiSquare: chiSquare,
    rolling: rolling
  };
})(typeof window !== 'undefined' ? window : globalThis);
