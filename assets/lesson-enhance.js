/* 统一课程阅读层：章节壳、连续阅读、进度、自测与导航 */
(function () {
  "use strict";

  const STORAGE_KEY = "vis-course-progress-v2";
  const pathMatch = location.pathname.match(/lesson-0(\d)/i);
  const chapterNo = pathMatch ? Number(pathMatch[1]) : 1;

  const META = {
    1: {
      lead: "先建立“数据—属性—视觉通道”的判断链，再进入 D3 的加载、变换与选择器。本章的案例是一条 80 条记录的合成新生数据。",
      objectives: ["解释 DIKW 与可视化的位置", "按测量尺度选择视觉通道", "完成 CSV 加载与类型转换", "理解 enter / update / exit"],
      time: 35,
      oneLine: "先判断属性，再选择通道；位置负责精确，色相负责分类。",
      mistakes: [
        "数值用彩虹色编码，产生并不存在的边界。",
        "CSV 字段不 trim，分组时同一班级被拆成两个键。",
        "Data-Join 不带 key，重排时动画与元素身份错乱。"
      ],
      checklist: ["能区分名义 / 序数 / 区间 / 比率", "知道 d3.csv 的 row 回调何时执行", "能解释 key 函数为什么影响动画"]
    },
    2: {
      lead: "把“画图”拆成一条可复用流水线：原始数据怎样变成数据表，数据表怎样映射为视觉结构，最后又怎样进入视图与交互。",
      objectives: ["描述 Card 数据流模型", "用 rollup 构造层次数据", "理解树布局的坐标计算", "用事件委托处理交互"],
      time: 40,
      oneLine: "可视化不是一步画图，而是变换、映射、渲染三段可分别检查的流程。",
      mistakes: [
        "把清洗、聚合和视觉映射混在同一段渲染代码里。",
        "树节点只用固定间距，忽略子树宽度导致重叠。",
        "给每个节点单独绑事件，增删节点后监听器失效。"
      ],
      checklist: ["能说出 D→T 与 T→V 的职责边界", "能用 rollup 生成层级计数", "能解释事件委托依赖冒泡"]
    },
    3: {
      lead: "颜色是一种视觉通道，而不是装饰。本章从颜色空间出发，依次解决 colormap 类型、色系搭配、科研配色与色觉缺陷检查。",
      objectives: ["区分四类颜色空间", "按数据语义选择 colormap", "使用经典科研配色", "检查色觉缺陷可读性"],
      time: 55,
      oneLine: "顺序看明度，发散看中点，类别看色相；先保证可读，再追求好看。",
      mistakes: [
        "把无序类别塞进连续色带，暗示不存在的顺序。",
        "发散数据不从有意义的中点出发，视觉中心错位。",
        "只用红绿区分类别，色觉缺陷读者无法分辨。"
      ],
      checklist: ["能判断 sequential / diverging / qualitative", "知道 Lab 为什么更接近感知均匀", "会用明度或形状作为冗余编码"]
    },
    4: {
      lead: "低维数据的关键不是“点怎么画”，而是数据空间如何经过坐标变换成为屏幕上的位置、长度和形状。",
      objectives: ["完成宽表到长表转换", "分清三层坐标空间", "选择合适曲线类型", "理解等值线追踪"],
      time: 45,
      oneLine: "先统一数据形状，再统一坐标系统，最后才讨论图形风格。",
      mistakes: [
        "宽表直接送入绘图函数，列名被误当成数据值。",
        "把数据域的边界直接当屏幕像素，忽略留白与轴范围。",
        "用平滑曲线制造数据中不存在的过冲。"
      ],
      checklist: ["能写出宽长表转换的映射关系", "知道 45° 为什么是斜率感知中点", "能解释 Marching Squares 的阈值含义"]
    },
    5: {
      lead: "时间既有顺序，也可能有周期。选择折线、日历、螺旋还是故事线，取决于你想让读者看到趋势、节律还是关系变化。",
      objectives: ["识别时间的五个属性", "选择标准时序图", "用日历与螺旋揭示周期", "用 Storyline 表达多角色关系"],
      time: 40,
      oneLine: "看趋势用折线，看节律用日历或螺旋，看关系变化用故事线。",
      mistakes: [
        "所有时间数据都用等距折线，忽略采样间隔。",
        "日历热图不标星期与月份，读者无法定位日期。",
        "Storyline 的纵轴随意抖动，制造虚假的聚散关系。"
      ],
      checklist: ["能说出至少三个时间属性", "知道日历热图的行列含义", "能解释螺旋怎样呈现周期"]
    }
  };

  const QUIZZES = {
    1: [
      ["哪一组运算最能说明“比率尺度”比“区间尺度”多了一个真零点？", ["排序与比较", "加减运算", "乘除运算", "分类归并"], 2, "比率尺度有真零点，因此“2 倍”有意义；0°C 并不表示“没有温度”，所以摄氏温度只是区间尺度。"],
      ["把年龄编码为色相与编码为位置，哪一种通常更容易做精确比较？", ["色相", "位置", "两者完全相同", "取决于字体"], 1, "Mackinlay 的通道排序中，位置是最强的定量通道，色相更适合定性区分。"],
      ["d3.group 与 d3.rollup 的核心区别是什么？", ["前者只能处理数字", "前者保留组内元素，后者保留聚合值", "后者不能分层", "两者完全等价"], 1, "group 返回“键 → 元素数组”，rollup 返回“键 → reducer 结果”，前者保留细节，后者压缩信息。"],
      ["Data-Join 的 key 函数最主要解决什么问题？", ["改变颜色比例尺", "减少 CSV 字段", "在数据重排时保持元素身份", "自动计算坐标轴"], 2, "key 让 D3 按稳定标识匹配新旧数据；没有 key 时会退化为按索引匹配，重排动画就会错乱。"]
    ],
    2: [
      ["在 Card 数据流模型中，“按专业统计人数”属于哪个阶段？", ["数据变换 D→T", "视觉映射 T→V", "视图渲染", "用户交互"], 0, "清洗、聚合、派生都发生在数据表形成阶段，结果是适合映射的数据表。"],
      ["d3.rollup 的 reducer 返回 v.length，最可能得到什么？", ["每个分组的元素数量", "原始 CSV 文本", "屏幕坐标", "颜色数组"], 0, "v 是同一分组内的元素数组，v.length 即组内计数。"],
      ["树布局算法最需要避免的问题是什么？", ["颜色太鲜艳", "兄弟子树相互重叠", "文字太长", "坐标轴刻度太少"], 1, "Reingold-Tilford 一类布局要同时满足层次清晰、子树不重叠与紧凑。"],
      ["事件委托相比逐节点绑定，最大的结构优势是什么？", ["自动改变数据", "节点增删后仍能响应", "无需 CSS", "无需 DOM"], 1, "事件委托把监听器放在共同祖先上，通过冒泡识别目标，因此动态增删子节点仍有效。"]
    ],
    3: [
      ["连续升高且没有自然中点的数据，应优先选择哪类 colormap？", ["定性型", "顺序型", "发散型", "随机色相"], 1, "顺序型用明度或色相的有序变化表达大小，避免制造中点。"],
      ["“相对平均值的正负偏差”最适合哪类 colormap？", ["顺序型", "发散型", "定性型", "灰度表"], 1, "偏差有明确的中点 0，发散型能让正负方向对称可读。"],
      ["无序类别最不该主要依赖哪个通道？", ["色相", "位置", "形状", "文字标签"], 0, "色相可以区分类别，但若还叠加明度顺序会暗示数据大小；应配合位置、形状和标签。"],
      ["检查色觉缺陷时，最稳妥的做法是什么？", ["只看红绿是否能区分", "增加明度或形状冗余编码", "把所有颜色改成灰色", "提高饱和度"], 1, "冗余编码让信息不只依赖某两种色相的差异，是比单一颜色替换更稳健的方案。"]
    ],
    4: [
      ["Crime 数据从“每年多列”改为“每年一行”，这一步主要解决什么？", ["统一数据形状便于映射", "改变真实数值", "提高屏幕分辨率", "减少坐标轴"], 0, "宽表转长表把列名中的年份变成可映射的变量，是所有后续变换的基础。"],
      ["Cleveland 的 45° 结论主要提醒我们什么？", ["所有图都必须 45°", "人眼对斜率的估计并非线性", "曲线一定优于直线", "坐标轴不能截断"], 1, "在常见宽高条件下，45° 附近更接近人对斜率的感知中点，图形比例会改变读者的判断。"],
      ["什么时候应谨慎使用高阶平滑曲线？", ["数据点很少且波动大", "数据完全线性", "只想连接相邻点", "坐标轴是离散的"], 0, "高阶平滑可能在数据点之间制造过冲，让读者看到不存在的峰谷。"],
      ["Marching Squares 的核心输入是什么？", ["颜色列表", "标量场与阈值", "节点层级", "文本语料"], 1, "它逐个网格单元判断四个角与阈值的关系，再连接交点形成等值线。" ]
    ],
    5: [
      ["想突出“每年同一季节的规律”，哪种视图更直接？", ["普通折线图", "日历热图或螺旋", "散点矩阵", "树图"], 1, "日历与螺旋把周期折叠到二维结构中，更容易比较相同相位。"],
      ["van Wijk 日历热图通常怎样安排行列？", ["行=星期，列=小时", "行=年，列=周", "行=类别，列=数值", "行=角色，列=场景"], 1, "常见做法是用行表示年份、列表示周，从而在有限空间内比较多年节律。"],
      ["阿基米德螺旋的主要视觉优势是什么？", ["适合展示层级", "把连续时间与周期结构同时保留", "能替代所有折线图", "不需要颜色"], 1, "半径随时间增长，角度按周期循环，因此既保持连续顺序，又让每圈对应一个周期。"],
      ["Storyline 中纵轴位置最重要的作用是表达什么？", ["精确数值大小", "角色之间的聚散与关系", "时间采样频率", "颜色饱和度"], 1, "故事线通常用纵轴组织角色或群体的靠近与分离，数值精确性让位于叙事关系。"]
    ]
  };

  function readProgress() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
    } catch (_) {
      return {};
    }
  }

  function writeProgress(progress) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (_) {
      /* 本地存储不可用时仍保留当前页面交互 */
    }
  }

  function isDone(id) {
    return Boolean(readProgress()[id]);
  }

  function setDone(id, done) {
    const progress = readProgress();
    if (done) progress[id] = true;
    else delete progress[id];
    writeProgress(progress);
    syncProgressUI();
  }

  const meta = META[chapterNo] || META[1];
  const main = document.querySelector(".lesson-main");
  const content = document.querySelector(".chapter-content");
  const oldNav = document.querySelector(".chapter-nav");
  const pageTitle = document.querySelector(".lesson-header h1")?.textContent.trim()
    || document.title.split("·")[0].trim();

  if (!main || !content) return;

  const chapters = Array.from(content.querySelectorAll(".chapter"));
  const sectionInfo = chapters.map((chapter, index) => {
    const h2 = chapter.querySelector("h2");
    const subtitle = Array.from(chapter.querySelectorAll(".chapter-subtitle"))
      .find((p) => !p.hidden) || chapter.querySelector(".chapter-subtitle");
    return {
      id: chapter.id || `section-${chapterNo}-${index + 1}`,
      title: (h2?.textContent || `第 ${index + 1} 节`).trim(),
      subtitle: (subtitle?.textContent || "").trim()
    };
  });

  const progressBar = document.createElement("div");
  progressBar.className = "reading-progress";
  document.body.prepend(progressBar);

  const header = document.createElement("header");
  header.className = "lesson-shell-header";
  header.innerHTML = `
    <a class="lesson-brand" href="../index.html" aria-label="返回可视化导论课程门户">
      <span class="lesson-brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <span class="lesson-brand-copy"><strong>可视化导论</strong><small>LEARNING READER</small></span>
    </a>
    <div class="lesson-crumb"><span>课程</span><span>/</span><span>${pageTitle.replace(/^第\s*\d+\s*章\s*/, "")}</span></div>
    <div class="lesson-header-actions">
      <span class="header-progress-text" id="headerProgressText">0 / ${chapters.length} 节</span>
      <button class="sidebar-toggle" id="sidebarToggle" type="button" aria-expanded="false">本章目录</button>
      <a class="header-home-link" href="../index.html">课程门户</a>
    </div>
  `;
  document.body.prepend(header);

  const hero = document.createElement("section");
  hero.className = "lesson-hero";
  hero.innerHTML = `
    <div class="lesson-hero-copy">
      <p class="hero-eyebrow">CHAPTER ${String(chapterNo).padStart(2, "0")} / ${sectionInfo.length} SECTIONS</p>
      <h1>${pageTitle.replace(/^第\s*\d+\s*章\s*/, "")}</h1>
      <p class="lesson-hero-lead">${meta.lead}</p>
      <ul class="lesson-objectives">${meta.objectives.map((item) => `<li>${item}</li>`).join("")}</ul>
    </div>
    <div class="lesson-hero-side">
      <p class="hero-side-label">本章一句话</p>
      <p class="hero-side-title">${meta.oneLine}</p>
      <div class="hero-time"><strong>${meta.time}</strong><span>分钟 · 建议一次完成</span></div>
    </div>
  `;
  main.prepend(hero);

  oldNav?.remove();
  const nav = document.createElement("aside");
  nav.className = "chapter-nav";
  nav.innerHTML = `
    <p class="nav-kicker">ON THIS PAGE / 本章目录</p>
    <div class="nav-progress-row"><strong>学习进度</strong><span id="navProgressText">0 / ${chapters.length}</span></div>
    <div class="nav-progress-track"><i id="navProgressFill"></i></div>
    <ul>
      ${sectionInfo.map((section, index) => `
        <li>
          <a href="#${section.id}" data-section="${section.id}">
            <span class="nav-num">${String(index + 1).padStart(2, "0")}</span>
            <span>${section.title.replace(/^\d+(\.\d+)?\s*/, "")}</span>
            <span class="nav-check" aria-hidden="true">○</span>
          </a>
        </li>`).join("")}
    </ul>
    <div class="nav-tip">
      <a href="./lecture.md" target="_blank">↗ 完整讲义 Markdown</a>
      ${chapterNo === 1 ? '<a href="./demo/" target="_blank">↗ 独立演示目录</a>' : ""}
      <a href="../supplementary/collection.html" target="_blank">↗ 补充演示集合</a>
    </div>
  `;
  main.insertBefore(nav, content);

  const rail = document.createElement("aside");
  rail.className = "lesson-rail";
  rail.innerHTML = `
    <div class="rail-card rail-accent">
      <p class="rail-label">ONE SENTENCE</p>
      <h3>${meta.oneLine}</h3>
      <div class="rail-meter"><strong>${meta.time}</strong><span>MIN / 本章</span></div>
    </div>
    <div class="rail-card">
      <p class="rail-label">COMMON PITFALLS / 易错点</p>
      <ul class="rail-list">${meta.mistakes.map((item) => `<li>${item}</li>`).join("")}</ul>
    </div>
    <div class="rail-card">
      <p class="rail-label">CHECK YOURSELF / 自查</p>
      <ul class="rail-list">${meta.checklist.map((item) => `<li>${item}</li>`).join("")}</ul>
    </div>
  `;
  main.appendChild(rail);

  function buildChapter(chapter, index) {
    const id = chapter.id || `section-${chapterNo}-${index + 1}`;
    chapter.id = id;
    const h2 = chapter.querySelector("h2");
    const title = h2?.textContent.trim() || `第 ${index + 1} 节`;
    const subtitle = Array.from(chapter.querySelectorAll(".chapter-subtitle"))
      .find((p) => !p.hidden) || chapter.querySelector(".chapter-subtitle");
    const panels = chapter.querySelector(".tab-panels");
    const explain = chapter.querySelector('.tab-panel[data-panel="explain"]');
    const code = chapter.querySelector('.tab-panel[data-panel="code"]');
    const demo = chapter.querySelector('.tab-panel[data-panel="demo"]');

    const heading = document.createElement("div");
    heading.className = "chapter-heading";
    heading.innerHTML = `
      <div class="chapter-heading-copy">
        <span class="chapter-index">SECTION ${String(index + 1).padStart(2, "0")} / ${String(chapters.length).padStart(2, "0")}</span>
      </div>
      <button class="complete-button" type="button" data-complete="${id}" aria-pressed="false">标记已学</button>
    `;
    const copy = heading.querySelector(".chapter-heading-copy");
    if (h2) copy.appendChild(h2);
    if (subtitle) copy.appendChild(subtitle);
    chapter.prepend(heading);

    let codeDetails = null;
    if (code) {
      const details = document.createElement("details");
      codeDetails = details;
      details.className = "lesson-disclosure code-disclosure";
      const codeCount = code.querySelectorAll("pre").length;
      details.innerHTML = `
        <summary>
          <span class="disclosure-label"><i>⌘</i>关键代码</span>
          <span class="disclosure-count">${codeCount || "若干"} 段 · 按需展开</span>
        </summary>
      `;
      code.remove();
      details.appendChild(code);
      (explain || panels)?.after?.(details);
      if (!explain && panels) panels.appendChild(details);
    }

    if (demo) {
      demo.remove();
      const demoZone = document.createElement("section");
      demoZone.className = "demo-zone";
      demoZone.innerHTML = `
        <div class="demo-zone-head">
          <span class="disclosure-label"><i>▶</i>交互演示</span>
          <span class="demo-zone-tag">TRY IT / 直接操作</span>
        </div>
      `;
      demoZone.appendChild(demo);
      (codeDetails || explain || panels)?.after?.(demoZone);
      if (!explain && panels) panels.appendChild(demoZone);
    }

    const quiz = document.createElement("section");
    quiz.className = "quiz-section";
    quiz.dataset.quiz = String(index);
    quiz.innerHTML = `
      <div class="quiz-head">
        <div>
          <p class="quiz-kicker">QUICK CHECK / 即时自测</p>
          <h3>停下来，确认你真的懂了</h3>
        </div>
        <div class="quiz-score" data-score>0 / 4 正确</div>
      </div>
      <div class="quiz-list">
        ${QUIZZES[chapterNo].map((item, qIndex) => `
          <div class="quiz-item" data-answer="${item[2]}" data-q="${qIndex}">
            <p class="quiz-question">${item[0]}</p>
            <div class="quiz-options">
              ${item[1].map((option, oIndex) => `
                <label class="quiz-option">
                  <input type="radio" name="quiz-${chapterNo}-${index}-${qIndex}" value="${oIndex}">
                  <span>${option}</span>
                </label>`).join("")}
            </div>
            <p class="quiz-feedback">${item[3]}</p>
          </div>`).join("")}
      </div>
      <div class="quiz-actions">
        <button class="quiz-submit" type="button">提交答案</button>
        <button class="quiz-reset" type="button">重做</button>
      </div>
    `;
    chapter.appendChild(quiz);

    const note = document.createElement("div");
    note.className = "scratch-note";
    note.innerHTML = `<strong>TAKEAWAY</strong><span>${meta.checklist[index % meta.checklist.length]}</span>`;
    chapter.appendChild(note);

    quiz.addEventListener("submit", (event) => event.preventDefault());
    quiz.querySelector(".quiz-submit").addEventListener("click", () => gradeQuiz(quiz));
    quiz.querySelector(".quiz-reset").addEventListener("click", () => resetQuiz(quiz));
    quiz.querySelectorAll("input[type=radio]").forEach((input) => {
      input.addEventListener("change", () => {
        quiz.querySelectorAll(".quiz-item").forEach((item) => item.classList.remove("correct", "wrong"));
        quiz.querySelectorAll(".quiz-feedback").forEach((el) => el.classList.remove("visible"));
        const score = quiz.querySelector("[data-score]");
        if (score) score.textContent = "待提交";
      });
    });

    const completeButton = heading.querySelector(".complete-button");
    completeButton.addEventListener("click", () => setDone(id, !isDone(id)));
    completeButton.dataset.bound = "true";
  }

  function gradeQuiz(quiz) {
    let correct = 0;
    quiz.querySelectorAll(".quiz-item").forEach((item) => {
      const answer = Number(item.dataset.answer);
      const selected = item.querySelector("input:checked");
      item.classList.remove("correct", "wrong");
      item.querySelectorAll(".quiz-option").forEach((label) => label.classList.remove("selected"));
      if (!selected) return;
      selected.closest(".quiz-option").classList.add("selected");
      const isCorrect = Number(selected.value) === answer;
      item.classList.add(isCorrect ? "correct" : "wrong");
      if (isCorrect) correct += 1;
      const feedback = item.querySelector(".quiz-feedback");
      if (feedback) {
        feedback.classList.add("visible");
        feedback.style.color = isCorrect ? "#c8e5cf" : "#ffd2c8";
      }
    });
    const score = quiz.querySelector("[data-score]");
    if (score) score.textContent = `${correct} / 4 正确`;
  }

  function resetQuiz(quiz) {
    quiz.querySelectorAll("input[type=radio]").forEach((input) => {
      input.checked = false;
    });
    quiz.querySelectorAll(".quiz-item").forEach((item) => item.classList.remove("correct", "wrong"));
    quiz.querySelectorAll(".quiz-option").forEach((label) => label.classList.remove("selected"));
    quiz.querySelectorAll(".quiz-feedback").forEach((el) => el.classList.remove("visible"));
    const score = quiz.querySelector("[data-score]");
    if (score) score.textContent = "0 / 4 正确";
  }

  chapters.forEach(buildChapter);

  function syncProgressUI() {
    const progress = readProgress();
    const doneCount = chapters.filter((chapter) => progress[chapter.id]).length;
    const ratio = chapters.length ? doneCount / chapters.length : 0;
    document.querySelectorAll("[data-complete]").forEach((button) => {
      const done = Boolean(progress[button.dataset.complete]);
      button.classList.toggle("is-complete", done);
      button.setAttribute("aria-pressed", String(done));
      button.textContent = done ? "已学完" : "标记已学";
    });
    document.querySelectorAll(".chapter-nav a[data-section]").forEach((link) => {
      const done = Boolean(progress[link.dataset.section]);
      link.classList.toggle("is-complete", done);
      const mark = link.querySelector(".nav-check");
      if (mark) mark.textContent = done ? "●" : "○";
    });
    const text = `${doneCount} / ${chapters.length} 节`;
    const navText = document.getElementById("navProgressText");
    const headerText = document.getElementById("headerProgressText");
    const fill = document.getElementById("navProgressFill");
    if (navText) navText.textContent = text;
    if (headerText) headerText.textContent = text;
    if (fill) fill.style.width = `${Math.round(ratio * 100)}%`;
  }

  syncProgressUI();

  function updateScrollState() {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const pageRatio = maxScroll > 0 ? Math.min(1, window.scrollY / maxScroll) : 0;
    progressBar.style.width = `${pageRatio * 100}%`;

    const marker = 130;
    let current = chapters[0]?.id;
    chapters.forEach((chapter) => {
      if (chapter.getBoundingClientRect().top <= marker) current = chapter.id;
    });
    document.querySelectorAll(".chapter-nav a[data-section]").forEach((link) => {
      link.classList.toggle("active", link.dataset.section === current);
    });
  }

  let scrollTicking = false;
  window.addEventListener("scroll", () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      updateScrollState();
      scrollTicking = false;
    });
  }, { passive: true });
  updateScrollState();

  document.querySelectorAll(".chapter-nav a[data-section]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const target = document.getElementById(link.dataset.section);
      if (!target) return;
      history.replaceState(null, "", `#${link.dataset.section}`);
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      nav.classList.remove("open");
      document.getElementById("sidebarToggle")?.setAttribute("aria-expanded", "false");
    });
  });

  const sidebarToggle = document.getElementById("sidebarToggle");
  sidebarToggle?.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    sidebarToggle.setAttribute("aria-expanded", String(open));
  });

  if (location.hash) {
    window.setTimeout(() => {
      const target = document.querySelector(location.hash);
      if (target) target.scrollIntoView({ block: "start" });
    }, 450);
  }

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) syncProgressUI();
  });
})();
