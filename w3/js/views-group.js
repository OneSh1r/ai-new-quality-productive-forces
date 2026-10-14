/* =============================================================================
 * Visual Pandas — views-group.js
 * Group by, pivot table and crosstab builders. Each one is the same operation
 * form the pipeline uses, plus a preview chart of the result.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, h = U.h, ui = PV.ui;
  var A = PV.app, ST = A.state;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  var local = { crosstab: null, section: 'group' };

  function ensureParams(df) {
    if (!ST.group.keys.length) {
      var cats = df.categoricalColumns();
      var numeric = df.numericColumns();
      ST.group.keys = cats.length ? [cats[0]] : [df.names[0]];
      ST.group.aggs = numeric.slice(0, 2).map(function (c, i) {
        return { col: c, fn: i === 0 ? 'sum' : 'mean', out: '' };
      });
    }
    if (!local.crosstab || !local.crosstab.row || !df.has(local.crosstab.row)) {
      // two *small* categories make a readable table; an id column does not
      var low = PV.df.categoryColumns(df);
      var row = PV.df.preferredCategoryColumn(df);
      local.crosstab = {
        row: row,
        col: low.filter(function (c) { return c !== row; })[0] || df.names[1] || row,
        margins: true
      };
    }
  }

  function sectionTabs() {
    var bar = h('div.section-tabs', { role: 'tablist', 'aria-label': t('group.tab') });
    [['group', t('group.title')], ['pivot', t('group.pivot.title')], ['crosstab', t('group.crosstab.title')]]
      .forEach(function (pair) {
        bar.appendChild(h('button.section-tab' + (local.section === pair[0] ? '.is-on' : ''), {
          type: 'button', text: pair[1],
          id: 'gtab-' + pair[0], role: 'tab',
          'aria-selected': local.section === pair[0] ? 'true' : 'false',
          'aria-controls': 'gpanel-' + pair[0],
          on: {
            click: function () { local.section = pair[0]; A.emit(); }
          }
        }));
      });
    return bar;
  }

  /** A compact chart of any preview frame. */
  function previewChart(host, frame) {
    if (!frame || !frame.nrows) return;
    var numeric = frame.numericColumns();
    var cats = frame.categoricalColumns();
    if (!numeric.length) return;
    var key = cats.length ? cats[0] : frame.names[0];
    var value = numeric[0];
    var holder = h('div.chart-holder');
    host.appendChild(holder);
    PV.charts.render(holder, {
      type: cats.length ? 'bar' : 'line',
      x: key, y: [value], agg: 'sum', sort: 'value_desc',
      limit: cats.length ? 14 : 0, labels: false
    }, frame, {
      width: holder.clientWidth || 520,
      onMark: function (info) { if (info.kind === 'category') A.markClick(info); }
    });
  }

  function builderPanel(title, hint, opId, params, df, extra) {
    var def = PV.ops.BY_ID[opId];
    var box = h('section.panel', {
      id: 'gpanel-' + opId, role: 'tabpanel', 'aria-labelledby': 'gtab-' + opId
    });
    box.appendChild(ui.panelHead(title, [
      ui.iconButton('refresh', {
        tip: t('misc.reset'),
        onClick: function () { resetParams(opId); }
      })
    ], { icon: def.icon }));
    var body = h('div.panel-body');
    if (hint) body.appendChild(h('div.sub-hint', { text: hint }));
    var grid = h('div.builder-grid');
    var formHost = h('div.builder-form');
    var previewHost = h('div.builder-preview');
    grid.appendChild(formHost);
    grid.appendChild(previewHost);
    body.appendChild(grid);
    box.appendChild(body);
    PV.forms.renderForm(formHost, {
      def: def, params: params, ctx: A.ctx(), previewHost: previewHost,
      onChange: function () { if (extra && extra.onChange) extra.onChange(); }
    });
    var foot = h('div.panel-foot');
    foot.appendChild(ui.button({
      label: t('group.apply'), icon: 'plus', variant: 'primary',
      onClick: function () {
        var check = PV.forms.previewFor(def, params, A.ctx());
        if (!check.ok) {
          PV.ui.toast(check.error || t('err.title'), { icon: 'warning', type: 'warn' });
          return;
        }
        A.addStep(opId, U.deepClone(params));
      }
    }));
    box.appendChild(foot);
    if (extra && extra.chart) {
      var chartHost = h('div.group-chart');
      body.appendChild(h('div.sub-title', { text: t('group.chart') }));
      body.appendChild(chartHost);
      previewChart(chartHost, extra.chart);
    }
    return box;
  }

  /** Re-derive parameters from the current result frame (columns may have moved on). */
  function resetParams(opId) {
    var df = A.result().df;
    if (!df) return;
    var fresh = PV.ops.defaults(opId, df, A.ctx());
    if (opId === 'groupby') ST.group = U.deepClone(fresh);
    else if (opId === 'pivot') ST.pivot = U.deepClone(fresh);
    else if (opId === 'merge') ST.merge = U.deepClone(fresh);
    else if (opId === 'crosstab') local.crosstab = U.deepClone(fresh);
    A.emit();
  }

  function renderGroupView(host) {
    U.clear(host);
    var df = A.result().df;
    if (!df) { host.appendChild(ui.emptyState(t('app.no_dataset'), null)); return; }
    ensureParams(df);
    host.appendChild(sectionTabs());
    if (local.section === 'group') {
      var check = PV.forms.previewFor(PV.ops.BY_ID.groupby, ST.group, A.ctx());
      host.appendChild(builderPanel(t('group.title'), t('group.hint'), 'groupby', ST.group, df, {
        chart: check.ok ? check.df : null
      }));
    } else if (local.section === 'pivot') {
      host.appendChild(builderPanel(t('group.pivot.title'), t('group.pivot.hint'), 'pivot', ST.pivot, df));
    } else {
      host.appendChild(builderPanel(t('group.crosstab.title'), t('group.crosstab.hint'), 'crosstab', local.crosstab, df));
    }
  }

  PV.viewsGroup = {
    render: renderGroupView,
    /** The section tabs and the crosstab settings live in this module: they
     * must take part in the view cache signature or switching looks dead. */
    signature: function () {
      return local.section + '|' + JSON.stringify(local.crosstab || {});
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
