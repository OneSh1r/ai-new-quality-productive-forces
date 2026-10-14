/* =============================================================================
 * Visual Pandas — views-combine.js
 * Joining two tables and appending rows, with a match report so it is obvious
 * what a join will do before it is added to the pipeline.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, h = U.h, ui = PV.ui;
  var A = PV.app, ST = A.state;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  function others() { return ST.datasets.filter(function (d) { return d.id !== ST.activeId; }); }

  function needSecondPanel() {
    var box = h('section.panel');
    box.appendChild(ui.panelHead(t('combine.merge.title'), [], { icon: 'merge' }));
    var body = h('div.panel-body');
    body.appendChild(ui.emptyState(t('combine.need_second'), t('combine.need_second.hint'),
      ui.button({
        label: t('src.samples'), icon: 'database',
        onClick: function () { A.loadSample('employees'); }
      })));
    box.appendChild(body);
    return box;
  }

  function matchReport(frame) {
    if (!frame || !frame.matchReport) return null;
    var r = frame.matchReport;
    var total = Math.max(1, r.both + r.leftOnly + r.rightOnly);
    var wrap = h('div.match-report');
    wrap.appendChild(h('div.match-title', { text: t('combine.stats') }));
    [
      [t('combine.both'), r.both, 'ok'],
      [t('combine.left_only'), r.leftOnly, 'warn'],
      [t('combine.right_only'), r.rightOnly, 'info']
    ].forEach(function (pair) {
      wrap.appendChild(h('div.match-row', [
        h('span.match-label', { text: pair[0] }),
        h('span.match-track', [h('span.match-fill.match-' + pair[2], {
          style: { width: (pair[1] / total * 100) + '%' }
        })]),
        h('span.match-count', { text: U.fmtInt(pair[1]) })
      ]));
    });
    wrap.appendChild(h('div.sub-hint', {
      text: t('combine.row_estimate', { n: U.fmtInt(frame.nrows) }) + ' · ' +
        t('combine.col_estimate', { n: frame.ncols })
    }));
    return wrap;
  }

  function mergePanel(df) {
    var def = PV.ops.BY_ID.merge;
    var params = ST.merge;
    var box = h('section.panel');
    box.appendChild(ui.panelHead(t('combine.merge.title'), [], { icon: 'merge' }));
    var body = h('div.panel-body');
    body.appendChild(h('div.sub-hint', { text: t('combine.merge.hint') }));
    var grid = h('div.builder-grid');
    var formHost = h('div.builder-form');
    var previewHost = h('div.builder-preview');
    grid.appendChild(formHost);
    grid.appendChild(previewHost);
    body.appendChild(grid);
    box.appendChild(body);
    var info = PV.forms.renderForm(formHost, {
      def: def, params: params, ctx: A.ctx(), previewHost: previewHost
    });
    if (info && info.ok) previewHost.insertBefore(matchReport(info.df), previewHost.firstChild);
    var foot = h('div.panel-foot');
    foot.appendChild(ui.button({
      label: t('combine.apply'), icon: 'plus', variant: 'primary',
      onClick: function () {
        var check = PV.forms.previewFor(def, params, A.ctx());
        if (!check.ok) {
          PV.ui.toast(check.error || t('err.title'), { icon: 'warning', type: 'warn' });
          return;
        }
        A.addStep('merge', U.deepClone(params));
      }
    }));
    box.appendChild(foot);
    return box;
  }

  function concatPanel() {
    var def = PV.ops.BY_ID.concat;
    var params = { other: others()[0] ? others()[0].id : '' };
    var box = h('section.panel');
    box.appendChild(ui.panelHead(t('combine.concat.title'), [], { icon: 'concat' }));
    var body = h('div.panel-body');
    body.appendChild(h('div.sub-hint', { text: t('combine.concat.hint') }));
    var grid = h('div.builder-grid');
    var formHost = h('div.builder-form');
    var previewHost = h('div.builder-preview');
    grid.appendChild(formHost);
    grid.appendChild(previewHost);
    body.appendChild(grid);
    box.appendChild(body);
    PV.forms.renderForm(formHost, { def: def, params: params, ctx: A.ctx(), previewHost: previewHost });
    var foot = h('div.panel-foot');
    foot.appendChild(ui.button({
      label: t('combine.concat.apply'), icon: 'plus', variant: 'primary',
      onClick: function () {
        var check = PV.forms.previewFor(def, params, A.ctx());
        if (!check.ok) {
          PV.ui.toast(check.error || t('err.title'), { icon: 'warning', type: 'warn' });
          return;
        }
        A.addStep('concat', U.deepClone(params));
      }
    }));
    box.appendChild(foot);
    return box;
  }

  function rolesPanel() {
    var box = h('section.panel');
    box.appendChild(ui.panelHead(t('combine.roles'), [], { icon: 'info' }));
    var body = h('div.panel-body');
    var list = h('div.ds-list');
    ST.datasets.forEach(function (d) {
      list.appendChild(h('div.ds-row' + (d.id === ST.activeId ? '.is-active' : ''), [
        ui.icon('table'),
        h('div.ds-main', [
          h('div.ds-name', { text: A.datasetLabel(d) }),
          h('div.ds-meta', { text: U.fmtInt(d.df.nrows) + ' × ' + d.df.ncols + ' · ' + d.pyName })
        ])
      ]));
    });
    body.appendChild(list);
    box.appendChild(body);
    return box;
  }

  function renderCombineView(host) {
    U.clear(host);
    var df = A.result().df;
    if (!df) { host.appendChild(ui.emptyState(t('app.no_dataset'), null)); return; }
    if (!ST.merge.other || !others().some(function (d) { return d.id === ST.merge.other; })) {
      ST.merge.other = others().length ? others()[0].id : '';
    }
    if (!others().length) {
      host.appendChild(needSecondPanel());
      host.appendChild(rolesPanel());
      return;
    }
    host.appendChild(mergePanel(df));
    host.appendChild(concatPanel());
    host.appendChild(rolesPanel());
  }

  PV.viewsCombine = { render: renderCombineView };
})(typeof window !== 'undefined' ? window : globalThis);
