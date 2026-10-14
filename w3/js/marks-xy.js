/* =============================================================================
 * Visual Pandas — marks-xy.js
 * Bars (vertical / horizontal / stacked / grouped), lines and areas.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, S = PV.stats;
  var s = U.s;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  function bar(svg, L, prep, c, ctx) {
    var C = PV.charts;
    var horiz = prep.horizontal || prep.type === 'hbar';
    var cats = prep.categories;
    var series = prep.series.filter(function (s0) { return !ctx.hidden[s0.name]; });
    var bandScale = horiz ? C.band(cats, L.y, L.y + L.plotH, 0.2) : C.band(cats, L.x, L.x + L.plotW, 0.2);
    var maxY = 0, minY = 0;
    if (prep.stack) {
      var sums = cats.map(function (cat, i) {
        var acc = 0;
        series.forEach(function (s0) {
          var p = s0.points[i];
          if (p && typeof p.y === 'number') acc += Math.max(0, p.y);
        });
        return acc;
      });
      maxY = S.max(sums) || 0;
    } else {
      series.forEach(function (s0) {
        s0.points.forEach(function (p) {
          if (typeof p.y !== 'number' || isNaN(p.y)) return;
          maxY = Math.max(maxY, p.y);
          minY = Math.min(minY, p.y);
        });
      });
    }
    var domain = [Math.min(0, minY), maxY > 0 ? maxY : 1];
    // end the value axis on a clean tick so the top gridline is never clipped
    var nice = U.niceTicks(domain[0], domain[1], 5);
    if (isFinite(nice.lo) && isFinite(nice.hi) && nice.hi > nice.lo) domain = [nice.lo, nice.hi];
    var valueScale = horiz
      ? C.linear(domain[0], domain[1], L.x, L.x + L.plotW)
      : C.linear(domain[0], domain[1], L.y + L.plotH, L.y);
    if (horiz) valueAxisX(svg, L, valueScale, domain, prep, c);
    else C.drawYAxis(svg, L, valueScale, domain, 'numeric', c, { label: prep.yLabel });
    var nSeries = Math.max(1, series.length);
    var inner = bandScale.bandWidth / (prep.stack ? 1 : nSeries);
    var accs = new Array(cats.length).fill(0);
    cats.forEach(function (cat, i) {
      series.forEach(function (se, si) {
        var p = se.points[i];
        if (!p || p.y === null || p.y === undefined || isNaN(p.y)) return;
        var v0 = prep.stack ? accs[i] : 0;
        var v1 = prep.stack ? accs[i] + p.y : p.y;
        if (prep.stack) accs[i] = v1;
        var p0 = valueScale(v0), p1 = valueScale(v1);
        var rect;
        if (horiz) {
          rect = s('rect.chart-bar', {
            x: Math.min(p0, p1),
            y: bandScale.left(i) + (prep.stack ? 0 : si * inner),
            width: Math.max(1, Math.abs(p1 - p0)),
            height: Math.max(1, prep.stack ? bandScale.bandWidth : inner),
            rx: 3, fill: se.color, opacity: 0.92
          });
        } else {
          rect = s('rect.chart-bar', {
            x: bandScale.left(i) + (prep.stack ? 0 : si * inner),
            y: Math.min(p0, p1),
            width: Math.max(1, prep.stack ? bandScale.bandWidth : inner),
            height: Math.max(1, Math.abs(p1 - p0)),
            rx: 3, fill: se.color, opacity: 0.92
          });
        }
        C.markHandlers(rect, {
          key: cat.value + '|' + se.name,
          kind: cat.isOther ? 'other' : 'category',
          field: prep.xField,
          cat: cat.raw,
          value: p.y,
          label: cat.label,
          series: se.name,
          value2: p.share !== undefined ? U.fmtPercent(p.share) : undefined,
          seriesName: series.length > 1 ? se.name : null,
          field2: prep.yFields[0],
          count: p.n,
          field3: prep.extra.colorLabel && series.length > 1 ? colorFieldOf(prep) : null
        }, ctx);
        svg.appendChild(rect);
        if (prep.spec.labels && series.length === 1) {
          svg.appendChild(horiz
            ? C.textEl(Math.max(p0, p1) + 6, bandScale.at(i), U.fmtShort(p.y), { anchor: 'start', fill: c.fg, class: 'chart-label' })
            : C.textEl(bandScale.at(i), Math.min(p0, p1) - 8, U.fmtShort(p.y), { anchor: 'middle', fill: c.fg, class: 'chart-label' }));
        }
      });
    });
    C.drawFrame(svg, L, c);
    // drawXAxis handles both orientations: vertical puts labels under the plot,
    // horizontal puts the category names to the left of each bar
    C.drawXAxis(svg, L, prep, bandScale, null, c, {});
    return { domain: domain };
  }

  function colorFieldOf(prep) { return prep.extra.colorLabel; }

  function valueAxisX(svg, L, scale, domain, prep, c) {
    var ticks = U.niceTicks(domain[0], domain[1], 5);
    var g = s('g.chart-axis-x');
    ticks.ticks.forEach(function (tv) {
      var x = scale(tv);
      if (x < L.x - 0.5 || x > L.x + L.plotW + 0.5) return;
      g.appendChild(s('line', { x1: x, x2: x, y1: L.y, y2: L.y + L.plotH, stroke: c.grid, 'stroke-width': 1 }));
      g.appendChild(PV.charts.textEl(x, L.y + L.plotH + 16, U.fmtShort(tv), { anchor: 'middle', fill: c.muted }));
    });
    if (prep.yLabel) {
      g.appendChild(PV.charts.textEl(L.x + L.plotW / 2, L.y + L.plotH + 36, prep.yLabel, { anchor: 'middle', fill: c.muted }));
    }
    svg.appendChild(g);
    return ticks;
  }

  function line(svg, L, prep, c, ctx, area) {
    var C = PV.charts;
    var series = prep.series.filter(function (s0) { return !ctx.hidden[s0.name]; });
    var xs = [], ys = [];
    series.forEach(function (s0) {
      s0.points.forEach(function (p) {
        if (p.x === null || p.y === null || p.y === undefined || isNaN(p.y)) return;
        xs.push(p.x);
        ys.push(p.y);
      });
    });
    if (!xs.length) {
      svg.appendChild(C.textEl(L.x + L.plotW / 2, L.y + L.plotH / 2, t('charts.empty.type'), { fill: c.muted }));
      return {};
    }
    var yd = (prep.type === 'ecdf' || prep.spec.y_log) ? [S.min(ys), S.max(ys)] : [Math.min(0, S.min(ys)), S.max(ys)];
    if (yd[0] === yd[1]) yd[1] = yd[0] + 1;
    var yScale = C.linear(yd[0], yd[1], L.y + L.plotH, L.y + 6);
    C.drawYAxis(svg, L, yScale, yd, 'numeric', c, { label: prep.yLabel });
    // A line over categories (e.g. revenue by region) has no numeric x: each
    // category gets a slot on a band axis, exactly like a bar chart, so the
    // line stays inside the plot instead of collapsing to NaN.
    var xd = null, xScale = null, bandScale = null;
    if (!C.isContinuous(prep.xKind)) {
      var slots = series[0].points.map(function (p, i) {
        return { label: p.label === undefined ? String(p.x) : p.label, value: p.x, index: i, raw: p.rowKey };
      });
      bandScale = C.band(slots, L.x, L.x + L.plotW, 0.2);
      C.drawXAxis(svg, L, Object.assign({}, prep, { categories: slots }), bandScale, null, c,
        { axisLabel: prep.xLabel });
    } else {
      xd = [S.min(xs), S.max(xs)];
      if (xd[0] === xd[1]) { xd[0] -= 1; xd[1] += 1; }
      xScale = C.linear(xd[0], xd[1], L.x + 6, L.x + L.plotW - 6);
      C.drawXAxis(svg, L, prep, null, xScale, c, { domain: xd, kind: prep.xKind || 'numeric', axisLabel: prep.xLabel });
    }
    // a line with too many points drops its circles, so it gets one shared
    // hit target instead: hover and click keep working along the whole series
    var dense = [];
    series.forEach(function (se) {
      var pts = [];
      se.points.forEach(function (p, i) {
        if (p.x === null || p.y === null || p.y === undefined || isNaN(p.y)) return;
        pts.push({ x: bandScale ? bandScale.at(i) : xScale(p.x), y: yScale(p.y), src: p });
      });
      if (!pts.length) return;
      var d = C.linePath(pts, prep.spec.smooth);
      if (area) {
        var base = yScale(U.clamp(0, yd[0], yd[1]));
        svg.appendChild(s('path', {
          d: d + ' L' + pts[pts.length - 1].x + ' ' + base + ' L' + pts[0].x + ' ' + base + ' Z',
          fill: se.color, opacity: 0.15, stroke: 'none',
          'data-key': 'area|' + se.name
        }));
      }
      svg.appendChild(s('path', {
        d: d, fill: 'none', stroke: se.color, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        'data-key': 'line|' + se.name
      }));
      if (pts.length <= 120) {
        pts.forEach(function (pt) {
          var circ = s('circle.chart-dot', {
            cx: pt.x, cy: pt.y, r: pts.length > 40 ? 2 : 3.2,
            fill: se.color, stroke: c.surface, 'stroke-width': 1
          });
          C.markHandlers(circ, {
            key: 'dot|' + se.name + '|' + (pt.src.rowKey !== undefined ? pt.src.rowKey : pt.src.x),
            kind: 'category', field: prep.xField,
            cat: pt.src.rowKey !== undefined ? pt.src.rowKey : pt.src.x,
            x: pt.src.x,
            value: pt.src.y,
            label: pt.src.label, series: se.name,
            seriesName: series.length > 1 ? se.name : null,
            field2: prep.yFields[0]
          }, ctx);
          svg.appendChild(circ);
        });
      } else {
        pts.forEach(function (pt) { dense.push({ px: pt.x, py: pt.y, src: pt.src, series: se.name }); });
      }
    });
    C.drawFrame(svg, L, c);
    // appended last so the frame lines never swallow the hover
    if (dense.length) {
      svg.appendChild(C.pointOverlay(svg, L, dense, ctx, function (rec) {
        return {
          kind: 'category', field: prep.xField,
          cat: rec.src.rowKey !== undefined ? rec.src.rowKey : rec.src.x,
          x: rec.src.x, value: rec.src.y, label: rec.src.label,
          series: rec.series, seriesName: series.length > 1 ? rec.series : null,
          field2: prep.yFields[0]
        };
      }, 26));
    }
    return { xScale: xScale, yScale: yScale, domain: yd, xDomain: xd };
  }

  PV.chartsMarks = Object.assign(PV.chartsMarks || {}, { bar: bar, line: line });
})(typeof window !== 'undefined' ? window : globalThis);
