/* =============================================================================
 * Visual Pandas — app-state.js
 * Application state, undo history, dataset management and derived results.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  var DEFAULT_CHART = {
    type: 'bar', x: null, y: [], color: null, size: null, agg: 'sum',
    sort: 'value_desc', limit: 12, stacked: false, horizontal: false,
    labels: false, smooth: false, trend: false, bins: null, corrMethod: 'pearson'
  };

  var state = {
    lang: 'zh',
    theme: 'light',
    datasets: [],
    activeId: null,
    pipelines: {},
    tab: 'table',
    sidebar: { mode: 'browse', opId: null, editIndex: null, params: null },
    stepsRev: 0,
    table: { search: '', density: 'normal', heat: false, hidden: {}, selectedRow: null, selectedCol: null },
    collapsed: { columns: true },
    focus: { col: null },
    opsExpanded: false,
    chartAdvanced: false,
    insertAt: 'end',
    expandedSteps: {},
    profile: { col: null, corrMethod: 'pearson', bins: null, pairCols: [], topN: 8 },
    charts: { spec: Object.assign({}, DEFAULT_CHART), hidden: {} },
    group: { keys: [], aggs: [] },
    pivot: { index: '', columns: '', values: '', aggfunc: 'sum', margins: true, fillValue: '0' },
    merge: { other: '', how: 'left', leftOn: [], rightOn: [], suffixes: '_x, _y', indicator: true },
    code: { withLoader: true, varName: 'df' },
    inspector: { kind: 'none', payload: null },
    status: ''
  };

  var history = [];
  var future = [];
  var cache = null;
  var listeners = [];

  function active() {
    return state.datasets.filter(function (d) { return d.id === state.activeId; })[0] || null;
  }

  function datasetLabel(d) {
    if (!d) return '';
    return state.lang === 'zh' ? (d.nameZh || d.name) : (d.nameEn || d.name);
  }

  function stepsOf(id) {
    id = id || state.activeId;
    if (!state.pipelines[id]) state.pipelines[id] = [];
    return state.pipelines[id];
  }

  function steps() { return stepsOf(state.activeId); }

  function ctx() {
    var ds = active();
    return {
      datasets: state.datasets,
      activeId: state.activeId,
      frame: ds ? ds.df : null,
      lang: state.lang
    };
  }

  function result() {
    var ds = active();
    if (!ds) return { df: null, stages: [], ms: 0 };
    var key = ds.id + '|' + ds.rev + '|' + JSON.stringify(steps());
    if (cache && cache.key === key) return cache;
    var out = PV.ops.applyPipeline(ds.df, steps(), ctx());
    cache = { key: key, df: out.df, stages: out.stages, ms: out.ms };
    return cache;
  }

  function invalidate() {
    cache = null;
    state.stepsRev += 1;
  }

  function snapshot() {
    // Datasets are kept by reference: a DataFrame is never mutated in place
    // (every operation returns a new frame), so a shallow copy is both enough
    // and cheap — and it means removing a dataset can be undone.
    return {
      activeId: state.activeId,
      datasets: state.datasets.slice(),
      pipelines: JSON.parse(JSON.stringify(state.pipelines))
    };
  }

  /** `label` names the action that is about to happen; it is what an undo
   * reports back, so the toast can say *what* was undone. */
  function pushHistory(label) {
    history.push({ snap: snapshot(), label: label || '' });
    if (history.length > 60) history.shift();
    future.length = 0;
  }

  function applySnapshot(snap) {
    state.datasets = (snap.datasets || state.datasets).slice();
    state.pipelines = JSON.parse(JSON.stringify(snap.pipelines));
    // a restored dataset list may not know about pipelines keyed by id
    Object.keys(state.pipelines).forEach(function (id) {
      if (!state.datasets.some(function (d) { return d.id === id; })) delete state.pipelines[id];
    });
    var exists = state.datasets.some(function (d) { return d.id === snap.activeId; });
    var next = exists ? snap.activeId : (state.datasets[0] ? state.datasets[0].id : null);
    var switched = next !== state.activeId;
    state.activeId = next;
    // a different table means different columns: re-derive the chart / group /
    // merge defaults so nothing points at a column that no longer exists
    if (switched && PV.app.resetViewState) PV.app.resetViewState(active());
    invalidate();
  }

  function undo() {
    if (!history.length) {
      PV.ui.toast(t('misc.not_available'), { icon: 'info' });
      return false;
    }
    var entry = history.pop();
    future.push({ snap: snapshot(), label: entry.label });
    applySnapshot(entry.snap);
    emit();
    PV.ui.toast(entry.label ? t('toast.undone', { name: entry.label }) : t('toast.undo'),
      { icon: 'reset' });
    return true;
  }

  function redo() {
    if (!future.length) {
      PV.ui.toast(t('misc.not_available'), { icon: 'info' });
      return false;
    }
    var entry = future.pop();
    history.push({ snap: snapshot(), label: entry.label });
    applySnapshot(entry.snap);
    emit();
    PV.ui.toast(entry.label ? t('toast.redone', { name: entry.label }) : t('toast.redo'),
      { icon: 'reset' });
    return true;
  }

  function on(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (fn) { fn(); }); }
  function refresh() { invalidate(); emit(); }

  /** Forget the undo history: a brand new workspace or a freshly loaded
   * session should not be undoable back into the previous one. */
  function resetHistory() {
    history.length = 0;
    future.length = 0;
  }

  /**
   * Tiny DOM memo: panels that only depend on a signature are built once and
   * re-attached afterwards, so unrelated updates stay cheap. Keys must cover
   * everything the panel reads.
   */
  var memoCache = {};
  function memo(key, build) {
    if (memoCache[key]) return memoCache[key];
    var node = build();
    if (Object.keys(memoCache).length > 48) memoCache = {};
    memoCache[key] = node;
    return node;
  }

  function clearMemo() { memoCache = {}; }

  PV.app = {
    state: state,
    defaultChart: DEFAULT_CHART,
    active: active,
    datasetLabel: datasetLabel,
    stepsOf: stepsOf,
    steps: steps,
    ctx: ctx,
    result: result,
    invalidate: invalidate,
    snapshot: snapshot,
    pushHistory: pushHistory,
    applySnapshot: applySnapshot,
    undo: undo,
    redo: redo,
    on: on,
    emit: emit,
    refresh: refresh,
    memo: memo,
    clearMemo: clearMemo,
    resetHistory: resetHistory,
    canUndo: function () { return history.length > 0; },
    canRedo: function () { return future.length > 0; },
    /** What the next undo / redo would take back, for tooltips and labels. */
    undoLabel: function () { return history.length ? (history[history.length - 1].label || '') : null; },
    redoLabel: function () { return future.length ? (future[future.length - 1].label || '') : null; },
    undoDepth: function () { return history.length; },
    redoDepth: function () { return future.length; },
    pyNameFor: function (name) { return PV.ops.sanitize(name, 'data'); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
