# 可视化 Pandas · Visual Pandas

一个在浏览器里使用的数据分析工作台：用鼠标和图形完成 pandas 里的常用操作，
并实时得到完全等价的 Python 代码。中英双语，内容一致。

A browser-based data analysis workbench: do pandas-style work with the mouse —
filtering, grouping, pivoting, joining, charting — and get the equivalent,
copy-ready pandas code as you go. Fully bilingual (中文 / English).

---

## 快速开始 · Quick start

直接双击 `index.html` 即可（无需安装、无需联网、没有构建步骤）。

Just open `index.html` in a browser — no install, no build step, no network
needed. All charts are hand-written SVG; there are no external dependencies.

可选：用任意静态服务器打开（这样“从网址加载数据”功能也能用）：

```bash
python -m http.server 8000      # 然后访问 http://localhost:8000
```

想看一遍完整演示？[讲解-网站特点.md](讲解-网站特点.md) 是面向使用者的功能全貌说明，
另有漫游动图 `tour/visual-pandas-tour.gif`（可直接在对话里播放）。

---

## 界面构成 · How the workspace is laid out

| 区域 | 作用 |
| --- | --- |
| 顶栏 | 数据集切换、行列数、语言（中/EN）、主题（浅色/深色）、导出、重置 |
| 左栏 | **数据源**（数据集列表 + 一个“添加数据”菜单：上传 / 粘贴 / 网址 / 生成 / 示例数据）、**操作面板**、**列列表**（可折叠，带迷你分布图） |
| 中间 | 标签页：数据表、数据概览、图表、汇总、代码（加载第二张表后多出“合并数据”） |
| 右栏 | **流水线**（每一步的行数变化、查看/代码按钮）与 **检查器**（列画像、行详情、数据点） |
| 底部 | 当前结果、数据来源、计算耗时 |

| Area | Purpose |
| --- | --- |
| Top bar | Dataset switcher, shape, language (中文/EN), theme, export, reset |
| Left | **Data source** (dataset list + one "add data" menu), **operation palette**, collapsible **column list** with mini distributions |
| Centre | Six tabs: Table, Profile, Charts, Group & Pivot, Combine, Python code |
| Right | **Pipeline** (row counts per step) and **Inspector** (column profile, row detail, marks) |
| Bottom | Current result, data source, timing |

## 数据加载 · Loading data

* **默认数据**：内置“全球零售订单”（2,614 行 × 16 列，含季节趋势、缺失值与重复行），打开即用。
* **示例数据集**：鸢尾花测量、城市空气质量（逐小时、含传感器中断）、乘客名单、区域负责人（用于表连接）。
* **上传文件**：CSV / TSV / TXT / JSON / JSONL / XLSX —— 也支持把文件直接拖到页面上。
  * 文本文件会先弹出**解析对话框**：分隔符（自动识别）、首行是否为列名、是否推断类型、缺失值标记，并实时预览。
  * XLSX 由内置的 ZIP + deflate 读取器解析（不依赖任何库）。
* **粘贴数据**：从 Excel 或 CSV 复制一块数据直接粘贴。
* **从网址加载**：抓取远程 CSV / JSON（在 `file://` 下浏览器可能拦截跨域请求）。
* **生成随机数据**：行数、列数、随机种子、缺失比例、数据模式（随机 / 时间趋势 / 分群 / 相关变量），完全可复现。

## 覆盖的 pandas 能力 · pandas coverage

每一步操作都会同时给出等价的 pandas 代码。以下为操作面板里的全部操作：

| 分类 | 可视化操作 | 等价 pandas |
| --- | --- | --- |
| 行 | 条件筛选（可视化条件 / 文本表达式） | `df[df["a"] > 1]`、`&`、`\|`、`.between()`、`.isin()`、`.isna()` |
| 行 | 排序（多列、升降序） | `df.sort_values([...], ascending=[...])` |
| 行 | 采样（head / tail / sample） | `df.head(n)`、`df.sample(n, random_state=42)` |
| 行 | 去重 | `df.drop_duplicates(subset=[...], keep=...)` |
| 行 | 缺失值处理（删除 / 填充） | `df.dropna()`、`df.fillna(df["c"].mean())`、`ffill` / `bfill` |
| 列 | 选择 / 删除 / 重命名 | `df[[...]]`、`df.drop(columns=[...])`、`df.rename(columns={...})` |
| 列 | 类型转换 | `df["c"].astype("int64")`（int / float / str / category / datetime / bool） |
| 列 | 新增列（表达式） | `df["m"] = df["profit"] / df["revenue"]` |
| 列 | 分箱 | `pd.cut` / `pd.qcut` |
| 列 | 字符串处理 | `.str.upper()`、`.str.contains()`、`.str.extract()`、`.str.split()` … |
| 列 | 日期特征 | `.dt.year`、`.dt.month`、`.dt.weekday`、`.dt.to_period("M")` … |
| 列 | 值映射 / 排名 / 数值变换 | `.replace({...})`、`.rank()`、`.clip()`、`.round()`、`.diff()`、`.pct_change()` |
| 列 | 独热编码 | `pd.get_dummies(df, columns=[...])` |
| 聚合 | 分组聚合 | `df.groupby([...], as_index=False).agg(...)` |
| 聚合 | 透视表 | `df.pivot_table(index=..., columns=..., values=..., aggfunc=..., margins=True)` |
| 聚合 | 交叉表 | `pd.crosstab(...)`（附卡方检验） |
| 聚合 | 滚动窗口 | `df["c"].rolling(window=7, min_periods=1).mean()` |
| 聚合 | 时间重采样 | `df.set_index("t").resample("D").agg(...)` |
| 多表 | 表连接 | `df.merge(other, how=..., left_on=..., right_on=..., indicator=True)` |
| 多表 | 追加行 | `pd.concat([df, other], ignore_index=True)` |

统计分析由自研的引擎完成，公式与 pandas / numpy 一致：
样本标准差（`ddof=1`）、线性插值分位数、无偏偏度与峰度、IQR 离群值、
Pearson / Spearman / Kendall 相关系数、卡方检验 p 值。

## 联动 · How the features talk to each other

整个应用围绕一个概念组织：**当前列**。你在任何地方点一个列名（表头、左侧列列表、数据概览的表、
图表里的取值），它就成为"当前列"，顶部出现一个芯片：

```
当前列  revenue  float64  ×
```

点这个芯片（或检查器里的“用这一列…”）会展开同一个菜单，把这一列送到任何工具：

| 菜单项 | 效果 |
| --- | --- |
| 看分布（直方图） | 打开图表页并画好直方图 |
| 看取值（值计数） | 打开数据概览并用它做值计数 |
| 作为图表 X / Y 轴 | 直接改写图表设置并切到图表页 |
| 按它分组汇总 | 打开汇总页，分组键就是它，统计列自动选好 |
| 用它筛选 | 打开筛选面板并预填这一列 |
| 查看统计 | 检查器显示它的完整统计 |
| 作为连接键 | 打开合并页，左右键都预填好 |

除此之外，各个部分之间还有这些直接通路：

* **图表 → 数据**：点柱/点/饼块/箱体就加一个筛选步骤，并弹出“查看结果”直接跳到数据表；
  汇总页的结果图点一下就是**下钻**（对原始数据按该类别筛选）。
* **流水线 → 界面**：每一步都有「查看」（跳到最合适的结果页：筛选→数据表、分组→汇总、连接→合并）
  和「代码」（就地展开这一步的 pandas 代码，可单独复制，也可跳到代码页）。
* **流水线 → 表格**：筛选步骤在表格上方显示为可删除的筛选芯片，「回到原始数据」一键清空。
* **代码 → 界面**：代码页每一步都标注行数变化，并给出“在界面中查看”的入口。
* **列 → 操作**：检查器、列菜单、表格右键都直接提供这一列的常用操作。

## 数据集管理与撤销 · Datasets and undo

左栏「数据源」可以同时放多张表：

* 点某一行即切换当前表；每张表各自记着自己的流水线，顶部、中间与右栏会同步切换。
* 每行的垃圾桶按钮（或 ⌄ 菜单里的「移除数据集」）会先弹确认框，删除后的提示里带「撤销」。
* ⌄ 菜单里还有重命名、数据详情（逐列非空 / 缺失率 / 基数）与导出 CSV。
* 「添加数据」菜单只列出还没加载过的示例数据集。

右栏「流水线」标题右侧是 **撤销 / 重做**：按钮带文字，悬停写明将撤销的动作
（`撤销 · 排序 · Ctrl/⌘+Z`），面板里有「上一步操作：…」。可以连续撤销 / 重做任意多步
（最多 60 步），每撤销一步重做按钮立刻可用；历史覆盖加 / 删步骤、改参数、停用、移动顺序、
清空流水线，以及**数据集的增删**——删掉一张表后按 `Ctrl/⌘+Z` 可以连数据一起找回。

## 初学者路径 · First-run path

1. 打开就在**数据表**里看到默认数据（2,614 行 × 16 列），或在左栏用「添加数据」换成自己的数据。
2. 点任意列名 → 顶部出现“当前列” → 右下检查器立刻给出它的统计与可做的操作。
3. 左栏只显示 **8 个常用操作**（每个都有一句人话说明）；需要更多时点「显示全部操作」。
4. 顶部一行提示接下来能做什么：**筛选出想要的几行 / 按类别汇总 / 画一张图**。
5. 图表页默认只显示 6 种常用图型与 X/Y/聚合三项，其余编码放在「更多设置」里。
6. 任何一步都能在右侧流水线里点「代码」看到等价的 pandas 写法，最后到「代码」页整段复制。

## 动效与流畅度 · Motion and performance

两套视觉层叠加在自研的 SVG 图表引擎之上，都**可选**：缺少它们时（或系统开启"减少动态效果"）
自动退化为静态渲染，功能不受影响。

| 图层 | 用途 | 位置 |
| --- | --- | --- |
| **D3 7.9** | 图表重绘时的图形过渡（按 `data-key` 匹配旧位置，柱/点/折线平滑移动）、关键指标数字滚动、新图形错峰淡入 | [js/anim.js](js/anim.js) |
| **p5 1.9** | 空工作台的环境粒子场、数据画像里随所选列变化的"分布地形"动画、缺失率/重复率环形进度 | [js/fx.js](js/fx.js) |

两个库都**本地打包**在 `assets/vendor/`（而不是引用 CDN），这样双击 `index.html` 依然可以离线使用。
p5 限制在 30fps，并在切换标签页/窗口不可见时自动暂停。

流畅度方面做了这些事：

* **视图缓存**：右侧检查器、折叠面板等无关变化不再重建表格/图表 DOM（约 0.7ms/次，原来是 8–60ms）。
* **图表重绘短路**：签名（数据 + 参数 + 宽度 + 图例 + 语言）未变时不重新绘制，也不会重放动画。
* **面板 memo**：数据源、操作面板、流水线、检查器按签名复用节点。
* **大数据散点走单条点路径**：超过 1,200 个点时改用一条 `<path>`（圆头线段画点）而不是上千个
  `<circle>`，悬停/点击由均匀网格最近邻索引接管，交互不变、DOM 数量降三个数量级。
* 列画像、`df.info()`、重复行检测按 DataFrame 实例缓存，50,000 行数据首次进入画像页约 1 秒，
  之后复用。

## 分享链接 · Shareable links

地址栏哈希对应标签页，可用 `?theme=` / `?lang=` 指定主题与语言：

```
index.html#profile                 数据画像
index.html#charts?theme=dark#...   （哈希在前，查询在后同样有效）
index.html?theme=dark&lang=en#code 深色 + 英文 + Python 代码页
```

## 用图形做分析 · Visual analysis, not just tables

除了表格与图表页，这些"用图形代替数字"的能力贯穿全站：

| 图形 | 解决的问题 | 位置 |
| --- | --- | --- |
| **数据条** | 一眼看出每行数值的相对大小（表格内） | 数据表 → 数据条 |
| **列图谱** | 15 列的形状同时呈现：分布、频数、时间曲线、基数、缺失率 | 数据概览 · 列图谱 |
| **缺失矩阵** | 空值是零散的还是成片的（成块 = 系统性缺失） | 数据概览 · 缺失矩阵 |
| **关联矩阵** | 数值列用 Pearson、类别列用 Cramér's V、混合用相关比 η，一张图看全部变量关系 | 数据概览 · 关联矩阵 |
| **二维密度图** | 大数据散点看不清密度：分箱上色，点格子即按该区域筛选 | 图表 · 密度图 |
| **平行坐标** | 多维度取舍关系（如"折扣越高、销量越低"）：每条线是一行，**在某根轴上拖拽即可筛选该维度** | 图表 · 平行坐标 |
| **箱线 / 小提琴 / 热力 / 饼图 / 累积分布 / 频数** | 分布、离群值、构成、累积比例 | 图表 |

三张图叠起来就是一条完整的图形化分析链路：
**列图谱**（哪些列值得看）→ **关联矩阵**（哪些变量有关）→ **密度图**（关系长什么样）→
**平行坐标**（多维取舍）→ 任意一次点击就是一次筛选，右侧流水线同步生成对应的 pandas 代码。

* **点击图形即筛选**：柱状图、散点、饼图、箱线图上的任一图形都能点（或右键）直接加一个筛选步骤，并附带“撤销”。
* **直方图刷选**：在直方图上点一个区间即可筛出该区间。
* **数据画像**：顶部 4 个关键指标（行 / 列 / 缺失单元格 / 重复行）加一行数据构成；
  下面是缺失值分布、值计数（横向柱状图，可直接点选筛选）、数据质量检查、
  相关性矩阵、数值分布、散点矩阵，最后是 `df.info()` 与 `df.describe()` 表格。
* **列画像**：每个列都有迷你分布图、分位数、偏度、离群值个数与高频取值，点一下取值就等于筛选。
* **相关性矩阵**：点击任意方块直接跳到该变量对的散点图（带最小二乘趋势线）。
* **散点矩阵**：自选 2–4 个数值列，两两对照。
* **数据质量检查**：常量列、高基数列、缺失偏多、完全重复行、离群值，并给出“一键处理”。
* **表格**：斑马纹 + 数值右对齐 + 类型/缺失徽标，列宽按内容自适应；数值热力着色、密度切换、
  虚拟滚动（几万行也流畅）、表头点击排序、列菜单（转换类型 / 重命名 / 删除 / 填充缺失…）、
  单元格右键“只看该值 / 排除该值”。
* **流水线**：每一步都显示行数变化与耗时，可停用、拖动顺序、编辑参数，支持撤销 / 重做（Ctrl/⌘+Z）。

## Python 代码 · Generated code

“Python 代码”标签页回答一个问题：**我在界面上做的这些操作，用 pandas 怎么写？**
它把当前流水线翻译成一份可直接运行的脚本，并附上：

* 脚本抬头注释（数据来源、原始行列数）与加载代码；
* 每一步的代码块，标注该步的 **行数变化**（`2,614 → 804`）与操作摘要；
* 结尾的 `print(df.shape)` 与可选的 `df.to_csv("result.csv")`；
* **运行结果预览**——前 5 行，和你在“数据表”页看到的一致；
* 选项：是否包含数据加载、DataFrame 变量名（`df` 可改成任意合法名字）。

示例输出：

```python
import numpy as np
import pandas as pd

# 数据来源: 内置示例数据 · Global retail orders
# 原始数据: 2,614 行 × 16 列
df = pd.read_csv("retail.csv")

# 步骤 1 · region = East  &  revenue > 2000
df = df[
    (df["region"] == "East")
    & (df["revenue"] > 2000)
]

# 步骤 2 · by category → sum(revenue)
df = (
    df.groupby(["category"], as_index=False)
      .agg(
        total=("revenue", "sum"),
      )
)

# 结果: 804 行 × 2 列
print(df.shape)
# df.to_csv("result.csv", index=False)   # 需要保存结果时取消注释
```

这份代码不是“看起来像”而是**真的等价**：`node tests/python-equivalence.test.js`
会把 18 条流水线生成的脚本交给真实的 pandas 执行，再把输出与界面里的结果逐单元格比对
（筛选/排序/缺失值/新增列/去重/分组/透视/交叉表/连接/重采样/滚动/字符串/分箱…）。
为此引擎在细节上刻意与 pandas 对齐：排序用稳定排序并在代码里生成
`kind="mergesort"`，四舍五入用 numpy 的“四舍六入五取偶”（`np.around`），
交叉表的行名与总计、连接时的列顺序都与 pandas 一致。

表达式语言（新增列 / 高级筛选）也支持：
`profit / revenue`、`where(isnull(rating), 0, rating)`、`year(date) * 100 + month(date)`、
`upper(region) + "-" + upper(channel)`、`clip(units, 2, 5)`、`zscore(revenue)`…，
界面会实时显示它对应的 pandas 写法与语法错误。

## 双语一致性 · Bilingual consistency

所有文案集中在 `js/i18n.js` 的两个字典里（`zh` / `en`），键完全一一对应；
测试会逐个检查两个字典是否覆盖同一组键，并检查代码里出现的每个文案键都存在。

## 项目结构 · Project layout

```
index.html              页面外壳，按依赖顺序加载脚本
assets/styles.css       设计令牌（浅色/深色）与全部样式
js/
  util.js                DOM 构建（h / s）、数字与日期格式化、随机数
  i18n.js                中英文案（唯一来源）
  stats.js               统计函数（pandas/numpy 口径）
  df.js                  DataFrame 引擎：dtype 推断、筛选、分组、透视、连接…
  io.js                  CSV/TSV/JSON/JSONL 解析与写出、XLSX(ZIP+deflate) 读取
  datasets.js            内置数据集与随机数据生成器
  expr.js                表达式语言（求值 + 生成 pandas 代码）
  ops.js                 24 个可视化操作的定义：表单、执行、代码生成、摘要
  charts.js              图表核心：配色、比例尺、布局、坐标轴、提示、导出
  chart-prep.js          图表数据整形（聚合、分组、排序、Top-N）
  marks-*.js             各类图形（柱/线/面积、散点/直方图、箱/热力/饼）
  ui.js / dialog.js      Toast、菜单、对话框、表单控件
  forms*.js              操作参数的声明式表单与实时预览
  app-*.js               状态、历史、数据管理、页面外壳
  panel-*.js / views-*.js 各面板与标签页视图
tests/                   1222 项自动化检查（引擎、操作、图表几何、XLSX、真实 pandas 等价性、
                         UI 一致性、DOM 冒烟，以及两个真实浏览器端到端套件）
tools/                   漫游动图的录制与合成（tour.js / build-gif.py）
tour/                    漫游动图（visual-pandas-tour.gif）
讲解-网站特点.md          面向使用者的功能讲解文档
```

## 测试 · Tests

```bash
node tests/run-all.js        # 一次跑完全部（1222 项检查）

node tests/engine.test.js    # DataFrame / 统计 / 解析 / 数据集（135）
node tests/ops.test.js       # 每个操作 + 代码生成 + 表达式（299）
node tests/charts.test.js    # 每种图表的几何、坐标轴、键与配色（253）
node tests/xlsx.test.js      # 自研 ZIP + XLSX 读取器（19）
node tests/python-equivalence.test.js   # 生成的代码交给真实 pandas 跑，逐值比对（70）
node tests/ui.test.js        # 文案键（含重复键）、图标形状、样式类、脚本顺序（83）
node tests/ui-boot.test.js   # 用 DOM 垫片启动界面 + 联动/图形检查（215）
node tests/e2e-core.test.js  # 真实浏览器：启动、五种加载方式、24 个操作、代码、表格、图标（47）
node tests/e2e-ui.test.js    # 真实浏览器：16 种图形与交互、画像联动、汇总、连接、撤销/重做、
                             #              代码页、导出与会话、语言主题、响应式、数据集增删（99）
```

其中 `python-equivalence` 需要本机有 `python` + `pandas`；没有时会自动跳过并提示。
两个 `e2e-*` 套件需要本机有 Chrome 或 Edge；没有时会自动跳过。

还有一个视觉检查脚本（需要本机有 Chrome 或 Edge）：它会用无头浏览器打开网站，依次截图
每个标签页、深色主题、当前列联动、流水线内联代码与空工作台，并报告控制台错误：

```bash
node tests/visual-check.js ./shots
node tools/tour.js ./tour      # 重新录制漫游动图（需要 python + Pillow）
```

## 已知边界 · Limitations

* 全部计算都在浏览器里完成，适合百万行以内的数据；图表默认最多绘制 4,000 个点
  （超过 1,200 个点的散点自动切换成快速点路径渲染，交互保持不变）。
* `file://` 下“从网址加载”会受浏览器跨域策略限制，用静态服务器打开即可。
* 会话（数据 + 流水线）可导出为 JSON；解析 XLSX 只读取单元格文本与数值，不处理公式与样式。
