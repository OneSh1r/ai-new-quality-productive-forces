/* =============================================================================
 * Visual Pandas — charts.js  (chart core)
 * Colours, scales, layout, axes, tooltips, sparklines and exporting.
 * Data shaping lives in chart-prep.js, the marks in charts-marks.js.
 * Written from scratch: no charting library, fully theme aware, SVG output.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, D = PV.df, S = PV.stats;
  var s = U.s, h = U.h;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  var MAX_POINTS = 4000;

  /** Above this many points a scatter switches to a single fast dot path. */
  var DENSE_LIMIT = 1200;

  /**
   * Uniform-grid nearest-neighbour index, used for hover on dense scatters
   * (thousands of points cannot carry individual hit targets).
   */
  function spatialIndex(points, cell) {
    cell = cell || 26;
    var grid = new Map();
    points.forEach(function (p, i) {
      var key = Math.floor(p.px / cell) + ':' + Math.floor(p.py / cell);
      var bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    });
    return {
      size: points.length,
      query: function (x, y, maxDist) {
        var cx = Math.floor(x / cell), cy = Math.floor(y / cell);
        var best = -1, bestD = (maxDist || cell * 1.6) * (maxDist || cell * 1.6);
        for (var rx = -2; rx <= 2; rx++) {
          for (var ry = -2; ry <= 2; ry++) {
            var bucket = grid.get((cx + rx) + ':' + (cy + ry));
            if (!bucket) continue;
            for (var i = 0; i < bucket.length; i++) {
              var p = points[bucket[i]];
              var dx = p.px - x, dy = p.py - y;
              var d = dx * dx + dy * dy;
              if (d < bestD) { bestD = d; best = bucket[i]; }
            }
          }
        }
        return best;
      }
    };
  }

  /**
   * One transparent rectangle that turns hover / click / right-click over the
   * plot into the *nearest* mark. Dense scatters and long lines have no
   * per-mark nodes, so this is what keeps them interactive: `all` holds
   * {px, py, src} records already projected into plot coordinates and
   * `infoOf(record)` builds the same info object a real mark would carry.
   */
  function pointOverlay(svg, L, all, ctx, infoOf, maxDist) {
    var index = spatialIndex(all, 26);
    var overlay = U.s('rect.chart-hit', {
      x: L.x, y: L.y, width: L.plotW, height: L.plotH, fill: 'transparent'
    });
    function at(ev) {
      var rect = svg.getBoundingClientRect ? svg.getBoundingClientRect() : { left: 0, top: 0, width: L.width };
      var scale = (rect.width || L.width) / L.width;
      var x = (ev.clientX - rect.left) / scale;
      var y = (ev.clientY - rect.top) / scale;
      var i = index.query(x, y, maxDist || 24);
      return i < 0 ? null : all[i];
    }
    overlay.addEventListener('mousemove', function (ev) {
      var rec = at(ev);
      if (!rec) { ctx.hideTip(); return; }
      ctx.tooltip(ev, ctx.tipHtml(infoOf(rec)));
    });
    overlay.addEventListener('mouseleave', function () { ctx.hideTip(); });
    overlay.addEventListener('click', function (ev) {
      var rec = at(ev);
      if (rec && ctx.onClick) ctx.onClick(infoOf(rec));
    });
    overlay.addEventListener('contextmenu', function (ev) {
      ev.preventDefault();
      var rec = at(ev);
      if (rec && ctx.onContext) ctx.onContext(infoOf(rec), ev);
    });
    return overlay;
  }

  /* ============================== colours ============================== */
  var FALLBACK = {
    light: {
      fg: '#12161f', muted: '#5b6675', line: '#d5dae2', grid: '#e8ebf0',
      surface: '#ffffff', accent: '#4f46e5',
      palette: ['#4f46e5', '#0d9488', '#f59e0b', '#e11d48', '#0284c7', '#7c3aed', '#65a30d', '#ea580c']
    },
    dark: {
      fg: '#e7ebf3', muted: '#9aa7bb', line: '#2b3446', grid: '#222b3b',
      surface: '#141a24', accent: '#8b9dff',
      palette: ['#8b9dff', '#2dd4bf', '#fbbf24', '#fb7185', '#38bdf8', '#c084fc', '#a3e635', '#fdba74']
    }
  };

  function cssVar(name, fallback) {
    try {
      var v = root.getComputedStyle(document.documentElement).getPropertyValue(name);
      if (v && v.trim()) return v.trim();
    } catch (e) { /* headless */ }
    return fallback;
  }

  function isDark() {
    return !!(root.document && document.documentElement.getAttribute('data-theme') === 'dark');
  }

  function colors() {
    var base = isDark() ? FALLBACK.dark : FALLBACK.light;
    var pal = [];
    for (var i = 1; i <= 8; i++) pal.push(cssVar('--c' + i, base.palette[(i - 1) % base.palette.length]));
    return {
      fg: cssVar('--fg', base.fg),
      muted: cssVar('--muted', base.muted),
      line: cssVar('--line', base.line),
      grid: cssVar('--grid', base.grid),
      surface: cssVar('--surface', base.surface),
      accent: cssVar('--accent', base.accent),
      palette: pal,
      dark: isDark()
    };
  }

  function colorAt(i) {
    var c = colors();
    return c.palette[Math.abs(i) % c.palette.length];
  }

  function rampColor(t2, c) {
    c = c || colors();
    var stops = c.dark
      ? [[26, 34, 48], [46, 76, 140], [104, 145, 255], [176, 202, 255]]
      : [[241, 244, 250], [176, 199, 250], [92, 133, 232], [38, 58, 140]];
    t2 = U.clamp(t2, 0, 1) * (stops.length - 1);
    var i = Math.min(stops.length - 2, Math.floor(t2));
    var f = t2 - i;
    var a = stops[i], b = stops[i + 1];
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * f) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * f) + ')';
  }

  function divergingColor(v, c) {
    c = c || colors();
    var stops = c.dark
      ? [[244, 63, 94], [30, 41, 59], [45, 212, 191]]
      : [[225, 29, 72], [247, 248, 251], [13, 148, 136]];
    var t2 = (U.clamp(v, -1, 1) + 1) / 2 * (stops.length - 1);
    var i = Math.min(stops.length - 2, Math.floor(t2));
    var f = t2 - i, a = stops[i], b = stops[i + 1];
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * f) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * f) + ')';
  }

  /* ============================== scales =============================== */
  function linear(d0, d1, r0, r1) {
    if (d0 === d1) { d0 -= 0.5; d1 += 0.5; }
    return function (v) { return r0 + (v - d0) / (d1 - d0) * (r1 - r0); };
  }

  function band(cats, r0, r1, padRatio) {
    var n = Math.max(1, cats.length);
    var step = (r1 - r0) / n;
    var pad = step * (padRatio === undefined ? 0.18 : padRatio);
    return {
      step: step,
      bandWidth: step - pad,
      at: function (i) { return r0 + i * step + step / 2; },
      left: function (i) { return r0 + i * step + pad / 2; }
    };
  }

  function labelLength(str) {
    var len = 0;
    var text = String(str);
    for (var i = 0; i < text.length; i++) {
      len += /[\u4e00-\u9fa5\uff00-\uffef]/.test(text.charAt(i)) ? 2 : 1;
    }
    return len;
  }

  /* ============================ value helpers ========================== */
  function isContinuous(kind) { return kind === 'numeric' || kind === 'datetime'; }

  function num(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof Date) return v.getTime();
    var n = Number(String(v).replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }

  function labelOf(v) {
    if (v === null || v === undefined) return 'NaN';
    if (v instanceof Date) return U.fmtDate(v, 'YYYY-MM-DD');
    if (typeof v === 'boolean') return v ? t('misc.true') : t('misc.false');
    return String(v);
  }

  function aggValue(values, fn) {
    var nums = S.numeric(values);
    switch (fn) {
      case 'mean': return nums.length ? S.mean(nums) : null;
      case 'median': return nums.length ? S.median(nums) : null;
      case 'min': return nums.length ? S.min(nums) : null;
      case 'max': return nums.length ? S.max(nums) : null;
      case 'count': return values.filter(function (v) { return v !== null && v !== undefined; }).length;
      case 'nunique': return D.uniqCount(values);
      case 'std': return nums.length > 1 ? S.std(nums) : null;
      case 'first': return values.length ? values[0] : null;
      case 'last': return values.length ? values[values.length - 1] : null;
      default: return nums.length ? S.sum(nums) : 0;
    }
  }

  /* ============================== layout =============================== */
  function layoutFor(prep, width) {
    var horizontal = prep.horizontal || prep.type === 'hbar';
    var cats = prep.categories.length;
    var height;
    if (['hist', 'ecdf', 'scatter', 'bubble', 'density', 'line', 'area'].indexOf(prep.type) >= 0 ||
        (prep.type === 'count' && prep.spec.height)) {
      height = prep.spec.height || 340;
    } else if (prep.type === 'box' || prep.type === 'violin') {
      height = 330;
    } else if (prep.type === 'parallel') {
      height = 380;
    } else if (prep.type === 'pie' || prep.type === 'donut') {
      height = 320;
    } else if (prep.type === 'heatmap') {
      height = prep.extra.isCorr
        ? U.clamp(150 + prep.extra.xLabels.length * 28, 260, 620)
        : U.clamp(150 + prep.extra.matrix2.ys.length * 28, 260, 720);
    } else if (horizontal) {
      height = U.clamp(70 + cats * 26, 200, 720);
    } else {
      height = U.clamp(250 + (cats > 10 ? 30 : 0), 280, 400);
    }
    var longest = 0;
    prep.categories.forEach(function (c0) { longest = Math.max(longest, labelLength(c0.label)); });
    var left = 62;
    if (horizontal) left = U.clamp(longest * 7.2 + 14, 78, Math.min(260, width * 0.38));
    if (prep.type === 'heatmap') left = 100;
    var m = {
      top: prep.type === 'parallel' ? 34 : 22,
      // horizontal bars print their value labels to the right of the bar end
      right: (horizontal && prep.spec.labels) ? 56 : 18,
      bottom: ['pie', 'donut', 'heatmap', 'box', 'violin'].indexOf(prep.type) >= 0 ? 36 : (horizontal ? 42 : 52),
      left: left
    };
    return {
      width: width, height: height, m: m,
      plotW: Math.max(40, width - m.left - m.right),
      plotH: Math.max(40, height - m.top - m.bottom),
      x: m.left, y: m.top, horizontal: horizontal
    };
  }

  /* ============================== chrome =============================== */
  function textEl(x, y, str, opts) {
    opts = opts || {};
    return s('text', {
      x: x, y: y,
      class: 'chart-text' + (opts.class ? ' ' + opts.class : ''),
      'text-anchor': opts.anchor || 'middle',
      'dominant-baseline': opts.baseline || 'middle',
      fill: opts.fill || 'currentColor',
      transform: opts.transform
    }, String(str));
  }

  function formatAxisValue(v, kind, opts) {
    opts = opts || {};
    if (kind === 'datetime') {
      var span = ((opts.domain ? opts.domain[1] : v) - (opts.domain ? opts.domain[0] : v)) || 1;
      var pattern = span > 1000 * 86400 * 300 ? 'YYYY' : span > 1000 * 86400 * 60 ? 'YYYY-MM' : 'MM-DD';
      return U.fmtDate(new Date(v), pattern);
    }
    if (typeof v === 'number' && Math.abs(v) >= 10000) return U.fmtShort(v, opts.unit);
    return U.fmtNumber(v, { maxFrac: Math.abs(v) < 1 ? 2 : 0 }) + (opts.unit ? ' ' + opts.unit : '');
  }

  function drawYAxis(svg, L, scale, domain, kind, c, opts) {
    opts = opts || {};
    var ticks = U.niceTicks(domain[0], domain[1], opts.count || 5);
    var g = s('g.chart-axis-y');
    if (opts.grid !== false) {
      ticks.ticks.forEach(function (tv) {
        var y = scale(tv);
        if (y < L.y - 0.5 || y > L.y + L.plotH + 0.5) return;
        g.appendChild(s('line', { x1: L.x, x2: L.x + L.plotW, y1: y, y2: y, stroke: c.grid, 'stroke-width': 1 }));
      });
    }
    ticks.ticks.forEach(function (tv) {
      var y = scale(tv);
      if (y < L.y - 0.5 || y > L.y + L.plotH + 0.5) return;
      g.appendChild(textEl(L.x - 8, y, formatAxisValue(tv, kind, opts), { anchor: 'end', fill: c.muted }));
    });
    if (opts.label) {
      var cy = L.y + L.plotH / 2;
      g.appendChild(textEl(12, cy, U.truncate(opts.label, 30), {
        anchor: 'middle', fill: c.muted, transform: 'rotate(-90 12 ' + cy + ')'
      }));
    }
    svg.appendChild(g);
    return ticks;
  }

  function drawXAxis(svg, L, prep, bandScale, xScale, c, opts) {
    opts = opts || {};
    var g = s('g.chart-axis-x');
    var labels = [];
    if (bandScale) {
      var cats = prep.categories;
      var maxTicks = Math.max(2, Math.floor(L.plotW / 58));
      var stepN = cats.length > maxTicks ? Math.ceil(cats.length / maxTicks) : 1;
      cats.forEach(function (cat, i) {
        if (stepN > 1 && i % stepN !== 0 && i !== cats.length - 1) return;
        // horizontal: the label sits in the left margin, so size by that width
        var maxChars = L.horizontal
          ? Math.max(6, Math.floor((L.x - 18) / 6.4))
          : Math.max(5, Math.floor(bandScale.step / 7));
        labels.push({ x: bandScale.at(i), text: U.truncate(cat.label, maxChars) });
      });
      if (!L.horizontal) {
        labels.forEach(function (lab) {
          g.appendChild(textEl(lab.x, L.y + L.plotH + 16, lab.text, { anchor: 'middle', fill: c.muted }));
        });
      } else {
        // horizontal bars: the band axis is vertical, so labels sit on the left
        labels.forEach(function (lab) {
          g.appendChild(textEl(L.x - 8, lab.x, lab.text, { anchor: 'end', fill: c.muted }));
        });
      }
    } else {
      var ticks = U.niceTicks(opts.domain[0], opts.domain[1], Math.max(2, Math.floor(L.plotW / 96)));
      ticks.ticks.forEach(function (tv) {
        var x = xScale(tv);
        if (x < L.x - 0.5 || x > L.x + L.plotW + 0.5) return;
        g.appendChild(textEl(x, L.y + L.plotH + 16, formatAxisValue(tv, opts.kind, opts), { anchor: 'middle', fill: c.muted }));
      });
    }
    if (opts.axisLabel) {
      g.appendChild(textEl(L.x + L.plotW / 2, L.y + L.plotH + 36, opts.axisLabel, { anchor: 'middle', fill: c.muted }));
    }
    svg.appendChild(g);
    return labels;
  }

  function drawFrame(svg, L, c) {
    svg.appendChild(s('line', {
      x1: L.x, x2: L.x + L.plotW, y1: L.y + L.plotH, y2: L.y + L.plotH, stroke: c.line, 'stroke-width': 1
    }));
    svg.appendChild(s('line', {
      x1: L.x, x2: L.x, y1: L.y, y2: L.y + L.plotH, stroke: c.line, 'stroke-width': 1
    }));
  }

  function markHandlers(node, info, ctx) {
    // a stable identity lets the animation layer match this mark across redraws
    if (info && info.key !== undefined && info.key !== null) {
      node.setAttribute('data-key', String(info.key));
    }
    node.addEventListener('mouseenter', function (ev) { ctx.tooltip(ev, ctx.tipHtml(info)); });
    node.addEventListener('mousemove', function (ev) { ctx.moveTip(ev); });
    node.addEventListener('mouseleave', function () { ctx.hideTip(); });
    node.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (ctx.onClick) ctx.onClick(info);
    });
    node.addEventListener('contextmenu', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (ctx.onContext) ctx.onContext(info, ev);
    });
  }

  function linePath(pts, smooth) {
    if (!smooth || pts.length < 3) {
      return pts.map(function (p, i) { return (i ? 'L' : 'M') + p.x + ' ' + p.y; }).join(' ');
    }
    var d = 'M' + pts[0].x + ' ' + pts[0].y;
    for (var i = 1; i < pts.length; i++) {
      var p0 = pts[i - 1], p1 = pts[i];
      var cx = (p0.x + p1.x) / 2;
      d += ' C' + cx + ' ' + p0.y + ' ' + cx + ' ' + p1.y + ' ' + p1.x + ' ' + p1.y;
    }
    return d;
  }

  function iconSvg(name) {
    var paths = (PV.icons && PV.icons[name]) || '';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="' + paths + '"/></svg>';
  }

  /* ============================== render =============================== */
  function render(host, spec, df, opts) {
    opts = opts || {};
    host.classList.add('chart-host');
    // Re-rendering an unchanged chart is the most common wasted frame in the
    // app (any unrelated state change re-renders the view), so short-circuit.
    var sig = chartSignature(spec, df, opts, host);
    if (host.__chartSig === sig && host.querySelector('svg.chart-svg')) {
      return host.__chartResult;
    }
    var prevSvg = host.querySelector('svg.chart-svg');
    U.clear(host);
    var c = colors();
    var prep = PV.chartPrep.prepare(spec, df, opts);
    if (prep.empty) {
      host.appendChild(h('div.chart-empty', [
        h('div.chart-empty-icon', { html: iconSvg('chart') }),
        h('div.chart-empty-text', t(prep.empty === 'no-data' ? 'charts.empty.type' : 'charts.empty'))
      ]));
      host.__chartSig = sig;
      host.__chartResult = { prep: prep, empty: true };
      return host.__chartResult;
    }
    var width = Math.max(280, host.clientWidth || opts.width || 660);
    var L = layoutFor(prep, width);
    var svg = s('svg.chart-svg', {
      viewBox: '0 0 ' + L.width + ' ' + L.height,
      width: '100%', height: L.height,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img', 'aria-label': titleOf(prep)
    });
    svg.appendChild(s('title', {}, titleOf(prep)));
    var tip = h('div.chart-tip', { role: 'tooltip' });
    var ctx = {
      hidden: opts.hidden || {},
      onClick: opts.onMark,
      onContext: opts.onContext,
      onBrush: opts.onBrush,
      tooltip: function (ev, html) {
        tip.innerHTML = html;
        tip.classList.add('is-visible');
        ctx.moveTip(ev);
      },
      moveTip: function (ev) {
        var rect = host.getBoundingClientRect();
        var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
        tip.style.left = U.clamp(x, 70, Math.max(70, rect.width - 70)) + 'px';
        tip.style.top = Math.max(8, y - 14) + 'px';
      },
      hideTip: function () { tip.classList.remove('is-visible'); },
      tipHtml: function (info) { return tipHtml(info, prep, opts); }
    };
    var marks = PV.chartsMarks || {};
    var type = prep.type;
    var run = function (fn, extra) {
      if (!fn) return;
      if (extra === undefined) fn(svg, L, prep, c, ctx);
      else fn(svg, L, prep, c, ctx, extra);
    };
    if (type === 'bar' || type === 'hbar' || type === 'count') run(marks.bar);
    else if (type === 'line' || type === 'ecdf') run(marks.line, false);
    else if (type === 'area') run(marks.line, true);
    else if (type === 'scatter' || type === 'bubble') run(marks.scatter);
    else if (type === 'density') run(marks.density || marks.scatter);
    else if (type === 'parallel') run(marks.parallel);
    else if (type === 'hist') run(marks.hist);
    else if (type === 'box') run(marks.box, false);
    else if (type === 'violin') run(marks.box, true);
    else if (type === 'heatmap') run(marks.heatmap);
    else if (type === 'pie') run(marks.pie, false);
    else if (type === 'donut') run(marks.pie, true);
    else run(marks.bar);
    host.appendChild(svg);
    host.appendChild(tip);
    if (PV.anim) PV.anim.transition(svg, prevSvg, { duration: spec.duration || 420 });
    var result = { prep: prep, svg: svg, layout: L, empty: false };
    host.__chartSig = sig;
    host.__chartResult = result;
    return result;
  }

  /** Cheap identity of everything that affects the drawn marks. */
  function chartSignature(spec, df, opts, host) {
    var hidden = opts.hidden ? Object.keys(opts.hidden).sort().join(',') : '';
    var width = host.clientWidth || opts.width || 660;
    return (df ? df.fullSignature() : 'none') + '|' + JSON.stringify(spec) + '|' +
      Math.round(width) + '|' + hidden + '|' + (PV.i18n.lang);
  }

  function tipHtml(info, prep, opts) {
    var title = info.label === undefined ? '' : info.label;
    if (info.kind === 'corr') title = info.field + ' × ' + info.field2;
    var lines = ['<div class="chart-tip-title">' + U.escapeHtml(String(title)) + '</div>'];
    var rows = [];
    if (info.kind === 'corr') {
      rows.push([info.series, U.fmtNumber(info.value, { maxFrac: 3 })]);
    } else if (info.kind === 'range') {
      rows.push([prep.extra.field || '', U.fmtInt(info.value) + ' ' + t('charts.count_axis')]);
    } else if (info.kind === 'region2d') {
      // a density rectangle stands for a crowd of rows, so the useful numbers
      // are how many and what share of them, not a single measure
      rows.push([t('charts.count_axis'), U.fmtInt(info.count)]);
      if (info.share !== undefined) rows.push(['share', U.fmtPercent(info.share, 2)]);
    } else if (info.kind === 'cell') {
      // a pivot heatmap cell: the title already names both categories
      rows.push([info.series || prep.yFields[0] || t('charts.count_axis'),
        U.fmtNumber(info.value, { maxFrac: 3 })]);
    } else {
      // The mark's own category comes first: it is what a click filters on and
      // it is the only thing that identifies the mark. The measure follows it.
      var xLabel = prep.xField && prep.xField !== '__corr__' ? prep.xField : '';
      if (info.cat !== undefined && info.cat !== null && xLabel) {
        rows.push([xLabel, U.fmtValue(info.cat, { maxFrac: 3 })]);
      }
      if (info.cat2 !== undefined && info.cat2 !== null && prep.yFields[0]) {
        rows.push([prep.yFields[0], U.fmtValue(info.cat2, { maxFrac: 3 })]);
      }
      var measureLabel = info.seriesName || prep.yFields[0] ||
        (prep.type === 'count' ? t('charts.count_axis') : prep.xField);
      rows.push([measureLabel, U.fmtNumber(info.value, { maxFrac: 2 })]);
      if (info.value2 !== undefined) rows.push(['share', String(info.value2)]);
      if (info.box) {
        rows.push(['median', U.fmtNumber(info.box.median, { maxFrac: 2 })]);
        rows.push(['q1–q3', U.fmtNumber(info.box.q1, { maxFrac: 2 }) + ' – ' + U.fmtNumber(info.box.q3, { maxFrac: 2 })]);
        rows.push(['n', U.fmtInt(info.box.n)]);
      } else if (info.count !== undefined && info.count !== null) {
        rows.push(['n', U.fmtInt(info.count)]);
      }
      if (info.sizeField && info.extra !== null && info.extra !== undefined) {
        rows.push([info.sizeField, U.fmtNumber(info.extra, { maxFrac: 2 })]);
      }
    }
    rows.forEach(function (r) {
      lines.push('<div class="chart-tip-row"><span>' + U.escapeHtml(String(r[0])) +
        '</span><b>' + U.escapeHtml(String(r[1])) + '</b></div>');
    });
    if (opts.onMark) lines.push('<div class="chart-tip-hint">' + t('charts.click_hint') + '</div>');
    return lines.join('');
  }

  function titleOf(prep) {
    var bits = [];
    if (prep.xField && prep.xField !== '__corr__') bits.push(prep.xField);
    if (prep.yFields && prep.yFields.length && prep.xField !== '__corr__') bits.push(prep.yFields.join(', '));
    var base = prep.type + (bits.length ? ': ' + bits.join(' · ') : '');
    if (prep.aggregated && prep.aggFn) base += ' (' + prep.aggFn + ')';
    return base;
  }

  /* --------- sparkline: mini histogram / line for lists and headers ------- */
  function sparkline(values, opts) {
    opts = opts || {};
    var w = opts.width || 92, hgt = opts.height || 22;
    var nums = S.numeric(values);
    var c = opts.colors || colors();
    var svg = s('svg.mini', { viewBox: '0 0 ' + w + ' ' + hgt, width: w, height: hgt, 'aria-hidden': 'true' });
    if (!nums.length) return svg;
    if (opts.type === 'bar') {
      var hist = S.histogram(nums, U.clamp(Math.round(w / 6), 6, 20));
      var maxC = S.max(hist.counts) || 1;
      var bw = w / hist.counts.length;
      hist.counts.forEach(function (cnt, i) {
        var bh = Math.max(1, (cnt / maxC) * (hgt - 2));
        svg.appendChild(s('rect', {
          x: i * bw + 0.5, y: hgt - bh, width: Math.max(1, bw - 1.2), height: bh,
          fill: c.accent, opacity: 0.5, rx: 1
        }));
      });
      return svg;
    }
    var lo = S.min(nums), hi = S.max(nums);
    var step = Math.max(1, Math.ceil(nums.length / 80));
    var pts = [];
    for (var i = 0; i < nums.length; i += step) pts.push(nums[i]);
    if (pts.length < 2) pts = [nums[0], nums[nums.length - 1]];
    var xs = linear(0, Math.max(1, pts.length - 1), 1, w - 1);
    var ys = linear(lo, hi === lo ? lo + 1 : hi, hgt - 1, 1);
    svg.appendChild(s('path', {
      d: pts.map(function (v, i2) { return (i2 ? 'L' : 'M') + xs(i2) + ' ' + ys(v); }).join(' '),
      fill: 'none', stroke: c.accent, 'stroke-width': 1.4, opacity: 0.75
    }));
    return svg;
  }

  function cellHeat(t2) { return rampColor(t2); }

  /**
   * Axis-less thumbnails for the column atlas and other picture-first panels.
   * kind: 'hist' (numeric shape) | 'bars' (category frequencies) | 'line' (time).
   */
  function miniChart(kind, values, opts) {
    opts = opts || {};
    var w = opts.width || 132;
    var hgt = opts.height || 38;
    var c = opts.colors || colors();
    var svg = s('svg.mini', {
      viewBox: '0 0 ' + w + ' ' + hgt, width: '100%', height: hgt,
      preserveAspectRatio: 'none', 'aria-hidden': 'true'
    });
    var pad = 2;
    if (kind === 'line') {
      var pts = (values || []).filter(function (v) { return typeof v === 'number'; });
      if (pts.length < 2) return svg;
      var lo = S.min(pts), hi = S.max(pts);
      var xs = linear(0, pts.length - 1, pad, w - pad);
      var ys = linear(lo, hi === lo ? lo + 1 : hi, hgt - pad, pad);
      var d = pts.map(function (v, i) { return (i ? 'L' : 'M') + xs(i).toFixed(1) + ' ' + ys(v).toFixed(1); }).join(' ');
      svg.appendChild(s('path', {
        d: d + ' L' + (w - pad) + ' ' + (hgt - pad) + ' L' + pad + ' ' + (hgt - pad) + ' Z',
        fill: c.accent, opacity: 0.16, stroke: 'none'
      }));
      svg.appendChild(s('path', { d: d, fill: 'none', stroke: c.accent, 'stroke-width': 1.4, opacity: 0.9 }));
      return svg;
    }
    var counts;
    if (kind === 'hist') {
      var nums = S.numeric(values);
      if (!nums.length) return svg;
      counts = S.histogram(nums, U.clamp(Math.round(w / 7), 8, 26)).counts;
    } else {
      counts = (values || []).slice(0, 12).map(function (n) { return typeof n === 'number' ? n : 0; });
      if (!counts.length) return svg;
    }
    var maxC = S.max(counts) || 1;
    var bw = w / counts.length;
    counts.forEach(function (n, i) {
      var bh = Math.max(1, (n / maxC) * (hgt - pad * 2));
      svg.appendChild(s('rect', {
        x: (i * bw + 0.5).toFixed(2), y: (hgt - pad - bh).toFixed(2),
        width: Math.max(1, bw - 1).toFixed(2), height: bh.toFixed(2),
        rx: 1.5, fill: c.accent, opacity: 0.55
      }));
    });
    return svg;
  }

  /* ------------------------------ export ------------------------------- */
  function toSVGString(svgEl) {
    var clone = svgEl.cloneNode(true);
    var c = colors();
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('style', 'background:' + c.surface);
    var vb = (clone.getAttribute('viewBox') || '0 0 660 360').split(/\s+/);
    clone.setAttribute('width', vb[2]);
    clone.setAttribute('height', vb[3]);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + clone.outerHTML;
  }

  function downloadSVG(svgEl, name) {
    U.download(name, toSVGString(svgEl), 'image/svg+xml;charset=utf-8');
  }

  function downloadPNG(svgEl, name, cb) {
    var c = colors();
    var vb = (svgEl.getAttribute('viewBox') || '0 0 660 360').split(/\s+/);
    var w = Number(vb[2]) || 660, hgt = Number(vb[3]) || 360;
    var str = toSVGString(svgEl);
    var img = new root.Image();
    var blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var scale = 2;
    img.onload = function () {
      var canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = hgt * scale;
      var g2 = canvas.getContext('2d');
      g2.fillStyle = c.surface;
      g2.fillRect(0, 0, canvas.width, canvas.height);
      g2.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(function (blob2) {
        U.download(name, blob2, 'image/png');
        if (cb) cb();
      });
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      if (cb) cb(new Error('png export failed'));
    };
    img.src = url;
  }

  PV.charts = {
    render: render,
    colors: colors,
    colorAt: colorAt,
    rampColor: rampColor,
    divergingColor: divergingColor,
    cellHeat: cellHeat,
    sparkline: sparkline,
    miniChart: miniChart,
    layoutFor: layoutFor,
    linear: linear,
    band: band,
    isContinuous: isContinuous,
    textEl: textEl,
    markHandlers: markHandlers,
    spatialIndex: spatialIndex,
    pointOverlay: pointOverlay,
    DENSE_LIMIT: DENSE_LIMIT,
    drawYAxis: drawYAxis,
    drawXAxis: drawXAxis,
    drawFrame: drawFrame,
    linePath: linePath,
    labelOf: labelOf,
    aggValue: aggValue,
    num: num,
    formatAxisValue: formatAxisValue,
    toSVGString: toSVGString,
    downloadSVG: downloadSVG,
    downloadPNG: downloadPNG,
    MAX_POINTS: MAX_POINTS
  };
})(typeof window !== 'undefined' ? window : globalThis);
