# 《可视化导论》重构版

本地可运行的静态课程网站。重构保留了原有五章内容与全部交互演示，并重新组织了阅读、代码、演示和自测之间的关系。

## 本地打开

可以直接双击 `index.html`。门户与五章课程的核心交互演示已支持通过 `file://` 离线运行，不需要安装依赖。

如需完整浏览 `supplementary/` 中的全部补充实验，建议双击 `start-local.bat`，或在当前目录运行：

```powershell
python -m http.server 8080 --bind 127.0.0.1
```

然后访问 `http://127.0.0.1:8080/`。

课程核心数据已打包到 `assets/course-data.js`。修改以下 CSV/JSON 后，请重新生成离线数据：

```powershell
node tools/build-course-data.mjs
```

## 重构内容

- 新门户：课程地图、关键词筛选、学习进度、继续学习入口。
- 新阅读层：章节目录、一句话总结、易错点、自查清单、阅读进度。
- 内容组织：讲解连续阅读，关键代码按需展开，交互演示直接嵌入小节。
- 学习闭环：每节 4 道即时自测、逐节完成标记、跨页面进度保存。
- 本地依赖：D3.js 与回归插件均已下载到 `vendor/`，无需 CDN。
- 离线入口：门户和课程链接显式指向 `index.html`，直接双击也不会进入目录索引。
- 离线数据：浏览器文件协议下自动使用打包的 CSV/JSON，核心演示无需本地服务器。
- 无视频：所有新增可视化均为 SVG / Canvas / DOM 交互。

## 主要目录

```text
.
├── index.html                 课程门户
├── assets/
│   ├── portal.css             门户样式
│   ├── portal.js              门户交互与首屏图形
│   ├── lesson.css             统一阅读样式
│   └── lesson-enhance.js      章节壳、进度、自测
├── lesson-01 ... lesson-05    五章内容与原有演示
├── supplementary/             补充实验集合
└── vendor/                    本地 D3.js 依赖
```

进度保存在浏览器 `localStorage` 的 `vis-course-progress-v2` 键中，不收集任何数据。
