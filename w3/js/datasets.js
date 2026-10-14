/* =============================================================================
 * Visual Pandas — datasets.js
 * Built-in data. Everything is generated from a fixed seed, so the numbers are
 * identical on every machine and every reload — and they contain real patterns
 * (seasonality, group effects, missing chunks, duplicates) worth exploring.
 * ========================================================================== */
(function (root) {
  'use strict';
  var PV = (root.PV = root.PV || {});
  var U = PV.util, D = PV.df;
  if (!U || !D) throw new Error('datasets.js requires util.js, stats.js and df.js');
  var DataFrame = D.DataFrame;

  function round(v, d) {
    var m = Math.pow(10, d === undefined ? 2 : d);
    return Math.round(v * m) / m;
  }

  /* ============================ default: retail ========================= */
  function retailSales() {
    var R = U.makeRandom('visual-pandas-retail-v1');
    var regions = [
      { name: 'East', countries: ['United States', 'Canada'], weight: 0.32, priceBias: 1.06, growth: 1.12 },
      { name: 'West', countries: ['United States', 'Mexico'], weight: 0.27, priceBias: 1.02, growth: 1.06 },
      { name: 'North', countries: ['Germany', 'Sweden', 'Poland'], weight: 0.21, priceBias: 1.11, growth: 0.97 },
      { name: 'South', countries: ['Brazil', 'Chile', 'Spain'], weight: 0.20, priceBias: 0.94, growth: 1.19 }
    ];
    var categories = [
      { name: 'Electronics', price: 420, disc: 0.16, margin: 0.24, weight: 0.26, growth: 1.22 },
      { name: 'Apparel', price: 78, disc: 0.24, margin: 0.44, weight: 0.24, growth: 1.04 },
      { name: 'Home', price: 165, disc: 0.18, margin: 0.36, weight: 0.19, growth: 0.95 },
      { name: 'Grocery', price: 32, disc: 0.07, margin: 0.19, weight: 0.20, growth: 1.08 },
      { name: 'Sports', price: 210, disc: 0.14, margin: 0.31, weight: 0.11, growth: 1.31 }
    ];
    var channels = [
      { name: 'Online', weight: 0.48, growth: 1.28, discBias: 1.15 },
      { name: 'Retail', weight: 0.34, growth: 0.98, discBias: 0.9 },
      { name: 'Partner', weight: 0.18, growth: 1.05, discBias: 1.0 }
    ];
    var N = 2600;
    var start = Date.UTC(2023, 0, 1);
    var rows = [];
    for (var i = 0; i < N; i++) {
      // Seasonality: Q4 uplift, summer dip, plus a slow upward trend.
      var dayOffset = Math.floor(R.float(0, 730));
      var d = new Date(start + dayOffset * 86400000);
      var month = d.getMonth();
      var season = 1 + 0.16 * Math.sin((month + 1) / 12 * 2 * Math.PI) + (month >= 9 ? 0.22 : 0) - (month === 6 || month === 7 ? 0.08 : 0);
      var yearGrowth = d.getFullYear() === 2024 ? 1.14 : 1.0;
      var ri = R.weighted(regions.map(function (r) { return r.weight; }));
      var region = regions[ri];
      var catWeights = categories.map(function (c, k) {
        return c.weight * (1 + 0.18 * Math.sin(k * 1.7 + ri * 2.1));
      });
      var ci = R.weighted(catWeights);
      var category = categories[ci];
      var chi = R.weighted(channels.map(function (c) { return c.weight; }));
      var channel = channels[chi];
      var country = region.countries[Math.floor(R.float(0, region.countries.length)) % region.countries.length];
      // Seasonality and year-over-year growth act on volume, so revenue keeps
      // its accounting identity: revenue - cost = profit, always.
      var seasonFactor = season * yearGrowth;
      var units = Math.max(1, Math.round((R.normal(9, 6) + (channel.name === 'Online' ? 2.5 : 0)) * seasonFactor));
      var price = round(category.price * region.priceBias * R.float(0.78, 1.28), 2);
      var discount = round(Math.max(0, Math.min(0.45,
        category.disc * channel.discBias * R.float(0.2, 1.9))), 2);
      var gross = units * price;
      var revenue = round(gross * (1 - discount), 2);
      var cost = round(revenue * (1 - category.margin * R.float(0.75, 1.15)), 2);
      var profit = round(revenue - cost, 2);
      var age = R.bool(0.035) ? null : Math.round(R.float(19, 74));
      var rating = R.bool(0.06) ? null : round(Math.max(1, Math.min(5, R.normal(4.1, 0.72))), 1);
      var returned = R.bool(0.055 + (category.name === 'Apparel' ? 0.05 : 0) + (discount > 0.25 ? 0.04 : 0));
      var shipDays = Math.max(1, Math.round(R.normal(channel.name === 'Online' ? 3.4 : 6.2, 1.6)));
      rows.push({
        order_id: 'SO-' + d.getFullYear() + '-' + String(100000 + i).slice(1),
        date: d,
        region: region.name,
        country: country,
        channel: channel.name,
        category: category.name,
        units: units,
        unit_price: price,
        discount: discount,
        revenue: revenue,
        cost: cost,
        profit: profit,
        ship_days: shipDays,
        customer_age: age,
        rating: rating,
        returned: returned
      });
    }
    rows.sort(function (a, b) { return a.date - b.date; });
    // A handful of exact duplicates so drop_duplicates is demoable.
    var RD = U.makeRandom('retail-duplicates');
    for (var k = 0; k < 14; k++) {
      var src = rows[Math.floor(RD.next() * rows.length)];
      rows.push(Object.assign({}, src));
    }
    return DataFrame.fromRecords(rows);
  }

  /* ================================ iris =============================== */
  function iris() {
    var species = [
      { name: 'setosa', mu: [5.01, 3.43, 1.46, 0.25], sd: [0.35, 0.38, 0.17, 0.10] },
      { name: 'versicolor', mu: [5.94, 2.77, 4.26, 1.33], sd: [0.52, 0.31, 0.47, 0.20] },
      { name: 'virginica', mu: [6.59, 2.97, 5.55, 2.03], sd: [0.64, 0.32, 0.55, 0.27] }
    ];
    var names = ['sepal_length', 'sepal_width', 'petal_length', 'petal_width'];
    var rows = [];
    species.forEach(function (sp, si) {
      var R = U.makeRandom('iris-' + sp.name);
      for (var i = 0; i < 50; i++) {
        var rec = { species: sp.name };
        names.forEach(function (nm, j) {
          rec[nm] = round(sp.mu[j] + sp.sd[j] * R.normal(0, 1), 1);
        });
        rec.species_id = si;
        rows.push(rec);
      }
    });
    return DataFrame.fromRecords(rows);
  }

  /* ============================ air quality =========================== */
  function airQuality() {
    var cities = [
      { name: 'Beijing', base: 62, temp: 12, hum: 44, night: 14, windy: 0.22 },
      { name: 'Shanghai', base: 41, temp: 17, hum: 71, night: 6, windy: 0.3 },
      { name: 'Chengdu', base: 54, temp: 16, hum: 78, night: 9, windy: 0.14 }
    ];
    var rows = [];
    cities.forEach(function (city) {
      var R = U.makeRandom('air-' + city.name);
      var t0 = new Date(2024, 0, 1).getTime();
      var hours = 90 * 24;
      for (var h = 0; h < hours; h++) {
        var d = new Date(t0 + h * 3600000);
        var hour = d.getHours();
        var diurnal = 1 + 0.34 * Math.sin(((hour - 7) / 24) * 2 * Math.PI) * -1 + 0.12;
        var weekTrend = Math.sin(h / (24 * 7) * 2 * Math.PI) * 0.07;
        var wind = Math.max(0, R.normal(2.6 + city.windy * 4, 1.4));
        var dilution = 1 / (1 + wind * 0.22);
        var pm25 = city.base * diurnal * (1 + weekTrend) * dilution * R.float(0.72, 1.34);
        var gap = (h > 26 * 24 && h < 27 * 24 + 6) || (h > 61 * 24 && h < 61 * 24 + 18);
        rows.push({
          timestamp: d,
          city: city.name,
          pm25: gap || R.bool(0.012) ? null : round(pm25, 1),
          pm10: round(pm25 * R.float(1.3, 2.1), 1),
          temperature: round(city.temp + Math.sin(((hour - 14) / 24) * 2 * Math.PI) * -6 + R.normal(0, 1.6), 1),
          humidity: round(Math.max(8, Math.min(99, city.hum + R.normal(0, 9))), 1),
          wind_speed: round(wind, 1),
          aqi_label: pm25 < 35 ? 'Good' : pm25 < 75 ? 'Moderate' : pm25 < 115 ? 'Unhealthy (sensitive)' : 'Unhealthy'
        });
      }
    });
    return DataFrame.fromRecords(rows);
  }

  /* ============================= employees ============================ */
  function employees() {
    var rows = [
      { region: 'East', manager: 'A. Novak', team_size: 42, budget: 1840000, head_office: 'New York', since: '2016-04-01' },
      { region: 'West', manager: 'M. Okafor', team_size: 37, budget: 1610000, head_office: 'San Francisco', since: '2018-09-15' },
      { region: 'North', manager: 'L. Bergman', team_size: 24, budget: 980000, head_office: 'Berlin', since: '2015-02-01' },
      { region: 'South', manager: 'R. Duarte', team_size: 21, budget: 870000, head_office: 'São Paulo', since: '2019-07-01' },
      { region: 'Central', manager: 'K. Ivanova', team_size: 12, budget: 540000, head_office: 'Warsaw', since: '2021-01-10' }
    ];
    var frame = DataFrame.fromRecords(rows);
    return frame.astype('since', 'datetime64[ns]');
  }

  /* ============================= passengers =========================== */
  function passengers() {
    var R = U.makeRandom('passengers-v1');
    var rows = [];
    for (var i = 0; i < 891; i++) {
      var pclass = R.weighted([0.24, 0.21, 0.55]) + 1;
      var sex = R.bool(0.65) ? 'male' : 'female';
      var ageBase = sex === 'male' ? 30 : 27;
      var age = R.bool(0.198) ? null : round(Math.max(0.5, R.normal(ageBase, 13.5)), 1);
      var fare = round(pclass === 1 ? R.float(30, 512)
        : pclass === 2 ? R.float(12, 73) : R.float(3.2, 56), 2);
      var survived = R.bool(pclass === 1 ? 0.63 : pclass === 2 ? 0.47 : 0.24) &&
        R.bool(sex === 'female' ? 1.0 : 0.42);
      var sibsp = R.weighted([0.68, 0.23, 0.03, 0.02, 0.04]);
      var parch = R.weighted([0.76, 0.13, 0.09, 0.02]);
      rows.push({
        passenger_id: 1 + i,
        survived: !!survived,
        pclass: pclass,
        sex: sex,
        age: age,
        sibsp: sibsp,
        parch: parch,
        fare: fare,
        embarked: R.pick(['S', 'C', 'Q', null]),
        deck: R.bool(0.23) ? null : R.pick(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
      });
    }
    return DataFrame.fromRecords(rows);
  }

  /* ========================== random generator ======================== */
  /**
   * Build a synthetic frame.
   * opts: {rows, cols, seed, nullPct, pattern, name}
   */
  function generate(opts) {
    opts = opts || {};
    var R = U.makeRandom(opts.seed === undefined || opts.seed === '' ? 'gen' : opts.seed);
    var n = U.clamp(opts.rows || 500, 1, 200000);
    var cols = U.clamp(opts.cols || 6, 1, 40);
    var nullPct = opts.nullPct === undefined ? 0.03 : opts.nullPct;
    var pattern = opts.pattern || 'random';
    var names = ['id', 'date', 'group', 'label'];
    var types = ['int', 'date', 'category', 'text'];
    var pool = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];
    var groups = ['Group A', 'Group B', 'Group C', 'Group D'];

    while (names.length < cols) {
      var j = names.length;
      names.push('metric_' + (j - 3));
      types.push('float');
      if (names.length < cols && j % 3 === 0) {
        names.push('metric_' + (j - 2) + '_pct');
        types.push('float');
      }
    }
    names = names.slice(0, cols);
    types = types.slice(0, cols);

    var start = Date.UTC(2022, 0, 1);
    var grid = [];
    var base = new Array(cols).fill(0).map(function () { return R.float(10, 120); });
    for (var i = 0; i < n; i++) {
      var row = new Array(cols);
      var dayOffset = Math.floor(i * (1095 / n));
      var d = new Date(start + dayOffset * 86400000);
      var season = 1 + 0.28 * Math.sin(dayOffset / 365 * 2 * Math.PI);
      var trend = 1 + dayOffset / 1095 * 0.7;
      var groupIdx = R.weighted([0.4, 0.3, 0.2, 0.1]);
      var cluster = R.normal(0, 1) > 0.4 ? R.normal(24, 7) : R.normal(0, 5);
      for (var c = 0; c < cols; c++) {
        var v;
        switch (types[c]) {
          case 'int':
            v = 1000 + i;
            break;
          case 'date':
            v = new Date(d.getTime());
            break;
          case 'category':
            v = groups[groupIdx];
            break;
          case 'text':
            v = pool[Math.floor(R.float(0, pool.length)) % pool.length] + '-' +
              (100 + Math.floor(R.float(0, 900)));
            break;
          default:
            if (pattern === 'trend') v = base[c] * season * trend * R.float(0.82, 1.2);
            else if (pattern === 'clusters') v = base[c] * 0.4 + cluster * (1 + groupIdx * 0.6) + R.normal(0, 3);
            else if (pattern === 'relation') v = base[c] + 2.1 * (i % 37) + R.normal(0, 6) + c * 3;
            else v = R.float(0, base[c] * 2);
            v = round(v, 2);
        }
        if (c > 2 && R.bool(nullPct)) v = null;
        row[c] = v;
      }
      grid.push(row);
    }
    var frame = PV.io.frameFromGrid(grid, names, {});
    return frame;
  }

  /* ============================== registry ============================ */
  var SAMPLES = [
    {
      id: 'retail',
      name: { zh: '全球零售订单', en: 'Global retail orders' },
      desc: {
        zh: '2 年订单数据，含地区、渠道、品类、折扣、利润、缺失值与重复行',
        en: 'Two years of orders: region, channel, category, discounts, profit, gaps and duplicates'
      },
      tags: { zh: ['默认', '时间序列', '多类别'], en: ['default', 'time series', 'categories'] },
      build: retailSales,
      isDefault: true
    },
    {
      id: 'iris',
      name: { zh: '鸢尾花测量', en: 'Iris measurements' },
      desc: {
        zh: '150 朵花的四个测量值，适合散点图与箱线图',
        en: 'Four measurements for 150 flowers — great for scatter and box plots'
      },
      tags: { zh: ['小数据', '散点'], en: ['small', 'scatter'] },
      build: iris
    },
    {
      id: 'air',
      name: { zh: '城市空气质量', en: 'City air quality' },
      desc: {
        zh: '三个城市 90 天的逐小时 PM2.5，含传感器中断的空白区段',
        en: 'Hourly PM2.5 for three cities over 90 days, with sensor outages'
      },
      tags: { zh: ['时间序列', '缺失值'], en: ['time series', 'missing data'] },
      build: airQuality
    },
    {
      id: 'passengers',
      name: { zh: '乘客名单', en: 'Passenger list' },
      desc: {
        zh: '891 名乘客的舱位、性别、年龄与票价，含大量缺失值',
        en: '891 passengers with class, sex, age and fare — plenty of missing values'
      },
      tags: { zh: ['类别', '缺失值'], en: ['categorical', 'missing'] },
      build: passengers
    },
    {
      id: 'employees',
      name: { zh: '区域负责人', en: 'Regional managers' },
      desc: {
        zh: '区域维表，可与零售订单按 region 连接',
        en: 'A small region dimension table — join it to the orders on region'
      },
      tags: { zh: ['连接', '小表'], en: ['join', 'dimension'] },
      build: employees
    }
  ];

  var cache = {};
  function build(id) {
    if (cache[id]) return cache[id];
    var spec = SAMPLES.filter(function (s) { return s.id === id; })[0];
    if (!spec) throw new Error('unknown dataset: ' + id);
    var frame = spec.build();
    cache[id] = frame;
    return frame;
  }

  function byId(id) {
    return SAMPLES.filter(function (s) { return s.id === id; })[0] || null;
  }

  PV.datasets = {
    SAMPLES: SAMPLES,
    build: build,
    byId: byId,
    defaultId: 'retail',
    retailSales: retailSales,
    iris: iris,
    airQuality: airQuality,
    passengers: passengers,
    employees: employees,
    generate: generate
  };
})(typeof window !== 'undefined' ? window : globalThis);
