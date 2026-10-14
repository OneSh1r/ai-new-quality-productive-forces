/* =============================================================================
 * Visual Pandas — forms-rows.js
 * Row-list editors (sort keys, filter conditions, aggregations, renames),
 * the expression editor, live preview and the complete form renderer.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, h = U.h, ui = PV.ui, dlg = PV.dialog, D = PV.df;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  function colOptions(df) {
    return df.names.map(function (c) { return { value: c, label: c }; });
  }

  function removeButton(onClick) {
    return ui.iconButton('trash', { onClick: onClick, tip: t('f.remove') });
  }

  function listField(label, host, addLabel, onAdd) {
    var add = ui.button({ icon: 'plus', label: addLabel, size: 'sm', onClick: onAdd });
    return h('div.field', [h('label.field-label', { text: label }), host, h('div.field-actions', [add])]);
  }

  /* ------------------------------ sort keys ---------------------------- */
  function sortKeys(field, params, ctx, onChange) {
    var df = ctx.frame;
    var rows = params[field.key] || (params[field.key] = []);
    var host = h('div.rowlist');
    function paint() {
      U.clear(host);
      rows.forEach(function (row, i) {
        var dir = row.ascending === false ? 'desc' : 'asc';
        var a = dlg.select(colOptions(df), row.col, function (v) { row.col = v; onChange(params, field); });
        var b = dlg.select([{ value: 'asc', label: t('f.ascending') }, { value: 'desc', label: t('f.descending') }], dir, function (v) {
          row.ascending = v === 'asc';
          onChange(params, field);
        });
        var c = removeButton(function () { rows.splice(i, 1); paint(); onChange(params, field); });
        host.appendChild(h('div.rowlist-row', [a, b, c]));
      });
    }
    paint();
    return listField(PV.forms.labelOf(field), host, t('f.add_key'), function () {
      rows.push({ col: df.names[0], ascending: true });
      paint();
      onChange(params, field);
    });
  }

  /* --------------------------- filter conditions ----------------------- */
  function suggestValues(frame, col) {
    if (!frame.has(col)) return null;
    var kind = frame.kind(col);
    if (kind !== 'category' && kind !== 'bool' && kind !== 'text') return null;
    var top = frame.valueCounts(col, { limit: 4 });
    var row = h('div.suggest-row');
    top.filter(function (r) { return !r.isOther; }).forEach(function (r) {
      row.appendChild(h('button.suggest', {
        type: 'button', text: D.displayKey(r.value),
        on: {
          click: function () {
            row.dispatchEvent(new CustomEvent('pv-pick', { detail: D.displayKey(r.value), bubbles: true }));
          }
        }
      }));
    });
    return row.childNodes.length ? row : null;
  }

  function valueEditor(cond, frame, field, params, onChange) {
    if (cond.op === 'isna' || cond.op === 'notna') {
      return h('div.inline-note', { text: t('fo.' + cond.op) });
    }
    if (cond.op === 'between') {
      var lo = dlg.textInput(cond.value, function (v) { cond.value = v; onChange(params, field); }, { placeholder: t('f.lower') });
      var up = dlg.textInput(cond.value2, function (v) { cond.value2 = v; onChange(params, field); }, { placeholder: t('f.upper') });
      return h('div.value-pair', [lo, h('span.value-sep', { text: '–' }), up]);
    }
    var ph = cond.op === 'isin' ? t('fo.isin.hint') : (cond.op === 'regex' ? '.*' : t('f.value'));
    var box = h('input.input.input-sm', { type: 'text', placeholder: ph });
    box.value = cond.value === undefined || cond.value === null ? '' : cond.value;
    box.addEventListener('input', U.debounce(function () {
      cond.value = box.value;
      onChange(params, field);
    }, 320));
    var wrap = h('div.value-cell', [box]);
    var suggests = suggestValues(frame, cond.col);
    if (suggests) {
      wrap.appendChild(suggests);
      wrap.addEventListener('pv-pick', function (ev) {
        cond.value = ev.detail;
        box.value = ev.detail;
        onChange(params, field);
      });
    }
    return wrap;
  }

  function conditions(field, params, ctx, onChange) {
    var df = ctx.frame;
    var rows = params[field.key] || (params[field.key] = []);
    var host = h('div.rowlist');
    function paint() {
      U.clear(host);
      rows.forEach(function (cond, i) {
        var colSel = dlg.select(colOptions(df), cond.col, function (v) {
          cond.col = v;
          cond.value = '';
          cond.value2 = '';
          paint();
          onChange(params, field);
        });
        var opSel = dlg.select(PV.ops.FILTER_OPS.map(function (o) {
          return { value: o, label: t('fo.' + o) };
        }), cond.op, function (v) {
          cond.op = v;
          paint();
          onChange(params, field);
        });
        var rem = removeButton(function () { rows.splice(i, 1); paint(); onChange(params, field); });
        host.appendChild(h('div.rowlist-row.rowlist-cond', [colSel, opSel, valueEditor(cond, df, field, params, onChange), rem]));
      });
    }
    paint();
    return listField(t('f.add_condition'), host, t('f.add_condition'), function () {
      rows.push({ col: df.names[0], op: 'eq', value: '', value2: '' });
      paint();
      onChange(params, field);
    });
  }

  /* --------------------------- aggregations ---------------------------- */
  function aggSpec(field, params, ctx, onChange) {
    var df = ctx.frame;
    var rows = params[field.key] || (params[field.key] = []);
    var host = h('div.rowlist');
    function paint() {
      U.clear(host);
      rows.forEach(function (row, i) {
        var colSel = dlg.select(colOptions(df), row.col, function (v) { row.col = v; onChange(params, field); });
        var fnSel = dlg.select(PV.ops.AGG_FNS.map(function (f) {
          return { value: f, label: t('fn.' + f) };
        }), row.fn, function (v) { row.fn = v; onChange(params, field); });
        var outIn = dlg.textInput(row.out, function (v) { row.out = v; onChange(params, field); }, { placeholder: t('f.out_name') });
        var rem = removeButton(function () { rows.splice(i, 1); paint(); onChange(params, field); });
        host.appendChild(h('div.rowlist-row.rowlist-agg', [colSel, fnSel, outIn, rem]));
      });
    }
    paint();
    return listField(t('f.add_agg'), host, t('f.add_agg'), function () {
      var numeric = df.numericColumns();
      rows.push({ col: numeric[0] || df.names[0], fn: 'sum', out: '' });
      paint();
      onChange(params, field);
    });
  }

  /* ------------------------------ renames ------------------------------ */
  function colMap(field, params, ctx, onChange) {
    var df = ctx.frame;
    var rows = params[field.key] || (params[field.key] = []);
    var host = h('div.rowlist');
    function paint() {
      U.clear(host);
      rows.forEach(function (row, i) {
        var fromSel = dlg.select(colOptions(df), row.from, function (v) { row.from = v; onChange(params, field); });
        var toIn = dlg.textInput(row.to, function (v) { row.to = v; onChange(params, field); }, { placeholder: t('f.new_name') });
        var rem = removeButton(function () { rows.splice(i, 1); paint(); onChange(params, field); });
        host.appendChild(h('div.rowlist-row.rowlist-map', [fromSel, h('span.value-sep', { text: '→' }), toIn, rem]));
      });
    }
    paint();
    return listField(PV.forms.labelOf(field), host, t('f.add_key'), function () {
      rows.push({ from: df.names[0], to: df.names[0] });
      paint();
      onChange(params, field);
    });
  }

  /* ---------------------------- expressions ---------------------------- */
  var EXPR_FNS = ['abs', 'round', 'min', 'max', 'sqrt', 'log', 'clip', 'where',
    'isnull', 'notnull', 'str', 'num', 'len', 'upper', 'lower', 'contains',
    'year', 'month', 'day', 'weekday', 'concat', 'bin', 'zscore', 'rank'];

  function expression(field, params, ctx, onChange) {
    var ta = h('textarea.textarea.textarea-mono', { rows: 3, spellcheck: 'false' });
    ta.value = params[field.key] === undefined ? '' : params[field.key];
    var status = h('div.expr-status');
    var palette = h('div.expr-palette');
    function update() {
      params[field.key] = ta.value;
      U.clear(status);
      var src = String(ta.value || '').trim();
      if (src) {
        try {
          PV.expr.evaluate(src, ctx.frame);
          status.className = 'expr-status is-ok';
          var pyName = (PV.app && PV.app.state.code && PV.app.state.code.varName) || 'df';
          status.appendChild(h('code.expr-py', { text: PV.expr.compile(src).python(pyName) }));
        } catch (e) {
          status.className = 'expr-status is-error';
          status.appendChild(h('div.expr-msg', { text: (e && e.message) ? e.message : String(e) }));
        }
      }
      onChange(params, field);
    }
    EXPR_FNS.forEach(function (name) {
      palette.appendChild(h('button.expr-fn', {
        type: 'button', text: name,
        on: {
          click: function () {
            var start = ta.selectionStart || 0;
            ta.value = ta.value.slice(0, start) + name + '(' + ta.value.slice(start);
            ta.focus();
            ta.setSelectionRange(start + name.length + 1, start + name.length + 1);
            update();
          }
        }
      }));
    });
    ta.addEventListener('input', U.debounce(update, 320));
    update();
    return h('div.field', [
      h('label.field-label', { text: PV.forms.labelOf(field) }),
      ta,
      palette,
      status
    ]);
  }

  function renderRowField(field, params, ctx, onChange) {
    if (field.type === 'sortkeys') return sortKeys(field, params, ctx, onChange);
    if (field.type === 'conds') return conditions(field, params, ctx, onChange);
    if (field.type === 'aggspec') return aggSpec(field, params, ctx, onChange);
    if (field.type === 'colmap') return colMap(field, params, ctx, onChange);
    if (field.type === 'expression') return expression(field, params, ctx, onChange);
    return h('div');
  }

  /* ------------------------------ preview ------------------------------ */
  function previewFor(def, params, ctx) {
    try {
      var res = PV.ops.applyPipeline(ctx.frame, [{ id: 'preview', type: def.id, params: params }], ctx);
      var st = res.stages[0];
      var rows = res.df ? res.df.nrows : 0;
      var cols = res.df ? res.df.ncols : 0;
      return { ok: st.ok, error: st.error, df: res.df, rows: rows, cols: cols, ms: st.ms };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function previewBlock(def, params, ctx) {
    var info = previewFor(def, params, ctx);
    var box = h('div.preview');
    if (!info.ok) {
      box.appendChild(h('div.preview-error', [ui.icon('warning'), h('span', { text: info.error || t('err.title') })]));
      return { node: box, info: info };
    }
    box.appendChild(h('div.preview-head', [
      h('span.preview-title', { text: t('group.preview') }),
      h('span.preview-stat', { text: t('ops.rows_out', { n: U.fmtInt(info.rows) }) }),
      h('span.preview-stat', { text: t('ops.cols_out', { m: info.cols }) }),
      h('span.preview-ms', { text: t('pipe.elapsed', { ms: info.ms }) })
    ]));
    if (info.rows === 0) box.appendChild(h('div.preview-warn', { text: t('ops.empty_result') }));
    var table = h('table.mini-table');
    var head = h('tr');
    head.appendChild(h('th', { text: '#' }));
    info.df.names.slice(0, 8).forEach(function (nm) { head.appendChild(h('th', { text: nm })); });
    table.appendChild(h('thead', head));
    var body = h('tbody');
    info.df.rows(0, 5).forEach(function (row, i) {
      var tr = h('tr');
      tr.appendChild(h('td.mini-index', { text: String(i) }));
      row.slice(0, 8).forEach(function (v) {
        tr.appendChild(h('td', {
          text: U.fmtValue(v, { maxFrac: 2 }),
          class: (U.isNA(v) ? 'is-na' : '') + (typeof v === 'number' ? ' num' : '')
        }));
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    box.appendChild(h('div.table-scroll', table));
    return { node: box, info: info };
  }

  function renderForm(host, opts) {
    var def = opts.def, params = opts.params, ctx = opts.ctx;
    var userOnChange = opts.onChange || function () {};
    var previewHost = opts.previewHost || null;
    var hasDynamic = def.params.some(function (f) { return typeof f.when === 'function'; });
    U.clear(host);
    var body = h('div.form-body');
    var slot = h('div.preview-slot');
    var last = { info: null };
    function paintPreview() {
      var block = previewBlock(def, params, ctx);
      if (previewHost) {
        U.clear(previewHost);
        previewHost.appendChild(block.node);
      } else {
        U.clear(slot);
        slot.appendChild(block.node);
      }
      last.info = block.info;
      if (opts.onPreview) opts.onPreview(block.info);
    }
    function paintFields() {
      U.clear(body);
      def.params.forEach(function (field) {
        if (field.when && !field.when(params)) return;
        var dynamic = hasDynamic && (field.type === 'select' || field.type === 'switch');
        var wrapped = function (p, f) {
          if (dynamic) {
            paintFields();
            paintPreview();
          } else {
            paintPreview();
          }
          userOnChange(p, f, { rerender: dynamic });
        };
        body.appendChild(PV.forms.renderField(field, params, ctx, wrapped));
      });
    }
    paintFields();
    if (previewHost) {
      host.appendChild(body);
    } else {
      host.appendChild(h('div.form-wrap', [body, slot]));
    }
    paintPreview();
    return last.info;
  }

  PV.formsRows = { renderRowField: renderRowField, previewFor: previewFor, previewBlock: previewBlock };
  PV.forms.renderForm = renderForm;
  PV.forms.previewFor = previewFor;
})(typeof window !== 'undefined' ? window : globalThis);
