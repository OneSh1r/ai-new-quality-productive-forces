/* =============================================================================
 * Visual Pandas — focus.js
 * "The current column": one shared notion of which column the user is looking
 * at, plus a single menu that sends it to every tool. Clicking a column name
 * anywhere sets it; each view reads it as a default. This is what ties the
 * table, the profile, the charts, the summaries and the joins together.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, h = U.h, ui = PV.ui;
  var A = PV.app, ST = A.state;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  /** The focused column, if it still exists in the current result. */
  function current() {
    var res = A.result();
    var col = ST.focus.col;
    return (col && res.df && res.df.has(col)) ? col : null;
  }

  /**
   * Focus a column: every view that has no explicit choice follows it. Only
   * empty/invalid slots are filled, so a chart the user built is never changed
   * under their feet.
   */
  function set(col) {
    if (!col) return clear();
    ST.focus.col = col;
    var df = A.result().df;
    if (df && df.has(col)) {
      var kind = df.kind(col);
      if (kind !== 'datetime') ST.profile.col = col;
      var spec = ST.charts.spec;
      if (kind === 'numeric' && (!spec.y || !spec.y.length || !df.has(spec.y[0]))) spec.y = [col];
      if (!spec.x || !df.has(spec.x)) spec.x = col;
    }
    A.emit();
  }

  function clear() {
    ST.focus.col = null;
    A.emit();
  }

  function toggle(col) {
    if (current() === col) clear();
    else set(col);
  }

  /* --------------------------- where to send it -------------------------- */
  function openHist(col) {
    ST.charts.spec = Object.assign({}, A.defaultChart, {
      type: 'hist', x: col, y: [col], bins: null, height: 360
    });
    A.setTab('charts');
  }

  function openCounts(col) {
    ST.profile.col = col;
    A.setTab('profile');
  }

  function useAsAxis(col, axis) {
    var df = A.result().df;
    var kind = df.has(col) ? df.kind(col) : 'text';
    var spec = Object.assign({}, A.defaultChart, ST.charts.spec);
    if (axis === 'x') {
      spec.x = col;
      if (kind !== 'numeric' && kind !== 'datetime') {
        if (['line', 'area', 'scatter', 'bubble', 'ecdf'].indexOf(spec.type) >= 0) spec.type = 'bar';
        if (!spec.y.length) spec.y = [PV.df.primaryNumericColumn(df)];
      }
    } else {
      spec.y = [col];
      if (['count', 'pie', 'donut'].indexOf(spec.type) >= 0) spec.type = 'bar';
    }
    ST.charts.spec = spec;
    A.setTab('charts');
  }

  function groupBy(col) {
    var df = A.result().df;
    if (!ST.group.aggs || !ST.group.aggs.length) {
      var main = PV.df.primaryNumericColumn(df);
      ST.group.aggs = [{ col: main, fn: df.kind(col) === 'numeric' ? 'mean' : 'sum', out: '' }];
    }
    ST.group.keys = [col];
    A.setTab('group');
  }

  function filterOn(col) {
    var df = A.result().df;
    var kind = df.has(col) ? df.kind(col) : 'text';
    A.openOpForm('filter', {
      mode: 'visual', match: 'all',
      conds: [{ col: col, op: (kind === 'numeric' || kind === 'datetime') ? 'gt' : 'eq', value: '', value2: '' }]
    });
  }

  function stats(col) {
    A.setInspector('column', { col: col });
    A.setTab('profile');
  }

  function joinKey(col) {
    var others = ST.datasets.filter(function (d) { return d.id !== ST.activeId; });
    if (!others.length) {
      PV.ui.toast(t('combine.need_second'), { icon: 'info', type: 'warn' });
      return;
    }
    var other = others.filter(function (d) { return d.id === ST.merge.other; })[0] || others[0];
    ST.merge = Object.assign({}, ST.merge, {
      other: other.id,
      leftOn: [col],
      rightOn: [other.df.has(col) ? col : other.df.names[0]]
    });
    A.setTab('combine');
  }

  /** Every action a column can be sent to — the app's linkage menu. */
  function actions(col) {
    var df = A.result().df;
    if (!df || !col || !df.has(col)) return [];
    var kind = df.kind(col);
    var numeric = kind === 'numeric';
    return [
      { label: t('focus.hist'), icon: 'chart', disabled: !numeric, onSelect: function () { openHist(col); } },
      { label: t('focus.counts'), icon: 'bars', onSelect: function () { openCounts(col); } },
      { separator: true },
      { label: t('focus.asX'), icon: 'scatterPlot', onSelect: function () { useAsAxis(col, 'x'); } },
      { label: t('focus.asY'), icon: 'chartLine', disabled: !numeric, onSelect: function () { useAsAxis(col, 'y'); } },
      { label: t('focus.groupBy'), icon: 'group', onSelect: function () { groupBy(col); } },
      { label: t('focus.filter'), icon: 'filter', onSelect: function () { filterOn(col); } },
      { label: t('focus.stats'), icon: 'sigma', onSelect: function () { stats(col); } },
      { separator: true },
      {
        label: t('focus.joinKey'), icon: 'merge',
        disabled: ST.datasets.length < 2,
        onSelect: function () { joinKey(col); }
      }
    ];
  }

  function menu(anchor, col) {
    var target = col || current();
    if (!target) return;
    ui.menu(anchor, actions(target), { align: 'right' });
  }

  /** Small "current column" chip for the header, with the linkage menu. */
  function chip() {
    var col = current();
    if (!col) return null;
    var df = A.result().df;
    var btn = h('button.focus-chip', {
      type: 'button',
      'data-tip': t('focus.use'),
      on: { click: function () { menu(btn, col); } }
    }, [
      ui.icon('target'),
      h('span.focus-chip-label', { text: t('focus.label') }),
      h('b', { text: col }),
      h('span.dtype-badge', { text: df.dtype(col) })
    ]);
    var clearBtn = h('button.focus-clear', {
      type: 'button', text: '×', 'aria-label': t('focus.clear'), 'data-tip': t('focus.clear'),
      on: { click: function (ev) { ev.stopPropagation(); clear(); } }
    });
    return h('div.focus-wrap', [btn, clearBtn]);
  }

  /** A compact row of "use this column" buttons, e.g. in the inspector. */
  function actionRow(col) {
    if (!col) return null;
    var df = A.result().df;
    if (!df || !df.has(col)) return null;
    var kind = df.kind(col);
    var row = h('div.ins-actions');
    if (kind === 'numeric') {
      row.appendChild(ui.button({ label: t('focus.hist'), icon: 'chart', size: 'sm', onClick: function () { openHist(col); } }));
    }
    row.appendChild(ui.button({ label: t('focus.counts'), icon: 'bars', size: 'sm', onClick: function () { openCounts(col); } }));
    row.appendChild(ui.button({ label: t('focus.asX'), icon: 'scatterPlot', size: 'sm', onClick: function () { useAsAxis(col, 'x'); } }));
    if (kind === 'numeric') {
      row.appendChild(ui.button({ label: t('focus.asY'), icon: 'chartLine', size: 'sm', onClick: function () { useAsAxis(col, 'y'); } }));
    }
    row.appendChild(ui.button({ label: t('focus.groupBy'), icon: 'group', size: 'sm', onClick: function () { groupBy(col); } }));
    row.appendChild(ui.button({ label: t('focus.filter'), icon: 'filter', size: 'sm', onClick: function () { filterOn(col); } }));
    return row;
  }

  PV.focus = {
    current: current,
    set: set,
    clear: clear,
    toggle: toggle,
    menu: menu,
    chip: chip,
    actions: actions,
    actionRow: actionRow,
    openHist: openHist,
    openCounts: openCounts,
    useAsAxis: useAsAxis,
    groupBy: groupBy,
    filterOn: filterOn
  };
})(typeof window !== 'undefined' ? window : globalThis);
