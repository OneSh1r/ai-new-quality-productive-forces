/* =============================================================================
 * Visual Pandas — ui.js
 * Icons, buttons, panel chrome, toasts and floating menus.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, h = U.h;

  function icon(name, size) {
    var paths = (PV.icons && PV.icons[name]) || PV.icons.question;
    // icons.js stores bare path data ("M12 3..."), so it has to be wrapped in a
    // <path> element: a bare text node inside <svg> paints nothing at all.
    return h('i.icon', {
      html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
        'stroke-linecap="round" stroke-linejoin="round"' +
        (size ? ' width="' + size + '" height="' + size + '"' : '') +
        '><path d="' + paths + '"/></svg>',
      'aria-hidden': 'true'
    });
  }

  function button(opts) {
    opts = opts || {};
    var cls = 'btn' + (opts.variant ? ' btn-' + opts.variant : '') +
      (opts.size ? ' btn-' + opts.size : '') + (opts.block ? ' btn-block' : '') +
      (opts.class ? ' ' + opts.class : '');
    var kids = [];
    if (opts.icon) kids.push(icon(opts.icon));
    if (opts.label) kids.push(h('span', { text: opts.label }));
    if (opts.caret) kids.push(icon('chevronDown'));
    var el = h('button', {
      class: cls, type: 'button', title: opts.title,
      disabled: opts.disabled, 'aria-label': opts.ariaLabel,
      on: { click: opts.onClick }
    }, kids);
    if (opts.tip) el.setAttribute('data-tip', opts.tip);
    return el;
  }

  function iconButton(name, opts) {
    opts = Object.assign({}, opts || {}, { icon: name });
    var el = button(opts);
    el.classList.add('btn-icon');
    if (!opts.label && !opts.ariaLabel) el.setAttribute('aria-label', opts.tip || name);
    if (opts.tip) el.setAttribute('data-tip', opts.tip);
    return el;
  }

  function tipAttrs(text) { return text ? { 'data-tip': text } : {}; }

  function panelHead(title, actions, opts) {
    opts = opts || {};
    return h('div.panel-head', [
      h('div.panel-title', [
        opts.icon ? icon(opts.icon) : null,
        h('span', { text: title }),
        opts.badge ? h('span.badge', { text: opts.badge }) : null
      ]),
      actions && actions.length ? h('div.panel-actions', actions) : null
    ]);
  }

  function emptyState(title, hint, action) {
    return h('div.empty-state', [
      h('div.empty-title', { text: title }),
      hint ? h('div.empty-hint', { text: hint }) : null,
      action || null
    ]);
  }

  /**
   * A panel whose head toggles its body. The open/closed state is supplied by
   * the caller so it survives the full re-render the app does on every change.
   */
  function collapsible(title, opts) {
    opts = opts || {};
    var open = opts.open !== false;
    var head = h('button.panel-head.panel-toggle', {
      type: 'button',
      'aria-expanded': open ? 'true' : 'false',
      'aria-label': open ? PV.i18n.t('misc.collapse') : PV.i18n.t('misc.expand'),
      on: { click: function () { if (opts.onToggle) opts.onToggle(); } }
    }, [
      h('div.panel-title', [
        opts.icon ? icon(opts.icon) : null,
        h('span', { text: title }),
        opts.badge ? h('span.badge', { text: opts.badge }) : null
      ]),
      h('div.panel-actions', [icon(open ? 'chevronUp' : 'chevronDown')])
    ]);
    var panel = h('div.panel.panel-collapsible' + (open ? '.is-open' : ''), [head]);
    if (open && opts.build) panel.appendChild(h('div.panel-body', [opts.build()]));
    return panel;
  }

  /* ------------------------------- toasts ------------------------------- */
  function toastHost() {
    var host = document.getElementById('toasts');
    if (!host) {
      host = h('div#toasts.toasts', { role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(host);
    }
    return host;
  }

  function toast(message, opts) {
    opts = opts || {};
    var host = toastHost();
    var node = h('div.toast' + (opts.type ? '.toast-' + opts.type : ''), [
      opts.icon ? icon(opts.icon) : null,
      h('span.toast-text', { text: message }),
      opts.action ? h('button.toast-action', {
        type: 'button', text: opts.action.label,
        on: { click: function () { opts.action.onClick(); remove(); } }
      }) : null
    ]);
    host.appendChild(node);
    var timer = setTimeout(remove, opts.duration || 3400);
    function remove() {
      clearTimeout(timer);
      node.classList.add('is-leaving');
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 220);
    }
    return remove;
  }

  /* -------------------------------- menus ------------------------------- */
  var openMenuEl = null;
  function closeMenu() {
    if (openMenuEl && openMenuEl.parentNode) openMenuEl.parentNode.removeChild(openMenuEl);
    openMenuEl = null;
  }

  function menu(anchor, items, opts) {
    opts = opts || {};
    closeMenu();
    var box = h('div.menu', { role: 'menu' });
    items.forEach(function (it) {
      if (!it) return;
      if (it.separator) { box.appendChild(h('div.menu-sep')); return; }
      box.appendChild(h('button.menu-item' + (it.danger ? '.is-danger' : '') +
        (it.checked ? '.is-checked' : ''), {
        type: 'button', role: 'menuitem', disabled: it.disabled,
        on: {
          click: function (ev) {
            ev.stopPropagation();
            closeMenu();
            if (it.onSelect) it.onSelect();
          }
        }
      }, [
        it.icon ? icon(it.icon) : h('i.icon.icon-placeholder'),
        h('span.menu-label', { text: it.label }),
        it.hint ? h('span.menu-hint', { text: it.hint }) : null,
        it.checked ? icon('check') : null
      ]));
    });
    document.body.appendChild(box);
    var rect = anchor.getBoundingClientRect();
    var w = box.offsetWidth, hgt = box.offsetHeight;
    var left = opts.align === 'right' ? rect.right - w : rect.left;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (left < 8) left = 8;
    var top = rect.bottom + 6;
    if (top + hgt > window.innerHeight - 8) top = Math.max(8, rect.top - hgt - 6);
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    openMenuEl = box;
    setTimeout(function () {
      document.addEventListener('mousedown', onDocDown, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', closeMenu, true);
    }, 0);
    function clean() {
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', closeMenu, true);
    }
    function onDocDown(ev) {
      if (box.contains(ev.target)) return;
      clean();
      closeMenu();
    }
    function onKey(ev) { if (ev.key === 'Escape') { clean(); closeMenu(); } }
    return box;
  }

  PV.ui = {
    icon: icon,
    button: button,
    iconButton: iconButton,
    panelHead: panelHead,
    emptyState: emptyState,
    collapsible: collapsible,
    toast: toast,
    menu: menu,
    closeMenu: closeMenu,
    tipAttrs: tipAttrs
  };
})(typeof window !== 'undefined' ? window : globalThis);
