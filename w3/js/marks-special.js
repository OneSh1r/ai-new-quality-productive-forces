/* =============================================================================
 * Visual Pandas — marks-special.js
 * Box plots, violins, heatmaps (correlation and pivot) and pie / donut.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, S = PV.stats;
  var s = U.s;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  function box(svg, L, prep, c, ctx, violin) {
    var C = PV.charts;
    var cats = prep.categories;
    var boxes = prep.series.map(function (se) { return se.points[0]; })
      .filter(function (p) { return p && p.box; });
    if (!boxes.length) {
      svg.appendChild(C.textEl(L.x + L.plotW / 2, L.y + L.plotH / 2, t('charts.empty.type'), { fill: c.muted }));
      return {};
    }
    var lo = S.min(boxes.map(function (p) { return p.box.min; }));
    var hi = S.max(boxes.map(function (p) { return p.box.max; }));
    if (lo === hi) { lo -= 1; hi += 1; }
    var pad = (hi - lo) * 0.06;
    var yd = [lo - pad, hi + pad];
    var xBand = C.band(cats, L.x, L.x + L.plotW, 0.3);
    var yScale = C.linear(yd[0], yd[1], L.y + L.plotH, L.y);
    C.drawYAxis(svg, L, yScale, yd, 'numeric', c, { label: prep.yLabel });
    C.drawXAxis(svg, L, prep, xBand, null, c, {});
    C.drawFrame(svg, L, c);
    prep.series.forEach(function (se, i) {
      var p = se.points[0];
      if (!p || !p.box) return;
      var b = p.box;
      var cx = xBand.at(i);
      var w = Math.min(48, xBand.bandWidth);
      if (violin && p.values && p.values.length > 1) {
        var grid = S.kde(p.values, 60);
        var dmax = S.max(grid.map(function (g2) { return g2.y; })) || 1;
        var left = [], right = [];
        grid.forEach(function (g3) {
          var yy = yScale(g3.x);
          var ww = (g3.y / dmax) * (w / 2);
          left.push([cx - ww, yy]);
          right.unshift([cx + ww, yy]);
        });
        var dPath = left.concat(right).map(function (pt, k) { return (k ? 'L' : 'M') + pt[0] + ' ' + pt[1]; }).join(' ') + ' Z';
        svg.appendChild(s('path', { d: dPath, fill: se.color, opacity: 0.26, stroke: se.color, 'stroke-width': 1 }));
      }
      if (!violin) {
        svg.appendChild(s('rect', {
          x: cx - w / 2, y: yScale(b.q3), width: w, height: Math.max(1, yScale(b.q1) - yScale(b.q3)),
          fill: se.color, opacity: 0.2, stroke: se.color, 'stroke-width': 1.4, rx: 3
        }));
        svg.appendChild(s('line', {
          x1: cx - w / 2, x2: cx + w / 2, y1: yScale(b.median), y2: yScale(b.median),
          stroke: se.color, 'stroke-width': 2.4
        }));
        svg.appendChild(s('line', { x1: cx, x2: cx, y1: yScale(b.whiskLo), y2: yScale(b.q1), stroke: se.color, 'stroke-width': 1.2 }));
        svg.appendChild(s('line', { x1: cx, x2: cx, y1: yScale(b.q3), y2: yScale(b.whiskHi), stroke: se.color, 'stroke-width': 1.2 }));
        [b.whiskLo, b.whiskHi].forEach(function (wv) {
          svg.appendChild(s('line', {
            x1: cx - w / 4, x2: cx + w / 4, y1: yScale(wv), y2: yScale(wv),
            stroke: se.color, 'stroke-width': 1.2
          }));
        });
        b.outliers.slice(0, 80).forEach(function (ov) {
          svg.appendChild(s('circle', {
            cx: cx, cy: yScale(ov), r: 2.2, fill: 'none',
            stroke: se.color, 'stroke-width': 1, opacity: 0.7
          }));
        });
      }
      var hit = s('rect.chart-box-hit', { x: cx - w / 2 - 4, y: L.y, width: w + 8, height: L.plotH, fill: 'transparent' });
      C.markHandlers(hit, {
        key: 'box|' + p.rowKey,
        kind: 'category', field: prep.xField, cat: p.rowKey, value: b.median, label: p.label,
        series: se.name, box: b, count: p.n, field2: prep.yFields[0]
      }, ctx);
      svg.appendChild(hit);
    });
    return { yScale: yScale, domain: yd };
  }

  function heatmap(svg, L, prep, c, ctx) {
    var C = PV.charts;
    var g = s('g.chart-heatmap');
    if (prep.extra.isCorr) {
      var names = prep.extra.xLabels;
      var mat = prep.extra.matrix.matrix;
      var seq = prep.extra.signed === false;
      var methods = prep.extra.matrix.methods || null;
      var size = Math.min(L.plotW, L.plotH);
      var cell = size / Math.max(1, names.length);
      var ox = L.x, oy = L.y;
      var maxAbs = seq ? (S.max(mat.reduce(function (a, r) { return a.concat(r.filter(function (v) { return v !== null; })); }, [])) || 1) : 1;
      names.forEach(function (nm, i) {
        g.appendChild(C.textEl(ox - 8, oy + i * cell + cell / 2, U.truncate(nm, 18), { anchor: 'end', fill: c.muted }));
        g.appendChild(C.textEl(ox + i * cell + cell / 2, oy - 11, U.truncate(nm, 16), { anchor: 'middle', fill: c.muted }));
      });
      mat.forEach(function (row, i) {
        row.forEach(function (v, j) {
          var rect = s('rect', {
            x: ox + j * cell + 1, y: oy + i * cell + 1, width: cell - 2, height: cell - 2,
            rx: 3,
            fill: (v === null || isNaN(v)) ? c.grid
              : (seq ? C.rampColor(maxAbs ? v / maxAbs : 0, c) : C.divergingColor(v, c)),
            'data-key': 'm|' + names[i] + '|' + names[j]
          });
          C.markHandlers(rect, {
            key: 'cell|' + names[i] + '|' + names[j],
            kind: 'corr', field: names[i], field2: names[j],
            label: names[i] + ' × ' + names[j], value: v,
            series: (methods && methods[i] && methods[i][j]) ? methods[i][j] : prep.extra.matrix.method,
            seq: seq, maxAbs: maxAbs
          }, ctx);
          g.appendChild(rect);
          if (cell > 32 && !isNaN(v)) {
            g.appendChild(C.textEl(ox + j * cell + cell / 2, oy + i * cell + cell / 2,
              v.toFixed(Math.abs(v) > 0.995 ? 0 : 2),
              { fill: (seq ? (v / (maxAbs || 1)) : Math.abs(v)) > 0.6 ? '#fff' : c.fg, class: 'chart-label' }));
          }
        });
      });
      svg.appendChild(g);
      return {};
    }
    var m2 = prep.extra.matrix2;
    var cw = m2.xs.length ? L.plotW / m2.xs.length : L.plotW;
    var ch = m2.ys.length ? L.plotH / m2.ys.length : L.plotH;
    var lo = m2.lo === null ? 0 : m2.lo;
    var hi = m2.hi === null ? 1 : m2.hi;
    m2.ys.forEach(function (yl, i) {
      g.appendChild(C.textEl(L.x - 8, L.y + i * ch + ch / 2, U.truncate(yl, 20), { anchor: 'end', fill: c.muted }));
      m2.xs.forEach(function (xl, j) {
        var v = m2.values[j] ? m2.values[j][i] : null;
        var rect = s('rect', {
          x: L.x + j * cw + 1, y: L.y + i * ch + 1,
          width: Math.max(1, cw - 2), height: Math.max(1, ch - 2), rx: 3,
          fill: v === null ? c.grid : C.rampColor(hi > lo ? (v - lo) / (hi - lo) : 0.5, c)
        });
        C.markHandlers(rect, {
          key: 'cell|' + xl + '|' + yl,
          kind: 'cell', field: prep.xField, cat: xl, cat2: yl, field2: prep.yFields[0],
          label: xl + ' · ' + yl, value: v, series: prep.extra.valueLabel
        }, ctx);
        g.appendChild(rect);
        if (ch > 24 && cw > 36 && v !== null) {
          g.appendChild(C.textEl(L.x + j * cw + cw / 2, L.y + i * ch + ch / 2, U.fmtShort(v),
            { fill: ((v - lo) / ((hi - lo) || 1)) > 0.62 ? '#fff' : c.fg, class: 'chart-label' }));
        }
      });
    });
    if (m2.xs.length <= 16) {
      m2.xs.forEach(function (xl, j) {
        if (cw < 30) return;
        g.appendChild(C.textEl(L.x + j * cw + cw / 2, L.y + L.plotH + 16, U.truncate(xl, 10), { anchor: 'middle', fill: c.muted }));
      });
    }
    svg.appendChild(g);
    return {};
  }

  function pie(svg, L, prep, c, ctx, donut) {
    var C = PV.charts;
    var pts = prep.series[0].points.filter(function (p) { return !ctx.hidden[p.label]; });
    var total = pts.reduce(function (a, p) { return a + p.y; }, 0) || 1;
    var cx = L.x + L.plotW / 2, cy = L.y + L.plotH / 2;
    var r = Math.max(26, Math.min(L.plotW, L.plotH) / 2 - 10);
    var r0 = donut ? r * 0.58 : 0;
    var angle = -Math.PI / 2;
    pts.forEach(function (p) {
      var share = p.y / total;
      var a1 = angle + share * Math.PI * 2;
      var large = share > 0.5 ? 1 : 0;
      var x0 = cx + r * Math.cos(angle), y0 = cy + r * Math.sin(angle);
      var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      var d;
      if (donut) {
        var xi0 = cx + r0 * Math.cos(a1), yi0 = cy + r0 * Math.sin(a1);
        var xi1 = cx + r0 * Math.cos(angle), yi1 = cy + r0 * Math.sin(angle);
        d = 'M' + x0 + ' ' + y0 + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1 + ' ' + y1 +
          ' L' + xi0 + ' ' + yi0 + ' A' + r0 + ' ' + r0 + ' 0 ' + large + ' 0 ' + xi1 + ' ' + yi1 + ' Z';
      } else {
        d = 'M' + cx + ' ' + cy + ' L' + x0 + ' ' + y0 + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1 + ' ' + y1 + ' Z';
      }
      var slice = s('path.chart-slice', { d: d, fill: p.color, opacity: 0.9, stroke: c.surface, 'stroke-width': 1.5 });
      C.markHandlers(slice, {
        key: 'slice|' + p.label,
        kind: p.isOther ? 'other' : 'category', field: prep.xField, cat: p.rowKey,
        label: p.label, value: p.y, value2: U.fmtPercent(share),
        series: prep.xField, field2: prep.yFields[0], count: p.n
      }, ctx);
      svg.appendChild(slice);
      if (share > 0.06 && r > 62) {
        var mid = (angle + a1) / 2;
        var lr = donut ? (r + r0) / 2 : r * 0.68;
        svg.appendChild(C.textEl(cx + lr * Math.cos(mid), cy + lr * Math.sin(mid),
          U.fmtPercent(share, 0), { fill: '#fff', class: 'chart-label' }));
      }
      angle = a1;
    });
    if (donut) {
      svg.appendChild(C.textEl(cx, cy - 9, U.fmtShort(total), { fill: c.fg, class: 'chart-total' }));
      svg.appendChild(C.textEl(cx, cy + 11, prep.yFields.length ? prep.yFields[0] : prep.xField,
        { fill: c.muted, class: 'chart-label' }));
    }
    return {};
  }

  /**
   * Parallel coordinates: every record is one line crossing every numeric
   * dimension, so you can see trade-offs between variables at a glance.
   * Dragging on an axis filters that dimension — visual querying instead of
   * writing conditions by hand.
   */
  function parallel(svg, L, prep, c, ctx) {
    var C = PV.charts;
    var dims = prep.extra.dims || [];
    var ranges = prep.extra.ranges || [];
    var n = dims.length;
    if (!n) return {};
    function xAt(i) { return L.x + (n === 1 ? L.plotW / 2 : (i * L.plotW) / (n - 1)); }
    function yAt(v) { return L.y + (1 - U.clamp(v, 0, 1)) * L.plotH; }
    prep.series.forEach(function (se) {
      var d = '';
      se.points.forEach(function (p) {
        for (var i = 0; i < p.norm.length; i++) {
          d += (i ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + yAt(p.norm[i]).toFixed(1);
        }
      });
      if (!d) return;
      svg.appendChild(s('path', {
        d: d, fill: 'none', stroke: se.color, 'stroke-width': prep.series.length > 1 ? 1.2 : 1,
        opacity: prep.series.length > 1 ? 0.32 : 0.24, 'stroke-linecap': 'round',
        'data-key': 'pc|' + se.name, 'data-opacity': prep.series.length > 1 ? 0.32 : 0.24
      }));
    });
    for (var i = 0; i < n; i++) {
      var x = xAt(i);
      var rg = ranges[i];
      svg.appendChild(s('line', { x1: x, x2: x, y1: L.y, y2: L.y + L.plotH, stroke: c.line, 'stroke-width': 1 }));
      svg.appendChild(C.textEl(x, L.y - 22, U.truncate(rg.col, 14), { anchor: 'middle', fill: c.fg }));
      svg.appendChild(C.textEl(x, L.y - 7, U.fmtShort(rg.hi), { anchor: 'middle', fill: c.muted, size: 10 }));
      svg.appendChild(C.textEl(x, L.y + L.plotH + 11, U.fmtShort(rg.lo), { anchor: 'middle', fill: c.muted, size: 10 }));
      var strip = s('rect.chart-axis-hit', { x: x - 13, y: L.y, width: 26, height: L.plotH });
      attachBrush(strip, i, rg, xAt, yAt, L, ctx, svg);
      svg.appendChild(strip);
    }
    C.drawFrame(svg, L, c);
    return {};
  }

  /** Drag on an axis to filter that dimension; a click alone does nothing. */
  function attachBrush(strip, dimIndex, rg, xAt, yAt, L, ctx, svg) {
    var band = null, startY = 0, dragging = false;
    function localY(ev) {
      var rect = svg.getBoundingClientRect ? svg.getBoundingClientRect() : { top: 0, height: L.height };
      var scale = (rect.height || L.height) / L.height;
      return (ev.clientY - rect.top) / scale;
    }
    function toValue(y) {
      var norm = 1 - (y - L.y) / L.plotH;
      return rg.lo + U.clamp(norm, 0, 1) * (rg.hi - rg.lo);
    }
    function onMove(ev) {
      if (!dragging || !band) return;
      var y = localY(ev);
      band.setAttribute('y', Math.min(startY, y).toFixed(1));
      band.setAttribute('height', Math.abs(y - startY).toFixed(1));
      ctx.hideTip();
    }
    function onUp() {
      dragging = false;
      if (typeof document !== 'undefined') {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
      }
      if (!band) return;
      var y1 = Number(band.getAttribute('y'));
      var span = Number(band.getAttribute('height'));
      if (band.parentNode) band.parentNode.removeChild(band);
      band = null;
      if (span < 5) return;
      var lo = toValue(y1 + span), hi = toValue(y1);
      if (ctx.onBrush) ctx.onBrush({ field: rg.col, lo: Math.min(lo, hi), hi: Math.max(lo, hi), dim: dimIndex });
    }
    strip.addEventListener('mousedown', function (ev) {
      ev.preventDefault();
      dragging = true;
      startY = localY(ev);
      band = s('rect.chart-brush-band', { x: xAt(dimIndex) - 13, y: startY, width: 26, height: 0 });
      svg.appendChild(band);
      if (typeof document !== 'undefined') {
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
      }
    });
    strip.addEventListener('mouseenter', function (ev) {
      ctx.tooltip(ev,
        '<div class="chart-tip-title">' + U.escapeHtml(rg.col) + '</div>' +
        '<div class="chart-tip-row"><span>' + U.fmtNumber(rg.lo, { maxFrac: 2 }) + ' – ' +
        U.fmtNumber(rg.hi, { maxFrac: 2 }) + '</span></div>' +
        '<div class="chart-tip-hint">' + U.escapeHtml(t('charts.parallel.hint')) + '</div>');
    });
    strip.addEventListener('mousemove', function (ev) { ctx.moveTip(ev); });
    strip.addEventListener('mouseleave', function () { ctx.hideTip(); });
  }

  PV.chartsMarks = Object.assign(PV.chartsMarks || {},
    { box: box, heatmap: heatmap, pie: pie, parallel: parallel });
})(typeof window !== 'undefined' ? window : globalThis);
