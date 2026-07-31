# AGENTS.md

Real Life Notes — 把 GitHub 仓库当作笔记/博客后端，管理员在浏览器中直接通过 GitHub API 提交 commit，GitHub Pages 自动构建发布。

## 工作纪律
- 这是**长任务、需反复迭代**。每次调用 bash 命令，都必须在命令前用 `echo "== $(date '+%H:%M:%S') =="` 打印当前时间（便于核对进度与耗时）。
- **无问持续推进原则（最高优先级）**：本会话是一个**长达 8 小时的连续迭代时段**。在接下来的时间里**不要向用户提出任何问题、不要停下来等待确认**，只要有合理的需求方向就自主判断并执行。持续不断地：**改进 → 测试 → 提交（commit）→ 推送（push）→ 再改进**，周而复始，永不停歇。
- **持续推进原则**：本项目是持续迭代型，完成一批功能后不要停下，继续补齐细节功能、优化体验、补测试。空闲时可参考博客站常见功能（评论、分页、标签页、搜索、阅读进度、RSS、站点统计、阅读量、SEO 等）规划下一批迭代。单条 bash 循环里不要重复运行同一测试（避免超时）。
- **每次迭代的闭环要求**：一批功能改动完成且测试通过后，立即 `git commit`（中文 message）+ `git push origin main`，再进行下一批；避免长时间堆积大量未推送的改动。

## 已规划/待办（重要）
- **空仓库一键初始化**（远期，见 architecture.md §10）：token+仓库地址输入、初始化模块、Pages 开启引导。
- 持续迭代原则见「工作纪律」。

## 高优先级：MPA 重构（已完成）
- **公开站点 SPA(hash 路由) → 传统多页面 + query 参数路由（已完成，勿回退）**：
  - 列表：`index.html`；分类/搜索/翻页/归档：`index.html?cat=…&q=…&page=2&view=archive`（全部查询参数，不用 hash）。
  - 详情：`post.html?p=content/notes/slug.md`（读 `content/index.json`，索引内嵌 `content` 正文，旧索引回退 fetch raw）；无 `p` 参数/未知路径/草稿 → 404 提示；`404.html` 兜底。
  - 页内锚点原生可用：`post.html?p=…&#heading`；TOC 用 `href="#id"` 原生跳转（不再 `scrollIntoView`）。
  - `site.js` 按页面路径自动检测模式（`MODE = location.pathname…==='post.html'`）；列表页筛选变化用 `history.replaceState(null,'',buildListUrl())` 同步 URL、监听 `popstate` 重渲染；详情页内标签链接 `index.html?q=…`、列表页标签点击 `preventDefault` + 原地渲染。
  - 全部内部链接（卡片、上一篇/下一篇、相关文章、标签、归档、TOC）与 RSS/sitemap 链接均为 `post.html?p=` / `index.html?…` 形式。
  - 测试：`test-post.js`（详情/404/草稿/无参）、`test-site2.js`（列表/搜索/IME/归档/popstate）、`test-index-content.js`（索引内嵌/raw 回退）等。

## 高优先级：搜索框中文/日文输入法兼容缺陷修复（已完成）
### 问题描述
现有实现仅监听 `input` 事件；使用拼音等输入法拼字过程中，未确认的拼音会持续触发搜索，造成搜索列表频繁闪烁、无效查询。用户期望仅在确认汉字后执行检索。
### 修复方案（浏览器原生 CompositionEvent 标准方案，已落地）
1. 利用 `compositionstart` / `compositionend` 区分「输入法拼字阶段」与「输入确认完成」；
2. 拼字阶段设置标记 `composing=true`，屏蔽 `input` 事件触发搜索；
3. 输入确认完成后（`compositionend`）主动执行一次搜索（防止浏览器 dispatch 顺序导致最后一次检索丢失）；
4. 叠加 `debounce(fn, 300)` 防抖函数，减少频繁检索开销；`Escape`/`Enter` 时 `debounced.cancel()` 后立即搜索；
5. 边界：防抖回调执行时若已进入拼字阶段则跳过（清空后 300ms 内开始打拼音的场景）；
6. 搜索输入框单例复用（避免每次重渲染重建导致失焦/IME 状态丢失）。
实现位置：`site.js` 的 `searchInputElement`/`doSearch`、`admin.js` 的 `filterInputElement`/`debouncedFilter`（后台过滤器同一套方案）。
### 固定开发规范
- 不引入第三方输入组件，原生 JS 实现；
- 采用方案A：拼字过程不执行搜索，文字确认后检索；
- 兼容中文、日文、韩文等全部需要输入法合成的语言；
- 同时保证英文、数字、粘贴、回车搜索功能不受影响。

## 当前状态与约定
- 已实现（`5763381` 起）：公共站点（`index.html` + `assets/js/site.js`）、管理后台（`admin/`）、GitHub 客户端（`assets/js/gh.js`）、Markdown/公式渲染（`assets/js/md.js`）。
- 纯原生 JS（IIFE + 全局 `gh`/`md`/`Site`/`Admin`），无构建步骤，`python3 -m http.server 8080` 即可本地运行。
- 沟通与文档用中文；commit message 用中文。分支 `main`，remote `origin` = `git@github.com:idealisan/real-life-notes.git`。
- 第三方库**本地托管**于 `assets/vendor/`（marked 4.3.0、DOMPurify 3.0.6、KaTeX 0.16.11 + 字体、highlight.js 11.9.0 + 主题），不依赖 CDN。

## 核心设计（勿偏离主路线）
- 主方案：**纯静态、零后端**。管理员用自己的 fine-grained PAT（仅授权本仓库 `Contents: read/write`），token 存**浏览器密码管理器**，前端直调 `api.github.com` 提交 commit → GitHub Pages 自动构建。
- 不可作为主路线的替代（已调研否决）：OAuth device/web flow 无法纯浏览器完成（`github.com/login/*` 无 CORS、需 `client_secret`）；`POST /pages/deployments` 不可用（要求 GitHub Actions 签发的 OIDC token）。

## 实现要点（已验证，勿回退）
- **token 表单**：`type="password"` + `autocomplete="current-password"` + 稳定唯一 `id`/`name` + 正常 `<form>`+submit；不设 `maxlength`；**不得**写入 localStorage/IndexedDB（内存持有，刷新重连）。
- **提交（`gh.commitFiles`，五步）**：GET refs/heads/{branch} → GET commits/{HEAD} → POST git/trees `{base_tree, tree}` → POST git/commits → PATCH refs。tree 条目直接带 `content`（GitHub 代写 blob）、删除用 `sha: null`；**必须带 `base_tree`**，否则未列出的文件全被删除；PATCH 409 时重试（重取基线）。
- **渲染管线（`md.render`）**：先保护代码块（`@@CODE-n@@`）→ 提取 `$...$`/`$$...$$`（`@@MATH-n@@`，货币 `$数字` 启发式跳过）→ marked → DOMPurify（`FORBID_ATTR:['style']`）→ hljs 高亮 `pre code.language-*` → 回填 KaTeX HTML。
- **el() 约定**（site.js/admin.js 共用工具）：`onClick` 等事件属性 → `addEventListener(k.slice(2).toLowerCase())`；`null/undefined` 属性值跳过 `setAttribute`（否则复选框/下拉永远选中）。
- **数据结构**：`config.json`（站点+分类+GitHub 坐标）、`content/index.json`（唯一索引，含 `draft` 字段，草稿进索引但公开站点过滤）、`content/<分类>/<slug>.md`（frontmatter + body）。一次发布 = 一个 commit 原子更新 md + index.json。见 `docs/data-model.md`。
- 后台入口在 `/admin/`，相对路径要用 `../config.json`。

## 验证
- 语法检查与集成测试用 node（本机未装，可临时下载到 `/tmp/opencode/node`）：
  - `node --check <file>` 语法。
  - jsdom 集成测试在 `/tmp/opencode/jstest/`：`test-site`（列表/路由）、`test-site2`（过滤/搜索/详情/公式/404）、`test-welcome`（种子帖渲染+灯箱）、`test-draft`（草稿直链拦截）、`test-empty`（无 config/index 仓库的连接）、`test-admin`（连接/发布）、`test-admin2`（草稿/编辑/删除/409 重试）、`test-img`（图片上传）。
- 本地预览：`python3 -m http.server 8080 --directory .`（可后台常驻：`nohup ... &`），站点在 `http://127.0.0.1:8080/`。
- 端到端验收：真实 token 发布一次 → raw 即时可见 → Pages 自动构建。
