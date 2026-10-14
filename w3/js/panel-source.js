/* =============================================================================
 * Visual Pandas — panel-source.js
 * The data source panel: samples, file upload, paste, URL and random data,
 * plus the dataset list. The parse dialog previews as you change options.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, h = U.h, ui = PV.ui, dlg = PV.dialog, IO = PV.io;
  var A = PV.app, S = A.state;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  var fileInput = null;

  function hiddenFileInput() {
    if (!fileInput) {
      fileInput = h('input', {
        type: 'file', multiple: true, class: 'hidden-input',
        accept: '.csv,.tsv,.txt,.json,.jsonl,.ndjson,.xlsx,.xlsm'
      });
      fileInput.addEventListener('change', function () {
        var files = Array.prototype.slice.call(fileInput.files || []);
        fileInput.value = '';
        files.forEach(function (f) { openFile(f); });
      });
      document.body.appendChild(fileInput);
    }
    return fileInput;
  }

  function openPicker() { hiddenFileInput().click(); }

  /* ----------------------------- loading --------------------------------- */
  function loadText(text, opts) {
    var frame;
    try {
      frame = IO.frameFromText(text, opts);
    } catch (e) {
      PV.ui.toast(t('err.parse'), { icon: 'warning', type: 'warn' });
      return null;
    }
    if (!frame.nrows && !frame.ncols) {
      PV.ui.toast(t('err.empty'), { icon: 'warning', type: 'warn' });
      return null;
    }
    var name = (opts && opts.filename) ? String(opts.filename).replace(/\.[^.]+$/, '') : 'pasted_data';
    return A.addDataset(frame, {
      name: name,
      nameZh: name,
      nameEn: name,
      pyName: name,
      source: { kind: 'file', name: (opts && opts.filename) || (name + '.csv'), size: text.length, format: 'text' }
    });
  }

  function openFile(file) {
    var name = file.name || '';
    var format = IO.detectFormat(name);
    if (format === 'xlsx') {
      PV.ui.toast(t('err.busy'), { icon: 'hourglass', duration: 1400 });
      U.readFileArrayBuffer(file).then(function (buf) {
        return IO.readXLSX(buf, 0).then(function (frame) {
          var sheets = frame._sheets || [];
          var idx = frame._sheetIndex || 0;
          delete frame._sheets;
          delete frame._sheetIndex;
          A.addDataset(frame, {
            name: name.replace(/\.[^.]+$/, ''),
            nameZh: name.replace(/\.[^.]+$/, ''),
            nameEn: name.replace(/\.[^.]+$/, ''),
            source: { kind: 'file', name: name, size: file.size, format: 'xlsx', sheets: sheets, sheetIndex: idx }
          });
        });
      }).catch(function () {
        PV.ui.toast(t('err.xlsx'), { icon: 'warning', type: 'warn' });
      });
      return;
    }
    if (['csv', 'tsv', 'json', 'jsonl', 'text'].indexOf(format) < 0) {
      PV.ui.toast(t('err.file_type', { ext: name.split('.').pop() }), { icon: 'warning', type: 'warn' });
      return;
    }
    U.readFileText(file).then(function (text) {
      if (format === 'json' || format === 'jsonl') {
        loadText(text, { filename: name, format: format });
        return;
      }
      openParseDialog(text, name);
    }).catch(function () {
      PV.ui.toast(t('err.load_failed'), { icon: 'warning', type: 'warn' });
    });
  }

  /* --------------------------- parse dialog ----------------------------- */
  function openParseDialog(text, filename) {
    var detected = IO.detectDelimiter(text);
    var opts = { delimiter: 'auto', header: true, infer: true, na: IO.DEFAULT_NA.join(', ') };
    var previewHost = h('div.parse-preview');
    var infoLine = h('div.parse-info');
    var formHost = h('div.parse-form');
    var body = h('div.parse-body', [formHost, infoLine, previewHost]);
    function buildOptions() {
      var na = String(opts.na || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      return {
        delimiter: opts.delimiter, header: opts.header, na: na,
        filename: filename, format: /\.jsonl?$/i.test(filename || '') ? 'json' : 'text'
      };
    }
    function paint() {
      U.clear(formHost);
      var delimSel = dlg.select([
        { value: 'auto', label: t('parse.delimiter.auto') + ' (' + (detected.key === 'comma' ? t('parse.delimiter.comma')
          : detected.key === 'tab' ? t('parse.delimiter.tab')
            : detected.key === 'semicolon' ? t('parse.delimiter.semicolon')
              : detected.key === 'pipe' ? t('parse.delimiter.pipe') : t('parse.delimiter.space')) + ')' },
        { value: 'comma', label: t('parse.delimiter.comma') + '  ,' },
        { value: 'tab', label: t('parse.delimiter.tab') + '  \\t' },
        { value: 'semicolon', label: t('parse.delimiter.semicolon') + '  ;' },
        { value: 'pipe', label: t('parse.delimiter.pipe') + '  |' },
        { value: 'space', label: t('parse.delimiter.space') }
      ], opts.delimiter, function (v) { opts.delimiter = v; paint(); });
      var headerSwitch = dlg.switchBox(t('parse.header'), opts.header, function (v) { opts.header = v; paint(); });
      var inferSwitch = dlg.switchBox(t('parse.infer'), opts.infer, function (v) { opts.infer = v; paint(); });
      var naInput = dlg.textInput(opts.na, function (v) { opts.na = v; paint(); });
      formHost.appendChild(h('div.parse-row', [dlg.field(t('parse.delimiter'), delimSel)]));
      formHost.appendChild(h('div.parse-row.parse-row-switches', [headerSwitch, inferSwitch]));
      formHost.appendChild(dlg.field(t('parse.na'), naInput, { hint: t('parse.na.hint') }));
      var frame = null, err = null;
      try {
        frame = IO.frameFromText(text, buildOptions());
      } catch (e) { err = e.message; }
      U.clear(previewHost);
      if (err || !frame) {
        infoLine.textContent = t('parse.error');
        infoLine.className = 'parse-info is-error';
        return;
      }
      infoLine.className = 'parse-info';
      infoLine.textContent = t('src.loaded_note', { rows: U.fmtInt(frame.nrows), cols: frame.ncols }) +
        ' · ' + t('parse.preview.rows', { n: 5 });
      var table = h('table.mini-table');
      var head = h('tr');
      head.appendChild(h('th', { text: '#' }));
      frame.names.slice(0, 10).forEach(function (nm) { head.appendChild(h('th', { text: nm })); });
      table.appendChild(h('thead', head));
      var tbody = h('tbody');
      frame.rows(0, 5).forEach(function (row, i) {
        var tr = h('tr');
        tr.appendChild(h('td.mini-index', { text: String(i) }));
        row.slice(0, 10).forEach(function (v) {
          tr.appendChild(h('td', { text: U.fmtValue(v, { maxFrac: 3 }), class: U.isNA(v) ? 'is-na' : '' }));
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      previewHost.appendChild(table);
    }
    paint();
    return dlg.dialog({
      title: t('parse.title') + (filename ? ' · ' + filename : ''),
      body: body,
      wide: true,
      actions: [
        { label: t('misc.cancel'), value: null },
        { label: t('parse.confirm'), value: 'ok', primary: true }
      ]
    }).then(function (res) {
      if (res !== 'ok') return null;
      var o = buildOptions();
      if (!opts.infer) o.infer = false;
      return loadText(text, o);
    });
  }

  /* --------------------------- paste / url ------------------------------ */
  function openPasteDialog() {
    var ta = h('textarea.textarea.textarea-mono', { rows: 10, placeholder: t('parse.paste.ph') });
    return dlg.dialog({
      title: t('src.paste'),
      body: ta,
      wide: true,
      actions: [
        { label: t('misc.cancel'), value: null },
        { label: t('parse.confirm'), value: 'ok', primary: true }
      ],
      onMount: function (card) {
        setTimeout(function () { ta.focus(); }, 30);
      }
    }).then(function (res) {
      if (res !== 'ok' || !ta.value.trim()) return null;
      return openParseDialog(ta.value, 'pasted_data.csv');
    });
  }

  function openUrlDialog() {
    return dlg.prompt({
      title: t('src.url'),
      label: t('src.url'),
      placeholder: t('parse.url.ph')
    }).then(function (url) {
      if (!url) return null;
      A.setStatus(t('err.busy'));
      return IO.frameFromURL(url).then(function (frame) {
        A.setStatus('');
        var name = url.split('/').pop().split('?')[0] || 'remote_data';
        A.addDataset(frame, {
          name: name.replace(/\.[^.]+$/, ''),
          nameZh: name, nameEn: name,
          source: { kind: 'url', url: url, name: name }
        });
      }).catch(function () {
        A.setStatus('');
        PV.ui.toast(t('err.url'), { icon: 'warning', type: 'warn', duration: 5000 });
      });
    });
  }

  /* ---------------------------- generator ------------------------------- */
  function openGenerateDialog() {
    var opts = { rows: 800, cols: 8, seed: '42', nullPct: 0.04, pattern: 'random', name: 'random_data' };
    var check = h('div.parse-info');
    function update() {
      U.clear(check);
      check.appendChild(h('span', { text: t('gen.note') }));
    }
    var body = h('div.gen-form', [
      dlg.field(t('gen.name'), dlg.textInput(opts.name, function (v) { opts.name = v; })),
      h('div.gen-row', [
        dlg.field(t('gen.rows'), dlg.textInput(opts.rows, function (v) { opts.rows = Number(v) || 100; }, { type: 'number', min: 1, step: 10 })),
        dlg.field(t('gen.cols'), dlg.textInput(opts.cols, function (v) { opts.cols = Number(v) || 4; }, { type: 'number', min: 2, max: 40, step: 1 }))
      ]),
      h('div.gen-row', [
        dlg.field(t('gen.seed'), dlg.textInput(opts.seed, function (v) { opts.seed = v; })),
        dlg.field(t('gen.null_pct'), dlg.textInput(String(opts.nullPct), function (v) { opts.nullPct = Number(v) || 0; }, { type: 'number', min: 0, max: 0.6, step: 0.01 }))
      ]),
      dlg.field(t('gen.pattern'), dlg.select([
        { value: 'random', label: t('gen.pattern.random') },
        { value: 'trend', label: t('gen.pattern.trend') },
        { value: 'clusters', label: t('gen.pattern.clusters') },
        { value: 'relation', label: t('gen.pattern.relation') }
      ], opts.pattern, function (v) { opts.pattern = v; })),
      check
    ]);
    update();
    return dlg.dialog({
      title: t('src.generate'),
      body: body,
      actions: [
        { label: t('misc.cancel'), value: null },
        { label: t('gen.create'), value: 'ok', primary: true }
      ]
    }).then(function (res) {
      if (res !== 'ok') return null;
      var frame = PV.datasets.generate(opts);
      return A.addDataset(frame, {
        name: opts.name, nameZh: opts.name, nameEn: opts.name, pyName: opts.name,
        source: { kind: 'generated', seed: opts.seed, rows: frame.nrows }
      });
    });
  }

  /* ---------------------------- panel ----------------------------------- */
  function datasetRow(ds) {
    var isActive = ds.id === S.activeId;
    var menuBtn = ui.iconButton('chevronDown', {
      tip: t('misc.more'),
      class: 'ds-more',
      onClick: function (ev) {
        ev.stopPropagation();
        ui.menu(menuBtn, [
          { label: t('src.rename'), icon: 'edit', onSelect: function () { renameDataset(ds); } },
          { label: t('src.detail'), icon: 'info', onSelect: function () { showDetails(ds); } },
          { label: t('table.export_csv'), icon: 'download', onSelect: function () { exportFrame(ds.df, ds.name + '.csv'); } },
          { separator: true },
          { label: t('src.remove'), icon: 'trash', danger: true, onSelect: function () { confirmRemoveDataset(ds); } }
        ], { align: 'right' });
      }
    });
    // A visible delete button: the action existed only inside the chevron menu,
    // which made it look like the feature was missing.
    var delBtn = ui.iconButton('trash', {
      tip: t('src.remove'),
      class: 'ds-del',
      onClick: function (ev) { ev.stopPropagation(); confirmRemoveDataset(ds); }
    });
    return h('div.ds-row' + (isActive ? '.is-active' : ''), {
      title: A.datasetLabel(ds),
      on: { click: function () { A.setActive(ds.id); } }
    }, [
      ui.icon('database'),
      h('div.ds-main', [
        h('div.ds-name', { text: A.datasetLabel(ds) }),
        h('div.ds-meta', {
          text: U.fmtInt(ds.df.nrows) + ' × ' + ds.df.ncols + ' · ' + ds.df.names.length + ' ' + t('misc.cols_unit')
        })
      ]),
      ds.id === S.activeId ? h('span.ds-active-dot', { text: '' }) : null,
      h('div.ds-tools', [delBtn, menuBtn])
    ]);
  }

  /** Removing a table throws away its rows and its pipeline: ask first, then
   * offer an undo (the history snapshot keeps the frame, so it comes back). */
  function confirmRemoveDataset(ds) {
    dlg.confirm(t('src.remove.confirm', { name: A.datasetLabel(ds), n: U.fmtInt(ds.df.nrows) }), {
      danger: true, confirmLabel: t('src.remove')
    }).then(function (ok) {
      if (!ok) return;
      A.removeDataset(ds.id);
      PV.ui.toast(t('toast.dataset_removed', { name: A.datasetLabel(ds) }), {
        icon: 'trash', duration: 5200,
        action: { label: t('toast.undo_action'), onClick: function () { A.undo(); } }
      });
    });
  }

  function renameDataset(ds) {
    dlg.prompt({ title: t('src.rename'), label: t('gen.name'), value: A.datasetLabel(ds) })
      .then(function (name) {
        if (!name) return;
        if (S.lang === 'zh') ds.nameZh = name; else ds.nameEn = name;
        ds.name = name;
        A.emit();
      });
  }

  function exportFrame(df, filename) {
    U.download(filename, IO.toCSVFrame(df), 'text/csv;charset=utf-8');
    PV.ui.toast(t('toast.exported', { name: filename }), { icon: 'download' });
  }

  function showDetails(ds) {
    var info = ds.df.info();
    var table = h('table.mini-table');
    var head = h('tr');
    [t('profile.col'), t('profile.non_null'), t('profile.na_pct'), t('profile.unique_n')]
      .forEach(function (x) { head.appendChild(h('th', { text: x })); });
    table.appendChild(h('thead', head));
    var body = h('tbody');
    info.forEach(function (c) {
      var tr = h('tr');
      tr.appendChild(h('td', { text: c.name + '  ' + c.dtype }));
      tr.appendChild(h('td.num', { text: U.fmtInt(c.nonNull) }));
      tr.appendChild(h('td.num', { text: U.fmtPercent(c.missing / Math.max(1, ds.df.nrows), 1) }));
      tr.appendChild(h('td.num', { text: U.fmtInt(c.unique) }));
      body.appendChild(tr);
    });
    table.appendChild(body);
    dlg.dialog({
      title: t('src.detail') + ' · ' + A.datasetLabel(ds),
      body: h('div.table-scroll', table),
      wide: true,
      actions: [{ label: t('misc.close'), value: 'ok', primary: true }]
    });
  }

  function renderSourcePanel(host) {
    U.clear(host);
    var box = h('div.panel.panel-source');
    var addBtn = ui.button({
      icon: 'plus', label: t('src.add'), caret: true, size: 'sm', variant: 'primary',
      onClick: function () { ui.menu(addBtn, loadMenuItems(), { align: 'right' }); }
    });
    box.appendChild(ui.panelHead(t('src.panel'), [addBtn], { icon: 'database' }));
    var list = h('div.ds-list');
    if (!S.datasets.length) {
      list.appendChild(ui.emptyState(t('app.no_dataset'), t('src.load_hint')));
    } else {
      S.datasets.forEach(function (ds) { list.appendChild(datasetRow(ds)); });
    }
    box.appendChild(h('div.panel-body', [list]));
    host.appendChild(box);
  }

  /** Everything that loads data lives behind one menu. */
  function loadMenuItems() {
    var loaded = S.datasets.map(function (d) { return d.id; });
    var items = [
      { label: t('src.upload'), icon: 'upload', hint: 'CSV · JSON · XLSX', onSelect: openPicker },
      { label: t('src.paste'), icon: 'clipboard', onSelect: openPasteDialog },
      { label: t('src.url'), icon: 'link', onSelect: openUrlDialog },
      { label: t('src.generate'), icon: 'wand', onSelect: openGenerateDialog },
      { separator: true }
    ];
    var samples = PV.datasets.SAMPLES.filter(function (spec) { return loaded.indexOf(spec.id) < 0; });
    samples.forEach(function (spec) {
      items.push({
        label: (S.lang === 'zh' ? spec.name.zh : spec.name.en),
        icon: 'table',
        onSelect: function () { A.loadSample(spec.id); }
      });
    });
    if (samples.length) items.push({ separator: true });
    items.push({
      label: t('src.reload'), icon: 'refresh',
      onSelect: function () { A.loadSample(PV.datasets.defaultId); }
    });
    return items;
  }

  PV.sourcePanel = {
    renderSourcePanel: renderSourcePanel,
    openPicker: openPicker,
    openFile: openFile,
    openPasteDialog: openPasteDialog,
    openUrlDialog: openUrlDialog,
    openGenerateDialog: openGenerateDialog,
    exportFrame: exportFrame,
    loadText: loadText
  };
})(typeof window !== 'undefined' ? window : globalThis);
