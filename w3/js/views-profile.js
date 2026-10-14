/* =============================================================================
 * Visual Pandas — views-profile.js
 * The data profile: overview cards, df.info(), df.describe(), missing values,
 * value counts and data quality checks. Charts live in views-profile2.js.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, h = U.h, ui = PV.ui, dlg = PV.dialog, D = PV.df, S = PV.stats;
  var A = PV.app, ST = A.state;
  var t = function (k, v) { return PV.i18n.t(k, v); };

  function card(label, value, hint) {
    return h('div.stat-card', [
      h('div.stat-label', { text: label }),
      h('div.stat-value', { text: value }),
      hint ? h('div.stat-hint', { text: hint }) : null
    ]);
  }

  /**
   * A key-number tile: the value counts up and an optional ratio ring animates
   * in. Both effects degrade to plain text without d3/p5.
   */
  function metricTile(opts) {
    var valueNode = h('div.stat-value');
    var ringNode = opts.ring ? h('div.stat-ring') : null;
    var tile = h('div.stat-card', [
      h('div.stat-label', { text: opts.label }),
      h('div.stat-value-row', [valueNode, ringNode]),
      opts.hint ? h('div.stat-hint', { text: opts.hint }) : null
    ]);
    setTimeout(function () {
      if (PV.anim) PV.anim.counter(valueNode, opts.value, { format: opts.format || U.fmtInt });
    }, 0);
    if (ringNode && PV.fx) {
      PV.fx.schedule(ringNode, {}, function () {
        PV.fx.ratioRing(ringNode, opts.ring, { size: 44, color: opts.ringColor });
      });
    }
    return tile;
  }

  function overview(df) {
    var info = df.info();
    var cells = df.nrows * df.ncols;
    var missing = info.reduce(sumMissing, 0);
    var dups = df.duplicated([], 'first').filter(Boolean).length;
    var numeric = df.numericColumns().length;
    var cats = df.categoricalColumns().length;
    var dates = df.dateColumns().length;
    var ridge = h('div.fx-ridge');
    var tiles = h('div.stat-cards', [
      metricTile({
        label: t('top.rows'), value: df.nrows,
        hint: t('profile.rows_total') + ' × ' + df.ncols + ' ' + t('misc.cols_unit')
      }),
      metricTile({
        label: t('top.cols'), value: df.ncols,
        hint: t('profile.cells') + ' ' + U.fmtInt(cells)
      }),
      metricTile({
        label: t('profile.missing_cells'), value: missing,
        hint: cells ? U.fmtPercent(missing / cells, 1) : '—',
        ring: function () { return cells ? missing / cells : 0; },
        ringColor: PV.charts.colors().palette[2]
      }),
      metricTile({
        label: t('profile.dup_rows'), value: dups,
        hint: dups ? t('profile.drop_dups') : t('misc.none'),
        ring: dups ? function () { return dups / Math.max(1, df.nrows); } : null,
        ringColor: PV.charts.colors().palette[3]
      })
    ]);
    var meta = h('div.profile-meta', [
      metaChip('hash', t('profile.numeric_n'), numeric),
      metaChip('text', t('profile.cat_n'), cats),
      metaChip('calendar', t('profile.dt_n'), dates),
      metaChip('save', t('profile.memory'), U.fmtBytes(df.memoryBytes()))
    ]);
    var panel = h('section.panel.panel-overview.span-12', [
      ui.panelHead(t('profile.key_stats'), [], { icon: 'gauge' }),
      h('div.panel-body', [ridge, tiles, meta])
    ]);
    // the ridge draws the distribution of the column currently in focus
    if (PV.fx) {
      PV.fx.schedule(ridge, {}, function () {
        PV.fx.ridgeStrip(ridge, function () {
          var frame = A.result().df;
          if (!frame) return [];
          // a numeric column shows an actual distribution; otherwise fall back
          var col = (frame.has(ST.profile.col) && frame.kind(ST.profile.col) === 'numeric')
            ? ST.profile.col : frame.numericColumns()[0];
          return col ? PV.stats.numeric(frame.col(col)) : [];
        }, { height: 62 });
      });
    }
    return panel;
  }

  function sumMissing(total, c) { return total + c.missing; }

  function metaChip(icon, label, value) {
    return h('span.meta-chip', [
      ui.icon(icon),
      h('span.meta-chip-label', { text: label }),
      h('b', { text: String(value) })
    ]);
  }

  /* ---------------------------- column atlas --------------------------- */
  /**
   * One thumbnail per column: numeric → distribution, category → frequencies,
   * datetime → monthly volume. This is the fastest way to see what a whole
   * table looks like, and a click turns any picture into the "current column".
   */
  function atlasPanel(df) {
    var info = df.info();
    var grid = h('div.atlas-grid');
    info.forEach(function (rec) {
      var vals = df.col(rec.name);
      var kind = rec.kind;
      var thumb = h('div.atlas-thumb');
      if (kind === 'numeric') {
        thumb.appendChild(PV.charts.miniChart('hist', vals, {}));
      } else if (kind === 'datetime') {
        var buckets = new Map();
        vals.forEach(function (v) {
          if (!(v instanceof Date)) return;
          var k = v.getFullYear() + '-' + (v.getMonth() + 1);
          buckets.set(k, (buckets.get(k) || 0) + 1);
        });
        var series = Array.from(buckets.keys()).sort().map(function (k) { return buckets.get(k); });
        thumb.appendChild(PV.charts.miniChart('line', series.length > 1 ? series : [0, 0], {}));
      } else {
        var vc = df.valueCounts(rec.name, { limit: 0 });
        // few categories → frequencies; many → a rank–frequency curve, which
        // reads as "a few common values and a long tail of rare ones"
        if (vc.length > 12) {
          thumb.appendChild(PV.charts.miniChart('line', vc.map(function (r) { return r.count; }), {}));
        } else {
          thumb.appendChild(PV.charts.miniChart('bars', vc.map(function (r) { return r.count; }), {}));
        }
      }
      var missingPct = df.nrows ? rec.missing / df.nrows : 0;
      var cell = h('button.atlas-cell' + (ST.table.hidden[rec.name] ? '.is-dim' : ''), {
        type: 'button',
        'data-tip': rec.name + ' · ' + rec.dtype,
        on: {
          click: function () {
            PV.focus.set(rec.name);
            A.setInspector('column', { col: rec.name });
          }
        }
      }, [
        thumb,
        h('div.atlas-name', { text: rec.name }),
        h('div.atlas-meta', [
          h('span.dtype-badge', { text: rec.dtype }),
          h('span.atlas-unique', { text: 'n=' + U.fmtShort(rec.unique) }),
          missingPct > 0
            ? h('span.atlas-missing', { text: 'NaN ' + U.fmtPercent(missingPct, 0) })
            : h('span.atlas-ok', { text: t('misc.none') })
        ]),
        h('div.atlas-track', [
          h('span.atlas-fill', { style: { width: (missingPct * 100).toFixed(1) + '%' } })
        ])
      ]);
      grid.appendChild(cell);
    });
    return h('section.panel.span-12.panel-atlas', [
      ui.panelHead(t('profile.atlas.title'), [
        h('span.badge', { text: t('profile.atlas.hint') })
      ], { icon: 'grid' }),
      h('div.panel-body', [grid])
    ]);
  }

  function infoTable(df) {
    var info = df.info();
    var numeric = df.numericColumns();
    var table = h('table.data-table');
    var head = h('tr');
    [t('profile.col'), t('cols.type'), t('profile.non_null'), t('profile.na_pct'),
      t('profile.unique_n'), t('profile.distribution'), t('profile.sample')]
      .forEach(function (x) { head.appendChild(h('th', { text: x })); });
    table.appendChild(h('thead', head));
    var body = h('tbody');
    info.forEach(function (c) { body.appendChild(infoRow(df, c, numeric)); });
    table.appendChild(body);
    return h('div.table-scroll', table);
  }

  function infoRow(df, c, numeric) {
    var tr = h('tr', { on: { click: function () { A.setInspector('column', { col: c.name }); } } });
    tr.appendChild(h('td.name-cell', { text: c.name }));
    tr.appendChild(h('td', [h('span.dtype-badge', { text: c.dtype })]));
    tr.appendChild(h('td.num', { text: U.fmtInt(c.nonNull) }));
    var pct = df.nrows ? c.missing / df.nrows : 0;
    tr.appendChild(h('td.num' + (pct > 0.2 ? '.is-warn' : ''), { text: pct ? U.fmtPercent(pct, 1) : '—' }));
    tr.appendChild(h('td.num', { text: U.fmtInt(c.unique) }));
    var td = h('td');
    td.appendChild(PV.charts.sparkline(df.col(c.name), {
      width: 110, height: 24, type: numeric.indexOf(c.name) >= 0 ? 'bar' : 'line'
    }));
    tr.appendChild(td);
    tr.appendChild(h('td.sample-cell', {
      text: c.sample.slice(0, 2).map(function (v) { return U.fmtValue(v, { maxFrac: 2 }); }).join(', ')
    }));
    return tr;
  }

  /* ----------------------------- describe ------------------------------- */
  function describeTable(statistics, columns, values) {
    var table = h('table.data-table');
    var head = h('tr');
    head.appendChild(h('th', { text: '' }));
    columns.forEach(function (c) { head.appendChild(h('th.num', { text: c })); });
    table.appendChild(h('thead', head));
    var body = h('tbody');
    statistics.forEach(function (statLabel, r) { body.appendChild(describeRow(statLabel, r, columns, values)); });
    table.appendChild(body);
    return h('div.table-scroll', table);
  }

  function describeRow(statLabel, r, columns, values) {
    var tr = h('tr');
    tr.appendChild(h('td.stat-cell', { text: statLabel }));
    columns.forEach(function (c, ci) {
      var v = values[r][ci];
      var isNum = typeof v === 'number';
      tr.appendChild(h('td.num', {
        text: (v === null || v === undefined) ? 'NaN' : (isNum ? U.fmtNumber(v, { maxFrac: 3 }) : U.truncate(String(v), 16))
      }));
    });
    return tr;
  }

  function describeTables(df) {
    var wrap = h('div');
    var numeric = df.describeNumeric();
    if (numeric.columns.length) {
      wrap.appendChild(h('div.sub-title', { text: t('profile.describe.numeric') }));
      wrap.appendChild(describeTable(numeric.statistic, numeric.columns, numeric.values));
    }
    var cats = df.describeCategorical();
    if (cats.columns.length) {
      wrap.appendChild(h('div.sub-title', { text: t('profile.describe.categorical') }));
      wrap.appendChild(describeTable(cats.statistic, cats.columns, cats.values));
    }
    return wrap;
  }

  /* ------------------------- missing values ----------------------------- */
  /**
   * Missingness matrix (missingno style): one row per sampled record and one
   * column per field, filled where a value is missing. Gaps that appear in
   * blocks mean the missingness is systematic rather than random.
   */
  function missingMatrixPanel(df) {
    var cols = df.names.slice(0, 26);
    var hasGaps = df.info().some(function (c) { return c.missing > 0; });
    if (!hasGaps) return h('div.ok-note', [ui.icon('check'), h('span', { text: t('profile.missing.none') })]);
    var sampleRows = Math.min(df.nrows, 140);
    var rowH = 1.6;
    var colW = U.clamp(560 / cols.length, 10, 26);
    var top = 34;
    var c = PV.charts.colors();
    var svg = U.s('svg.mini', {
      viewBox: '0 0 ' + (cols.length * colW) + ' ' + (top + sampleRows * rowH + 4),
      width: '100%', height: top + sampleRows * rowH + 4,
      preserveAspectRatio: 'none', role: 'img', 'aria-label': t('profile.missingmatrix.title')
    });
    svg.appendChild(U.s('rect', {
      x: 0, y: top, width: cols.length * colW, height: sampleRows * rowH,
      fill: c.dark ? '#1b2330' : '#e9edf4'
    }));
    var idx = [];
    for (var i = 0; i < sampleRows; i++) {
      idx.push(df.nrows <= 1 ? 0 : Math.round(i * (df.nrows - 1) / (sampleRows - 1)));
    }
    cols.forEach(function (col, ci) {
      var vals = df.col(col);
      idx.forEach(function (rowIndex, ri) {
        if (!U.isNA(vals[rowIndex])) return;          // only the gaps are drawn
        svg.appendChild(U.s('rect', {
          x: (ci * colW).toFixed(1), y: (top + ri * rowH).toFixed(2),
          width: colW.toFixed(1), height: (rowH + 0.2).toFixed(2),
          fill: c.palette[2], opacity: 1, 'data-key': 'mm|' + col + '|' + ri
        }));
      });
      svg.appendChild(U.s('text', {
        x: (ci * colW + colW / 2).toFixed(1), y: (top - 5).toFixed(1),
        'text-anchor': 'start', fill: c.muted, 'font-size': 9,
        transform: 'rotate(-60 ' + (ci * colW + colW / 2).toFixed(1) + ' ' + (top - 5).toFixed(1) + ')'
      }, U.truncate(col, 14)));
    });
    // the count sits above the matrix: with a clean dataset the matrix itself
    // is almost empty, and the number is what makes that readable
    var total = df.info().reduce(function (a, c) { return a + c.missing; }, 0);
    var cells = Math.max(1, df.nrows * df.ncols);
    return h('div.matrix-body', [
      h('div.matrix-legend', [
        h('span.legend-swatch', { style: { background: PV.charts.colorAt(2) } }),
        h('span', {
          text: t('profile.missingmatrix.count', { n: U.fmtInt(total), p: U.fmtPercent(total / cells, 2) })
        })
      ]),
      h('div.matrix-scroll', [svg]),
      h('div.sub-hint', { text: t('profile.missingmatrix.rows', { n: sampleRows }) + ' · ' + t('profile.missingmatrix.hint') })
    ]);
  }

  /** Mixed-type association matrix: numeric, categorical and mixed pairs. */
  function assocPanel(df) {
    var info = df.info();
    var cols = df.names.filter(function (c) {
      var rec = info.filter(function (i) { return i.name === c; })[0];
      return rec && rec.unique > 1 && (rec.kind === 'numeric' || rec.kind === 'category' || rec.kind === 'bool');
    }).slice(0, 8);
    if (cols.length < 3) return h('div.sub-hint', { text: t('profile.corr.need') });
    var matrix = df.assocMatrix(cols);
    var holder = h('div.chart-holder');
    var cell = h('div');
    PV.charts.render(holder, {
      type: 'heatmap', x: '__matrix__', y: cols, matrix: matrix, height: 300
    }, df, {
      width: 420,
      onMark: function (m) {
        if (m.kind !== 'corr') return;
        var a = m.field, b = m.field2;
        if (df.kind(a) === 'numeric' && df.kind(b) === 'numeric') {
          ST.charts.spec = Object.assign({}, A.defaultChart, { type: 'density', x: a, y: [b] });
          A.setTab('charts');
        } else {
          PV.focus.set(a);
          A.setInspector('column', { col: a });
        }
      }
    });
    cell.appendChild(holder);
    cell.appendChild(h('div.sub-hint', { text: t('profile.assoc.hint') }));
    return cell;
  }

  function missingPanel(df) {
    var info = df.info().filter(hasMissing).sort(byCountDesc);
    if (!info.length) {
      return h('div.ok-note', [ui.icon('check'), h('span', { text: t('profile.missing.none') })]);
    }
    var total = info.reduce(sumMissing, 0);
    var wrap = h('div.missing-list');
    wrap.appendChild(h('div.missing-summary', [
      h('span', { text: t('profile.missing_total') }),
      h('b', { text: U.fmtInt(total) + '  ' + U.fmtPercent(total / Math.max(1, df.nrows * df.ncols), 1) })
    ]));
    var maxMissing = info[0].missing;
    info.forEach(function (c) { wrap.appendChild(missingRow(df, c, maxMissing)); });
    wrap.appendChild(h('div.missing-foot', [
      h('span.sub-hint', { text: t('profile.missing.click') }),
      ui.button({
        label: t('profile.fix_missing'), icon: 'missing', size: 'sm',
        onClick: function () {
          A.openOpForm('missing', {
            mode: 'fillna',
            columns: info.map(function (c) { return c.name; }),
            method: 'mean', value: ''
          });
        }
      })
    ]));
    return wrap;
  }

  function hasMissing(c) { return c.missing > 0; }
  function byCountDesc(a, b) { return b.missing - a.missing; }

  function missingRow(df, c, maxMissing) {
    var pct = df.nrows ? c.missing / df.nrows : 0;
    return h('button.missing-row', {
      type: 'button', title: t('profile.missing.click'),
      on: {
        click: function () {
          A.openOpForm('missing', { mode: 'fillna', columns: [c.name], method: 'mean', value: '' });
        }
      }
    }, [
      h('span.missing-name', { text: c.name }),
      h('span.missing-track', [h('span.missing-fill', {
        style: { width: Math.max(2, c.missing / maxMissing * 100) + '%' }
      })]),
      h('span.missing-value', { text: U.fmtInt(c.missing) + '  ' + U.fmtPercent(pct, 1) })
    ]);
  }

  /* --------------------------- value counts ----------------------------- */
  function valueCountsPanel(df) {
    var cols = df.categoricalColumns().concat(df.numericColumns());
    if (!cols.length) return h('div');
    if (!ST.profile.col || !df.has(ST.profile.col)) ST.profile.col = PV.df.preferredCategoryColumn(df);
    var wrap = h('div');
    var head = h('div.control-row');
    head.appendChild(dlg.select(cols.map(function (c) { return { value: c, label: c }; }), ST.profile.col, function (v) {
      ST.profile.col = v;
      A.emit();
    }));
    head.appendChild(dlg.select([5, 8, 12, 20, 40].map(function (n) {
      return { value: String(n), label: t('profile.top_n', { n: n }) };
    }), String(ST.profile.topN), function (v) {
      ST.profile.topN = Number(v);
      A.emit();
    }));
    wrap.appendChild(head);
    var vc = df.valueCounts(ST.profile.col, { limit: ST.profile.topN });
    var holder = h('div.chart-holder');
    wrap.appendChild(holder);
    PV.charts.render(holder, {
      type: 'count', x: ST.profile.col, limit: ST.profile.topN,
      horizontal: true, labels: true, height: 330
    }, df, {
      width: holder.clientWidth || 420,
      // Clicking a bar is the fastest way to see what a value actually holds:
      // it filters the frame to that value, exactly like a chart bar does.
      onMark: function (info) { A.markClick(info); },
      onContext: function (info, ev) { A.markContext(info, ev); }
    });
    wrap.appendChild(h('div.sub-hint', [
      h('span', { text: t('cols.unique') + ': ' + U.fmtInt(vc.uniqueCount) }),
      h('span', { text: ' · ' + t('profile.top_n', { n: ST.profile.topN }) })
    ]));
    return wrap;
  }

  /* --------------------------- quality checks --------------------------- */
  function qualityChecks(df) {
    var issues = [];
    var numeric = df.numericColumns();
    df.info().forEach(function (c) { collectIssues(df, c, numeric, issues); });
    var dups = df.duplicated([], 'first').filter(Boolean).length;
    if (dups) {
      issues.push({
        icon: 'dedup',
        text: t('profile.q.dup', { n: U.fmtInt(dups) }),
        action: { label: t('profile.drop_dups'), run: function () { A.addStep('dedup', { columns: [], keep: 'first' }); } }
      });
    }
    if (!issues.length) {
      return h('div.ok-note', [ui.icon('check'), h('span', { text: t('profile.quality.ok') })]);
    }
    var list = h('div.quality-list');
    issues.slice(0, 12).forEach(function (it) { list.appendChild(qualityRow(it)); });
    return list;
  }

  function collectIssues(df, c, numeric, issues) {
    var isNum = numeric.indexOf(c.name) >= 0;
    if (c.unique === 1 && c.nonNull > 0) issues.push({ icon: 'info', text: t('profile.q.constant', { col: c.name }) });
    if (c.missing > 0 && c.missing / Math.max(1, df.nrows) > 0.25) {
      issues.push({
        icon: 'missing',
        text: t('profile.q.missing', { col: c.name, p: U.fmtPercent(c.missing / df.nrows, 0) }),
        action: {
          label: t('profile.fix_missing'),
          run: function () { A.openOpForm('missing', { mode: 'fillna', columns: [c.name], method: 'mean', value: '' }); }
        }
      });
    }
    if (c.dtype === 'object' && c.unique > 40 && c.unique > df.nrows * 0.5) {
      issues.push({ icon: 'hash', text: t('profile.q.highcard', { col: c.name, n: U.fmtInt(c.unique) }) });
    }
    if (isNum && c.min !== null && c.min < 0) {
      issues.push({ icon: 'sigma', text: t('profile.q.negative', { col: c.name }) });
    }
    if (isNum) {
      var bx = S.boxStats(S.numeric(df.col(c.name)));
      if (bx && bx.outliers.length > Math.max(3, df.nrows * 0.02)) {
        issues.push({ icon: 'target', text: t('profile.q.outlier', { col: c.name, n: U.fmtInt(bx.outliers.length) }) });
      }
    }
  }

  function qualityRow(it) {
    return h('div.quality-row', [
      h('span.q-icon', [ui.icon(it.icon)]),
      h('span.q-text', { text: it.text }),
      it.action ? ui.button({ label: it.action.label, size: 'sm', onClick: it.action.run }) : null
    ]);
  }

  /* ------------------------------- render ------------------------------- */
  function renderProfileView(host) {
    U.clear(host);
    var df = A.result().df;
    if (!df) {
      host.appendChild(ui.emptyState(t('app.no_dataset'), null));
      return;
    }
    var grid = h('div.profile-grid');
    grid.appendChild(overview(df));
    grid.appendChild(atlasPanel(df));
    // Rows pair panels of similar natural height: lists with lists, charts with
    // charts, matrices with matrices, so both sides stay balanced.
    grid.appendChild(panel(t('profile.missingmatrix.title'), 'missing', missingMatrixPanel(df), 6));
    grid.appendChild(panel(t('profile.assoc.title'), 'merge', assocPanel(df), 6));
    grid.appendChild(panel(t('profile.missing.title'), 'missing', missingPanel(df), 6));
    grid.appendChild(panel(t('profile.quality.title'), 'check', qualityChecks(df), 6));
    grid.appendChild(panel(t('profile.value_counts.title'), 'bars', valueCountsPanel(df), 6));
    grid.appendChild(PV.viewsProfile2.panel('dist', df));
    grid.appendChild(PV.viewsProfile2.panel('corr', df));
    grid.appendChild(PV.viewsProfile2.panel('pair', df));
    grid.appendChild(panel(t('profile.info.title'), 'table', infoTable(df), 12));
    grid.appendChild(panel(t('profile.describe.title'), 'sigma', describeTables(df), 12));
    host.appendChild(grid);
  }

  function panel(title, iconName, body, span) {
    return h('section.panel.span-' + (span || 12), [
      ui.panelHead(title, [], { icon: iconName }),
      h('div.panel-body', [body])
    ]);
  }

  PV.viewsProfile = { render: renderProfileView, overview: overview };
})(typeof window !== 'undefined' ? window : globalThis);
