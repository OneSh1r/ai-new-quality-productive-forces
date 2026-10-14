/* =============================================================================
 * Visual Pandas — views-table.js
 * The data grid: virtual scrolling, click-to-sort, search, heat shading,
 * column menus and cell menus that write straight into the pipeline.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, h = U.h, ui = PV.ui, dlg = PV.dialog, D = PV.df;
  var A = PV.app, ST = A.state;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  var ROW_H = { compact: 26, normal: 32, comfy: 40 };
  var view = { sort: [], search: '', from: 0, to: 0, rows: [] };

  function rowHeight() { return ROW_H[ST.table.density] || ROW_H.normal; }

  /** Apply the view-only search filter and local sort to the result frame. */
  function viewFrame() {
    var df = A.result().df;
    if (!df) return null;
    var search = (ST.table.search || '').trim().toLowerCase();
    if (!search) return df;
    var names = df.names;
    var idx = [];
    for (var i = 0; i < df.nrows; i++) {
      for (var c = 0; c < names.length; c++) {
        var v = df.col(names[c])[i];
        if (v === null || v === undefined) continue;
        if (String(v).toLowerCase().indexOf(search) >= 0) { idx.push(i); break; }
      }
    }
    return df.take(idx);
  }

  function columnWidths(df, visible) {
    var widths = {};
    var sample = Math.min(df.nrows, 150);
    visible.forEach(function (col) {
      var vals = df.col(col);
      var maxLen = String(col).length + 2;
      for (var i = 0; i < sample; i++) {
        var v = vals[i];
        if (v === null || v === undefined) continue;
        var len = String(v instanceof Date ? U.fmtDateTime(v) : v).length;
        if (len > maxLen) maxLen = len;
      }
      widths[col] = U.clamp(maxLen * 7.4 + 26, 88, 220);
    });
    return widths;
  }

  function visibleColumns(df) {
    return df.names.filter(function (n) { return !ST.table.hidden[n]; });
  }

  /* ------------------------------- cells -------------------------------- */
  /** Data bars / heat need one min/max pair per column, computed once per render. */
  function heatStats(df, visible) {
    var stats = {};
    var info = df.info();
    visible.forEach(function (col) {
      var rec = info.filter(function (c) { return c.name === col; })[0];
      if (rec && rec.min !== null && rec.max !== null && rec.max > rec.min) stats[col] = rec;
    });
    return stats;
  }

  /** A background bar sized by the value's position inside the column range. */
  function dataBar(stats, col, value) {
    if (!ST.table.heat || value === null || typeof value !== 'number') return '';
    var info = stats[col];
    if (!info) return '';
    var p = U.clamp((value - info.min) / (info.max - info.min), 0, 1);
    return '<span class="cell-bar" style="width:' + (p * 100).toFixed(1) + '%"></span>';
  }

  function cellMenu(ev, df, col, value, rowIndex) {
    var items = [
      {
        label: t('table.menu.filter_value') + (value === null ? '' : ': ' + U.truncate(String(value), 18)),
        icon: 'filter', disabled: value === null,
        onSelect: function () { A.filterByValue(col, value, false); }
      },
      {
        label: t('table.menu.exclude_value'), icon: 'close', disabled: value === null,
        onSelect: function () { A.filterByValue(col, value, true); }
      },
      { separator: true },
      {
        label: t('table.menu.copy_values'), icon: 'copy',
        onSelect: function () {
          dlg.copy(U.fmtValue(value)).then(function () { PV.ui.toast(t('toast.copied'), { icon: 'check' }); });
        }
      },
      {
        label: t('ins.row_detail'), icon: 'rows',
        onSelect: function () { A.setInspector('row', { index: rowIndex }); }
      },
      { separator: true },
      { label: t('ins.column_profile') + ': ' + col, icon: 'profile', onSelect: function () { A.setInspector('column', { col: col }); } }
    ];
    ui.menu(ev.target, items);
  }

  function columnMenu(ev, df, col) {
    var isSorted = view.sort.length && view.sort[0].col === col;
    var items = [
      { label: t('table.menu.sort_asc'), icon: 'arrowUp', onSelect: function () { setSort(col, true); } },
      { label: t('table.menu.sort_desc'), icon: 'arrowDown', onSelect: function () { setSort(col, false); } },
      isSorted ? { label: t('table.menu.clear_sort'), icon: 'close', onSelect: function () { view.sort = []; A.emit(); } } : null,
      { separator: true },
      { label: t('table.menu.value_counts'), icon: 'bars', onSelect: function () { ST.profile.col = col; A.setTab('profile'); } },
      { label: t('table.menu.histogram'), icon: 'chart', onSelect: function () {
        ST.charts.spec = Object.assign({}, ST.charts.spec, { type: 'hist', x: col, y: [col], bins: null });
        A.setTab('charts');
      } },
      { label: t('table.menu.describe'), icon: 'sigma', onSelect: function () {
        A.setInspector('column', { col: col });
      } },
      { separator: true },
      { label: t('table.menu.rename'), icon: 'rename', onSelect: function () { renameColumn(col); } },
      { label: t('table.menu.cast'), icon: 'type', onSelect: function () {
        A.openOpForm('cast', { col: col, dtype: df.dtype(col) === 'object' ? 'float64' : 'object' });
      } },
      { label: t('table.menu.duplicate'), icon: 'copy', onSelect: function () {
        var name = df.uniqueName(col + '_copy');
        A.addStep('select', { columns: df.names.concat([name]) });
      } },
      {
        label: t('table.menu.fill_missing'), icon: 'missing',
        onSelect: function () { A.openOpForm('missing', { mode: 'fillna', columns: [col], method: 'mean', value: '' }); }
      },
      { separator: true },
      { label: t('table.menu.drop'), icon: 'trash', danger: true, onSelect: function () {
        A.addStep('drop', { columns: [col] });
      } }
    ].filter(Boolean);
    ui.menu(ev.target, items, { align: 'right' });
  }

  function renameColumn(col) {
    dlg.prompt({ title: t('table.menu.rename'), label: col, value: col }).then(function (name) {
      if (!name || name === col) return;
      A.addStep('rename', { pairs: [{ from: col, to: name }] });
    });
  }

  function setSort(col, ascending) {
    if (view.sort.length === 1 && view.sort[0].col === col && view.sort[0].ascending === ascending) {
      view.sort = [];
    } else {
      view.sort = [{ col: col, ascending: ascending }];
    }
    A.emit();
  }

  /**
   * Every filter step, as a removable chip. This is the visible link between
   * the pipeline, the charts (whose clicks add filters) and the table.
   */
  function filterChips() {
    var steps = A.steps();
    var ctx = A.ctx();
    var rows = [];
    steps.forEach(function (step, index) {
      if (step.type !== 'filter' || step.enabled === false) return;
      rows.push({ text: PV.ops.summarize(step, ctx) || t('op.filter'), index: index });
    });
    if (!rows.length) return null;
    var box = h('div.filter-chips', [
      h('span.filter-chips-label', { text: t('table.filters') })
    ]);
    rows.forEach(function (r) {
      box.appendChild(h('span.chip.chip-filter', [
        h('span', { text: U.truncate(r.text, 46) }),
        h('button.chip-x', {
          type: 'button', text: '×', 'aria-label': t('f.remove'),
          on: { click: function () { A.removeStep(r.index); } }
        })
      ]));
    });
    box.appendChild(h('button.filter-clear', {
      type: 'button', text: t('table.clear_filters'),
      on: { click: function () { A.clearSteps(); } }
    }));
    return box;
  }

  /* ------------------------------ render -------------------------------- */
  function renderTableView(host) {
    U.clear(host);
    var res = A.result();
    var df = res.df;
    if (!df) {
      host.appendChild(ui.emptyState(t('app.no_dataset'), null));
      return;
    }
    var frame = viewFrame();
    if (view.sort.length) frame = frame.sortValues(view.sort);
    var visible = visibleColumns(frame);

    /* toolbar */
    var searchBox = h('input.input.input-sm.search-input', {
      type: 'search', placeholder: t('table.search.ph'), value: ST.table.search || ''
    });
    searchBox.addEventListener('input', U.debounce(function () {
      ST.table.search = searchBox.value;
      A.emit();
      // the toolbar is rebuilt on every render: keep the caret where the user left it
      var again = document.querySelector('.search-input');
      if (again) {
        again.focus();
        try { again.setSelectionRange(again.value.length, again.value.length); } catch (e) { /* ignore */ }
      }
    }, 260));
    var densityBtn = ui.button({
      icon: 'rows', caret: true,
      label: t('table.density.' + ST.table.density),
      onClick: function () {
        ui.menu(densityBtn, ['compact', 'normal', 'comfy'].map(function (d) {
          return {
            label: t('table.density.' + d), checked: ST.table.density === d,
            onSelect: function () { ST.table.density = d; A.emit(); }
          };
        }), { align: 'right' });
      }
    });
    var columnsBtn = ui.button({
      icon: 'columns', label: t('table.columns'), caret: true,
      onClick: function () {
        ui.menu(columnsBtn, df.names.map(function (n) {
          return {
            label: n, checked: !ST.table.hidden[n],
            onSelect: function () {
              if (ST.table.hidden[n]) delete ST.table.hidden[n];
              else ST.table.hidden[n] = true;
              A.emit();
            }
          };
        }).concat([{ separator: true }, {
          label: t('f.select_all'), icon: 'check',
          onSelect: function () { ST.table.hidden = {}; A.emit(); }
        }]), { align: 'right' });
      }
    });
    var heatBtn = ui.button({
      icon: ST.table.heat ? 'barChart' : 'eyeOff',
      label: ST.table.heat ? t('table.bars_on') : t('table.bars_off'),
      onClick: function () { ST.table.heat = !ST.table.heat; A.emit(); }
    });
    var addColBtn = ui.button({
      icon: 'plus', label: t('table.menu.add_computed'),
      onClick: function () { A.openOpForm('assign'); }
    });
    var toolbar = h('div.view-toolbar', [
      searchBox,
      h('div.toolbar-right', [
        heatBtn,
        densityBtn,
        columnsBtn,
        addColBtn,
        ui.button({
          icon: 'download', label: t('table.export_csv'),
          onClick: function () { PV.sourcePanel.exportFrame(frame, (A.active().name || 'data') + '.csv'); }
        })
      ])
    ]);
    host.appendChild(toolbar);

    if (!frame.nrows) {
      host.appendChild(ui.emptyState(t('table.empty'), t('table.empty.hint'),
        ui.button({
          label: t('table.clear_filters'), icon: 'reset',
          onClick: function () { ST.table.search = ''; A.clearSteps(); }
        })));
      return;
    }

    /* status line */
    var statusLine = h('div.view-status', [
      h('span', { text: t('table.rows_n', { n: U.fmtInt(frame.nrows) }) }),
      view.sort.length ? h('span.chip.chip-sort', [
        h('span', { text: view.sort[0].col + (view.sort[0].ascending ? ' ↑' : ' ↓') }),
        h('button.chip-x', {
          type: 'button', text: '×',
          on: { click: function () { view.sort = []; A.emit(); } }
        })
      ]) : null,
      (ST.table.search && frame.nrows !== res.df.nrows)
        ? h('span.status-note', { text: t('table.filtered_note', { n: U.fmtInt(frame.nrows) }) })
        : null,
      h('span.status-hint', { text: t('table.hint.colclick') })
    ]);
    host.appendChild(statusLine);
    // active filters as removable chips: the table shows why rows are missing
    var chips = filterChips();
    if (chips) host.appendChild(chips);

    /* grid */
    var widths = columnWidths(frame, visible);
    var template = '58px ' + visible.map(function (c) { return Math.round(widths[c]) + 'px'; }).join(' ');
    var wrap = h('div.table-wrap');
    var head = h('div.grid-head', { style: { gridTemplateColumns: template } });
    head.appendChild(h('div.grid-cell.grid-index.grid-h', { text: t('table.index') }));
    visible.forEach(function (col) {
      var sorted = view.sort[0] && view.sort[0].col === col ? (view.sort[0].ascending ? ' ↑' : ' ↓') : '';
      var info = frame.info().filter(function (c) { return c.name === col; })[0];
      var title = h('button.grid-head-btn', {
        type: 'button',
        'data-tip': col + ' · ' + frame.dtype(col) + ' · ' + t('table.menu.sort_asc'),
        on: {
          click: function (ev) {
            if (ev.target.closest('.col-menu')) return;
            // one click does the two things people expect from a header:
            // sort by this column (asc → desc → off) and focus it, which
            // drives the inspector and the "use this column" menu
            var same = view.sort.length === 1 && view.sort[0].col === col;
            if (!same) view.sort = [{ col: col, ascending: true }];
            else if (view.sort[0].ascending) view.sort = [{ col: col, ascending: false }];
            else view.sort = [];
            ST.focus.col = col;
            ST.inspector = { kind: 'column', payload: { col: col } };
            A.emit();
          }
        }
      }, [
        h('span.grid-col-name', { text: col + sorted }),
        h('span.grid-col-meta', [
          h('span.grid-col-type', { text: frame.dtype(col) }),
          info && info.missing ? h('span.grid-col-missing', { text: 'NaN ' + U.fmtInt(info.missing) }) : null
        ])
      ]);
      var menuBtn = h('button.col-menu', {
        type: 'button', 'aria-label': t('table.columns'), 'data-tip': t('table.columns'),
        on: { click: function (ev) { ev.stopPropagation(); columnMenu(ev, frame, col); } }
      }, [ui.icon('chevronDown')]);
      var cell = h('div.grid-cell.grid-h' + (ST.table.selectedCol === col ? '.is-selected' : ''), [title, menuBtn]);
      head.appendChild(cell);
    });
    wrap.appendChild(head);
    // Only the header and each row carry the column template: the containers
    // must stay non-grid, otherwise a row would be squeezed into column one.
    var bodyHost = h('div.grid-body');
    var spacerTop = h('div.grid-spacer');
    var rowsHost = h('div.grid-rows');
    wrap.appendChild(bodyHost);
    bodyHost.appendChild(spacerTop);
    bodyHost.appendChild(rowsHost);
    host.appendChild(wrap);

    var stats = heatStats(frame, visible);
    function paintRows() {
      var rh = rowHeight();
      var viewH = wrap.clientHeight || 520;
      var headH = head.offsetHeight || 40;
      var scroll = (wrap.scrollTop || 0) - headH;
      var first = Math.max(0, Math.floor(scroll / rh) - 4);
      var count = Math.ceil(viewH / rh) + 8;
      var last = Math.min(frame.nrows, first + count);
      spacerTop.style.height = (first * rh) + 'px';
      U.clear(rowsHost);
      var frag = [];
      for (var i = first; i < last; i++) {
        frag.push(rowNode(frame, i, visible, rh, stats, template));
      }
      frag.forEach(function (n) { rowsHost.appendChild(n); });
      view.from = first;
      view.to = last;
    }
    var onScroll = U.raf(paintRows);
    wrap.addEventListener('scroll', onScroll);
    paintRows();
    host.__paintRows = paintRows;
  }

  function rowNode(frame, i, visible, rh, stats, template) {
    var row = h('div.grid-row', {
      class: (i % 2 ? 'is-alt ' : '') + (ST.table.selectedRow === i ? 'is-selected' : ''),
      style: { height: rh + 'px', gridTemplateColumns: template }
    });
    row.appendChild(h('div.grid-cell.grid-index', {
      text: String(i),
      on: { click: function () { A.setInspector('row', { index: i }); } }
    }));
    visible.forEach(function (col) {
      var v = frame.col(col)[i];
      var cls = 'grid-cell' + (U.isNA(v) ? ' is-na' : '') + (typeof v === 'number' ? ' num' : '');
      var bar = dataBar(stats || {}, col, v);
      var cell = h('div', {
        class: cls + (bar ? ' has-bar' : ''),
        title: U.fmtValue(v, { maxFrac: 4 }),
        on: {
          click: function () {
            ST.table.selectedRow = i;
            A.setInspector('row', { index: i });
          },
          contextmenu: function (ev) { cellMenu(ev, frame, col, v, i); }
        }
      });
      if (bar) cell.innerHTML = bar;
      cell.appendChild(h('span.cell-value', { text: U.fmtValue(v, { maxFrac: 4 }) }));
      row.appendChild(cell);
    });
    return row;
  }

  PV.viewsTable = {
    render: renderTableView,
    viewFrame: viewFrame,
    /** Local view state that must invalidate the cached view node. */
    signature: function () { return JSON.stringify(view.sort); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
