/* =============================================================================
 * Visual Pandas — app-pipeline.js
 * Pipeline mutations (add / edit / remove / reorder / disable), click-to-filter
 * helpers and small UI state setters.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util;
  var A = PV.app, S = A.state;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  function addStep(type, params, opts) {
    var def = PV.ops.BY_ID[type];
    if (!def) return null;
    var ds = A.active();
    if (!ds) return null;
    A.pushHistory(t('op.' + type));
    var step = {
      id: U.uid('step'), type: type, enabled: true,
      params: params || PV.ops.defaults(type, A.result().df, A.ctx())
    };
    if (opts && opts.at === 'start') A.steps().unshift(step);
    else A.steps().push(step);
    A.invalidate();
    A.emit();
    PV.ui.toast(t('toast.applied', { name: t('op.' + type) }), {
      icon: def.icon,
      action: { label: t('table.view_result'), onClick: function () { A.setTab(tabForStep(type)); } }
    });
    return step;
  }

  /** Which tab shows the result of a step best. */
  function tabForStep(type) {
    if (['groupby', 'pivot', 'crosstab', 'rolling', 'resample'].indexOf(type) >= 0) return 'group';
    if (['merge', 'concat'].indexOf(type) >= 0) return 'combine';
    return 'table';
  }

  function updateStep(index, params) {
    var list = A.steps();
    if (!list[index]) return;
    A.pushHistory(t('misc.edit') + ' ' + t('op.' + list[index].type));
    list[index].params = params;
    A.invalidate();
    A.emit();
  }

  function removeStep(index) {
    var list = A.steps();
    if (!list[index]) return;
    A.pushHistory(t('misc.delete') + ' ' + t('op.' + list[index].type));
    list.splice(index, 1);
    A.invalidate();
    A.emit();
    PV.ui.toast(t('toast.step_removed'), { icon: 'trash' });
  }

  function toggleStep(index) {
    var list = A.steps();
    if (!list[index]) return;
    A.pushHistory((list[index].enabled === false ? t('misc.enable') : t('misc.disable')) +
      ' ' + t('op.' + list[index].type));
    list[index].enabled = list[index].enabled === false;
    A.invalidate();
    A.emit();
  }

  function moveStep(index, dir) {
    var list = A.steps();
    var to = index + dir;
    if (to < 0 || to >= list.length) return;
    A.pushHistory(t('misc.move') + ' ' + t('op.' + list[index].type));
    list.splice(to, 0, list.splice(index, 1)[0]);
    A.invalidate();
    A.emit();
  }

  function clearSteps() {
    if (!A.steps().length) return;
    PV.dialog.confirm(t('pipe.clear.confirm', { n: A.steps().length }), {
      danger: true, confirmLabel: t('pipe.clear')
    }).then(function (ok) {
      if (!ok) return;
      A.pushHistory(t('pipe.clear'));
      S.pipelines[S.activeId] = [];
      A.invalidate();
      A.emit();
      PV.ui.toast(t('toast.cleared'), { icon: 'reset' });
    });
  }

  function filterByValue(field, value, exclude) {
    if (!field || value === undefined || value === null) return;
    var ds = A.active();
    var dtype = ds && ds.df.has(field) ? ds.df.dtype(field) : 'object';
    var strValue = (value instanceof Date)
      ? (dtype === 'datetime64[ns]' ? U.fmtDate(value, 'YYYY-MM-DD') : U.fmtDateTime(value))
      : String(value);
    addStep('filter', {
      mode: 'visual', match: 'all',
      conds: [{ col: field, op: exclude ? 'ne' : 'eq', value: strValue, value2: '' }]
    });
    var after = A.result().df.nrows;
    var desc = field + (exclude ? ' ≠ ' : ' = ') + strValue;
    PV.ui.toast(t('charts.filter_added', { desc: desc }) + ' · ' +
      t('toast.rows_after', { n: U.fmtInt(after) }), {
      icon: 'filter', duration: 5400,
      action: { label: t('toast.undo_action'), onClick: function () { A.undo(); } }
    });
  }

  function filterByRange(field, lo, hi) {
    if (!field) return;
    addStep('filter', {
      mode: 'visual', match: 'all',
      conds: [{ col: field, op: 'between', value: String(lo), value2: String(hi) }]
    });
    PV.ui.toast(t('charts.brush_applied', {
      a: U.fmtNumber(lo, { maxFrac: 2 }), b: U.fmtNumber(hi, { maxFrac: 2 })
    }), { icon: 'filter', duration: 5400, action: { label: t('toast.undo_action'), onClick: function () { A.undo(); } } });
  }

  function openOpForm(opId, params, editIndex) {
    var df = A.result().df;
    if (!df) {
      PV.ui.toast(t('err.no_dataset'), { icon: 'warning', type: 'warn' });
      return;
    }
    S.sidebar = {
      mode: 'form', opId: opId,
      editIndex: (editIndex === undefined || editIndex === null) ? null : editIndex,
      params: params || PV.ops.defaults(opId, df, A.ctx())
    };
    A.emit();
  }

  function closeOpForm() {
    S.sidebar = { mode: 'browse', opId: null, editIndex: null, params: null };
    A.emit();
  }

  function setTab(name) {
    if (S.tab === name) return;
    S.tab = name;
    try {
      if (root.history && root.history.replaceState) {
        root.history.replaceState(null, '', '#' + name);
      }
    } catch (e) { /* file:// may refuse: harmless */ }
    A.emit();
  }

  function setInspector(kind, payload) {
    S.inspector = { kind: kind, payload: payload };
    // focusing a column is the app's main linkage: every view can follow it
    if (kind === 'column' && payload && payload.col) S.focus.col = payload.col;
    A.emit();
  }

  function setStatus(msg) {
    S.status = msg || '';
    var el = document.getElementById('status-text');
    if (el) el.textContent = S.status;
  }

  /**
   * The value a mark filters on. A mark carries two numbers — the category it
   * stands for (info.cat) and the measure it was drawn with (info.value, e.g.
   * a sum, a median or a count). Only the category identifies a row, so a
   * click always filters on that.
   */
  function markValue(info) {
    if (!info) return undefined;
    return info.cat === undefined ? info.value : info.cat;
  }

  function markClick(info) {
    if (!info) return;
    if (info.kind === 'other') return;
    if (info.kind === 'range') return filterByRange(info.field, info.range[0], info.range[1]);
    if (info.kind === 'region2d') return filterByRegion(info);
    if (info.kind === 'corr') return; // handled by the profile view
    if (info.kind === 'point') {
      setInspector('point', info);
      return;
    }
    var value = markValue(info);
    if (value === undefined) return;
    filterByValue(info.field, value, false);
  }

  /** A 2D density cell: filter both axes to that rectangle in one step. */
  function filterByRegion(info) {
    if (!info.range || !info.range2) return;
    addStep('filter', {
      mode: 'visual', match: 'all',
      conds: [
        { col: info.field, op: 'between', value: String(info.range[0]), value2: String(info.range[1]) },
        { col: info.field2, op: 'between', value: String(info.range2[0]), value2: String(info.range2[1]) }
      ]
    });
    PV.ui.toast(t('charts.filter_added', { desc: info.label }) + ' · ' +
      t('toast.rows_after', { n: U.fmtInt(A.result().df.nrows) }), {
      icon: 'filter', duration: 5600,
      action: { label: t('toast.undo_action'), onClick: function () { A.undo(); } }
    });
  }

  function markContext(info, ev) {
    var highlight = markValue(info);
    if (!info || info.kind === 'corr' || info.kind === 'other') return;
    // A bin or a density rectangle stands for a range, not a value: the only
    // useful actions there are the range filter and the column profile.
    if (info.kind === 'range' || info.kind === 'region2d') {
      PV.ui.menu(ev.target, [
        { label: t('charts.only') + ': ' + info.label, icon: 'filter', onSelect: function () { markClick(info); } },
        { separator: true }
      ].concat(profileItem(info.field)));
      return;
    }
    if (highlight === undefined) return;
    PV.ui.menu(ev.target, [
      { label: t('charts.only'), icon: 'filter', onSelect: function () { filterByValue(info.field, highlight, false); } },
      { label: t('charts.exclude'), icon: 'close', onSelect: function () { filterByValue(info.field, highlight, true); } },
      { separator: true }
    ].concat(profileItem(info.field)));
  }

  /** "Profile this column" is offered wherever a mark names a column. */
  function profileItem(field) {
    if (!field || field === '__corr__') return [];
    return [{
      label: t('ins.column_profile') + ': ' + field, icon: 'profile',
      onSelect: function () {
        S.profile.col = field;
        setTab('profile');
        setInspector('column', { col: field });
      }
    }];
  }

  Object.assign(A, {
    addStep: addStep,
    updateStep: updateStep,
    removeStep: removeStep,
    toggleStep: toggleStep,
    moveStep: moveStep,
    clearSteps: clearSteps,
    filterByValue: filterByValue,
    filterByRange: filterByRange,
    openOpForm: openOpForm,
    closeOpForm: closeOpForm,
    setTab: setTab,
    setInspector: setInspector,
    setStatus: setStatus,
    markClick: markClick,
    markContext: markContext,
    filterByRegion: filterByRegion,
    tabForStep: tabForStep
  });
})(typeof window !== 'undefined' ? window : globalThis);
