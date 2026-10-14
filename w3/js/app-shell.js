/* =============================================================================
 * Visual Pandas — app-shell.js
 * The page shell: header, tabs, sidebar, right rail, status bar, theme and
 * language toggles, exports, session save/load and global wiring.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, h = U.h, ui = PV.ui, dlg = PV.dialog;
  var A = PV.app, ST = A.state;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  var TABS = [
    { id: 'table', icon: 'table' },
    { id: 'profile', icon: 'profile' },
    { id: 'charts', icon: 'chart' },
    { id: 'group', icon: 'pivot' },
    { id: 'combine', icon: 'merge' },
    { id: 'code', icon: 'code' }
  ];

  /* ------------------------------- header ------------------------------- */
  function brand() {
    var mark = h('span.brand-mark');
    mark.innerHTML = ui.icon('pivot').innerHTML;
    return h('div.brand', [mark, h('div.brand-text', [
      h('div.brand-title', { text: t('app.title') }),
      h('div.brand-sub', { text: t('app.tagline') })
    ])]);
  }

  function datasetSwitcher() {
    var ds = A.active();
    var wrap = h('div.dataset-switch');
    if (!ds) {
      wrap.appendChild(h('span.chip-warn', { text: t('app.no_dataset') }));
      return wrap;
    }
    var sel = h('select.select.select-sm.dataset-select');
    ST.datasets.forEach(function (d) { sel.appendChild(h('option', { value: d.id, text: A.datasetLabel(d) })); });
    sel.value = ds.id;
    sel.addEventListener('change', function () { A.setActive(sel.value); });
    wrap.appendChild(sel);
    var res = A.result();
    wrap.appendChild(h('span.shape-chip', [
      h('span.shape-rows', { text: U.fmtInt(res.df.nrows) }),
      h('span.shape-x', { text: '×' }),
      h('span.shape-cols', { text: String(res.df.ncols) })
    ]));
    if (A.steps().length) wrap.appendChild(h('span.steps-chip', { text: t('pipe.steps_n', { n: A.steps().length }) }));
    return wrap;
  }

  function langToggle() {
    var wrap = h('div.segmented');
    [['zh', '中文'], ['en', 'EN']].forEach(function (pair) {
      wrap.appendChild(h('button.seg' + (ST.lang === pair[0] ? '.is-on' : ''), {
        type: 'button', text: pair[1], on: { click: function () { setLang(pair[0]); } }
      }));
    });
    return wrap;
  }

  function setLang(lang) {
    ST.lang = lang;
    PV.i18n.setLang(lang, true);
    try { localStorage.setItem('pv-lang', lang); } catch (e) { /* ignore */ }
    A.emit();
  }

  /** Deep links: #profile opens the profile tab, so views can be shared. */
  function tabFromHash() {
    var raw = (root.location && root.location.hash ? root.location.hash : '').replace(/^#/, '');
    return TABS.filter(function (x) { return x.id === raw; })[0] ? raw : null;
  }

  function initHash() {
    var tab = tabFromHash();
    if (tab) ST.tab = tab;
    root.addEventListener('hashchange', function () {
      var next = tabFromHash();
      if (next && next !== ST.tab) {
        ST.tab = next;
        A.emit();
      }
    });
  }

  function setTheme(theme) {
    ST.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('pv-theme', theme); } catch (e) { /* ignore */ }
    // effects read colours on every frame; force a clean redraw of the view
    if (PV.fx) PV.fx.killAll();
    viewCache = {};
    A.clearMemo();
    A.emit();
  }

  function exportMenu(anchor) {
    var ds = A.active();
    var res = A.result();
    ui.menu(anchor, [
      { label: t('app.export.result_csv'), icon: 'download', onSelect: function () { PV.sourcePanel.exportFrame(res.df, (ds.name || 'result') + '_result.csv'); } },
      { label: t('app.export.result_json'), icon: 'download', onSelect: function () {
        U.download((ds.name || 'result') + '_result.json', JSON.stringify(res.df.toJSON('records'), null, 1), 'application/json;charset=utf-8');
        PV.ui.toast(t('toast.exported', { name: 'JSON' }), { icon: 'download' });
      } },
      { separator: true },
      { label: t('misc.new_dataset_from_result'), icon: 'database', onSelect: function () { A.resultToDataset(); } },
      { separator: true },
      { label: t('app.export.session'), icon: 'save', onSelect: saveSession },
      { label: t('app.import.session'), icon: 'upload', onSelect: loadSession },
      { separator: true },
      { label: t('app.reset'), icon: 'reset', danger: true, onSelect: function () {
        dlg.confirm(t('app.reset.confirm'), { danger: true, confirmLabel: t('app.reset') })
          .then(function (ok) { if (ok) resetWorkspace(); });
      } }
    ], { align: 'right' });
  }

  function showHelp() {
    dlg.dialog({
      title: t('app.help'),
      body: h('div.help-body', [
        h('p', { text: t('misc.help.body1') }),
        h('p', { text: t('misc.help.body2') }),
        h('p', { text: t('misc.help.body3') }),
        h('div.sub-title', { text: t('misc.shortcut') }),
        h('p', { text: 'Ctrl/⌘ + Z — ' + t('toast.undo') }),
        h('p', { text: 'Ctrl/⌘ + F — ' + t('misc.shortcut.search') })
      ]),
      actions: [{ label: t('misc.close'), value: 'ok', primary: true }]
    });
  }

  function header() {
    var exportBtn = ui.button({ icon: 'download', label: t('app.export'), caret: true, onClick: function () { exportMenu(exportBtn); } });
    return h('header.topbar', [
      brand(),
      datasetSwitcher(),
      PV.focus ? PV.focus.chip() : null,
      h('div.topbar-right', [
        ui.iconButton(ST.theme === 'dark' ? 'sun' : 'moon', { tip: t('app.theme.toggle'), onClick: function () { setTheme(ST.theme === 'dark' ? 'light' : 'dark'); } }),
        ui.iconButton('question', { tip: t('app.help'), onClick: showHelp }),
        langToggle(),
        exportBtn
      ])
    ]);
  }

  /* ------------------------------- tabs --------------------------------- */
  function tabsBar() {
    var bar = h('nav.tabs', { role: 'tablist' });
    // 合并数据 only appears once there is something to join with
    visibleTabs().forEach(function (tab) {
      bar.appendChild(h('button.tab' + (ST.tab === tab.id ? '.is-on' : ''), {
        type: 'button', role: 'tab', 'data-tab': tab.id,
        'aria-selected': ST.tab === tab.id ? 'true' : 'false',
        on: { click: function () { A.setTab(tab.id); } }
      }, [ui.icon(tab.icon), h('span', { text: t(tab.id + '.tab') })]));
    });
    return bar;
  }

  function visibleTabs() {
    return TABS.filter(function (x) {
      return x.id !== 'combine' || ST.datasets.length > 1;
    });
  }

  /* ----------------------------- sidebar -------------------------------- */
  function columnRow(df, c) {
    var nums = df.numericColumns().indexOf(c.name) >= 0;
    return h('button.col-row', {
      type: 'button',
      on: { click: function () { A.setInspector('column', { col: c.name }); } }
    }, [
      h('span.col-spark', [PV.charts.sparkline(df.col(c.name), { width: 46, height: 18, type: nums ? 'bar' : 'line' })]),
      h('span.col-main', [
        h('span.col-name', { text: c.name }),
        h('span.col-meta', [
          h('span.dtype-badge', { text: c.dtype }),
          c.missing ? h('span.col-missing', { text: 'NaN ' + U.fmtInt(c.missing) }) : null
        ])
      ])
    ]);
  }

  function columnsPanel() {
    var df = A.result().df;
    if (!df) return h('div.panel.panel-columns');
    var list = h('div.col-list');
    var info = df.info();
    info.forEach(function (c) { list.appendChild(columnRow(df, c, info)); });
    return ui.collapsible(t('cols.panel'), {
      icon: 'columns',
      badge: String(df.ncols),
      open: !ST.collapsed.columns,
      onToggle: function () {
        ST.collapsed.columns = !ST.collapsed.columns;
        A.emit();
      },
      build: function () { return list; }
    });
  }

  function sidebar() {
    var left = h('aside.side');
    if (ST.sidebar.mode === 'form') {
      PV.opsPanel.renderFormPanel(left);
      return left;
    }
    // the key must carry the *active* dataset and every visible label: without
    // it, clicking a dataset row (or renaming one) re-uses the old node and the
    // list looks dead.
    var dsKey = ST.activeId + '|' + ST.datasets.map(function (d) {
      return d.id + ':' + d.rev + ':' + d.nameZh + ':' + d.nameEn;
    }).join(',');
    left.appendChild(A.memo('src|' + ST.lang + '|' + dsKey, function () {
      var node = h('div.side-block');
      PV.sourcePanel.renderSourcePanel(node);
      return node;
    }));
    left.appendChild(A.memo('ops|' + ST.lang + '|' + !!ST.opsExpanded, function () {
      var node = h('div.side-block');
      PV.opsPanel.renderOpsPanel(node);
      return node;
    }));
    left.appendChild(A.memo('cols|' + ST.lang + '|' + frameKey() + '|' + !!ST.collapsed.columns, columnsPanel));
    return left;
  }

  /** A cheap identity of the pipeline result (name-shape-size based). */
  function frameKey() {
    var res = A.result();
    if (!res.df) return 'none';
    return res.df.fullSignature() + '|' + A.steps().map(function (s) {
      return s.type + (s.enabled === false ? '!' : '');
    }).join('.');
  }

  /* ------------------------------- rail --------------------------------- */
  function rail() {
    var right = h('aside.rail');
    // undo / redo availability is part of the key: otherwise the buttons keep
    // the disabled state of whatever node was built for this pipeline shape.
    var historyKey = (A.canUndo() ? 'u' + A.undoDepth() : 'u0') + (A.canRedo() ? 'r' + A.redoDepth() : 'r0');
    right.appendChild(A.memo('pipe|' + ST.lang + '|' + frameKey() + '|' + stepsKey() + '|' + historyKey, function () {
      var node = h('div.rail-block');
      PV.railPanel.renderPipeline(node);
      return node;
    }));
    right.appendChild(A.memo('ins|' + ST.lang + '|' + frameKey() + '|' + JSON.stringify(ST.inspector), function () {
      var node = h('div.rail-block');
      PV.railPanel.renderInspector(node);
      return node;
    }));
    return right;
  }

  function stepsKey() {
    var res = A.result();
    return A.steps().map(function (s, i) {
      var st = res.stages[i] || {};
      return s.type + ':' + (s.enabled === false ? 'off' : 'on') + ':' + (st.rows) + ':' + (st.error ? 'e' : '');
    }).join(',') + '|' + Object.keys(ST.expandedSteps).join(',');
  }

  /* ------------------------------ status -------------------------------- */
  function sourceLabel(ds) {
    var s = ds.source || {};
    if (s.kind === 'file') return s.name || 'file';
    if (s.kind === 'url') return s.url;
    if (s.kind === 'sample') return t('misc.sample_note');
    if (s.kind === 'generated') return 'generate(seed=' + s.seed + ')';
    if (s.kind === 'derived') return t('misc.new_dataset_from_result');
    return t('misc.custom');
  }

  function statusBar() {
    var ds = A.active();
    var res = A.result();
    var left = ds ? t('src.loaded_note', { rows: U.fmtInt(res.df.nrows), cols: res.df.ncols }) : t('app.no_dataset');
    return h('footer.statusbar', [
      h('span#status-text.status-text', { text: ST.status || left }),
      h('span.status-right', [
        ds ? h('span', { text: t('top.source') + ': ' + sourceLabel(ds) }) : null,
        res.ms ? h('span', { text: t('pipe.elapsed', { ms: res.ms }) }) : null
      ])
    ]);
  }

  /* ------------------------------- views -------------------------------- */
  /** One cached view node per tab, reused while its inputs are unchanged. */
  var viewCache = {};
  var lastViewNode = null;

  function viewSignature(tab) {
    var res = A.result();
    var ds = A.active();
    var bits = [tab, ds ? ds.id : 'none', ds ? ds.rev : 0,
      res.df ? res.df.fullSignature() : 'none', ST.lang];
    if (tab === 'table') {
      bits.push(JSON.stringify([ST.table.search, ST.table.density, ST.table.heat, ST.table.hidden,
        ST.table.selectedRow, ST.table.selectedCol]));
      bits.push(PV.viewsTable.signature ? PV.viewsTable.signature() : '');
    } else if (tab === 'charts') bits.push(JSON.stringify(ST.charts) + '|' + !!ST.chartAdvanced);
    else if (tab === 'profile') bits.push(JSON.stringify(ST.profile));
    else if (tab === 'group') {
      bits.push(JSON.stringify([ST.group, ST.pivot]));
      bits.push(PV.viewsGroup.signature ? PV.viewsGroup.signature() : '');
    }
    else if (tab === 'combine') bits.push(JSON.stringify(ST.merge));
    else if (tab === 'code') bits.push(JSON.stringify(ST.code) + '|' + A.steps().length);
    return bits.join('|');
  }

  function currentView() {
    if (!visibleTabs().some(function (x) { return x.id === ST.tab; })) ST.tab = 'table';
    var tab = ST.tab;
    var sig = viewSignature(tab);
    if (viewCache[tab] && viewCache[tab].sig === sig) return viewCache[tab].node;
    var holder = h('div.view', { dataset: { tab: tab } });
    if (!A.active()) {
      holder.appendChild(emptyHero());
      viewCache[tab] = { sig: viewSignature(tab), node: holder };
      return holder;
    }
    if (ST.tab === 'table') PV.viewsTable.render(holder);
    else if (ST.tab === 'profile') PV.viewsProfile.render(holder);
    else if (ST.tab === 'charts') PV.viewsCharts.render(holder);
    else if (ST.tab === 'group') PV.viewsGroup.render(holder);
    else if (ST.tab === 'combine') PV.viewsCombine.render(holder);
    else if (ST.tab === 'code') PV.viewsCode.render(holder);
    // recompute: rendering may normalise state (e.g. an auto-picked chart spec)
    viewCache[tab] = { sig: viewSignature(tab), node: holder };
    return holder;
  }

  /** The no-data workspace: an ambient p5 field behind a clear call to action. */
  function emptyHero() {
    var canvas = h('div.fx-hero');
    var hero = h('div.hero', [
      canvas,
      h('div.hero-body', [
        h('div.hero-title', { text: t('app.no_dataset') }),
        h('div.hero-hint', { text: t('src.load_hint') }),
        h('div.hero-actions', [
          ui.button({
            label: t('src.reload'), icon: 'database', variant: 'primary',
            onClick: function () { A.loadSample(PV.datasets.defaultId); }
          }),
          ui.button({
            label: t('src.upload'), icon: 'upload',
            onClick: function () { PV.sourcePanel.openPicker(); }
          })
        ])
      ])
    ]);
    if (PV.fx) PV.fx.schedule(canvas, {}, function () { PV.fx.ambientField(canvas, { height: 240 }); });
    return hero;
  }

  /* ------------------------------ session ------------------------------- */
  var MAX_SESSION_ROWS = 60000;

  function saveSession() {
    var payload = {
      app: 'visual-pandas', version: 1, savedAt: new Date().toISOString(),
      lang: ST.lang, theme: ST.theme, activeId: ST.activeId,
      datasets: ST.datasets.map(function (d) {
        var limit = Math.min(d.df.nrows, MAX_SESSION_ROWS);
        return {
          id: d.id, name: d.name, nameZh: d.nameZh, nameEn: d.nameEn, pyName: d.pyName,
          source: d.source, addedAt: d.addedAt,
          columns: d.df.names, dtypes: d.df.dtypes,
          truncated: d.df.nrows > limit,
          rows: d.df.toJSON('records', limit)
        };
      }),
      pipelines: ST.pipelines
    };
    U.download('visual-pandas-session.json', JSON.stringify(payload), 'application/json;charset=utf-8');
    PV.ui.toast(t('toast.session_saved'), { icon: 'save' });
  }

  function loadSession() {
    var input = h('input', { type: 'file', accept: '.json' });
    input.addEventListener('change', function () {
      var file = input.files[0];
      if (!file) return;
      U.readFileText(file).then(function (text) {
        var data = JSON.parse(text);
        if (!data || !Array.isArray(data.datasets)) throw new Error('bad session');
        ST.datasets = [];
        ST.pipelines = {};
        data.datasets.forEach(function (d) {
          var frame = PV.df.DataFrame.fromRecords(d.rows, { columns: d.columns });
          frame._dtypes = d.dtypes.slice();
          ST.datasets.push({
            id: d.id, name: d.name, nameZh: d.nameZh, nameEn: d.nameEn, pyName: d.pyName,
            df: frame, source: d.source || { kind: 'custom' }, addedAt: d.addedAt, rev: 1
          });
        });
        ST.pipelines = data.pipelines || {};
        var ok = ST.datasets.some(function (d) { return d.id === data.activeId; });
        ST.activeId = ok ? data.activeId : (ST.datasets[0] ? ST.datasets[0].id : null);
        A.resetHistory();
        A.invalidate();
        A.resetViewState(A.active());
        A.emit();
        PV.ui.toast(t('toast.session_loaded', { n: ST.datasets.length }), { icon: 'upload' });
      }).catch(function () {
        PV.ui.toast(t('err.session'), { icon: 'warning', type: 'warn' });
      });
    });
    input.click();
  }

  function resetWorkspace() {
    ST.datasets = [];
    ST.pipelines = {};
    ST.activeId = null;
    A.resetHistory();
    A.invalidate();
    A.emit();
    A.loadSample(PV.datasets.defaultId);
    PV.ui.toast(t('toast.reset'), { icon: 'reset' });
  }

  /* --------------------------- global wiring ---------------------------- */
  function dragOverlay() {
    var overlay = h('div.drop-overlay', [ui.icon('upload'), h('span', { text: t('app.drop_overlay') })]);
    document.body.appendChild(overlay);
    var depth = 0;
    window.addEventListener('dragenter', function (ev) {
      var types = ev.dataTransfer ? Array.prototype.slice.call(ev.dataTransfer.types || []) : [];
      if (types.indexOf('Files') < 0) return;
      depth += 1;
      overlay.classList.add('is-on');
    });
    window.addEventListener('dragover', function (ev) { ev.preventDefault(); });
    window.addEventListener('dragleave', function () {
      depth = Math.max(0, depth - 1);
      if (!depth) overlay.classList.remove('is-on');
    });
    window.addEventListener('drop', function (ev) {
      ev.preventDefault();
      depth = 0;
      overlay.classList.remove('is-on');
      var files = ev.dataTransfer ? Array.prototype.slice.call(ev.dataTransfer.files || []) : [];
      files.forEach(function (f) { PV.sourcePanel.openFile(f); });
    });
  }

  function keyboard() {
    document.addEventListener('keydown', function (ev) {
      var meta = ev.metaKey || ev.ctrlKey;
      if (!meta) return;
      // Caps Lock sends 'Z': normalise before comparing
      var key = String(ev.key || '').toLowerCase();
      if (key === 'z' && !ev.shiftKey) { ev.preventDefault(); A.undo(); return; }
      if ((key === 'z' && ev.shiftKey) || key === 'y') { ev.preventDefault(); A.redo(); return; }
      if (key === 'f') {
        var box = document.querySelector('.search-input');
        if (!box) {
          // the search box lives in the table view: go there first
          A.setTab('table');
          box = document.querySelector('.search-input');
        }
        if (box) { ev.preventDefault(); box.focus(); box.select(); }
      }
    });
  }

  function resizeHandling() {
    var pending = null;
    window.addEventListener('resize', function () {
      if (pending) clearTimeout(pending);
      pending = setTimeout(function () { pending = null; A.emit(); }, 280);
    });
  }

  function render() {
    var appRoot = document.getElementById('app');
    if (!appRoot) return;
    U.clear(appRoot);
    appRoot.appendChild(header());
    appRoot.appendChild(tabsBar());
    var body = h('div.workspace');
    body.appendChild(sidebar());
    var view = currentView();
    // Effects live inside view nodes: drop the old instances only when the node
    // itself is replaced, then rebuild the sketches of whatever we attached.
    if (view !== lastViewNode) {
      if (PV.fx) PV.fx.killAll();
      lastViewNode = view;
    }
    body.appendChild(h('main.center', [view]));
    body.appendChild(rail());
    appRoot.appendChild(body);
    appRoot.appendChild(statusBar());
    if (PV.fx) PV.fx.mountAll(view);
    if (PV.viewsProfile2 && PV.viewsProfile2.redrawAll) setTimeout(function () { PV.viewsProfile2.redrawAll(); }, 0);
  }

  PV.shell = {
    render: render,
    setLang: setLang,
    setTheme: setTheme,
    init: function () {
      A.on(render);
      dragOverlay();
      keyboard();
      resizeHandling();
      var savedLang = null, savedTheme = null;
      try {
        savedLang = localStorage.getItem('pv-lang');
        savedTheme = localStorage.getItem('pv-theme');
      } catch (e) { /* ignore */ }
      // shareable links: ?theme=dark&lang=en together with #charts
      var query = (root.location && root.location.search) || '';
      var qTheme = /[?&]theme=(dark|light)/.exec(query);
      var qLang = /[?&]lang=(zh|en)/.exec(query);
      if (qTheme) savedTheme = qTheme[1];
      if (qLang) savedLang = qLang[1];
      ST.lang = (savedLang === 'en') ? 'en' : 'zh';
      ST.theme = (savedTheme === 'dark') ? 'dark' : 'light';
      PV.i18n.setLang(ST.lang, true);
      document.documentElement.setAttribute('data-theme', ST.theme);
      document.documentElement.setAttribute('lang', ST.lang === 'zh' ? 'zh-CN' : 'en');
      initHash();
      render();
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
