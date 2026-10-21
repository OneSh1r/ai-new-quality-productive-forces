/* 课程门户：进度、筛选、继续学习与首屏图形 */
(function () {
  "use strict";

  const STORAGE_KEY = "vis-course-progress-v2";
  const CHAPTERS = {
    "01": ["ch-1-1", "ch-1-2", "ch-1-3", "ch-1-4", "ch-1-5"],
    "02": ["ch-2-1", "ch-2-2", "ch-2-3", "ch-2-4"],
    "03": ["ch-3-1", "ch-3-2", "ch-3-3", "ch-3-4", "ch-3-5", "ch-3-6", "ch-3-7", "ch-3-8"],
    "04": ["ch-4-1", "ch-4-2", "ch-4-3", "ch-4-4", "ch-4-5"],
    "05": ["ch-5-1", "ch-5-2", "ch-5-3", "ch-5-4", "ch-5-5"]
  };

  function readProgress() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
    } catch (_) {
      return {};
    }
  }

  function chapterStatus(number) {
    const progress = readProgress();
    const ids = CHAPTERS[number] || [];
    const done = ids.filter((id) => progress[id]).length;
    return { done, total: ids.length, ratio: ids.length ? done / ids.length : 0 };
  }

  function updateChapterProgress() {
    document.querySelectorAll(".chapter-card").forEach((card) => {
      const number = card.querySelector(".chapter-number")?.textContent.trim();
      const state = chapterStatus(number);
      const label = card.querySelector(".progress-label");
      const fill = card.querySelector(".progress-track i");

      if (label) {
        label.textContent = state.done === 0
          ? "未开始"
          : state.done === state.total
            ? "已完成"
            : `${state.done}/${state.total} 节`;
        label.classList.toggle("done", state.done === state.total);
      }
      if (fill) fill.style.width = `${Math.round(state.ratio * 100)}%`;
    });
  }

  function updateContinueLink() {
    const progress = readProgress();
    const fallback = { href: "lesson-01/#ch-1-1", label: "开始学习" };
    const all = Object.entries(CHAPTERS);
    let target = null;

    for (const [number, ids] of all) {
      const nextId = ids.find((id) => !progress[id]);
      if (nextId) {
        target = { href: `lesson-${number}/index.html#${nextId}`, label: "继续学习" };
        break;
      }
    }

    const link = document.getElementById("continueLink");
    const label = document.getElementById("continueLabel");
    if (!link || !label) return;

    if (target) {
      link.href = target.href;
      label.textContent = target.label;
    } else {
      link.href = "lesson-05/index.html#ch-5-5";
      label.textContent = "复习最后一章";
    }
  }

  function drawHeroChart() {
    const svg = document.getElementById("heroChart");
    if (!svg || !window.d3) return;

    const width = 560;
    const height = 430;
    const margin = { top: 34, right: 26, bottom: 42, left: 42 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const root = d3.select(svg);

    const defs = root.insert("defs", ":first-child");
    const gradient = defs.append("linearGradient")
      .attr("id", "trendGradient")
      .attr("x1", "0")
      .attr("x2", "0")
      .attr("y1", "0")
      .attr("y2", "1");
    gradient.append("stop").attr("offset", "0%").attr("stop-color", "#dfbd62").attr("stop-opacity", 0.72);
    gradient.append("stop").attr("offset", "100%").attr("stop-color", "#dfbd62").attr("stop-opacity", 0);

    const grid = root.select(".canvas-grid");
    [0, 0.25, 0.5, 0.75, 1].forEach((ratio) => {
      const y = margin.top + plotH * ratio;
      grid.append("line")
        .attr("x1", margin.left)
        .attr("x2", width - margin.right)
        .attr("y1", y)
        .attr("y2", y);
    });
    [0, 0.25, 0.5, 0.75, 1].forEach((ratio) => {
      const x = margin.left + plotW * ratio;
      grid.append("line")
        .attr("x1", x)
        .attr("x2", x)
        .attr("y1", margin.top)
        .attr("y2", height - margin.bottom);
    });

    const axis = root.select(".canvas-axis");
    ["高", "中", "低"].forEach((label, i) => {
      axis.append("text")
        .attr("x", 2)
        .attr("y", margin.top + 10 + i * (plotH / 2))
        .text(label);
    });
    axis.append("text")
      .attr("x", margin.left)
      .attr("y", height - 15)
      .text("样本 →");
    axis.append("text")
      .attr("x", margin.left)
      .attr("y", 18)
      .text("指标值");

    const points = [
      { x: 0.04, y: 0.18, group: "A", value: 31 },
      { x: 0.1, y: 0.25, group: "B", value: 38 },
      { x: 0.16, y: 0.22, group: "A", value: 35 },
      { x: 0.23, y: 0.31, group: "B", value: 47 },
      { x: 0.3, y: 0.27, group: "A", value: 43 },
      { x: 0.37, y: 0.39, group: "B", value: 55 },
      { x: 0.44, y: 0.34, group: "A", value: 51 },
      { x: 0.51, y: 0.48, group: "B", value: 63 },
      { x: 0.58, y: 0.42, group: "A", value: 58 },
      { x: 0.64, y: 0.58, group: "B", value: 71 },
      { x: 0.71, y: 0.53, group: "A", value: 67 },
      { x: 0.78, y: 0.68, group: "B", value: 79 },
      { x: 0.84, y: 0.62, group: "A", value: 75 },
      { x: 0.91, y: 0.79, group: "B", value: 88 }
    ];

    const x = d3.scaleLinear().domain([0, 1]).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([0, 1]).range([height - margin.bottom, margin.top]);

    const line = d3.line()
      .x((d) => x(d.x))
      .y((d) => y(d.y))
      .curve(d3.curveMonotoneX);
    const area = d3.area()
      .x((d) => x(d.x))
      .y0(y(0.02))
      .y1((d) => y(d.y))
      .curve(d3.curveMonotoneX);

    root.select(".trend-line").attr("d", line(points));
    root.select(".trend-area").attr("d", area(points));

    const tooltip = document.getElementById("heroTooltip");
    const groups = Array.from(new Set(points.map((d) => d.group)));
    const color = d3.scaleOrdinal().domain(groups).range(["#dd6c54", "#dfbd62"]);

    const selection = root.select(".canvas-points")
      .selectAll("circle")
      .data(points)
      .join("circle")
      .attr("cx", (d) => x(d.x))
      .attr("cy", (d) => y(d.y))
      .attr("r", 5.2)
      .attr("fill", (d) => color(d.group))
      .style("animation-delay", (_, i) => `${350 + i * 70}ms`);

    function showPoint(event, d) {
      if (!tooltip) return;
      const rect = svg.getBoundingClientRect();
      tooltip.innerHTML = `<span>样本 ${String(Math.round(d.x * 100)).padStart(2, "0")} · 组别 ${d.group}</span><strong>指标值 ${d.value} · 位置编码</strong>`;
      tooltip.style.left = `${Math.min(rect.width - 160, Math.max(8, event.clientX - rect.left + 12))}px`;
      tooltip.style.top = `${Math.max(8, event.clientY - rect.top - 50)}px`;
      tooltip.style.right = "auto";
      tooltip.classList.add("visible");
    }

    selection
      .on("mouseenter", showPoint)
      .on("mousemove", showPoint)
      .on("mouseleave", () => tooltip?.classList.remove("visible"))
      .on("focus", function (event, d) {
        const ctm = this.getScreenCTM();
        showPoint({ clientX: ctm.e + this.getAttribute("cx") * 1, clientY: ctm.f + this.getAttribute("cy") * 1 }, d);
      })
      .on("blur", () => tooltip?.classList.remove("visible"))
      .attr("tabindex", 0)
      .attr("role", "img")
      .attr("aria-label", (d) => `样本 ${Math.round(d.x * 100)}，指标值 ${d.value}`);
  }

  function setupFilters() {
    const cards = Array.from(document.querySelectorAll(".chapter-card"));
    const chips = Array.from(document.querySelectorAll(".filter-chip"));
    const search = document.getElementById("chapterSearch");
    const empty = document.getElementById("emptyResult");
    let activeFilter = "all";

    function apply() {
      const query = (search?.value || "").trim().toLowerCase();
      let visible = 0;

      cards.forEach((card) => {
        const matchesFilter = activeFilter === "all" || card.dataset.filter === activeFilter;
        const haystack = `${card.textContent} ${card.dataset.tags || ""}`.toLowerCase();
        const matchesQuery = !query || haystack.includes(query);
        const show = matchesFilter && matchesQuery;
        card.classList.toggle("is-hidden", !show);
        if (show) visible += 1;
      });
      if (empty) empty.hidden = visible !== 0;
    }

    chips.forEach((chip) => {
      chip.addEventListener("click", () => {
        activeFilter = chip.dataset.filter || "all";
        chips.forEach((item) => item.classList.toggle("active", item === chip));
        apply();
      });
    });
    search?.addEventListener("input", apply);
  }

  function setupReveal() {
    const targets = [
      ...document.querySelectorAll(".section-head"),
      ...document.querySelectorAll(".chapter-card"),
      ...document.querySelectorAll(".learning-route li"),
      ...document.querySelectorAll(".tool-card"),
      ...document.querySelectorAll(".about-section > *")
    ];
    targets.forEach((el) => el.classList.add("reveal"));
    document.body.classList.add("reveal-ready");

    if (!("IntersectionObserver" in window)) {
      targets.forEach((el) => el.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -30px" });

    targets.forEach((el, i) => {
      el.style.transitionDelay = `${Math.min((i % 4) * 55, 165)}ms`;
      observer.observe(el);
    });
  }

  document.querySelectorAll("[data-scroll]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector(button.dataset.scroll)?.scrollIntoView({ behavior: "smooth" });
    });
  });

  drawHeroChart();
  updateChapterProgress();
  updateContinueLink();
  setupFilters();
  setupReveal();

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      updateChapterProgress();
      updateContinueLink();
    }
  });
})();
