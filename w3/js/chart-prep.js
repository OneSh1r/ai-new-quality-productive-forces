/* =============================================================================
 * Visual Pandas — chart-prep.js
 * Turns a DataFrame plus a chart spec into the series/domain structure that
 * charts-marks.js draws: aggregation, grouping, sorting, top-N bucketing.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, S = PV.stats;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  /**
   * spec: {type, x, y:[], color, size, agg, sort, limit, stack, horizontal, bins}
   */
  function prepare(spec, df) {
    var C = PV.charts;
    var num = C.num, labelOf = C.labelOf, aggValue = C.aggValue, colorAt = C.colorAt;
    var out = {
      type: spec.type || 'bar', spec: spec,
      series: [], legend: [], categories: [],
      xKind: null, yKind: null, colorKind: null,
      xField: spec.x, yFields: (spec.y || []).filter(Boolean),
      aggregated: false, totalPoints: 0, dropped: 0,
      empty: null, stack: !!spec.stack, horizontal: !!spec.horizontal,
      extra: {}, xLabel: spec.x, yLabel: ''
    };
    if (!df || !df.nrows) { out.empty = 'no-data'; return out; }
    var type = out.type;
    // the correlation heatmap has no x column: it is drawn from the numeric frame
    var isCorr = (type === 'heatmap' && (spec.x === '__corr__' || (spec.x === '__matrix__' && !!spec.matrix)));
    if (!isCorr && type !== 'parallel' && (!spec.x || !df.has(spec.x))) { out.empty = 'no-x'; return out; }
    if (!isCorr && ['bar', 'hbar', 'line', 'area', 'scatter', 'bubble', 'hist', 'box',
      'violin', 'ecdf'].indexOf(type) >= 0
      && (!out.yFields.length || !df.has(out.yFields[0]))) { out.empty = 'no-y'; return out; }
    out.xKind = df.kind(spec.x);
    out.yKind = out.yFields.length ? df.kind(out.yFields[0]) : null;
    out.colorKind = spec.color ? df.kind(spec.color) : null;
    var rows = df.nrows;

    /* ---------------- parallel coordinates ------------------------ */
    if (type === 'parallel') {
      var dims = (spec.y || []).filter(function (c) { return df.has(c); });
      if (dims.length < 2) dims = df.numericColumns().slice(0, 5);
      if (dims.length < 2) { out.empty = 'no-y'; return out; }
      out.extra.dims = dims;
      var ranges = dims.map(function (c) {
        var nums = S.numeric(df.col(c));
        return { col: c, lo: S.min(nums), hi: S.max(nums) };
      });
      out.extra.ranges = ranges;
      var step = Math.max(1, Math.ceil(rows / 700));
      var colorField = (spec.color && df.has(spec.color)) ? spec.color : null;
      var groups = new Map(), order = [];
      for (var r = 0; r < rows; r += step) {
        var values = ranges.map(function (rg) {
          var n = S.numeric([df.col(rg.col)[r]])[0];
          if (n === null || n === undefined || isNaN(n)) return null;
          return rg.hi === rg.lo ? 0.5 : (n - rg.lo) / (rg.hi - rg.lo);
        });
        if (values.some(function (v) { return v === null; })) continue;
        var g = colorField ? labelOf(df.col(colorField)[r]) : '__all__';
        if (!groups.has(g)) { groups.set(g, []); order.push(g); }
        groups.get(g).push({ row: r, norm: values, raw: dims.map(function (c) { return df.col(c)[r]; }) });
      }
      order.forEach(function (g, gi) {
        var pts = groups.get(g);
        out.series.push({
          name: g === '__all__' ? dims.join(' · ') : g,
          color: colorAt(gi),
          points: pts
        });
        if (g !== '__all__') out.legend.push({ name: g, color: colorAt(gi), count: pts.length });
      });
      out.aggregated = false;
      out.totalPoints = out.series.reduce(function (a, s2) { return a + s2.points.length; }, 0);
      out.xLabel = dims.join(' · ');
      out.yLabel = '';
      return out;
    }

    /* ---------------- counts of one category column ---------------- */
    if (type === 'count') {
      var vc = df.valueCounts(spec.x, { limit: 0 });
      var cats0 = vc.slice(0, spec.limit || 25);
      out.categories = cats0.map(function (r, i2) {
        return { label: labelOf(r.value), value: r.value, index: i2, raw: r.value };
      });
      out.series = [{
        name: spec.x, color: colorAt(0),
        points: cats0.map(function (r, i3) {
          return { x: i3, y: r.count, label: labelOf(r.value), rowKey: r.value, share: r.percent };
        })
      }];
      out.aggregated = true;
      out.totalPoints = vc.length;
      out.extra.uniqueCount = vc.uniqueCount;
      out.yLabel = t('charts.count_axis');
      return out;
    }

    /* ---------------- histogram / ECDF of one numeric column ------- */
    if (type === 'hist' || type === 'ecdf') {
      var field = out.yFields[0] || spec.x;
      var vals = S.numeric(df.col(field));
      out.dropped = df.nrows - vals.length;
      out.xKind = 'numeric';
      out.yKind = 'numeric';
      out.xLabel = field;
      out.yLabel = type === 'hist' ? t('charts.count_axis') : 'P(X <= x)';
      if (!vals.length) { out.empty = 'no-data'; return out; }
      out.extra.field = field;
      out.extra.stats = S.boxStats(vals);
      if (type === 'hist') {
        var hist = S.histogram(vals, spec.bins || null);
        out.extra.edges = hist.edges;
        out.series = [{
          name: field, color: colorAt(0),
          points: hist.counts.map(function (cnt, i4) {
            return {
              x: (hist.edges[i4] + hist.edges[i4 + 1]) / 2,
              x0: hist.edges[i4], x1: hist.edges[i4 + 1], y: cnt,
              label: U.fmtNumber(hist.edges[i4], { maxFrac: 2 }) + ' – ' +
                U.fmtNumber(hist.edges[i4 + 1], { maxFrac: 2 })
            };
          })
        }];
        out.xDomain = [hist.edges[0], hist.edges[hist.edges.length - 1]];
      } else {
        out.series = [{
          name: field, color: colorAt(0),
          points: S.ecdf(vals).map(function (p) {
            return { x: p.x, y: p.y, label: U.fmtNumber(p.x, { maxFrac: 2 }) };
          })
        }];
        out.xDomain = [S.min(vals), S.max(vals)];
      }
      out.totalPoints = vals.length;
      return out;
    }

    /* ---------------- scatter / bubble / density ------------------- */
    if (type === 'scatter' || type === 'bubble' || type === 'density') {
      var xsCol = df.col(spec.x), ysCol = df.col(out.yFields[0]);
      var useColor = !!(spec.color && df.has(spec.color));
      var sizeArr = (spec.size && df.has(spec.size) && type !== 'density') ? df.col(spec.size) : null;
      var pts = [];
      var catOrder = [], catColors = {};
      for (var r2 = 0; r2 < rows; r2++) {
        var xv = out.xKind === 'datetime'
          ? (xsCol[r2] instanceof Date ? xsCol[r2].getTime() : null)
          : num(xsCol[r2]);
        var yv = num(ysCol[r2]);
        if (xv === null || yv === null) { out.dropped += 1; continue; }
        var cName = useColor ? labelOf(df.col(spec.color)[r2]) : null;
        if (cName !== null && catOrder.indexOf(cName) < 0) {
          catOrder.push(cName);
          catColors[cName] = colorAt(catOrder.length - 1);
        }
        pts.push({
          x: xv, y: yv, row: r2,
          color: cName === null ? colorAt(0) : catColors[cName],
          group: cName,
          size: sizeArr ? num(sizeArr[r2]) : null,
          label: (out.xKind === 'datetime' ? U.fmtDate(new Date(xv), 'YYYY-MM-DD')
            : U.fmtNumber(xv, { maxFrac: 3 })) + ' · ' + U.fmtNumber(yv, { maxFrac: 3 })
        });
      }
      // binning has no per-point DOM cost, so the density view keeps every point
      var cap = type === 'density' ? 60000 : C.MAX_POINTS;
      if (pts.length > cap) {
        var step = pts.length / cap;
        var kept = [];
        for (var k2 = 0; k2 < pts.length; k2 += step) kept.push(pts[Math.floor(k2)]);
        out.downsampled = pts.length - kept.length;
        pts = kept;
      }
      if (!pts.length) { out.empty = 'no-data'; return out; }
      var groups = catOrder.length ? catOrder : [null];
      groups.forEach(function (grp) {
        var sel = pts.filter(function (p) { return p.group === grp; });
        if (!sel.length) return;
        out.series.push({
          name: grp === null ? out.yFields[0] : grp,
          color: grp === null ? colorAt(0) : catColors[grp],
          points: sel
        });
        if (grp !== null) out.legend.push({ name: grp, color: catColors[grp], count: sel.length });
      });
      out.xLabel = spec.x;
      out.yLabel = out.yFields[0];
      out.extra.hasSize = !!sizeArr;
      out.extra.colorLabel = useColor ? spec.color : null;
      out.totalPoints = pts.length;
      if (type !== 'density' && out.series.length === 1 && spec.trend !== false) {
        var fit = S.linearFit(pts.map(function (p) { return p.x; }), pts.map(function (p) { return p.y; }));
        if (isFinite(fit.slope)) out.extra.fit = fit;
      }
      return out;
    }

    /* ---------------- box / violin per category -------------------- */
    if (type === 'box' || type === 'violin') {
      var ycol = out.yFields[0];
      var groupCol = spec.x;
      var buckets = new Map();
      var order = [];
      for (var r3 = 0; r3 < rows; r3++) {
        var key = labelOf(df.col(groupCol)[r3]);
        var val = num(df.col(ycol)[r3]);
        if (val === null) { out.dropped += 1; continue; }
        if (!buckets.has(key)) { buckets.set(key, []); order.push(key); }
        buckets.get(key).push(val);
      }
      order = order.sort().slice(0, spec.limit || 30);
      out.categories = order.map(function (lab, i5) {
        return { label: U.truncate(lab, 22), value: lab, index: i5, raw: lab };
      });
      out.series = order.map(function (lab, i6) {
        var vals2 = buckets.get(lab) || [];
        var bs = S.boxStats(vals2);
        return {
          name: lab, color: colorAt(i6),
          points: [{
            x: i6, y: bs ? bs.median : null, box: bs, label: lab,
            rowKey: lab, n: vals2.length, values: vals2
          }]
        };
      });
      out.yLabel = ycol;
      out.xLabel = spec.x;
      out.aggregated = true;
      out.totalPoints = order.length;
      return out;
    }

    /* ---------------- heatmap ------------------------------------- */
    if (type === 'heatmap') {
      if (spec.x === '__corr__' || spec.x === '__matrix__') {
        var provided = spec.x === '__matrix__' && spec.matrix;
        var cols = out.yFields.length ? out.yFields : df.numericColumns();
        var corr = provided ? spec.matrix : df.corr(cols, spec.corrMethod || 'pearson');
        out.extra.matrix = corr;
        out.extra.xLabels = corr.names;
        out.extra.isCorr = true;
        // association matrices are all-positive: use a sequential ramp
        out.extra.signed = !provided;
        out.xField = '__corr__';
        out.yFields = corr.names.slice();
        out.totalPoints = corr.names.length * corr.names.length;
        return out;
      }
      var xf = spec.x, yf = out.yFields[0];
      var vField = (spec.values && df.has(spec.values)) ? spec.values : yf;
      var pairs = [], xv2 = [], yv2 = [];
      for (var r4 = 0; r4 < rows; r4++) {
        var xl = labelOf(df.col(xf)[r4]);
        var yl = labelOf(df.col(yf)[r4]);
        var vv = num(df.col(vField)[r4]);
        if (vv === null) { out.dropped += 1; continue; }
        if (xv2.indexOf(xl) < 0) xv2.push(xl);
        if (yv2.indexOf(yl) < 0) yv2.push(yl);
        pairs.push({ x: xl, y: yl, v: vv });
      }
      if (!pairs.length) { out.empty = 'no-data'; return out; }
      var cells = new Map();
      pairs.forEach(function (rec) {
        var k = rec.x + '\u0001' + rec.y;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(rec.v);
      });
      var allVals = [];
      var matrix = xv2.map(function (xlab) {
        return yv2.map(function (ylab) {
          var bucket = cells.get(xlab + '\u0001' + ylab);
          var av = bucket ? aggValue(bucket, spec.agg || 'mean') : null;
          if (av !== null) allVals.push(av);
          return av;
        });
      });
      out.extra.matrix2 = {
        xs: xv2.slice(0, 36), ys: yv2.slice(0, 36),
        values: matrix.slice(0, 36).map(function (col) { return col.slice(0, 36); }),
        lo: S.min(allVals), hi: S.max(allVals)
      };
      out.xLabel = xf;
      out.yLabel = yf;
      out.extra.valueLabel = vField + ' · ' + (spec.agg || 'mean');
      out.aggregated = true;
      out.totalPoints = pairs.length;
      return out;
    }

    /* ---------------- pie / donut --------------------------------- */
    if (type === 'pie' || type === 'donut') {
      var valField = out.yFields[0];
      var counts = new Map(), ord2 = [];
      for (var r5 = 0; r5 < rows; r5++) {
        var lab2 = labelOf(df.col(spec.x)[r5]);
        var v2 = valField ? num(df.col(valField)[r5]) : 1;
        if (v2 === null) { out.dropped += 1; continue; }
        if (!counts.has(lab2)) { counts.set(lab2, { sum: 0, n: 0 }); ord2.push(lab2); }
        counts.get(lab2).sum += v2;
        counts.get(lab2).n += 1;
      }
      var entries = ord2.map(function (lab3) {
        return { label: lab3, value: counts.get(lab3).sum, n: counts.get(lab3).n };
      }).sort(function (a, b) { return b.value - a.value; });
      var lim = spec.limit || 12;
      if (entries.length > lim) {
        var rest = entries.slice(lim);
        entries = entries.slice(0, lim);
        entries.push({
          label: t('misc.other'),
          value: rest.reduce(function (a, b) { return a + b.value; }, 0),
          n: rest.length, isOther: true
        });
      }
      var total2 = entries.reduce(function (a, b) { return a + b.value; }, 0);
      out.series = [{
        name: spec.x, color: colorAt(0),
        points: entries.map(function (e2, i7) {
          return {
            x: i7, y: e2.value, label: e2.label,
            rowKey: e2.isOther ? undefined : e2.label,
            color: colorAt(i7), share: total2 ? e2.value / total2 : 0,
            n: e2.n, isOther: e2.isOther
          };
        })
      }];
      out.extra.total = total2;
      out.legend = out.series[0].points.filter(function (p) { return !p.isOther; })
        .map(function (p) { return { name: p.label, color: p.color, count: p.y }; });
      out.aggregated = true;
      out.totalPoints = entries.length;
      return out;
    }

    /* ---------------- bar / hbar / line / area -------------------- */
    var xField = spec.x;
    var multiY = out.yFields.slice();
    var colorField = (spec.color && df.has(spec.color)) ? spec.color : null;
    var xContinuous = C.isContinuous(out.xKind);
    var buckets2 = new Map();
    var xOrder = [], colorOrder = [], xRaw = new Map();
    for (var r6 = 0; r6 < rows; r6++) {
      var xr = df.col(xField)[r6];
      var xk2;
      if (xContinuous) {
        if (out.xKind === 'datetime') xk2 = (xr instanceof Date) ? String(xr.getTime()) : null;
        else { var xn = num(xr); xk2 = xn === null ? null : String(xn); }
      } else {
        xk2 = labelOf(xr);
      }
      if (xk2 === null) { out.dropped += 1; continue; }
      var ck2 = colorField ? labelOf(df.col(colorField)[r6]) : '__all__';
      if (colorOrder.indexOf(ck2) < 0) colorOrder.push(ck2);
      if (xOrder.indexOf(xk2) < 0) { xOrder.push(xk2); xRaw.set(xk2, xr); }
      var bkey = xk2 + '\u0001' + ck2;
      if (!buckets2.has(bkey)) {
        buckets2.set(bkey, { xKey: xk2, xRaw: xr, values: multiY.map(function () { return []; }) });
      }
      var bucket2 = buckets2.get(bkey);
      multiY.forEach(function (yf2, yi) { bucket2.values[yi].push(df.col(yf2)[r6]); });
    }
    if (!xOrder.length) { out.empty = 'no-data'; return out; }
    xOrder.sort(function (a, b) {
      if (xContinuous) return Number(a) - Number(b);
      var la = labelOf(xRaw.get(a)), lb = labelOf(xRaw.get(b));
      return la < lb ? -1 : la > lb ? 1 : 0;
    });
    var aggFn = spec.agg || ((type === 'line' || type === 'area') ? 'mean' : 'sum');
    var seriesList = [];
    if (colorField) {
      colorOrder.forEach(function (ck4, ci2) {
        var pts2 = xOrder.map(function (xk5) {
          var b = buckets2.get(xk5 + '\u0001' + ck4);
          return {
            x: xContinuous ? Number(xk5) : xk5,
            y: b ? aggValue(b.values[0], aggFn) : null,
            label: labelOf(xRaw.get(xk5)),
            rowKey: ck4 === '__all__' ? xRaw.get(xk5) : ck4
          };
        });
        seriesList.push({ name: ck4 === '__all__' ? multiY[0] : ck4, color: colorAt(ci2), points: pts2 });
        if (ck4 !== '__all__') out.legend.push({ name: ck4, color: colorAt(ci2) });
      });
    } else {
      multiY.forEach(function (yf3, yi2) {
        var pts3 = xOrder.map(function (xk6) {
          var b = buckets2.get(xk6 + '\u0001__all__');
          return {
            x: xContinuous ? Number(xk6) : xk6,
            y: b ? aggValue(b.values[yi2], aggFn) : null,
            label: labelOf(xRaw.get(xk6)),
            rowKey: xRaw.get(xk6)
          };
        });
        seriesList.push({ name: yf3, color: colorAt(yi2), points: pts3 });
      });
      if (multiY.length > 1) {
        multiY.forEach(function (yf4, i8) { out.legend.push({ name: yf4, color: colorAt(i8) }); });
      }
    }
    if (!xContinuous && (spec.sort === 'value_desc' || spec.sort === 'value_asc')) {
      var totals = new Map();
      seriesList.forEach(function (s2) {
        s2.points.forEach(function (p) { totals.set(p.x, (totals.get(p.x) || 0) + (p.y || 0)); });
      });
      var dir = spec.sort === 'value_desc' ? -1 : 1;
      xOrder = xOrder.slice().sort(function (a, b) { return dir * ((totals.get(a) || 0) - (totals.get(b) || 0)); });
      seriesList.forEach(function (s3) {
        var byKey = new Map();
        s3.points.forEach(function (p) { byKey.set(p.x, p); });
        s3.points = xOrder.map(function (k3) { return byKey.get(k3); }).filter(Boolean);
      });
    }
    if (!xContinuous && spec.limit && xOrder.length > spec.limit) {
      var keep = xOrder.slice(0, spec.limit);
      seriesList.forEach(function (s4) {
        var kept2 = s4.points.filter(function (p) { return keep.indexOf(p.x) >= 0; });
        var rest2 = s4.points.filter(function (p) { return keep.indexOf(p.x) < 0; });
        if (rest2.length) {
          kept2.push({
            x: '__other__', y: rest2.reduce(function (a, p) { return a + (p.y || 0); }, 0),
            label: t('misc.other'), isOther: true, n: rest2.length, rowKey: undefined
          });
        }
        s4.points = kept2;
      });
      xOrder = keep.concat(['__other__']);
    }
    out.series = seriesList;
    out.categories = xOrder.map(function (xk7, i9) {
      var isOther = xk7 === '__other__';
      return {
        label: isOther ? t('misc.other') : labelOf(xRaw.get(xk7)),
        value: xk7, index: i9,
        raw: isOther ? undefined : xRaw.get(xk7), isOther: isOther
      };
    });
    out.aggregated = true;
    out.aggFn = aggFn;
    out.totalPoints = out.series.reduce(function (a, s5) { return a + s5.points.length; }, 0);
    out.xLabel = xField;
    out.yLabel = aggFn + '(' + multiY.join(', ') + ')';
    out.extra.colorLabel = colorField;
    out.extra.xIsCategory = !xContinuous;
    out.extra.categoryCount = out.categories.length;
    return out;
  }

  PV.chartPrep = { prepare: prepare };
})(typeof window !== 'undefined' ? window : globalThis);
