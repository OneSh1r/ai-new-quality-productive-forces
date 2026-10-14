/* =============================================================================
 * Visual Pandas — panel-ops.js
 * The operation palette and the parameter panel (with live preview).
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, h = U.h, ui = PV.ui, dlg = PV.dialog;
  var A = PV.app, S = A.state;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  var search = '';

  /**
   * The eight operations that cover most everyday analysis. They are shown
   * with a plain-language line each; everything else lives behind
   * "show all operations" so a first-time user is not faced with 24 buttons.
   */
  var COMMON = [
    { id: 'filter', hint: { zh: '只保留满足条件的行', en: 'Keep only the rows you want' } },
    { id: 'groupby', hint: { zh: '按类别算合计 / 平均', en: 'Totals and averages per group' } },
    { id: 'sort', hint: { zh: '按某一列排序', en: 'Order rows by a column' } },
    { id: 'assign', hint: { zh: '用公式算出一列新的', en: 'Compute a new column' } },
    { id: 'select', hint: { zh: '只保留 / 重排需要的列', en: 'Keep and reorder columns' } },
    { id: 'missing', hint: { zh: '处理空值', en: 'Fill or drop empty cells' } },
    { id: 'dedup', hint: { zh: '去掉重复的行', en: 'Remove duplicate rows' } },
    { id: 'pivot', hint: { zh: '行列交叉汇总', en: 'Cross-tabulate rows and columns' } }
  ];

  function opButton(def) {
    var btn = h('button.op-btn', {
      type: 'button',
      on: {
        click: function () { A.openOpForm(def.id); }
      }
    }, [
      ui.icon(def.icon),
      h('span.op-name', { text: t('op.' + def.id) })
    ]);
    btn.setAttribute('data-tip', t('op.' + def.id + '.desc'));
    return btn;
  }

  function opCard(def, hint) {
    var lang = S.lang;
    var btn = h('button.op-card', {
      type: 'button',
      on: { click: function () { A.openOpForm(def.id); } }
    }, [
      h('span.op-card-icon', [ui.icon(def.icon)]),
      h('span.op-card-main', [
        h('span.op-card-name', { text: t('op.' + def.id) }),
        h('span.op-card-hint', { text: hint ? (hint[lang] || hint.en) : t('op.' + def.id + '.desc') })
      ])
    ]);
    return btn;
  }

  /** The beginner-friendly tier: a short, labelled list. */
  function commonSection() {
    var box = h('div.op-group.op-common');
    box.appendChild(h('div.op-group-title', { text: t('ops.common') }));
    box.appendChild(h('div.op-group-hint', { text: t('ops.common_hint') }));
    COMMON.forEach(function (entry) {
      var def = PV.ops.BY_ID[entry.id];
      if (def) box.appendChild(opCard(def, entry.hint));
    });
    return box;
  }

  function renderOpsPanel(host) {
    var box = h('div.panel.panel-ops');
    var searchBox = h('input.input.input-sm', { type: 'search', placeholder: t('ops.search'), value: search });
    searchBox.addEventListener('input', U.debounce(function () {
      search = searchBox.value.toLowerCase();
      paintList();
    }, 140));
    box.appendChild(ui.panelHead(t('ops.panel'), [ui.iconButton('refresh', {
      tip: t('misc.reset'), onClick: function () { search = ''; searchBox.value = ''; paintList(); }
    })], { icon: 'wand' }));
    var toggle = ui.button({
      icon: S.opsExpanded ? 'chevronUp' : 'chevronDown',
      label: S.opsExpanded ? t('ops.show_less') : t('ops.show_all'),
      size: 'sm', block: true,
      onClick: function () { S.opsExpanded = !S.opsExpanded; A.emit(); }
    });
    var listHost = h('div#ops-list.ops-list');
    box.appendChild(h('div.panel-body', [searchBox, listHost, toggle]));
    host.appendChild(box);
    var list = listHost;
    function paintList() {
      U.clear(list);
      if (!search) list.appendChild(commonSection());
      if (!search && !S.opsExpanded) return;
      if (!search) {
        list.appendChild(h('div.op-group-title.op-all-title', { text: t('ops.all') }));
      }
      PV.ops.GROUPS.forEach(function (group) {
        var defs = PV.ops.REGISTRY.filter(function (d) { return d.group === group; });
        if (search) {
          defs = defs.filter(function (d) {
            return (t('op.' + d.id) + ' ' + d.id + ' ' + t('op.' + d.id + '.desc')).toLowerCase()
              .indexOf(search) >= 0;
          });
        }
        if (!defs.length) return;
        var g = h('div.op-group');
        g.appendChild(h('div.op-group-title', { text: t('ops.group.' + group) }));
        var grid = h('div.op-grid');
        defs.forEach(function (d) { grid.appendChild(opButton(d)); });
        g.appendChild(grid);
        list.appendChild(g);
      });
      if (!list.childNodes.length) list.appendChild(h('div.picker-empty', { text: t('cols.empty') }));
    }
    paintList();
  }

  function renderFormPanel(host) {
    var def = PV.ops.BY_ID[S.sidebar.opId];
    if (!def) { A.closeOpForm(); return; }
    var editing = S.sidebar.editIndex !== null && S.sidebar.editIndex !== undefined;
    var params = S.sidebar.params || (S.sidebar.params = PV.ops.defaults(def.id, A.result().df, A.ctx()));
    var box = h('div.panel.panel-form');
    var back = ui.iconButton('chevronRight', {
      tip: t('misc.close'),
      onClick: function () { A.closeOpForm(); }
    });
    box.appendChild(h('div.panel-head', [
      h('div.panel-title', [ui.icon(def.icon), h('span', { text: t('op.' + def.id) })]),
      h('div.panel-actions', [back])
    ]));
    box.appendChild(h('div.op-desc', { text: t('op.' + def.id + '.desc') }));
    var formHost = h('div.form-host');
    var previewHost = h('div.preview-host');
    box.appendChild(h('div.panel-body', [formHost, previewHost]));
    var apply = ui.button({
      label: editing ? t('misc.apply') : t('ops.add'),
      variant: 'primary', icon: editing ? 'check' : 'plus',
      onClick: function () { commit(false); }
    });
    var position = h('div.segmented.seg-sm');
    [['end', t('step.insert_end')], ['start', t('step.insert_start')]].forEach(function (pair) {
      position.appendChild(h('button.seg' + (S.insertAt === pair[0] ? '.is-on' : ''), {
        type: 'button', text: pair[1],
        on: { click: function () { S.insertAt = pair[0]; A.emit(); } }
      }));
    });
    box.appendChild(h('div.panel-foot', editing ? [
      ui.button({ label: t('misc.cancel'), onClick: function () { A.closeOpForm(); } }),
      apply
    ] : [
      ui.button({ label: t('misc.cancel'), onClick: function () { A.closeOpForm(); } }),
      position,
      apply
    ]));
    host.appendChild(box);
    PV.forms.renderForm(formHost, {
      def: def,
      params: params,
      ctx: A.ctx(),
      previewHost: previewHost
    });
    function commit(keepOpen) {
      var check = PV.forms.previewFor(def, params, A.ctx());
      if (!check.ok) {
        PV.ui.toast(check.error || t('err.title'), { icon: 'warning', type: 'warn' });
        return;
      }
      if (editing) {
        A.updateStep(S.sidebar.editIndex, U.deepClone(params));
        A.closeOpForm();
        return;
      }
      A.addStep(def.id, U.deepClone(params), { at: S.insertAt });
      if (keepOpen) {
        S.sidebar = { mode: 'form', opId: def.id, editIndex: null, params: PV.ops.defaults(def.id, A.result().df, A.ctx()) };
        A.emit();
      } else {
        A.closeOpForm();
      }
    }
  }

  /** Small "quick action" row used at the top of the operations panel. */
  function quickActions() {
    var df = A.result().df;
    var numeric = df ? df.numericColumns() : [];
    var cats = df ? df.categoricalColumns() : [];
    var actions = [];
    if (numeric.length) {
      actions.push(ui.button({
        label: t('table.menu.histogram'), icon: 'chart', size: 'sm',
        onClick: function () {
          S.charts.spec = Object.assign({}, S.charts.spec, { type: 'hist', y: [numeric[0]], x: numeric[0], bins: null });
          A.setTab('charts');
        }
      }));
      actions.push(ui.button({
        label: t('profile.corr.title'), icon: 'grid', size: 'sm',
        onClick: function () { A.setTab('profile'); }
      }));
    }
    if (cats.length) {
      actions.push(ui.button({
        label: t('group.title'), icon: 'group', size: 'sm',
        onClick: function () { A.setTab('group'); }
      }));
    }
    return actions.length ? h('div.quick-row', actions) : null;
  }

  PV.opsPanel = { renderOpsPanel: renderOpsPanel, renderFormPanel: renderFormPanel, quickActions: quickActions };
})(typeof window !== 'undefined' ? window : globalThis);
