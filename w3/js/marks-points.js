/* =============================================================================
 * Visual Pandas — marks-points.js
 * Scatter / bubble / density points and histograms.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, S = PV.stats;
  var s = U.s;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  function scatter(svg, L, prep, c, ctx) {
    var C = PV.charts;
    var series = prep.series.filter(function (s0) { return !ctx.hidden[s0.name]; });
    var xs = [], ys = [], sizes = [];
    series.forEach(function (s0) {
      s0.points.forEach(function (p) {
        xs.push(p.x);
        ys.push(p.y);
        if (p.size !== null) sizes.push(p.size);
      });
    });
    if (!xs.length) {
      svg.appendChild(C.textEl(L.x + L.plotW / 2, L.y + L.plotH / 2, t('charts.empty.type'), { fill: c.muted }));
      return {};
    }
    var xd = [S.min(xs), S.max(xs)], yd = [S.min(ys), S.max(ys)];
    if (xd[0] === xd[1]) { xd[0] -= 1; xd[1] += 1; }
    if (yd[0] === yd[1]) { yd[0] -= 1; yd[1] += 1; }
    var xPad = (xd[1] - xd[0]) * 0.04, yPad = (yd[1] - yd[0]) * 0.06;
    xd = [xd[0] - xPad, xd[1] + xPad];
    yd = [yd[0] - yPad, yd[1] + yPad];
    var xScale = C.linear(xd[0], xd[1], L.x + 6, L.x + L.plotW - 6);
    var yScale = C.linear(yd[0], yd[1], L.y + L.plotH, L.y + 6);
    C.drawYAxis(svg, L, yScale, yd, 'numeric', c, { label: prep.yLabel });
    C.drawXAxis(svg, L, prep, null, xScale, c, { domain: xd, kind: prep.xKind || 'numeric', axisLabel: prep.xLabel });
    if (prep.extra.fit) {
      var f = prep.extra.fit;
      svg.appendChild(s('line', {
        x1: xScale(xd[0]), y1: yScale(f.slope * xd[0] + f.intercept),
        x2: xScale(xd[1]), y2: yScale(f.slope * xd[1] + f.intercept),
        stroke: c.accent, 'stroke-width': 1.5, 'stroke-dasharray': '5 4', opacity: 0.7
      }));
    }
    var smin = sizes.length ? S.min(sizes) : 0;
    var smax = sizes.length ? S.max(sizes) : 1;
    var total = series.reduce(function (acc, s0) { return acc + s0.points.length; }, 0);
    if (total > C.DENSE_LIMIT) {
      var hit = denseScatter(svg, L, series, c, ctx, xScale, yScale, prep, smin, smax);
      C.drawFrame(svg, L, c);
      if (hit) svg.appendChild(hit);
      return { xScale: xScale, yScale: yScale, xDomain: xd, domain: yd, dense: true };
    }
    series.forEach(function (se) {
      se.points.forEach(function (p) {
        var r = (prep.extra.hasSize && p.size !== null)
          ? 3 + 12 * (smax > smin ? (p.size - smin) / (smax - smin) : 0.5)
          : 3.6;
        var circ = s('circle.chart-dot', {
          cx: xScale(p.x), cy: yScale(p.y), r: r, fill: se.color,
          opacity: series.length > 1 ? 0.7 : 0.62, stroke: se.color, 'stroke-width': 1
        });
        C.markHandlers(circ, {
          key: 'pt|' + se.name + '|' + p.row,
          kind: 'point', field: prep.xField, x: p.x, label: p.label,
          series: se.name, value: p.y, row: p.row, field2: prep.yFields[0],
          extra: p.size, sizeField: prep.extra.hasSize ? prep.spec.size : null
        }, ctx);
        svg.appendChild(circ);
      });
    });
    C.drawFrame(svg, L, c);
    return { xScale: xScale, yScale: yScale, xDomain: xd, domain: yd };
  }

  /**
   * Dense scatter: thousands of points as a single dot path per series (one
   * <path> instead of thousands of <circle>s), with hover and click served by
   * a uniform-grid nearest-neighbour lookup.
   */
  function denseScatter(svg, L, series, c, ctx, xScale, yScale, prep, smin, smax) {
    var C = PV.charts;
    var all = [];
    series.forEach(function (se) {
      var d = '';
      se.points.forEach(function (p) {
        var x = xScale(p.x), y = yScale(p.y);
        var r = (prep.extra.hasSize && p.size !== null)
          ? 3 + 12 * (smax > smin ? (p.size - smin) / (smax - smin) : 0.5)
          : 3.4;
        d += 'M' + x.toFixed(1) + ' ' + y.toFixed(1) + 'l0.01 0';
        all.push({ px: x, py: y, src: p, series: se, r: r });
      });
      if (!d) return;
      svg.appendChild(s('path.chart-dots', {
        d: d,
        stroke: se.color,
        'stroke-width': 4,
        'stroke-linecap': 'round',
        fill: 'none',
        opacity: series.length > 1 ? 0.55 : 0.5,
        'data-key': 'dots|' + se.name,
        'data-opacity': series.length > 1 ? 0.55 : 0.5
      }));
    });
    function infoOf(rec) {
      return {
        kind: 'point', field: prep.xField, x: rec.src.x, label: rec.src.label,
        series: rec.series.name, value: rec.src.y, row: rec.src.row,
        field2: prep.yFields[0], extra: rec.src.size,
        sizeField: prep.extra.hasSize ? prep.spec.size : null
      };
    }
    return C.pointOverlay(svg, L, all, ctx, infoOf, 24);
  }

  function hist(svg, L, prep, c, ctx) {
    var C = PV.charts;
    var series = prep.series[0];
    var pts = series.points;
    var xd = prep.xDomain || [pts[0].x0, pts[pts.length - 1].x1];
    var maxC = S.max(pts.map(function (p) { return p.y; })) || 1;
    var yd = [0, maxC * 1.1];
    var niceY = U.niceTicks(yd[0], yd[1], 5);
    if (isFinite(niceY.hi) && niceY.hi > 0) yd = [0, niceY.hi];
    var xScale = C.linear(xd[0], xd[1], L.x, L.x + L.plotW);
    var yScale = C.linear(yd[0], yd[1], L.y + L.plotH, L.y);
    C.drawYAxis(svg, L, yScale, yd, 'numeric', c, { label: t('charts.count_axis') });
    C.drawXAxis(svg, L, prep, null, xScale, c, { domain: xd, kind: 'numeric', axisLabel: prep.extra.field });
    pts.forEach(function (p) {
      var x0 = xScale(p.x0), x1 = xScale(p.x1);
      var rect = s('rect.chart-bar', {
        x: x0 + 0.5, y: yScale(p.y), width: Math.max(1, x1 - x0 - 1),
        height: Math.max(0.5, L.y + L.plotH - yScale(p.y)),
        fill: series.color, opacity: 0.85, rx: 2
      });
      C.markHandlers(rect, {
        key: 'bin|' + p.x0,
        kind: 'range', field: prep.extra.field, range: [p.x0, p.x1],
        label: p.label, value: p.y, series: prep.extra.field, count: p.y
      }, ctx);
      svg.appendChild(rect);
    });
    var st = prep.extra.stats;
    if (st && prep.spec.showStats !== false) {
      [['median', st.median, c.accent, '4 3'], ['mean', st.mean, c.muted, '2 3']].forEach(function (pair) {
        if (pair[1] === null || pair[1] === undefined || isNaN(pair[1])) return;
        var x = xScale(pair[1]);
        svg.appendChild(s('line', {
          x1: x, x2: x, y1: L.y + 4, y2: L.y + L.plotH,
          stroke: pair[2], 'stroke-width': 1.4, 'stroke-dasharray': pair[3], opacity: 0.9
        }));
      });
    }
    C.drawFrame(svg, L, c);
    return { xScale: xScale, yScale: yScale, domain: yd, xDomain: xd };
  }

  /**
   * 2D density: bin the points into a grid and colour each cell by how many
   * records fall in it. Clicking a cell filters both axes to that rectangle —
   * the fastest way to find and isolate a cluster in a big scatter.
   */
  function density(svg, L, prep, c, ctx) {
    var C = PV.charts;
    var pts = [];
    prep.series.forEach(function (se) {
      se.points.forEach(function (p) { pts.push(p); });
    });
    if (!pts.length) {
      svg.appendChild(C.textEl(L.x + L.plotW / 2, L.y + L.plotH / 2, t('charts.empty.type'), { fill: c.muted }));
      return {};
    }
    var xs = pts.map(function (p) { return p.x; });
    var ys = pts.map(function (p) { return p.y; });
    var xd = [S.min(xs), S.max(xs)], yd = [S.min(ys), S.max(ys)];
    if (xd[0] === xd[1]) { xd[0] -= 1; xd[1] += 1; }
    if (yd[0] === yd[1]) { yd[0] -= 1; yd[1] += 1; }
    var xPad = (xd[1] - xd[0]) * 0.02, yPad = (yd[1] - yd[0]) * 0.04;
    xd = [xd[0] - xPad, xd[1] + xPad];
    yd = [yd[0] - yPad, yd[1] + yPad];
    var xScale = C.linear(xd[0], xd[1], L.x, L.x + L.plotW);
    var yScale = C.linear(yd[0], yd[1], L.y + L.plotH, L.y);
    C.drawYAxis(svg, L, yScale, yd, 'numeric', c, { label: prep.yLabel });
    C.drawXAxis(svg, L, prep, null, xScale, c, { domain: xd, kind: prep.xKind || 'numeric', axisLabel: prep.xLabel });
    C.drawFrame(svg, L, c);
    var cols = U.clamp(Math.round(L.plotW / 22), 8, 48);
    var rows = U.clamp(Math.round(L.plotH / 20), 6, 40);
    var cellW = (xd[1] - xd[0]) / cols;
    var cellH = (yd[1] - yd[0]) / rows;
    var grid = new Array(cols * rows).fill(0);
    var total = 0;
    pts.forEach(function (p) {
      var ci = U.clamp(Math.floor((p.x - xd[0]) / cellW), 0, cols - 1);
      var ri = U.clamp(Math.floor((p.y - yd[0]) / cellH), 0, rows - 1);
      grid[ri * cols + ci] += 1;
      total += 1;
    });
    var maxCount = S.max(grid) || 1;
    for (var ri2 = 0; ri2 < rows; ri2++) {
      for (var ci2 = 0; ci2 < cols; ci2++) {
        var n = grid[ri2 * cols + ci2];
        if (!n) continue;
        var x0 = xScale(xd[0] + ci2 * cellW);
        var x1 = xScale(xd[0] + (ci2 + 1) * cellW);
        var y1 = yScale(yd[0] + ri2 * cellH);
        var y0 = yScale(yd[0] + (ri2 + 1) * cellH);
        var t2 = Math.pow(n / maxCount, 0.45);
        var rect = s('rect.chart-cell', {
          x: (x0 + 0.5).toFixed(2), y: (y0 + 0.5).toFixed(2),
          width: Math.max(1, x1 - x0 - 1).toFixed(2), height: Math.max(1, y1 - y0 - 1).toFixed(2),
          rx: 2, fill: C.rampColor(t2, c), opacity: 0.9,
          'data-key': 'd' + ci2 + '-' + ri2
        });
        C.markHandlers(rect, {
          kind: 'region2d',
          field: prep.xField, field2: prep.yFields[0],
          label: U.fmtNumber(xd[0] + ci2 * cellW, { maxFrac: 2 }) + ' – ' + U.fmtNumber(xd[0] + (ci2 + 1) * cellW, { maxFrac: 2 }) +
            '  ×  ' + U.fmtNumber(yd[0] + ri2 * cellH, { maxFrac: 2 }) + ' – ' + U.fmtNumber(yd[0] + (ri2 + 1) * cellH, { maxFrac: 2 }),
          value: n,
          count: n,
          share: total ? n / total : 0,
          range: [xd[0] + ci2 * cellW, xd[0] + (ci2 + 1) * cellW],
          range2: [yd[0] + ri2 * cellH, yd[0] + (ri2 + 1) * cellH]
        }, ctx);
        svg.appendChild(rect);
      }
    }
    return { xScale: xScale, yScale: yScale, domain: yd, xDomain: xd, density: true };
  }

  PV.chartsMarks = Object.assign(PV.chartsMarks || {}, { scatter: scatter, hist: hist, density: density });
})(typeof window !== 'undefined' ? window : globalThis);
