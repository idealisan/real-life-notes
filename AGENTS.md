# AGENTS.md

Real Life Notes — 把 GitHub 仓库当作笔记/博客后端，管理员在浏览器中直接通过 GitHub API 提交 commit，GitHub Pages 自动构建发布。

## 工作纪律
- 这是**长任务、需反复迭代**。每次调用 bash 命令，都必须在命令前用 `echo "== $(date '+%H:%M:%S') =="` 打印当前时间（便于核对进度与耗时）。
- **无问持续推进原则（最高优先级）**：本会话是一个**长达 8 小时的连续迭代时段**。在接下来的时间里**不要向用户提出任何问题、不要停下来等待确认**，只要有合理的需求方向就自主判断并执行。持续不断地：**改进 → 测试 → 提交（commit）→ 推送（push）→ 再改进**，周而复始，永不停歇。
- **持续推进原则**：本项目是持续迭代型，完成一批功能后不要停下，继续补齐细节功能、优化体验、补测试。空闲时可参考博客站常见功能（评论、分页、标签页、搜索、阅读进度、RSS、站点统计、阅读量、SEO 等）规划下一批迭代。单条 bash 循环里不要重复运行同一测试（避免超时）。
- **每次迭代的闭环要求**：一批功能改动完成且测试通过后，立即 `git commit`（中文 message）+ `git push origin main`，再进行下一批；避免长时间堆积大量未推送的改动。
- **文件写入权限规则（最高优先级）**：任何情况下都**不要向没有访问权限的位置写文件**（会触发权限错误导致工作中断）。应**始终尽量把文件写入当前项目目录**（`/home/lxdubuntu24/default-oc/real-life-notes/`）内；临时文件一律放到临时目录（如 `/tmp/opencode/`），用完**不提交或及时清理**。测试脚本等开发期工具放 `/tmp/opencode/jstest/`（不随仓库提交）。若某路径写不进去（权限/只读），立即改用项目内或临时目录的替代路径，不要反复重试导致卡住。

## 已规划/待办（重要）
- **空仓库一键初始化**（远期，见 architecture.md §10）：token+仓库地址输入、初始化模块、Pages 开启引导。
- 持续迭代原则见「工作纪律」。

## 已知问题（待修 Bug）
1. ~~**详情页 TOC sticky 悬浮与正文重叠**~~（已修复 `04b8aba` 后）：正文阅读时展开目录（`<details class="toc">`）后往下滚动，目录会 sticky 悬浮在页面上方、不随滚动消失，与下方正文排版发生重叠。桌面端 `≥980px` 的 `.detail-body .toc { position: sticky; top: 16px; … }` 效果不正确。**已移除该 sticky 规则**（`.toc` 恢复普通文档流，跟随正文滚动）。
2. **详情页顶部标签点击无效果**：正文阅读（`post.html?p=…`）时点击详情头部的标签（`.detail-head` 的 `.tag`），页面无任何变化，网络请求中只有对当前页面地址的请求，未出现 `index.html?q=…` 的跳转。**排查结论**：代码中 `.tag` 是 `<a href="index.html?q=…">`，href 解析正确（jsdom 验证 resolved href 正常）、无全局 click 拦截、无 preventDefault、无 service worker/base 标签；已做防御性修复——`tagLink()` 在 `MODE==='post'` 分支增加 `onClick`（`preventDefault()` + `window.location.href = href`）显式导航，保证点击必跳转。测试：`test-post.js` 断言点击后 `defaultPrevented=true`（导航接管）。若仍复现需在真实浏览器进一步排查。

## 高优先级：MPA 重构（已完成）- **公开站点 SPA(hash 路由) → 传统多页面 + query 参数路由（已完成，勿回退）**：
  - 列表：`index.html`；分类/搜索/翻页/归档：`index.html?cat=…&q=…&page=2&view=archive`（全部查询参数，不用 hash）。
  - 详情：`post.html?p=content/notes/slug.md`（读 `content/index.json`，索引内嵌 `content` 正文，旧索引回退 fetch raw）；无 `p` 参数/未知路径/草稿 → 404 提示；`404.html` 兜底。
  - 页内锚点原生可用：`post.html?p=…&#heading`；TOC 用 `href="#id"` 原生跳转（不再 `scrollIntoView`）。
  - `site.js` 按页面路径自动检测模式（`MODE = location.pathname…==='post.html'`）；列表页筛选变化用 `history.replaceState(null,'',buildListUrl())` 同步 URL、监听 `popstate` 重渲染；详情页内标签链接 `index.html?q=…`、列表页标签点击 `preventDefault` + 原地渲染。
  - 全部内部链接（卡片、上一篇/下一篇、相关文章、标签、归档、TOC）与 RSS/sitemap 链接均为 `post.html?p=` / `index.html?…` 形式。
  - 测试：`test-post.js`（详情/404/草稿/无参）、`test-site2.js`（列表/搜索/IME/归档/popstate）、`test-index-content.js`（索引内嵌/raw 回退）等。

## 评论系统（已完成，路线 B）
- **实现方式**：基于 GitHub Issues 的原生评论，**零第三方服务、零外部脚本**。`post.html` 详情页底部渲染评论区：`GET api.github.com/repos/{owner}/{repo}/issues?labels=评论&state=all` → 按 `title === 文章路径` 匹配对应 Issue → 展示 Issue 正文+全部回复（头像/作者/日期/Markdown 渲染）；未建 Issue 时显示「写第一条评论」链接（预填标题+标签跳转 GitHub 创建）。
- **门控**：`config.comments = { enabled, label }`，**默认关闭**；管理后台站点设置可开关并配置标签。
- **CSP**：公共站点 `connect-src` 放行 `https://api.github.com`（仅为评论读取，仍无第三方脚本）。
- 测试：`test-comments.js`（启用/未建 Issue 引导/禁用不渲染）。

## 高优先级：搜索框手动提交（已完成，替代自动搜索）
### 决策
自动搜索（input 防抖 + IME 组合事件处理）在真实浏览器中表现不佳、且每次都整页重渲染造成性能开销。**改为普通 `<input type="search">` + 「搜索」按钮的手动提交**（`.search-form` 表单 `onsubmit`）：
- 输入框**不绑定任何 `input`/`keydown`/`composition*` 监听**，天然 IME 安全（中/日/韩输入法拼字、Enter 选词、Escape 取消都不会误触发搜索）；
- 仅表单提交（点按钮或输入框内回车）时执行 `render()`，并重置 `page/view/cat`、同步 `q=` 到 URL；
- 标签/分类点击仍是独立链接（`index.html?q=`/`?cat=`），`preventDefault` + 原地渲染不变。
实现位置：`site.js` `renderList`（form+submit）、`.search-form`/`.search-submit` 样式（site.css）。
后台编辑器列表的过滤框仍保留防抖（内存过滤、开销小，无性能问题）。
测试：`test-site2.js` 搜索断言全部改为「输入不触发 + 提交才过滤 + IME 不干扰」。

## 相对路径支持（已完成）
- **`site.url` 为空时全部使用相对路径**，不再按 `github.owner/repo` 推导 `https://<owner>.github.io/<repo>/`——适配 GitHub Pages 多仓库/子路径部署（不能假设用户有顶级域名）。
- `admin.js`：`siteBaseUrl()` 无 `site.url` 时返回 `''`；新增 `absUrl(path)`（base 为空 → 直接 `path`，否则 `base/path`）与 `homeUrl()`（base 为空 → `index.html`）；RSS（`<link>`/`<atom:link>`/item `<link>`）、sitemap（`<loc>`）、robots.txt（`Sitemap:`）均经这两个函数生成，无前导 `/`。
- 公开站点内部链接本就是相对路径（`post.html?p=`/`index.html?…`），canonical/og:url 用 `location.href` 天然正确。
- 后台站点设置「站点地址」占位提示改为「留空则用相对路径」。文档 `docs/data-model.md` 已同步。

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
