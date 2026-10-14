/* =============================================================================
 * Visual Pandas — fx.js
 * p5.js effects: an ambient data field for the empty workspace and an animated
 * distribution "ridge" behind the profile's key numbers. Both are guarded:
 * without p5, with prefers-reduced-motion, or when FX are switched off they
 * degrade to a static, still-legible surface.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util;

  var reduced = false;
  try {
    reduced = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { /* ignore */ }

  var instances = [];
  var paused = false;

  function available() { return typeof root.p5 === 'function'; }
  function enabled() {
    var s = PV.app && PV.app.state;
    return available() && (!s || s.fx !== false);
  }

  function colors() { return PV.charts.colors(); }

  function sizeOf(node, fallbackW, fallbackH) {
    var w = node.clientWidth || fallbackW || 320;
    var h = node.clientHeight || fallbackH || 90;
    // an explicit size (small rings) must win over the minimum for big surfaces
    if (fallbackW && fallbackH) return { w: Math.round(w), h: Math.round(h) };
    return { w: Math.max(120, Math.round(w)), h: Math.max(48, Math.round(h)) };
  }

  /** Static stand-in so the layout never collapses when effects are off. */
  function fallback(node, opts) {
    node.classList.add('fx-static');
    if (opts && opts.fallbackText) {
      node.appendChild(U.h('div.fx-static-text', { text: opts.fallbackText }));
    }
  }

  /**
   * Sketches are registered on their node so they can be rebuilt after the
   * app re-renders (or after a cached view is re-attached).
   */
  function register(node, kind, args, build) {
    var list = (node.__pvFx = node.__pvFx || []);
    if (list.indexOf(kind) < 0) list.push(kind);
    node.__pvBuild = node.__pvBuild || {};
    node.__pvBuild[kind] = build;
    mountNow(node, kind, args);
  }

  function mountNow(node, kind, args) {
    if (node.__pvLive) return null;
    if (!enabled() || reduced) { fallback(node, args); return null; }
    var build = (node.__pvBuild || {})[kind];
    if (!build) return null;
    try {
      var inst = build(node);
      if (!inst) { fallback(node, args); return null; }
      inst.__pvNode = node;
      node.__pvLive = true;
      instances.push(inst);
      if (paused) inst.noLoop();
      node.classList.add('fx-live');
      return inst;
    } catch (e) {
      fallback(node, args);
      return null;
    }
  }

  /** (Re)create every registered sketch inside a subtree that is not live. */
  function mountAll(rootNode) {
    if (!rootNode || rootNode.nodeType !== 1) return;
    if (rootNode.__pvFx) rootNode.__pvFx.forEach(function (k) { mountNow(rootNode, k, {}); });
    if (!rootNode.querySelectorAll) return;
    var nodes = rootNode.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].__pvFx) continue;
      nodes[i].__pvFx.forEach(function (k) { mountNow(nodes[i], k, {}); });
    }
  }

  function killAll() {
    instances.forEach(function (inst) {
      if (inst.__pvNode) {
        inst.__pvNode.__pvLive = false;
        inst.__pvNode.classList.remove('fx-live');
      }
      try { inst.remove(); } catch (e) { /* ignore */ }
    });
    instances = [];
  }

  /**
   * Mount an effect after the node is attached, or apply the static fallback
   * immediately when p5 is unavailable / motion is reduced. Callers use this
   * so the surface looks right even before (or without) any canvas.
   */
  function schedule(node, opts, mountFn) {
    if (!enabled() || reduced) {
      fallback(node, opts);
      return false;
    }
    setTimeout(function () { mountFn(); }, 0);
    return true;
  }

  function setPaused(flag) {
    paused = flag;
    instances.forEach(function (inst) {
      try { flag ? inst.noLoop() : inst.loop(); } catch (e) { /* ignore */ }
    });
  }

  root.document && document.addEventListener('visibilitychange', function () {
    setPaused(!!document.hidden);
  });

  /* ------------------------- ambient data field ------------------------- */
  /**
   * A slow lattice of dots that breathe — used where the workspace would
   * otherwise be empty (no dataset yet).
   */
  function ambientField(node, opts) {
    opts = opts || {};
    return register(node, 'ambient', opts, function () { return new root.p5(function (p) {
      var c = colors();
      var dots = [];
      var box = sizeOf(node, opts.width, opts.height);
      p.setup = function () {
        p.createCanvas(box.w, box.h);
        p.frameRate(30);
        p.noStroke();
        var gap = 26;
        for (var x = gap / 2; x < box.w; x += gap) {
          for (var y = gap / 2; y < box.h; y += gap) {
            dots.push({ x: x, y: y, ph: p.random(6.28), sp: p.random(0.6, 1.5) });
          }
        }
      };
      p.draw = function () {
        p.clear();
        var t = p.millis() / 1000;
        for (var i = 0; i < dots.length; i++) {
          var d = dots[i];
          var wave = Math.sin(t * d.sp + d.ph);
          var r = 1.1 + 1.5 * (wave * 0.5 + 0.5);
          var dx = Math.sin(t * 0.25 + d.ph) * 6;
          var dy = Math.cos(t * 0.21 + d.ph * 1.3) * 6;
          var hueMix = (i % 5 === 0) ? 1 : 0;
          var col = p.color(hueMix ? c.palette[1] : c.accent);
          col.setAlpha(28 + 46 * (wave * 0.5 + 0.5));
          p.fill(col);
          p.circle(d.x + dx, d.y + dy, r * 2);
        }
      };
      p.windowResized = function () {
        var b = sizeOf(node, opts.width, opts.height);
        p.resizeCanvas(b.w, b.h);
      };
    }, node); });
  }

  /* --------------------------- distribution ridge ------------------------ */
  /**
   * An animated silhouette of a numeric column, with a highlight sweeping
   * across it. `valuesOf` is read on every frame so it always reflects the
   * column the user is looking at.
   */
  function ridgeStrip(node, valuesOf, opts) {
    opts = opts || {};
    return register(node, 'ridge', opts, function () { return new root.p5(function (p) {
      var c = colors();
      var box = sizeOf(node, opts.width, opts.height);
      var shape = [];
      var smoothShape = [];
      p.setup = function () {
        p.createCanvas(box.w, box.h);
        p.frameRate(30);
        p.noStroke();
        shape = buildShape();
      };
      function buildShape() {
        var vals = valuesOf() || [];
        var bins = Math.max(18, Math.min(64, Math.round(box.w / 14)));
        var counts = new Array(bins).fill(0);
        if (!vals.length) return counts.map(function (_, i) { return 0.12 + 0.06 * Math.sin(i / 3); });
        var lo = Math.min.apply(null, vals);
        var hi = Math.max.apply(null, vals);
        var span = hi - lo || 1;
        vals.forEach(function (v) {
          var i = Math.floor((v - lo) / span * bins);
          counts[Math.max(0, Math.min(bins - 1, i))] += 1;
        });
        var max = Math.max.apply(null, counts) || 1;
        return counts.map(function (n) { return n / max; });
      }
      function smooth(target, k) {
        if (smoothShape.length !== target.length) smoothShape = target.slice();
        for (var i = 0; i < target.length; i++) {
          smoothShape[i] += (target[i] - smoothShape[i]) * k;
        }
        return smoothShape;
      }
      p.draw = function () {
        p.clear();
        var target = buildShape();
        var s = smooth(target, 0.08);
        var w = box.w / s.length;
        var t = p.millis() / 1000;
        var sweep = (t * 0.18) % 1;
        for (var i = 0; i < s.length; i++) {
          var h2 = Math.max(3, s[i] * (box.h - 10));
          var x = i * w;
          var dist = Math.abs((i / s.length) - sweep);
          var glow = Math.max(0, 1 - dist * 7);
          var col = p.color(c.accent);
          col.setAlpha(26 + 60 * s[i] + 60 * glow);
          p.fill(col);
          p.rect(x + 0.6, box.h - h2, Math.max(1, w - 1.2), h2, 3);
        }
      };
      p.windowResized = function () {
        var b = sizeOf(node, opts.width, opts.height);
        p.resizeCanvas(b.w, b.h);
        box = b;
      };
    }, node); });
  }

  /** Animated ratio ring drawn with p5 (used inside the key-number tiles). */
  function ratioRing(node, ratioOf, opts) {
    opts = opts || {};
    return register(node, 'ring', opts, function () { return new root.p5(function (p) {
      var box = sizeOf(node, opts.size || 46, opts.size || 46);
      var shown = 0;
      p.setup = function () {
        p.createCanvas(box.w, box.h);
        p.frameRate(30);
        p.noFill();
      };
      p.draw = function () {
        p.clear();
        var c = colors();
        var target = U.clamp(ratioOf() || 0, 0, 1);
        shown += (target - shown) * 0.12;
        var cx = box.w / 2, cy = box.h / 2;
        var r = Math.min(box.w, box.h) / 2 - 4;
        p.strokeWeight(4);
        var track = p.color(c.line);
        track.setAlpha(180);
        p.stroke(track);
        p.arc(cx, cy, r * 2, r * 2, 0, Math.PI * 2);
        var col = p.color(opts.color || c.accent);
        p.stroke(col);
        p.arc(cx, cy, r * 2, r * 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * shown);
      };
    }, node); });
  }

  PV.fx = {
    available: available,
    enabled: enabled,
    ambientField: ambientField,
    ridgeStrip: ridgeStrip,
    ratioRing: ratioRing,
    killAll: killAll,
    mountAll: mountAll,
    schedule: schedule,
    setPaused: setPaused,
    count: function () { return instances.length; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
