/* =============================================================================
 * Visual Pandas — panel-rail.js
 * The right rail: the pipeline (with per-step row counts) and the inspector
 * that profiles whatever the user last touched.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, h = U.h, ui = PV.ui, dlg = PV.dialog, D = PV.df, S = PV.stats;
  var A = PV.app, ST = A.state;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  /* ============================== pipeline ============================== */
  function stepRow(step, index, stage, total) {
    var def = PV.ops.BY_ID[step.type];
    var disabled = step.enabled === false;
    var failed = stage && stage.ok === false;
    var row = h('div.step' + (disabled ? '.is-disabled' : '') + (failed ? '.is-failed' : ''), {
      'data-index': index
    });
    var num = h('span.step-num', { text: String(index + 1) });
    var icon = ui.icon(def ? def.icon : 'question');
    var main = h('div.step-main', [
      h('div.step-title', [h('span', { text: t('op.' + step.type) })]),
      h('div.step-summary', { text: stage && stage.error ? stage.error : PV.ops.summarize(step, A.ctx()) })
    ]);
    var delta = h('div.step-delta', [
      h('span', {
        text: stage ? U.fmtInt(stage.rowsIn) + ' → ' + U.fmtInt(stage.rows) : ''
      }),
      h('span.step-delta-sub', {
        text: stage && stage.ms !== undefined ? t('pipe.elapsed', { ms: stage.ms }) : ''
      })
    ]);
    var tools = h('div.step-tools');
    tools.appendChild(ui.iconButton(disabled ? 'eyeOff' : 'eye', {
      tip: disabled ? t('pipe.enable') : t('pipe.disable'),
      onClick: function (ev) { ev.stopPropagation(); A.toggleStep(index); }
    }));
    tools.appendChild(ui.iconButton('edit', {
      tip: t('pipe.edit'),
      onClick: function (ev) {
        ev.stopPropagation();
        openEdit(index);
      }
    }));
    tools.appendChild(ui.iconButton('arrowUp', {
      tip: t('pipe.move_up'), disabled: index === 0,
      onClick: function (ev) { ev.stopPropagation(); A.moveStep(index, -1); }
    }));
    tools.appendChild(ui.iconButton('arrowDown', {
      tip: t('pipe.move_down'), disabled: index === total - 1,
      onClick: function (ev) { ev.stopPropagation(); A.moveStep(index, 1); }
    }));
    tools.appendChild(ui.iconButton('trash', {
      tip: t('pipe.remove'),
      onClick: function (ev) { ev.stopPropagation(); A.removeStep(index); }
    }));
    // quick actions that tie the pipeline to the rest of the app
    var quick = h('div.step-quick');
    quick.appendChild(ui.button({
      icon: 'eye', size: 'sm', label: t('step.view'),
      onClick: function (ev) { ev.stopPropagation(); A.setTab(A.tabForStep(step.type)); }
    }));
    var codeOpen = !!ST.expandedSteps[step.id];
    quick.appendChild(ui.button({
      icon: 'code', size: 'sm', label: codeOpen ? t('step.hide_code') : t('step.code'),
      onClick: function (ev) {
        ev.stopPropagation();
        if (codeOpen) delete ST.expandedSteps[step.id];
        else ST.expandedSteps[step.id] = true;
        A.emit();
      }
    }));
    row.appendChild(num);
    row.appendChild(h('span.step-icon', [icon]));
    row.appendChild(main);
    row.appendChild(quick);
    row.appendChild(delta);
    row.appendChild(tools);
    row.addEventListener('click', function () { openEdit(index); });
    if (!codeOpen) return row;
    var wrap = h('div.step-wrap');
    wrap.appendChild(row);
    wrap.appendChild(stepCode(step, stage));
    return wrap;
  }

  /** The pandas line(s) this step contributes, shown inline. */
  function stepCode(step, stage) {
    var res = A.result();
    var built = PV.ops.buildCode(A.active().df, A.steps(), A.ctx(), {
      varName: ST.code.varName, stages: res.stages
    });
    var block = built.steps.filter(function (b) { return b.type === step.type; })[0];
    var code = (block && block.code.length) ? block.code.join('\n') : '# (no code for this step)';
    var pre = h('pre.step-code');
    pre.innerHTML = PV.viewsCode.highlight(code);
    var box = h('div.step-code-box', [pre]);
    box.appendChild(h('div.step-code-foot', [
      stage && stage.rowsIn !== undefined
        ? h('span.sub-hint', { text: t('pipe.delta', { from: U.fmtInt(stage.rowsIn), to: U.fmtInt(stage.rows) }) })
        : null,
      ui.button({
        icon: 'copy', size: 'sm', label: t('code.copy'),
        onClick: function (ev) {
          ev.stopPropagation();
          dlg.copy(code).then(function (ok) {
            PV.ui.toast(ok ? t('code.copied') : t('err.clipboard'), { icon: 'check' });
          });
        }
      }),
      ui.button({
        icon: 'code', size: 'sm', label: t('code.tab'),
        onClick: function (ev) { ev.stopPropagation(); A.setTab('code'); }
      })
    ]));
    return box;
  }

  function openEdit(index) {
    var step = A.steps()[index];
    if (!step) return;
    A.openOpForm(step.type, U.deepClone(step.params), index);
  }

  /** Three obvious first moves, so a beginner is never stuck at a blank panel. */
  function suggestions() {
    var focusCol = PV.focus.current();
    var box = h('div.suggest-actions');
    box.appendChild(h('div.op-group-title', { text: t('pipe.suggest') }));
    box.appendChild(ui.button({
      icon: 'filter', size: 'sm', block: true, label: t('pipe.suggest.filter'),
      onClick: function () { A.openOpForm('filter'); }
    }));
    box.appendChild(ui.button({
      icon: 'group', size: 'sm', block: true,
      label: focusCol ? t('focus.groupBy') + ' · ' + focusCol : t('pipe.suggest.group'),
      onClick: function () {
        if (focusCol) PV.focus.groupBy(focusCol);
        else A.openOpForm('groupby');
      }
    }));
    box.appendChild(ui.button({
      icon: 'chart', size: 'sm', block: true, label: t('pipe.suggest.chart'),
      onClick: function () { A.setTab('charts'); }
    }));
    return box;
  }

  function renderPipeline(host) {
    var res = A.result();
    var list = A.steps();
    var box = h('div.panel.panel-pipeline');
    // Undo / redo are labelled and say *what* they take back — an icon with the
    // tooltip "已撤销" told the user nothing about what the button would do.
    var undoWhat = A.undoLabel();
    var redoWhat = A.redoLabel();
    var head = ui.panelHead(t('pipe.panel'), [
      ui.button({
        icon: 'reset', size: 'sm', label: t('pipe.undo'), class: 'btn-undo',
        disabled: !A.canUndo(),
        title: t('pipe.undo') + (undoWhat ? ' · ' + undoWhat : '') + ' · Ctrl/⌘+Z',
        ariaLabel: t('pipe.undo') + (undoWhat ? ' ' + undoWhat : ''),
        onClick: function () { A.undo(); }
      }),
      ui.button({
        icon: 'refresh', size: 'sm', label: t('pipe.redo'), class: 'btn-redo',
        disabled: !A.canRedo(),
        title: t('pipe.redo') + (redoWhat ? ' · ' + redoWhat : '') + ' · Ctrl/⌘+Shift+Z',
        ariaLabel: t('pipe.redo') + (redoWhat ? ' ' + redoWhat : ''),
        onClick: function () { A.redo(); }
      }),
      ui.iconButton('trash', { tip: t('pipe.clear'), disabled: !list.length, onClick: function () { A.clearSteps(); } })
    ], { icon: 'layers', badge: list.length ? String(list.length) : null });
    box.appendChild(head);
    var body = h('div.panel-body');
    if (undoWhat) body.appendChild(h('div.sub-hint.undo-hint', { text: t('pipe.last_action') + ' ' + undoWhat }));
    if (!list.length) {
      body.appendChild(ui.emptyState(t('pipe.empty.title'), t('pipe.empty.hint')));
      body.appendChild(suggestions());
    } else {
      var stepsHost = h('div.steps');
      list.forEach(function (step, i) {
        stepsHost.appendChild(stepRow(step, i, res.stages[i], list.length));
      });
      body.appendChild(stepsHost);
      var base = A.active();
      body.appendChild(h('div.pipeline-summary', [
        h('div.sum-row', [
          h('span', { text: t('pipe.base') }),
          h('b', { text: U.fmtInt(base.df.nrows) + ' × ' + base.df.ncols })
        ]),
        h('div.sum-row.is-result', [
          h('span', { text: t('pipe.result') }),
          h('b', { text: U.fmtInt(res.df.nrows) + ' × ' + res.df.ncols })
        ]),
        h('div.sum-row', [
          h('span', { text: t('misc.summary') }),
          h('b', { text: t('pipe.steps_n', { n: list.length }) + ' · ' + res.ms + ' ms' })
        ]),
        ui.button({
          icon: 'code', label: t('code.tab'), size: 'sm', block: true,
          onClick: function () { A.setTab('code'); }
        })
      ]));
    }
    box.appendChild(body);
    host.appendChild(box);
  }

  /* ============================= inspector ============================== */
  function statRow(label, value, cls) {
    return h('div.ins-row' + (cls ? '.' + cls : ''), [
      h('span.ins-key', { text: label }),
      h('span.ins-val', { text: value })
    ]);
  }

  function columnProfile(col) {
    var df = A.result().df;
    if (!df || !df.has(col)) return ui.emptyState(t('ins.empty'));
    var info = df.info().filter(function (c) { return c.name === col; })[0];
    var values = df.col(col);
    var box = h('div.ins-section');
    box.appendChild(h('div.ins-head', [
      h('div.ins-title', { text: col }),
      h('div.ins-meta', [h('span.dtype-badge', { text: info.dtype }),
        h('span.ins-meta-item', { text: t('ins.unique_n', { n: U.fmtInt(info.unique) }) })])
    ]));
    // the linkage row comes first: send this column anywhere from here
    box.appendChild(h('div.ins-sub', { text: t('focus.use') }));
    box.appendChild(PV.focus.actionRow(col));
    var spark = PV.charts.sparkline(values, {
      width: 240, height: 34,
      type: info.dtype === 'float64' || info.dtype === 'int64' ? 'bar' : 'line'
    });
    box.appendChild(h('div.ins-spark', [spark]));
    var grid = h('div.ins-grid');
    grid.appendChild(statRow(t('profile.non_null'), U.fmtInt(info.nonNull)));
    grid.appendChild(statRow(t('cols.missing'), info.missing ? U.fmtInt(info.missing) + ' (' +
      U.fmtPercent(info.missing / Math.max(1, df.nrows), 1) + ')' : '0'));
    grid.appendChild(statRow(t('profile.unique_n'), U.fmtInt(info.unique)));
    if (info.mean !== null && info.mean !== undefined) {
      grid.appendChild(statRow(t('cols.mean'), U.fmtNumber(info.mean, { maxFrac: 3 })));
      grid.appendChild(statRow(t('cols.median'), U.fmtNumber(info.median, { maxFrac: 3 })));
      grid.appendChild(statRow(t('cols.std'), U.fmtNumber(info.std, { maxFrac: 3 })));
      grid.appendChild(statRow(t('cols.min'), U.fmtNumber(info.min, { maxFrac: 3 })));
      grid.appendChild(statRow(t('cols.max'), U.fmtNumber(info.max, { maxFrac: 3 })));
      var nums = S.numeric(values);
      grid.appendChild(statRow(t('cols.skew'), U.fmtNumber(S.skew(nums), { maxFrac: 3 })));
      var bx = S.boxStats(nums);
      if (bx) {
        grid.appendChild(statRow(t('ins.outliers'), U.fmtInt(bx.outliers.length),
          bx.outliers.length ? 'is-warn' : ''));
      }
    }
    box.appendChild(grid);
    var top = df.valueCounts(col, { limit: 6 });
    if (top.length && (top.length > 1 || top[0].value !== null)) {
      var bars = h('div.ins-bars');
      var maxCount = top[0] ? top[0].count : 1;
      top.forEach(function (r) {
        var label = r.isOther ? t('profile.other_label', { n: r.otherN }) : D.displayKey(r.value);
        var bar = h('button.ins-bar', {
          type: 'button',
          on: {
            click: function () {
              if (r.isOther || r.value === null) return;
              A.filterByValue(col, r.value, false);
            }
          }
        }, [
          h('span.ins-bar-fill', { style: { width: (r.count / maxCount * 100) + '%' } }),
          h('span.ins-bar-label', { text: label }),
          h('span.ins-bar-value', { text: U.fmtInt(r.count) })
        ]);
        bars.appendChild(bar);
      });
      box.appendChild(h('div.ins-sub', { text: t('profile.value_counts.title') }));
      box.appendChild(bars);
    }
    box.appendChild(h('div.ins-actions', [
      ui.button({
        label: t('op.missing'), icon: 'missing', size: 'sm',
        onClick: function () { A.openOpForm('missing', { mode: 'fillna', columns: [col], method: 'mean', value: '' }); }
      }),
      ui.button({
        label: t('table.menu.rename'), icon: 'rename', size: 'sm',
        onClick: function () { A.openOpForm('rename', { pairs: [{ from: col, to: col }] }); }
      })
    ]));
    return box;
  }

  function rowDetail(index) {
    var df = A.result().df;
    if (!df || index === null || index === undefined || index >= df.nrows) return ui.emptyState(t('ins.empty'));
    var row = df.rowObject(index);
    var box = h('div.ins-section');
    box.appendChild(h('div.ins-head', [
      h('div.ins-title', { text: t('ins.row_detail') }),
      h('div.ins-meta', [h('span.ins-meta-item', { text: t('ins.index_label', { i: index }) })])
    ]));
    var grid = h('div.ins-grid');
    Object.keys(row).forEach(function (k) {
      var v = row[k];
      grid.appendChild(statRow(k, U.fmtValue(v, { maxFrac: 4 }), U.isNA(v) ? 'is-na' : ''));
    });
    box.appendChild(grid);
    box.appendChild(h('div.ins-actions', [
      ui.button({
        label: t('ins.copy_path'), icon: 'copy', size: 'sm',
        onClick: function () {
          var clean = {};
          Object.keys(row).forEach(function (k) { clean[k] = row[k] instanceof Date ? U.fmtDateTime(row[k]) : row[k]; });
          dlg.copy(JSON.stringify(clean, null, 2)).then(function () {
            PV.ui.toast(t('toast.copied'), { icon: 'check' });
          });
        }
      })
    ]));
    return box;
  }

  function pointDetail(info) {
    var box = h('div.ins-section');
    box.appendChild(h('div.ins-head', [
      h('div.ins-title', { text: t('ins.point_detail') }),
      h('div.ins-meta', [h('span.ins-meta-item', { text: info.label || '' })])
    ]));
    var grid = h('div.ins-grid');
    // info.x is the column's own value, info.value the measure drawn on the y axis
    grid.appendChild(statRow(info.field, U.fmtNumber(info.x === undefined ? info.value : info.x, { maxFrac: 4 })));
    if (info.field2) grid.appendChild(statRow(info.field2, U.fmtNumber(info.value, { maxFrac: 4 })));
    if (info.sizeField && info.extra !== null && info.extra !== undefined) {
      grid.appendChild(statRow(info.sizeField, U.fmtNumber(info.extra, { maxFrac: 4 })));
    }
    if (info.series) grid.appendChild(statRow(t('ins.value'), String(info.series)));
    box.appendChild(grid);
    return box;
  }

  function renderInspector(host) {
    var ins = ST.inspector;
    var box = h('div.panel.panel-inspector');
    box.appendChild(ui.panelHead(t('ins.title'), [], { icon: 'search' }));
    var body = h('div.panel-body');
    if (ins.kind === 'column') body.appendChild(columnProfile(ins.payload.col));
    else if (ins.kind === 'row') body.appendChild(rowDetail(ins.payload.index));
    else if (ins.kind === 'point') body.appendChild(pointDetail(ins.payload));
    else body.appendChild(ui.emptyState(t('ins.empty')));
    box.appendChild(body);
    host.appendChild(box);
  }

  PV.railPanel = { renderPipeline: renderPipeline, renderInspector: renderInspector };
})(typeof window !== 'undefined' ? window : globalThis);
