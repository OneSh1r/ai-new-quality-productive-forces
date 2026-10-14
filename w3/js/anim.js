/* =============================================================================
 * Visual Pandas — anim.js
 * Motion layer built on D3: chart marks travel from their previous geometry
 * instead of snapping, numbers count up, panels fade in. Everything is
 * optional — without d3 (or with reduced motion) the app renders statically.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util;

  var reduced = false;
  try {
    reduced = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { /* ignore */ }

  function hasD3() { return !!(root.d3 && root.d3.select && root.d3.transition); }
  function enabled() { return hasD3() && !reduced; }
  function ease(name) {
    var fn = root.d3 && root.d3['ease' + name];
    return typeof fn === 'function' ? fn : function (t) { return t; };
  }

  /** Index the marks of a rendered chart by their data-key. */
  function keyMap(svg) {
    var map = new Map();
    if (!svg || !svg.querySelectorAll) return map;
    var nodes = svg.querySelectorAll('[data-key]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-key');
      if (key !== null && !map.has(key)) map.set(key, nodes[i]);
    }
    return map;
  }

  var GEO_ATTRS = { rect: ['x', 'y', 'width', 'height'], circle: ['cx', 'cy', 'r'], image: ['x', 'y'] };

  function collect(el, old, tag) {
    var from = {}, to = {};
    var attrs = GEO_ATTRS[tag] || [];
    for (var i = 0; i < attrs.length; i++) {
      var a = attrs[i];
      var now = el.getAttribute(a), was = old.getAttribute(a);
      if (now === null || was === null) continue;
      var nNow = Number(now), nWas = Number(was);
      if (!isFinite(nNow) || !isFinite(nWas) || nNow === nWas) continue;
      from[a] = nWas;
      to[a] = nNow;
    }
    return { from: from, to: to };
  }

  function run(el, from, to, dur, delay) {
    if (!Object.keys(to).length) return;
    var sel = root.d3.select(el);
    Object.keys(from).forEach(function (a) { sel.attr(a, from[a]); });
    var tr = sel.transition().duration(dur).delay(delay || 0).ease(ease('CubicOut'));
    Object.keys(to).forEach(function (a) { tr.attr(a, to[a]); });
  }

  function fadeIn(svg, opts) {
    if (!enabled()) return;
    var nodes = svg.querySelectorAll('[data-key]');
    var dur = (opts && opts.duration) || 320;
    for (var i = 0; i < nodes.length; i++) {
      root.d3.select(nodes[i])
        .attr('opacity', 0)
        .transition()
        .duration(dur)
        .delay(Math.min(i * 4, 140))
        .ease(ease('QuadOut'))
        .attr('opacity', nodes[i].getAttribute('data-opacity') || 1);
    }
  }

  /**
   * Animate `svg` from the geometry of `prevSvg` (matched by data-key).
   * Marks that did not exist before fade in; paths interpolate their `d`.
   */
  function transition(svg, prevSvg, opts) {
    if (!svg) return;
    if (!enabled()) return;
    if (!prevSvg) { fadeIn(svg, opts); return; }
    opts = opts || {};
    var dur = opts.duration === undefined ? 420 : opts.duration;
    var prev = keyMap(prevSvg);
    var nodes = svg.querySelectorAll('[data-key]');
    var fresh = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = el.getAttribute('data-key');
      var old = prev.get(key);
      var tag = el.tagName.toLowerCase();
      if (!old || old.tagName.toLowerCase() !== tag) { fresh.push(el); continue; }
      if (tag === 'path') {
        var dNow = el.getAttribute('d'), dWas = old.getAttribute('d');
        if (dNow && dWas && dNow !== dWas) {
          var interp = root.d3.interpolateString(dWas, dNow);
          root.d3.select(el).attr('d', dWas)
            .transition().duration(dur).ease(ease('CubicOut'))
            .attrTween('d', function () { return function (t) { return interp(t); }; });
        }
        continue;
      }
      var geo = collect(el, old, tag);
      run(el, geo.from, geo.to, dur, 0);
    }
    if (fresh.length) fadeIn({ querySelectorAll: function () { return fresh; } }, { duration: 320 });
  }

  /** Count a number up (or down) inside a node. */
  function counter(node, to, opts) {
    if (!node) return;
    opts = opts || {};
    var from = opts.from === undefined ? 0 : opts.from;
    var fmt = opts.format || function (v) { return U.fmtNumber(v, { maxFrac: opts.decimals || 0 }); };
    if (!enabled() || from === to) { node.textContent = fmt(to); return; }
    node.textContent = fmt(from);
    var start = null;
    var dur = opts.duration || 560;
    root.d3.timer(function (t) {
      if (start === null) start = t;
      var k = Math.min(1, (t - start) / dur);
      node.textContent = fmt(from + (to - from) * ease('CubicOut')(k));
      return k < 1;
    });
  }

  /** Soft entrance for a freshly rendered panel. */
  function enter(node, opts) {
    if (!node || !enabled()) return;
    opts = opts || {};
    var attr = opts.attribute || 'opacity';
    root.d3.select(node)
      .style('opacity', 0)
      .transition().duration(opts.duration || 260).ease(ease('QuadOut'))
      .style('opacity', 1);
  }

  PV.anim = {
    available: hasD3,
    enabled: enabled,
    reduced: function () { return reduced; },
    transition: transition,
    fadeIn: fadeIn,
    counter: counter,
    enter: enter
  };
})(typeof window !== 'undefined' ? window : globalThis);
