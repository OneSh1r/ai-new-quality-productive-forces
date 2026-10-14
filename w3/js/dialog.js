/* =============================================================================
 * Visual Pandas — dialog.js
 * Modal dialogs, confirmations, prompts, clipboard helpers and form inputs.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, h = U.h, ui = PV.ui;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  function dialog(opts) {
    return new Promise(function (resolve) {
      var body = typeof opts.body === 'string' ? h('div.dialog-text', { text: opts.body }) : opts.body;
      var actions = opts.actions || [
        { label: t('misc.cancel'), value: null },
        { label: t('misc.confirm'), value: 'ok', primary: true }
      ];
      var card = h('div.dialog' + (opts.wide ? '.dialog-wide' : ''), [
        h('div.dialog-head', [
          h('div.dialog-title', { text: opts.title || '' }),
          ui.iconButton('close', { onClick: function () { finish(null); } })
        ]),
        h('div.dialog-body', body),
        h('div.dialog-footer', actions.map(function (a) {
          return ui.button({
            label: a.label,
            variant: a.primary ? 'primary' : (a.danger ? 'danger' : null),
            onClick: function () { finish(a.value); }
          });
        }))
      ]);
      var overlay = h('div.overlay', {
        on: { mousedown: function (ev) { if (ev.target === overlay) finish(null); } }
      }, card);
      var onKey = function (ev) { if (ev.key === 'Escape') finish(null); };
      document.addEventListener('keydown', onKey);
      document.body.appendChild(overlay);
      setTimeout(function () {
        var first = card.querySelector('input, select, textarea');
        if (first) first.focus();
      }, 20);
      function finish(value) {
        document.removeEventListener('keydown', onKey);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(value);
      }
      if (opts.onMount) opts.onMount(card, finish);
    });
  }

  function confirmDialog(message, opts) {
    opts = opts || {};
    return dialog({
      title: opts.title || t('misc.confirm'),
      body: message,
      actions: [
        { label: t('misc.cancel'), value: false },
        { label: opts.confirmLabel || t('misc.confirm'), value: true, primary: true, danger: opts.danger }
      ]
    });
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var done = document.execCommand('copy');
      document.body.removeChild(ta);
      return done;
    } catch (e) { return false; }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; })
        .catch(function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function promptDialog(opts) {
    var input = h('input.input#dlg-input', {
      type: 'text', value: opts.value === undefined ? '' : opts.value,
      placeholder: opts.placeholder || ''
    });
    var body = field(opts.label, input);
    return dialog({
      title: opts.title,
      body: body,
      actions: [
        { label: t('misc.cancel'), value: null },
        { label: opts.confirmLabel || t('misc.apply'), value: '__ok__', primary: true }
      ],
      onMount: function (card, finish) {
        input.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') finish('__ok__');
        });
      }
    }).then(function (res) { return res === '__ok__' ? input.value : null; });
  }

  /* ------------------------------ form bits ----------------------------- */
  function field(label, control, opts) {
    opts = opts || {};
    return h('div.field', [
      label ? h('label.field-label', { text: label }) : null,
      control,
      opts.hint ? h('div.field-hint', { text: opts.hint }) : null
    ]);
  }

  function select(options, value, onChange, opts) {
    opts = opts || {};
    var el = h('select.select', { on: { change: function () { onChange(el.value); } } });
    options.forEach(function (o) {
      el.appendChild(h('option', { value: o.value, text: o.label }));
    });
    el.value = value;
    if (el.value === undefined || el.value === '') el.selectedIndex = 0;
    if (opts.tip) el.setAttribute('data-tip', opts.tip);
    return el;
  }

  function checkbox(label, checked, onChange) {
    var input = h('input', { type: 'checkbox', checked: !!checked });
    input.addEventListener('change', function () { onChange(input.checked); });
    return h('label.check', [input, h('span', { text: label })]);
  }

  function switchBox(label, checked, onChange) {
    var input = h('input', { type: 'checkbox', checked: !!checked });
    input.addEventListener('change', function () { onChange(input.checked); });
    return h('label.switch', [
      input,
      h('span.switch-track', h('span.switch-dot')),
      h('span.switch-label', { text: label })
    ]);
  }

  function textInput(value, onChange, opts) {
    opts = opts || {};
    var input = h('input.input', {
      type: opts.type || 'text',
      value: value === undefined || value === null ? '' : value,
      placeholder: opts.placeholder || '',
      min: opts.min, max: opts.max, step: opts.step
    });
    var emit = function () { onChange(input.value); };
    input.addEventListener('input', U.debounce(emit, opts.debounce || 300));
    input.addEventListener('change', emit);
    return input;
  }

  var api = {
    dialog: dialog,
    confirm: confirmDialog,
    prompt: promptDialog,
    copy: copyToClipboard,
    field: field,
    select: select,
    checkbox: checkbox,
    switchBox: switchBox,
    textInput: textInput
  };
  PV.dialog = api;
  Object.keys(api).forEach(function (k) { PV.ui[k] = api[k]; });
})(typeof window !== 'undefined' ? window : globalThis);
