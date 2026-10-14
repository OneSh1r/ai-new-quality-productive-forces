/* =============================================================================
 * Visual Pandas — views-code.js
 * The Python tab: the runnable pandas script for the current pipeline, a
 * step-by-step breakdown with row deltas, and a preview of what the script
 * produces. This is where the visual work turns into reusable code.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, h = U.h, ui = PV.ui, dlg = PV.dialog;
  var A = PV.app, ST = A.state;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  /* A tiny Python highlighter: comments, strings, numbers, keywords, pandas
     aliases and call names. The regex is a literal so no escaping surprises. */
  var TOKEN_RE = new RegExp([
    '(#[^\\n]*)',
    '("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\')',
    '(\\b\\d+(?:\\.\\d+)?\\b)',
    '(\\b(?:import|as|from|for|in|if|else|elif|def|return|with|lambda|not|and|or|None|True|False|while|try|except)\\b)',
    '(\\b(?:pd|np)\\b)',
    '([A-Za-z_][A-Za-z0-9_]*(?=\\())'
  ].join('|'), 'g');

  function highlight(code) {
    return U.escapeHtml(code).replace(TOKEN_RE, function (m, comment, str, num, kw, builtin, fn) {
      if (comment) return '<span class="tok-comment">' + comment + '</span>';
      if (str) return '<span class="tok-str">' + str + '</span>';
      if (num) return '<span class="tok-num">' + num + '</span>';
      if (kw) return '<span class="tok-kw">' + kw + '</span>';
      if (builtin) return '<span class="tok-builtin">' + builtin + '</span>';
      if (fn) return '<span class="tok-fn">' + fn + '</span>';
      return m;
    });
  }

  function codeBlock(code) {
    var pre = h('pre.code-block');
    pre.innerHTML = highlight(code);
    return pre;
  }

  function copyButton(script) {
    return ui.button({
      icon: 'copy', label: t('code.copy'), size: 'sm', variant: 'primary',
      onClick: function () {
        dlg.copy(script).then(function (ok) {
          PV.ui.toast(ok ? t('code.copied') : t('err.clipboard'), { icon: ok ? 'check' : 'warning', type: ok ? null : 'warn' });
        });
      }
    });
  }

  function optionsRow() {
    var row = h('div.code-options');
    row.appendChild(dlg.switchBox(t('code.with_loader'), ST.code.withLoader, function (v) {
      ST.code.withLoader = v;
      A.emit();
    }));
    row.appendChild(dlg.field(t('code.dataframe_name'), dlg.textInput(ST.code.varName, function (v) {
      var name = PV.ops.sanitize(v || 'df', 'df');
      if (name === ST.code.varName) return;
      ST.code.varName = name;
      A.emit();
    })));
    return row;
  }

  function mainPanel(script, res) {
    var ds = A.active();
    var panel = h('section.panel.panel-code');
    panel.appendChild(ui.panelHead(t('code.title'), [
      copyButton(script.text),
      ui.button({
        icon: 'download', label: '.py', size: 'sm',
        onClick: function () { U.download((ds.name || 'analysis') + '.py', script.text, 'text/x-python;charset=utf-8'); }
      })
    ], { icon: 'code' }));
    var body = h('div.panel-body', [
      h('div.code-lead', [ui.icon('info'), h('span', { text: t('code.purpose') })]),
      h('div.code-sub', [ui.icon('database'), h('span', { text: t('code.data_note') })]),
      h('div.code-meta', [
        h('span.badge', { text: t('top.rows') + ' ' + U.fmtInt(ds.df.nrows) }),
        h('span.badge', { text: t('top.cols') + ' ' + ds.df.ncols }),
        h('span.badge.badge-accent', { text: t('pipe.steps_n', { n: A.steps().length }) }),
        h('span.badge', { text: t('top.result') + ' ' + U.fmtInt(res.df.nrows) + ' × ' + res.df.ncols })
      ]),
      codeBlock(script.text)
    ]);
    panel.appendChild(body);
    var foot = h('div.panel-foot');
    foot.appendChild(optionsRow());
    panel.appendChild(foot);
    return panel;
  }

  function stepList(script) {
    var blocks = script.blocks;
    var panel = h('section.panel.panel-code-steps');
    panel.appendChild(ui.panelHead(t('code.steps'), [
      h('span.badge', { text: t('code.step_note') })
    ], { icon: 'layers' }));
    var body = h('div.panel-body');
    if (!blocks.length) {
      body.appendChild(h('div.sub-hint', { text: t('code.no_steps') }));
      panel.appendChild(body);
      return panel;
    }
    blocks.forEach(function (b, i) {
      var item = h('div.code-step' + (b.enabled ? '' : '.is-off') + (b.error ? '.is-error' : ''));
      var delta = (b.rowsIn !== null && b.rowsIn !== undefined && b.rows !== undefined)
        ? t('pipe.delta', { from: U.fmtInt(b.rowsIn), to: U.fmtInt(b.rows) })
        : '';
      item.appendChild(h('div.code-step-head', [
        h('span.code-step-n', { text: String(i + 1) }),
        h('span.code-step-name', { text: t('op.' + b.type) }),
        h('span.code-step-summary', { text: b.summary || '' }),
        b.error ? h('span.code-step-error', { text: b.error }) : null,
        delta ? h('span.code-step-delta', { text: delta }) : null,
        !b.enabled ? h('span.badge', { text: t('ops.disabled') }) : null,
        // close the loop: jump back to the view this step belongs to
        ui.button({
          icon: 'eye', size: 'sm', label: t('step.where'),
          onClick: function () { A.setTab(A.tabForStep(b.type)); }
        })
      ]));
      if (b.enabled && b.code.length) {
        var pre = h('pre.code-step-body');
        pre.innerHTML = highlight(b.code.join('\n'));
        item.appendChild(pre);
      }
      body.appendChild(item);
    });
    panel.appendChild(body);
    return panel;
  }

  function resultPreview(res) {
    var panel = h('section.panel.panel-result-preview');
    panel.appendChild(ui.panelHead(t('code.result_preview'), [
      h('span.badge', { text: U.fmtInt(res.df.nrows) + ' × ' + res.df.ncols })
    ], { icon: 'table' }));
    var table = h('table.mini-table');
    var head = h('tr');
    head.appendChild(h('th', { text: '#' }));
    res.df.names.slice(0, 10).forEach(function (nm) { head.appendChild(h('th', { text: nm })); });
    table.appendChild(h('thead', head));
    var body = h('tbody');
    res.df.rows(0, 5).forEach(function (row, i) {
      var tr = h('tr');
      tr.appendChild(h('td.mini-index', { text: String(i) }));
      row.slice(0, 10).forEach(function (v) {
        tr.appendChild(h('td', {
          text: U.fmtValue(v, { maxFrac: 3 }),
          class: (U.isNA(v) ? 'is-na' : '') + (typeof v === 'number' ? ' num' : '')
        }));
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    panel.appendChild(h('div.panel-body', [h('div.table-scroll', table)]));
    return panel;
  }

  function renderCodeView(host) {
    U.clear(host);
    var ds = A.active();
    if (!ds) {
      host.appendChild(ui.emptyState(t('app.no_dataset'), null));
      return;
    }
    var res = A.result();
    var script = PV.ops.fullScript(ST.datasets, ST.activeId, A.steps(), {
      withLoader: ST.code.withLoader,
      varName: ST.code.varName,
      stages: res.stages,
      result: { nrows: res.df.nrows, ncols: res.df.ncols }
    });
    host.appendChild(mainPanel(script, res));
    var cols = h('div.code-columns', [stepList(script), resultPreview(res)]);
    host.appendChild(cols);
    host.appendChild(h('div.sub-hint', [
      h('span', { text: t('code.inspect.hint', { name: ST.code.varName }) })
    ]));
  }

  PV.viewsCode = { render: renderCodeView, highlight: highlight };
})(typeof window !== 'undefined' ? window : globalThis);
