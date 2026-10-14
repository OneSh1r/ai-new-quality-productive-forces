/* =============================================================================
 * A very small DOM/browser shim, just enough to boot the real application in
 * Node: elements, classList, events, SVG, a naive querySelector, layout
 * measurements and localStorage. Not a general purpose DOM.
 * ========================================================================== */
'use strict';

function makeStyle() {
  var store = {};
  return {
    setProperty: function (k, v) { store[k] = v; },
    getPropertyValue: function (k) { return store[k] || ''; },
    _store: store
  };
}

function decode(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** type is the tag name; pass isText for text nodes (SVG has a <text> tag). */
function Node(type, isText) {
  this.nodeType = isText ? 3 : 1;
  this.isTextNode = !!isText;
  this.tagName = (type || 'div').toUpperCase();
  this.childNodes = [];
  this.parentNode = null;
  this.attributes = {};
  this.style = makeStyle();
  this.dataset = {};
  this.listeners = {};
  this._text = '';
  this._classes = [];
  var self = this;
  this.classList = {
    add: function () { [].forEach.call(arguments, function (c) { if (self._classes.indexOf(c) < 0) self._classes.push(c); }); },
    remove: function () { [].forEach.call(arguments, function (c) { var i = self._classes.indexOf(c); if (i >= 0) self._classes.splice(i, 1); }); },
    contains: function (c) { return self._classes.indexOf(c) >= 0; },
    toggle: function (c) { self.classList.contains(c) ? self.classList.remove(c) : self.classList.add(c); }
  };
}

Object.defineProperty(Node.prototype, 'className', {
  get: function () { return this._classes.join(' '); },
  set: function (v) { this._classes = String(v).split(/\s+/).filter(Boolean); }
});

/* `h('div#id')` assigns `.id` directly, so route it through attributes. */
Object.defineProperty(Node.prototype, 'id', {
  get: function () { return this.attributes.id || ''; },
  set: function (v) { this.attributes.id = String(v); }
});

['value', 'placeholder', 'type'].forEach(function (prop) {
  Object.defineProperty(Node.prototype, prop, {
    get: function () { return this.attributes[prop] === undefined ? '' : this.attributes[prop]; },
    set: function (v) { this.attributes[prop] = v; },
    configurable: true
  });
});

['checked', 'disabled'].forEach(function (prop) {
  Object.defineProperty(Node.prototype, prop, {
    get: function () { return this.attributes[prop] === true; },
    set: function (v) { this.attributes[prop] = !!v; },
    configurable: true
  });
});

Object.defineProperty(Node.prototype, 'textContent', {
  get: function () {
    if (this.isTextNode) return this._text;
    var markup = this._html ? decode(String(this._html).replace(/<[^>]*>/g, '')) : '';
    return markup + this.childNodes.map(function (c) { return c.textContent; }).join('');
  },
  set: function (v) {
    this.childNodes = [];
    if (v === '' || v === null || v === undefined) return;
    var t = new Node('#text', true);
    t._text = String(v);
    t.parentNode = this;
    this.childNodes.push(t);
  }
});

Object.defineProperty(Node.prototype, 'innerHTML', {
  get: function () { return this._html || ''; },
  set: function (v) {
    this._html = String(v);
    this.childNodes = [];
  }
});

Object.defineProperty(Node.prototype, 'outerHTML', {
  get: function () {
    var self = this;
    if (this.isTextNode) return this._text;
    var attrs = Object.keys(this.attributes).map(function (k) {
      return k + '="' + String(self.attributes[k]).replace(/"/g, '&quot;') + '"';
    }).join(' ');
    var cls = this._classes.length ? ' class="' + this._classes.join(' ') + '"' : '';
    var style = this.style._store && Object.keys(this.style._store).length
      ? ' style="' + Object.keys(this.style._store).map(function (k) { return k + ':' + self.style._store[k]; }).join(';') + '"'
      : '';
    if (this.childNodes.length === 0 && !this._html) return '<' + this.tagName.toLowerCase() + cls + style + (attrs ? ' ' + attrs : '') + '/>';
    return '<' + this.tagName.toLowerCase() + cls + style + (attrs ? ' ' + attrs : '') + '>' +
      (this._html || '') + this.childNodes.map(function (c) { return c.outerHTML; }).join('') +
      '</' + this.tagName.toLowerCase() + '>';
  }
});

Node.prototype.appendChild = function (child) {
  if (!child) return child;
  if (child.parentNode) child.parentNode.removeChild(child);
  child.parentNode = this;
  this.childNodes.push(child);
  return child;
};

Node.prototype.insertBefore = function (child, ref) {
  if (child.parentNode) child.parentNode.removeChild(child);
  var i = this.childNodes.indexOf(ref);
  child.parentNode = this;
  if (i < 0) this.childNodes.push(child);
  else this.childNodes.splice(i, 0, child);
  return child;
};

Node.prototype.removeChild = function (child) {
  var i = this.childNodes.indexOf(child);
  if (i >= 0) this.childNodes.splice(i, 1);
  child.parentNode = null;
  return child;
};

Object.defineProperty(Node.prototype, 'firstChild', {
  get: function () { return this.childNodes[0] || null; }
});

Object.defineProperty(Node.prototype, 'lastChild', {
  get: function () { return this.childNodes[this.childNodes.length - 1] || null; }
});

Node.prototype.setAttribute = function (k, v) { this.attributes[k] = v; if (k === 'class') this.className = v; };
Node.prototype.getAttribute = function (k) {
  if (k === 'class') return this.className;
  return this.attributes[k] === undefined ? null : this.attributes[k];
};
Node.prototype.removeAttribute = function (k) { delete this.attributes[k]; };
Node.prototype.hasAttribute = function (k) { return this.attributes[k] !== undefined; };
Node.prototype.addEventListener = function (type, fn) {
  (this.listeners[type] = this.listeners[type] || []).push(fn);
};
Node.prototype.removeEventListener = function (type, fn) {
  var list = this.listeners[type] || [];
  var i = list.indexOf(fn);
  if (i >= 0) list.splice(i, 1);
};
Node.prototype.dispatchEvent = function (ev) {
  ev.target = ev.target || this;
  ev.currentTarget = this;
  var list = (this.listeners[ev.type] || []).slice();
  list.forEach(function (fn) { fn(ev); });
  if (this.parentNode && ev.bubbles) this.parentNode.dispatchEvent(ev);
  return true;
};
Node.prototype.click = function () {
  var self = this;
  (this.listeners.click || []).slice().forEach(function (fn) {
    fn({ type: 'click', target: self, stopPropagation: function () {}, preventDefault: function () {} });
  });
};
Node.prototype.getBoundingClientRect = function () {
  return { top: 0, left: 0, right: 240, bottom: 32, width: 240, height: 32 };
};
Node.prototype.getContext = function () {
  return { fillRect: function () {}, drawImage: function () {}, fillStyle: '' };
};
Node.prototype.cloneNode = function () {
  var copy = new Node(this.tagName.toLowerCase());
  copy._classes = this._classes.slice();
  copy.attributes = Object.assign({}, this.attributes);
  copy._html = this._html;
  copy._text = this._text;
  return copy;
};

function matches(node, sel) {
  if (!node || node.nodeType !== 1) return false;
  // supports "tag", ".class", "#id", "tag.class", comma lists and (simple)
  // descendant chains like ".panel .mini-table"
  return sel.split(',').some(function (part) {
    var steps = part.trim().split(/\s+/);
    if (!simpleMatch(node, steps[steps.length - 1])) return false;
    var i = steps.length - 2;
    var cur = node.parentNode;
    while (i >= 0 && cur) {
      if (cur.nodeType === 1 && simpleMatch(cur, steps[i])) i -= 1;
      cur = cur.parentNode;
    }
    return i < 0;
  });
}

function simpleMatch(node, sel) {
  if (!node || node.nodeType !== 1) return false;
  var m = /^([a-zA-Z]*)((?:[.#][\w-]+|\[[\w-]+(?:[~|^$*]?=(?:"[^"]*"|'[^']*'|[\w-]+))?\])*)$/.exec(sel || '');
  if (!m) return false;
  if (m[1] && node.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
  var rest = m[2] || '';
  var parts = rest.match(/[.#][\w-]+|\[[^\]]+\]/g) || [];
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (part.charAt(0) === '.') {
      if (node._classes.indexOf(part.slice(1)) < 0) return false;
    } else if (part.charAt(0) === '#') {
      if ((node.attributes.id || node.id) !== part.slice(1)) return false;
    } else {
      var body = part.slice(1, -1);
      var eq = body.indexOf('=');
      if (eq < 0) {
        if (node.attributes[body] === undefined) return false;
      } else {
        var name = body.slice(0, eq).trim();
        var want = body.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        var val = node.attributes[name];
        var have = val === undefined ? undefined : (name === 'class' ? node.className : String(val));
        if (have !== want) return false;
      }
    }
  }
  return !!(m[1] || parts.length);
}

function walk(node, fn) {
  node.childNodes.forEach(function (c) {
    if (c.nodeType === 1) { fn(c); walk(c, fn); }
  });
}

Node.prototype.querySelector = function (sel) {
  var found = null;
  walk(this, function (n) { if (!found && matches(n, sel)) found = n; });
  return found;
};

Node.prototype.querySelectorAll = function (sel) {
  var out = [];
  walk(this, function (n) { if (matches(n, sel)) out.push(n); });
  return out;
};

Node.prototype.matches = function (sel) { return matches(this, sel); };
Node.prototype.contains = function (other) {
  var n = other;
  while (n) { if (n === this) return true; n = n.parentNode; }
  return false;
};
Node.prototype.closest = function (sel) {
  var n = this;
  while (n) { if (n.nodeType === 1 && matches(n, sel)) return n; n = n.parentNode; }
  return null;
};
Node.prototype.focus = function () { document.activeElement = this; };
Node.prototype.select = function () {};
Node.prototype.setSelectionRange = function () {};
Node.prototype.scrollIntoView = function () {};

var document = {
  documentElement: new Node('html'),
  body: new Node('body'),
  activeElement: null,
  readyState: 'complete',
  listeners: {},
  createElement: function (tag) { return new Node(tag); },
  createElementNS: function (ns, tag) { return new Node(tag); },
  createTextNode: function (text) { var n = new Node('#text', true); n._text = String(text); return n; },
  getElementById: function (id) { return document.body.querySelector('#' + id); },
  querySelector: function (sel) { return document.body.querySelector(sel); },
  querySelectorAll: function (sel) { return document.body.querySelectorAll(sel); },
  addEventListener: function (type, fn) { (document.listeners[type] = document.listeners[type] || []).push(fn); },
  removeEventListener: function (type, fn) {
    var list = document.listeners[type] || [];
    var i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  },
  execCommand: function () { return true; }
};

var storage = {};
var localStorage = {
  getItem: function (k) { return storage[k] === undefined ? null : storage[k]; },
  setItem: function (k, v) { storage[k] = String(v); },
  removeItem: function (k) { delete storage[k]; }
};

function safeSet(root, key, value) {
  try {
    Object.defineProperty(root, key, { value: value, writable: true, configurable: true, enumerable: true });
  } catch (e) { /* read-only global: leave it alone */ }
}

function install(root, extra) {
  root.window = root;
  root.document = document;
  root.localStorage = localStorage;
  root.getComputedStyle = function () {
    return { getPropertyValue: function () { return ''; } };
  };
  root.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(Date.now()); }, 0); };
  root.customElements = undefined;
  root.CustomEvent = function (type, opts) {
    this.type = type;
    this.detail = opts && opts.detail;
    this.bubbles = !!(opts && opts.bubbles);
  };
  root.Node = Node;
  root.Element = Node;
  root.HTMLElement = Node;
  safeSet(root, 'navigator', { clipboard: null, userAgent: 'node-shim' });
  root.setTimeout = setTimeout;
  root.clearTimeout = clearTimeout;
  safeSet(root, 'performance', root.performance || { now: function () { return Date.now(); } });
  root.addEventListener = function (type, fn) { (document.listeners[type] = document.listeners[type] || []).push(fn); };
  root.removeEventListener = document.removeEventListener;
  root.innerWidth = 1440;
  root.innerHeight = 900;
  Object.assign(root, extra || {});
  document.body.parentNode = document.documentElement;
  document.documentElement.childNodes = [document.body];
  document.body.parentNode = document.documentElement;
  return { document: document, Node: Node };
}

module.exports = {
  install: install,
  Node: Node,
  document: document,
  matches: matches,
  walk: walk
};
