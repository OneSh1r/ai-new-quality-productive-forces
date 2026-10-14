/* =============================================================================
 * Visual Pandas — views-charts.js
 * The chart builder: encodings on the left, the live chart on the right,
 * click-to-filter, series toggles and SVG/PNG export.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, h = U.h, ui = PV.ui, dlg = PV.dialog;
  var A = PV.app, ST = A.state;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  var TYPES = ['bar', 'hbar', 'line', 'area', 'scatter', 'bubble', 'density', 'hist', 'box', 'violin',
    'heatmap', 'parallel', 'pie', 'donut', 'ecdf', 'count'];
  /** The six a beginner actually needs; the rest appear under "more settings". */
  var PRIMARY_TYPES = ['bar', 'line', 'scatter', 'hist', 'box', 'pie'];
  var TYPE_ICON = {
    bar: 'barChart', hbar: 'barChart', line: 'chartLine', area: 'chartLine',
    scatter: 'scatterPlot', bubble: 'scatterPlot', hist: 'chart', box: 'box',
    violin: 'box', heatmap: 'grid', pie: 'pieChart', donut: 'pieChart',
    ecdf: 'chartLine', count: 'barChart', density: 'scatterPlot', parallel: 'layers'
  };
  var AGG = ['sum', 'mean', 'median', 'count', 'nunique', 'min', 'max', 'std'];

  function spec() { return ST.charts.spec; }
  function setSpec(patch) { Object.assign(ST.charts.spec, patch); A.emit(); }

  function fieldRow(label, control) { return h('div.builder-field', [h('label.builder-label', { text: label }), control]); }

  function columnSelect(cols, value, onChange, extraOptions) {
    var opts = (extraOptions || []).concat(cols.map(function (c) { return { value: c, label: c }; }));
    return dlg.select(opts, value, onChange);
  }

  function chipFor(col, selected, onChange) {
    var remove = function () { selected.splice(selected.indexOf(col), 1); onChange(selected.slice()); };
    return h('span.chip', [h('span', { text: col }), h('button.chip-x', { type: 'button', text: '×', on: { click: remove } })]);
  }

  function multiColumns(cols, values, onChange) {
    var selected = (values || []).slice();
    var wrap = h('div.multi-select');
    selected.forEach(function (c) { wrap.appendChild(chipFor(c, selected, onChange)); });
    var remaining = cols.filter(function (c) { return selected.indexOf(c) < 0; });
    if (remaining.length) {
      var add = h('select.select.select-sm');
      add.appendChild(h('option', { value: '', text: '+ ' + t('f.column') }));
      remaining.forEach(function (c) { add.appendChild(h('option', { value: c, text: c })); });
      add.addEventListener('change', function () { if (add.value) { selected.push(add.value); onChange(selected.slice()); } });
      wrap.appendChild(add);
    }
    return wrap;
  }

  function autoSpecFor(df) {
    var numeric = df.numericColumns(), cats = df.categoricalColumns(), dates = df.dateColumns();
    var main = PV.df.primaryNumericColumn(df);
    if (dates.length && numeric.length) return { type: 'line', x: dates[0], y: [main], agg: 'sum', sort: 'none', limit: 0, smooth: true };
    if (cats.length && numeric.length) return { type: 'bar', x: PV.df.preferredCategoryColumn(df), y: [main], agg: 'sum', sort: 'value_desc', limit: 12 };
    if (cats.length) return { type: 'count', x: PV.df.preferredCategoryColumn(df), y: [], limit: 12 };
    if (numeric.length >= 2) return { type: 'scatter', x: numeric[0], y: [numeric[1]], trend: true };
    if (numeric.length === 1) return { type: 'hist', x: numeric[0], y: [numeric[0]], bins: null };
    return null;
  }

  /**
   * A pipeline step can remove the columns a chart was built on (group by,
   * drop, pivot …). Rather than showing an empty chart, re-pick a sensible
   * spec for the frame we actually have.
   */
  function ensureValidSpec(df) {
    var s = spec();
    var xOk = s.x === '__corr__' || (s.x && df.has(s.x));
    var yList = (s.y || []).filter(function (c) { return df.has(c); });
    var type = s.type;
    var numericY = yList.filter(function (c) { return df.kind(c) === 'numeric'; });
    var ok;
    if (type === 'count') ok = xOk;
    else if (type === 'parallel') ok = numericY.length >= 2;
    else if (type === 'pie' || type === 'donut') ok = xOk;
    else ok = xOk && yList.length > 0;
    if (ok) {
      if (yList.length !== (s.y || []).length) s.y = yList;
      return;
    }
    var auto = autoSpecFor(df);
    if (!auto) return;
    var merged = Object.assign({}, A.defaultChart, auto);
    // keep the user's chart type when it still works for the new columns
    if (['bar', 'hbar', 'line', 'area', 'scatter', 'bubble', 'density', 'hist', 'ecdf', 'count', 'parallel'].indexOf(s.type) >= 0) {
      merged.type = s.type;
      if (s.type === 'count') { merged.y = []; merged.x = auto.x; }
      if (s.type === 'parallel') {
        merged.y = df.numericColumns().slice(0, 6);
        merged.x = df.numericColumns()[0] || merged.x;
      }
      if (s.type === 'hist' || s.type === 'ecdf') {
        var numeric = df.numericColumns();
        if (numeric.length) { merged.x = numeric[0]; merged.y = [numeric[0]]; }
      }
      if (['line', 'area'].indexOf(s.type) >= 0) merged.agg = 'mean';
    }
    ST.charts.spec = merged;
    ST.charts.hidden = {};
  }

  function chooseType(ty, df) {
    var s = spec();
    s.type = ty;
    if (df) {
      var numeric = df.numericColumns();
      if (ty === 'hist' || ty === 'ecdf') {
        var nv = numeric.indexOf(s.x) >= 0 ? s.x : (numeric[0] || s.x);
        s.x = nv;
        s.y = [nv];
      }
      if (ty === 'parallel') {
        var dims = (s.y && s.y.length >= 2 ? s.y : numeric).slice(0, 6);
        s.y = dims.length >= 2 ? dims : numeric.slice(0, 5);
      }
      if (['scatter', 'bubble', 'density'].indexOf(ty) >= 0) {
        if (numeric.indexOf(s.x) < 0) s.x = numeric[0] || s.x;
        var other = numeric.filter(function (c) { return c !== s.x; })[0] || s.x;
        s.y = [other === s.x ? (numeric[1] || s.x) : other];
      }
    }
    if (ty === 'count') s.y = [];
    if ((ty === 'scatter' || ty === 'bubble') && s.y.length > 1) s.y = [s.y[0]];
    A.emit();
  }

  function typeButton(ty, df) {
    return h('button.type-btn' + (spec().type === ty ? '.is-on' : ''), {
      type: 'button', title: t('charts.type.' + ty),
      on: { click: function () { chooseType(ty, df); } }
    }, [ui.icon(TYPE_ICON[ty]), h('span', { text: t('charts.type.' + ty) })]);
  }

  function typeSection(df) {
    var grid = h('div.type-grid');
    var list = ST.chartAdvanced ? TYPES : PRIMARY_TYPES;
    list.forEach(function (ty) { grid.appendChild(typeButton(ty, df)); });
    return h('div.builder-section', [h('div.builder-title', { text: t('charts.type') }), grid]);
  }

  function encodingSection(df) {
    var s = spec();
    var enc = h('div.builder-section');
    enc.appendChild(h('div.builder-title', { text: t('charts.builder') }));
    if (s.type === 'parallel') {
      enc.appendChild(fieldRow(t('charts.dims'), multiColumns(df.numericColumns(), s.y, function (list) {
        if (list.length >= 2) setSpec({ y: list });
      })));
      enc.appendChild(fieldRow(t('charts.color'), columnSelect(df.categoricalColumns(), s.color, function (v) {
        setSpec({ color: v || null });
      }, [{ value: '', label: t('f.none') }])));
      enc.appendChild(h('div.sub-hint', { text: t('charts.parallel.hint') }));
      return enc;
    }
    enc.appendChild(fieldRow(t('charts.x'), columnSelect(df.names, s.x, function (v) { setSpec({ x: v }); })));
    var yMulti = ['line', 'area', 'bar', 'hbar'].indexOf(s.type) >= 0;
    if (yMulti) {
      enc.appendChild(fieldRow(t('charts.y_multi'), multiColumns(df.numericColumns(), s.y, function (list) {
        if (list.length) setSpec({ y: list });
      })));
    } else if (s.type !== 'count') {
      enc.appendChild(fieldRow(t('charts.y'), columnSelect(df.numericColumns(), s.y[0], function (v) { setSpec({ y: v ? [v] : [] }); })));
    }
    if (ST.chartAdvanced && ['scatter', 'bubble'].indexOf(s.type) >= 0) {
      enc.appendChild(fieldRow(t('charts.size'), columnSelect(df.numericColumns(), s.size, function (v) { setSpec({ size: v || null }); }, [{ value: '', label: t('f.none') }])));
    }
    if (ST.chartAdvanced && ['bar', 'hbar', 'line', 'area', 'scatter', 'bubble'].indexOf(s.type) >= 0) {
      enc.appendChild(fieldRow(t('charts.color'), columnSelect(df.categoricalColumns(), s.color, function (v) { setSpec({ color: v || null }); }, [{ value: '', label: t('f.none') }])));
    }
    if (['bar', 'hbar', 'line', 'area'].indexOf(s.type) >= 0) {
      enc.appendChild(fieldRow(t('charts.agg'), dlg.select(AGG.map(function (f) { return { value: f, label: t('fn.' + f) }; }), s.agg, function (v) { setSpec({ agg: v }); })));
    }
    if (ST.chartAdvanced && (s.type === 'hist' || s.type === 'ecdf')) {
      enc.appendChild(fieldRow(t('charts.bins'), dlg.textInput(s.bins || '', function (v) {
        setSpec({ bins: v === '' ? null : U.clamp(Number(v) || 10, 2, 60) });
      }, { type: 'number', min: 2, max: 60 })));
    }
    if (s.type === 'density') {
      enc.appendChild(h('div.sub-hint', { text: t('charts.density.hint') }));
    }
    if (ST.chartAdvanced && ['bar', 'hbar', 'count', 'pie', 'donut', 'box', 'violin'].indexOf(s.type) >= 0) {
      enc.appendChild(fieldRow(t('charts.sort'), dlg.select([
        { value: 'value_desc', label: t('charts.sort.value_desc') },
        { value: 'value_asc', label: t('charts.sort.value_asc') },
        { value: 'none', label: t('charts.sort.none') }
      ], s.sort, function (v) { setSpec({ sort: v }); })));
      enc.appendChild(fieldRow(t('charts.limit'), dlg.textInput(s.limit || 0, function (v) {
        setSpec({ limit: Math.max(0, Number(v) || 0) });
      }, { type: 'number', min: 0, max: 60 })));
    }
    return enc;
  }

  function optionSection() {
    var s = spec();
    var opts = h('div.builder-section');
    opts.appendChild(h('div.builder-title', { text: t('ops.options') }));
    var stack = h('div.switch-stack');
    if (['bar', 'hbar'].indexOf(s.type) >= 0) {
      stack.appendChild(dlg.switchBox(t('charts.stack'), s.stacked, function (v) { setSpec({ stacked: v }); }));
      stack.appendChild(dlg.switchBox(t('charts.labels'), s.labels, function (v) { setSpec({ labels: v }); }));
      stack.appendChild(dlg.switchBox(t('charts.type.hbar'), s.horizontal, function (v) { setSpec({ horizontal: v }); }));
    }
    if (['line', 'area', 'ecdf'].indexOf(s.type) >= 0) {
      stack.appendChild(dlg.switchBox(t('charts.smooth'), s.smooth, function (v) { setSpec({ smooth: v }); }));
      stack.appendChild(dlg.switchBox(t('charts.y_log'), s.y_log, function (v) { setSpec({ y_log: v }); }));
    }
    if (['scatter', 'bubble'].indexOf(s.type) >= 0) {
      stack.appendChild(dlg.switchBox(t('charts.auto_chart'), s.trend, function (v) { setSpec({ trend: v }); }));
    }
    opts.appendChild(stack);
    // beginners only need the essentials: colour, labels, stacking and friends
    // live behind one "more settings" switch
    var advanced = h('button.builder-more' + (ST.chartAdvanced ? '.is-open' : ''), {
      type: 'button',
      on: { click: function () { ST.chartAdvanced = !ST.chartAdvanced; A.emit(); } }
    }, [
      ui.icon(ST.chartAdvanced ? 'chevronUp' : 'chevronDown'),
      h('span', { text: ST.chartAdvanced ? t('charts.basic') : t('charts.advanced') })
    ]);
    return h('div', [advanced, ST.chartAdvanced ? opts : null]);
  }

  function resetSpec(df) { ST.charts.spec = Object.assign({}, A.defaultChart, autoSpecFor(df) || {}); ST.charts.hidden = {}; A.emit(); }

  function autoPick(df) { var auto = autoSpecFor(df); if (auto) { ST.charts.spec = Object.assign({}, A.defaultChart, auto); A.emit(); } }

  function actionSection(df) {
    return h('div.builder-actions', [
      ui.button({ icon: 'wand', label: t('charts.auto_chart'), size: 'sm', onClick: function () { autoPick(df); } }),
      ui.button({ icon: 'reset', label: t('misc.reset'), size: 'sm', onClick: function () { resetSpec(df); } })
    ]);
  }

  function legendItem(item) {
    var hidden = !!ST.charts.hidden[item.name];
    var toggle = function () {
      if (ST.charts.hidden[item.name]) delete ST.charts.hidden[item.name];
      else ST.charts.hidden[item.name] = true;
      A.emit();
    };
    return h('button.legend-item' + (hidden ? '.is-off' : ''), { type: 'button', on: { click: toggle } }, [
      h('span.legend-swatch', { style: { background: item.color } }),
      h('span.legend-label', { text: item.name })
    ]);
  }

  function legendBar(prep) {
    if (!prep.legend || !prep.legend.length) return null;
    var bar = h('div.chart-legend');
    prep.legend.forEach(function (item) { bar.appendChild(legendItem(item)); });
    return bar;
  }

  function exportRow(chartHost) {
    var svgOf = function () { return chartHost.querySelector('svg'); };
    return h('div.chart-export', [
      ui.button({ icon: 'download', label: t('app.export.chart_svg'), size: 'sm', onClick: function () { var el = svgOf(); if (el) PV.charts.downloadSVG(el, 'chart.svg'); } }),
      ui.button({ icon: 'download', label: t('app.export.chart_png'), size: 'sm', onClick: function () { var el = svgOf(); if (el) PV.charts.downloadPNG(el, 'chart.png'); } })
    ]);
  }

  function renderChartsView(host) {
    U.clear(host);
    var df = A.result().df;
    if (!df) { host.appendChild(ui.emptyState(t('app.no_dataset'), null)); return; }
    ensureValidSpec(df);
    var layout = h('div.charts-layout');
    var side = h('div.charts-side');
    var main = h('div.charts-main');
    layout.appendChild(side);
    layout.appendChild(main);
    host.appendChild(layout);
    side.appendChild(typeSection(df));
    side.appendChild(encodingSection(df));
    side.appendChild(optionSection());
    side.appendChild(actionSection(df));
    var chartHost = h('div.chart-box');
    var legendHost = h('div.legend-host');
    var infoLine = h('div.chart-info');
    main.appendChild(chartHost);
    main.appendChild(legendHost);
    main.appendChild(infoLine);
    var result = PV.charts.render(chartHost, spec(), df, {
      hidden: ST.charts.hidden,
      width: chartHost.clientWidth || 720,
      onMark: function (info) { A.markClick(info); },
      onContext: function (info, ev) { A.markContext(info, ev); },
      onBrush: function (info) {
        if (!info || !info.field) return;
        A.filterByRange(info.field, info.lo, info.hi);
      }
    });
    if (!result.empty) {
      var legend = legendBar(result.prep);
      if (legend) legendHost.appendChild(legend);
      infoLine.appendChild(h('span', { text: t('charts.click_hint') }));
      infoLine.appendChild(h('span.chart-info-stat', { text: t('charts.points_n', { n: U.fmtInt(result.prep.totalPoints) }) }));
      if (result.prep.dropped) infoLine.appendChild(h('span.chart-info-stat', { text: 'NaN: ' + U.fmtInt(result.prep.dropped) }));
      if (df.nrows > PV.charts.MAX_POINTS) {
        infoLine.appendChild(h('span.chart-info-stat', { text: t('charts.row_limit', { n: U.fmtInt(PV.charts.MAX_POINTS) }) }));
      }
    }
    main.appendChild(exportRow(chartHost));
  }

  PV.viewsCharts = { render: renderChartsView, autoSpecFor: autoSpecFor };
})(typeof window !== 'undefined' ? window : globalThis);
