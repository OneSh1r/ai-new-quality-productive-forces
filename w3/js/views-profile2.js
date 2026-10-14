/* =============================================================================
 * Visual Pandas — views-profile2.js
 * The chart column of the profile view: correlation matrix, numeric
 * distributions and the scatter matrix.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, h = U.h, ui = PV.ui, dlg = PV.dialog;
  var A = PV.app, ST = A.state;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  var pendingRedraw = [];

  function drawInto(host, spec, df, opts) {
    opts = opts || {};
    var box = h('div.chart-holder');
    host.appendChild(box);
    var draw = function () {
      PV.charts.render(box, spec, df, {
        width: box.clientWidth || 420,
        hidden: {},
        onMark: function (info) {
          if (info.kind === 'corr') return openScatter(info.field, info.field2);
          if (opts.onMark) return opts.onMark(info);
          A.markClick(info);
        },
        onContext: function (info, ev) { A.markContext(info, ev); }
      });
    };
    draw();
    pendingRedraw.push({ node: box, draw: draw });
    return box;
  }

  function openScatter(a, b) {
    ST.charts.spec = Object.assign({}, A.defaultChart, {
      type: 'scatter', x: a, y: [b], color: null, size: null, trend: true
    });
    A.setTab('charts');
  }

  function corrPanel(df) {
    var numeric = df.numericColumns();
    var wrap = h('div');
    if (numeric.length < 2) {
      wrap.appendChild(h('div.sub-hint', { text: t('profile.corr.need') }));
      return wrap;
    }
    var head = h('div.control-row');
    head.appendChild(dlg.field(t('profile.corr.method'), dlg.select(['pearson', 'spearman', 'kendall'].map(function (m) {
      return { value: m, label: m.charAt(0).toUpperCase() + m.slice(1) };
    }), ST.profile.corrMethod, function (v) {
      ST.profile.corrMethod = v;
      A.emit();
    })));
    wrap.appendChild(head);
    var cols = numeric.slice(0, 8);
    drawInto(wrap, { type: 'heatmap', x: '__corr__', y: cols, corrMethod: ST.profile.corrMethod }, df);
    wrap.appendChild(h('div.sub-hint', { text: t('profile.corr.hint') }));
    return wrap;
  }

  function distributions(df) {
    var numeric = df.numericColumns().slice(0, 4);
    if (!numeric.length) return h('div.sub-hint', { text: t('charts.no_numeric') });
    var wrap = h('div.mini-charts');
    numeric.forEach(function (col) {
      var cell = h('div.mini-chart');
      wrap.appendChild(cell);
      PV.charts.render(cell, { type: 'hist', x: col, y: [col], bins: ST.profile.bins || null }, df, {
        width: cell.clientWidth || 320,
        onMark: function (info) {
          if (info.kind === 'range') A.filterByRange(info.field, info.range[0], info.range[1]);
        }
      });
    });
    return wrap;
  }

  function pairPlot(df) {
    var numeric = df.numericColumns();
    if (numeric.length < 2) return h('div.sub-hint', { text: t('profile.corr.need') });
    var chosen = (ST.profile.pairCols || []).filter(function (c) { return df.has(c); }).slice(0, 4);
    if (chosen.length < 2) chosen = numeric.slice(0, 3);
    var wrap = h('div');
    var picker = h('div.control-row');
    numeric.forEach(function (c) {
      var on = chosen.indexOf(c) >= 0;
      picker.appendChild(h('button.toggle-chip' + (on ? '.is-on' : ''), {
        type: 'button', text: c,
        on: {
          click: function () {
            var i = chosen.indexOf(c);
            if (i >= 0) chosen.splice(i, 1);
            else if (chosen.length < 4) chosen.push(c);
            ST.profile.pairCols = chosen.slice();
            A.emit();
          }
        }
      }));
    });
    wrap.appendChild(picker);
    var grid = h('div.pair-grid');
    for (var i = 0; i < chosen.length; i++) {
      for (var j = i + 1; j < chosen.length; j++) {
        grid.appendChild(pairCell(chosen[i], chosen[j], df));
      }
    }
    wrap.appendChild(grid);
    return wrap;
  }

  function pairCell(a, b, df) {
    var cell = h('div.pair-cell');
    PV.charts.render(cell, { type: 'scatter', x: a, y: [b], trend: true, color: null }, df, {
      width: cell.clientWidth || 300,
      onMark: function (info) { A.markClick(info); }
    });
    return cell;
  }

  function renderChartsColumn(host, df) {
    pendingRedraw = [];
    host.appendChild(section(t('profile.corr.title'), 'grid', [corrPanel(df)]));
    host.appendChild(section(t('profile.numeric_dist.title'), 'chart', [distributions(df)]));
    host.appendChild(section(t('profile.pairplot.title'), 'scatterPlot', [
      h('div.sub-hint', { text: t('profile.pairplot.hint') }),
      pairPlot(df)
    ]));
  }

  /**
   * One chart panel of the profile grid, addressed by name so the profile can
   * lay its panels out in balanced pairs.
   */
  function panel(kind, df) {
    if (kind === 'corr') return section(t('profile.corr.title'), 'grid', [corrPanel(df)], 6);
    if (kind === 'dist') return section(t('profile.numeric_dist.title'), 'chart', [distributions(df)], 6);
    return section(t('profile.pairplot.title'), 'scatterPlot', [
      h('div.sub-hint', { text: t('profile.pairplot.hint') }),
      pairPlot(df)
    ], 6);
  }

  function section(title, iconName, body, span) {
    return h('section.panel.span-' + (span || 12), [
      ui.panelHead(title, [], { icon: iconName }),
      h('div.panel-body', body)
    ]);
  }

  function redrawAll() {
    pendingRedraw.forEach(function (item) {
      if (item.node.parentNode) item.draw();
    });
  }

  PV.viewsProfile2 = {
    panel: panel,
    renderChartsColumn: renderChartsColumn,
    redrawAll: redrawAll,
    drawInto: drawInto
  };
})(typeof window !== 'undefined' ? window : globalThis);
