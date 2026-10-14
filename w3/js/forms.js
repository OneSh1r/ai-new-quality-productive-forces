/* =============================================================================
 * Visual Pandas — forms.js
 * Declarative parameter forms for operations: scalar fields and the column
 * picker. Row-list editors live in forms-rows.js.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, h = U.h, ui = PV.ui, dlg = PV.dialog;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  function labelOf(field) { return field.label ? t(field.label) : ''; }

  function optLabel(o, field) {
    if (field.labels && field.labels[o] !== undefined) {
      var lab = field.labels[o];
      return PV.i18n.has(lab) ? t(lab) : lab;
    }
    if (field.labelKeyPrefix) return PV.i18n.has(field.labelKeyPrefix + o) ? t(field.labelKeyPrefix + o) : o;
    return o;
  }

  function columnList(source, df) {
    if (source === 'numericColumns') return df.numericColumns();
    if (source === 'categoricalColumns') return df.categoricalColumns();
    if (source === 'dateColumns') return df.dateColumns();
    return df.names.slice();
  }

  function dtypeBadge(df, col) { return h('span.dtype-badge', { text: df.dtype(col) }); }

  function otherDatasets(ctx) {
    return (ctx.datasets || []).filter(function (d) { return d.id !== ctx.activeId; });
  }

  function datasetOptions(ctx) {
    return otherDatasets(ctx).map(function (d) {
      return { value: d.id, label: PV.app.datasetLabel(d) };
    });
  }

  function applyDatasetChange(params, field, value, ctx) {
    params[field.key] = value;
    var others = otherDatasets(ctx);
    var other = others.filter(function (d) { return d.id === value; })[0];
    if (!other) return;
    if (Array.isArray(params.leftOn) && Array.isArray(params.rightOn)) {
      var common = ctx.frame.names.filter(function (n) { return other.df.has(n); });
      params.leftOn = common.slice(0, 1);
      params.rightOn = common.slice(0, 1);
    }
  }

  function sourceOptions(field, df, ctx) {
    if (field.source === 'datasets') return datasetOptions(ctx);
    return columnList(field.source, df).map(function (c) { return { value: c, label: c }; });
  }

  function simpleField(field, params, onChange) {
    var value = params[field.key];
    if (field.type === 'number') {
      return dlg.field(labelOf(field), dlg.textInput(value, function (v) {
        params[field.key] = v === '' ? '' : Number(v);
        onChange(params, field);
      }, { type: 'number', min: field.min, max: field.max, step: field.step }));
    }
    if (field.type === 'text') {
      return dlg.field(labelOf(field), dlg.textInput(value, function (v) {
        params[field.key] = v;
        onChange(params, field);
      }, { placeholder: field.placeholder }));
    }
    if (field.type === 'textarea' || field.type === 'mapping') {
      var ta = h('textarea.textarea', { rows: field.type === 'mapping' ? 5 : 3 });
      ta.value = value === undefined || value === null ? '' : value;
      ta.addEventListener('input', U.debounce(function () {
        params[field.key] = ta.value;
        onChange(params, field);
      }, 350));
      return dlg.field(labelOf(field), ta, {
        hint: field.type === 'mapping' ? t('f.mapping.hint') : null
      });
    }
    if (field.type === 'switch') {
      return h('div.field.field-switch', [dlg.switchBox(labelOf(field), value, function (v) {
        params[field.key] = v;
        onChange(params, field);
      })]);
    }
    return h('div');
  }

  function renderField(field, params, ctx, onChange) {
    var df = ctx.frame;
    if (field.type === 'select') {
      var opts = field.source
        ? sourceOptions(field, df, ctx)
        : (field.options || []).map(function (o) { return { value: o, label: optLabel(o, field) }; });
      return dlg.field(labelOf(field), dlg.select(opts, params[field.key], function (v) {
        params[field.key] = v;
        onChange(params, field);
      }), { hint: field.hint ? t(field.hint) : null });
    }
    if (field.type === 'dataset') {
      if (!otherDatasets(ctx).length) {
        return dlg.field(labelOf(field), h('div.inline-note', { text: t('combine.need_second') }));
      }
      return dlg.field(labelOf(field), dlg.select(datasetOptions(ctx), params[field.key], function (v) {
        applyDatasetChange(params, field, v, ctx);
        onChange(params, field);
      }));
    }
    if (field.type === 'columns') return columnsField(field, params, ctx, onChange);
    if (field.type === 'sortkeys' || field.type === 'conds' || field.type === 'aggspec' ||
        field.type === 'colmap' || field.type === 'expression') {
      return PV.formsRows.renderRowField(field, params, ctx, onChange);
    }
    return simpleField(field, params, onChange);
  }

  function columnsField(field, params, ctx, onChange) {
    var frame = (field.fromOther && ctx.otherFrame) ? ctx.otherFrame : ctx.frame;
    var selected = (params[field.key] || []).slice();
    var pool = field.fromOther ? frame.names.slice() : columnList(field.source, frame);
    if (field.filter === 'categorical' && !field.source) pool = frame.categoricalColumns();
    var search = '';
    var listHost = h('div.picker-list');
    var chipHost = h('div.chips');
    var sel = {
      toggle: function (col) {
        var i = selected.indexOf(col);
        if (field.maxOne) selected = [col];
        else if (i >= 0) selected.splice(i, 1);
        else selected.push(col);
        paintChips();
        paintList();
        params[field.key] = selected.slice();
        onChange(params, field);
      },
      move: function (from, to) {
        if (to < 0 || to >= selected.length) return;
        selected.splice(to, 0, selected.splice(from, 1)[0]);
        paintChips();
        paintList();
        params[field.key] = selected.slice();
        onChange(params, field);
      }
    };
    function paintChips() {
      U.clear(chipHost);
      if (!selected.length) {
        chipHost.appendChild(h('span.chips-empty', { text: t('f.none') }));
        return;
      }
      selected.forEach(function (col, idx) {
        var chip = h('span.chip', [h('span', { text: col })]);
        if (field.ordered !== false && selected.length > 1) {
          chip.appendChild(h('button.chip-move', {
            type: 'button', text: '◀', 'aria-label': 'move left',
            on: { click: function () { sel.move(idx, idx - 1); } }
          }));
          chip.appendChild(h('button.chip-move', {
            type: 'button', text: '▶', 'aria-label': 'move right',
            on: { click: function () { sel.move(idx, idx + 1); } }
          }));
        }
        chip.appendChild(h('button.chip-x', {
          type: 'button', text: '×', 'aria-label': 'remove',
          on: { click: function () { sel.toggle(col); } }
        }));
        chipHost.appendChild(chip);
      });
    }
    function paintList() {
      U.clear(listHost);
      var shown = pool.filter(function (col) {
        if (search && col.toLowerCase().indexOf(search) < 0) return false;
        if (field.filter === 'categorical' && !field.source) {
          var kind = frame.kind(col);
          return kind === 'category' || kind === 'text' || kind === 'bool';
        }
        return true;
      });
      if (!shown.length) {
        listHost.appendChild(h('div.picker-empty', { text: t('cols.empty') }));
        return;
      }
      shown.forEach(function (col) {
        var on = selected.indexOf(col) >= 0;
        listHost.appendChild(h('button.picker-row' + (on ? '.is-on' : ''), {
          type: 'button',
          on: { click: function () { sel.toggle(col); } }
        }, [
          h('span.picker-check', {
            html: on ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>' : ''
          }),
          h('span.picker-name', { text: col }),
          frame.has(col) ? dtypeBadge(frame, col) : null
        ]));
      });
    }
    paintChips();
    paintList();
    var searchBox = h('input.input.input-sm', { type: 'search', placeholder: t('f.search_col') });
    searchBox.addEventListener('input', U.debounce(function () {
      search = searchBox.value.toLowerCase();
      paintList();
    }, 160));
    return h('div.field', [
      h('label.field-label', [
        h('span', { text: labelOf(field) }),
        h('span.field-count', { text: t('f.selected_n', { n: selected.length }) })
      ]),
      chipHost,
      pool.length > 6 ? searchBox : null,
      listHost
    ]);
  }

  PV.forms = {
    renderField: renderField,
    columnsField: columnsField,
    sourceOptions: sourceOptions,
    dtypeBadge: dtypeBadge,
    labelOf: labelOf,
    optLabel: optLabel,
    columnList: columnList
  };
})(typeof window !== 'undefined' ? window : globalThis);
