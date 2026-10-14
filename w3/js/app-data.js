/* =============================================================================
 * Visual Pandas — app-data.js
 * Loading, switching, removing datasets and rebuilding the derived view state.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util;
  var A = PV.app, S = A.state;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  function uniqueId(base) {
    var id = PV.ops.sanitize(base, 'data');
    var n = 2;
    while (S.datasets.some(function (d) { return d.id === id; })) id = PV.ops.sanitize(base, 'data') + '_' + (n++);
    return id;
  }

  function addDataset(frame, meta) {
    meta = meta || {};
    // the very first table of a session is the starting point, not an edit
    if (S.datasets.length) A.pushHistory(t('src.add') + ' ' + (meta.nameZh || meta.name || ''));
    var id = uniqueId(meta.slug || meta.name || 'data');
    var ds = {
      id: id,
      name: meta.name || id,
      nameZh: meta.nameZh || meta.name || id,
      nameEn: meta.nameEn || meta.name || id,
      pyName: PV.ops.sanitize(meta.pyName || meta.name || id, 'data'),
      df: frame,
      source: meta.source || { kind: 'custom' },
      addedAt: new Date(),
      rev: 1
    };
    S.datasets.push(ds);
    S.pipelines[ds.id] = [];
    S.activeId = ds.id;
    A.invalidate();
    resetViewState(ds);
    A.emit();
    PV.ui.toast(t('toast.dataset_added', {
      name: A.datasetLabel(ds), rows: U.fmtInt(frame.nrows), cols: frame.ncols
    }), { icon: 'database' });
    return ds;
  }

  function loadSample(id) {
    var spec = PV.datasets.byId(id);
    if (!spec) return null;
    var frame = PV.datasets.build(id);
    return addDataset(frame, {
      slug: id,
      name: spec.id,
      nameZh: spec.name.zh,
      nameEn: spec.name.en,
      pyName: id,
      source: { kind: 'sample', name: spec.name.en, file: id + '.csv' }
    });
  }

  function removeDataset(id) {
    var ds = S.datasets.filter(function (d) { return d.id === id; })[0];
    if (!ds) return;
    A.pushHistory(t('src.remove') + ' ' + A.datasetLabel(ds));
    S.datasets = S.datasets.filter(function (d) { return d.id !== id; });
    delete S.pipelines[id];
    var stillThere = S.datasets.some(function (d) { return d.id === S.activeId; });
    if (!stillThere) {
      S.activeId = S.datasets.length ? S.datasets[0].id : null;
      resetViewState(A.active());
    }
    A.invalidate();
    A.emit();
  }

  function setActive(id) {
    var ok = S.datasets.some(function (d) { return d.id === id; });
    if (!ok || id === S.activeId) return;
    S.activeId = id;
    A.invalidate();
    resetViewState(A.active());
    A.emit();
  }

  /** Re-derive chart / group / merge defaults for the newly active dataset. */
  function resetViewState(ds) {
    S.inspector = { kind: 'none', payload: null };
    S.table.selectedRow = null;
    S.table.selectedCol = null;
    S.table.search = '';
    S.table.hidden = {};
    if (!ds) return;
    var df = ds.df;
    var numeric = df.numericColumns();
    var cats = df.categoricalColumns();
    var dates = df.dateColumns();
    var main = PV.df.primaryNumericColumn(df);
    var spec = Object.assign({}, A.defaultChart);
    if (dates.length && numeric.length) {
      spec.type = 'line'; spec.x = dates[0]; spec.y = [main]; spec.agg = 'sum';
      spec.sort = 'none'; spec.limit = 0; spec.smooth = true;
    } else if (cats.length && numeric.length) {
      spec.type = 'bar'; spec.x = PV.df.preferredCategoryColumn(df); spec.y = [main]; spec.agg = 'sum';
    } else if (cats.length) {
      spec.type = 'count'; spec.x = PV.df.preferredCategoryColumn(df); spec.y = []; spec.limit = 12;
    } else if (numeric.length >= 2) {
      spec.type = 'scatter'; spec.x = numeric[0];
      spec.y = [numeric.filter(function (c) { return c !== numeric[0]; })[0]]; spec.trend = true;
    }
    S.charts.spec = spec;
    S.charts.hidden = {};
    S.profile.col = PV.df.preferredCategoryColumn(df);
    S.profile.pairCols = numeric.slice(0, 3);
    S.profile.bins = null;
    var aggCols = [main].concat(numeric.filter(function (c) { return c !== main; })).slice(0, 2);
    var aggs = aggCols.map(function (c, i) {
      return { col: c, fn: i === 0 ? 'sum' : 'mean', out: '' };
    });
    if (!aggs.length) aggs = [{ col: df.names[0], fn: 'count', out: '' }];
    var prefCat = PV.df.preferredCategoryColumn(df);
    S.group = { keys: [prefCat], aggs: aggs };
    var otherCats = PV.df.categoryColumns(df).filter(function (c) { return c !== prefCat; });
    S.pivot = {
      index: prefCat,
      columns: otherCats[0] || df.names[1] || df.names[0],
      values: main || df.names[0],
      aggfunc: 'sum', margins: true, fillValue: '0'
    };
    var other = S.datasets.filter(function (d) { return d.id !== ds.id; })[0];
    var common = other ? df.names.filter(function (n) { return other.df.has(n); }) : [];
    S.merge = {
      other: other ? other.id : '', how: 'left',
      leftOn: common.slice(0, 1), rightOn: common.slice(0, 1),
      suffixes: '_x, _y', indicator: true
    };
  }

  function resultToDataset() {
    var res = A.result();
    if (!res.df) return null;
    var src = A.active();
    return addDataset(res.df.copy(), {
      name: src.name + '_result',
      nameZh: src.nameZh + ' +',
      nameEn: src.nameEn + ' +',
      pyName: src.pyName + '_result',
      source: { kind: 'derived' }
    });
  }

  Object.assign(A, {
    addDataset: addDataset,
    loadSample: loadSample,
    removeDataset: removeDataset,
    setActive: setActive,
    resetViewState: resetViewState,
    resultToDataset: resultToDataset
  });
})(typeof window !== 'undefined' ? window : globalThis);
