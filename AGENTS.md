# AGENTS.md

Real Life Notes — 把 GitHub 仓库当作笔记/博客后端，管理员在浏览器中直接通过 GitHub API 提交 commit，GitHub Pages 自动构建发布。

## 文档分工准则
- **AGENTS.md 只维护工作准则与纪律**（如何干活、约定、验证流程），不记录具体需求。
- **工作需求一律记录在其他文档**：需求缺口/待补功能/优先级 → **`docs/requirements-analysis.md`（需求来源）**；已采纳待办/已知问题/功能决策 → `docs/requirements.md`；架构 → `docs/architecture.md`；数据结构 → `docs/data-model.md`；实现技术方案 → `docs/tech-manual.md`；使用说明 → `docs/user-manual.md`。
- 新增需求或发现 Bug 时，**先更新 `docs/requirements.md` 再动手实现**；完成后同步把对应条目标记为已修复/已完成。

## 工作纪律
- 这是**长任务、需反复迭代**。每次调用 bash 命令，都必须在命令前用 `echo "== $(date '+%H:%M:%S') =="` 打印当前时间（便于核对进度与耗时）。
- **无问持续推进原则（最高优先级）**：本会话是一个**长达 8 小时的连续迭代时段**。在接下来的时间里**不要向用户提出任何问题、不要停下来等待确认**，只要有合理的需求方向就自主判断并执行。持续不断地：**改进 → 测试 → 提交（commit）→ 推送（push）→ 再改进**，周而复始，永不停歇。
- **持续推进原则**：本项目是持续迭代型，完成一批功能后不要停下，继续补齐细节功能、优化体验、补测试。空闲时可参考博客站常见功能（评论、分页、标签页、搜索、阅读进度、RSS、站点统计、阅读量、SEO 等）规划下一批迭代。单条 bash 循环里不要重复运行同一测试（避免超时）。
- **每次迭代的闭环要求**：一批功能改动完成且测试通过后，立即 `git commit`（中文 message）+ `git push origin main`，再进行下一批；避免长时间堆积大量未推送的改动。
- **文件写入权限规则（最高优先级）**：任何情况下都**不要向没有访问权限的位置写文件**（会触发权限错误导致工作中断）。应**始终尽量把文件写入当前项目目录**（`/home/lxdubuntu24/default-oc/real-life-notes/`）内；临时文件一律放到临时目录（如 `/tmp/opencode/`），用完**不提交或及时清理**。测试脚本等开发期工具放 `/tmp/opencode/jstest/`（不随仓库提交）。若某路径写不进去（权限/只读），立即改用项目内或临时目录的替代路径，不要反复重试导致卡住。

## 当前状态与约定
- 已实现：公共站点（`index.html` + `assets/js/site.js`）、管理后台（`admin/`）、GitHub 客户端（`assets/js/gh.js`）、Markdown/公式渲染（`assets/js/md.js`）。
- 纯原生 JS（IIFE + 全局 `gh`/`md`/`Site`/`Admin`），无构建步骤，`python3 -m http.server 8080` 即可本地运行。
- 沟通与文档用中文；commit message 用中文。分支 `main`，remote `origin` = `git@github.com:idealisan/real-life-notes.git`。
- 第三方库**本地托管**于 `assets/vendor/`（marked 4.3.0、DOMPurify 3.0.6、KaTeX 0.16.11 + 字体、highlight.js 11.9.0 + 主题），不依赖 CDN。
- **改代码资源（js/css）后的发布流程**：`node tools/version-bump.js` → `git add -A && git commit && git push`。脚本会把代码资源统一复制到 `assets/v<unix时间戳>/` 并重写 4 个 HTML 的引用（取代旧的手动 `?v=` 版本号），幂等可重复运行；**HTML 与版本目录必须在同一个提交里上线**。用户内容（图片/md/config.json/content/index.json）不版本化。

## 核心设计（勿偏离主路线）
- 主方案：**纯静态、零后端**。管理员用自己的 fine-grained PAT（仅授权本仓库 `Contents: read/write`），token 存**浏览器密码管理器**，前端直调 `api.github.com` 提交 commit → GitHub Pages 自动构建。
- 不可作为主路线的替代（已调研否决）：OAuth device/web flow 无法纯浏览器完成（`github.com/login/*` 无 CORS、需 `client_secret`）；`POST /pages/deployments` 不可用（要求 GitHub Actions 签发的 OIDC token）。

## 实现要点（已验证，勿回退）
- **token 表单**：`type="password"` + `autocomplete="current-password"` + 稳定唯一 `id`/`name` + 正常 `<form action="./" method="get">`+submit（**必须带 `action`**，否则浏览器不认为这是可保存密码的表单）；表单内加一个 `visually-hidden` 的 `autocomplete="username"` 字段，提交时由 JS 填仓库 owner。**纯 SPA + `preventDefault` 时浏览器原生启发式不会弹保存框**，必须显式调用 Credential Management API：连接成功后 `navigator.credentials.store(new PasswordCredential({ id: state.user.login, password: token }))`（仅 HTTPS、`window.PasswordCredential` 存在时）。不设 `maxlength`；**不得**写入 localStorage/IndexedDB（内存持有，刷新重连）。
  - **独立登录页（无后端静态兼容，推荐）**：`admin/login.html` 用 `method="get"` + `action="./index.html"` 真实提交跳转触发保存框；Token/仓库输入**不带 `name`**（不序列化进 URL），隐藏 `adminUser` 字段保留 `name="adminUser"` + `autocomplete="username"` 供密码管理器识别；提交处理器把 Token/仓库写入 `sessionStorage`（`adminToken`/`adminRepo`）后**不 preventDefault**，让浏览器真实 GET 跳转到 `index.html`，后台 `boot()` 读 sessionStorage 自动连接。静态托管无后端也能跑。
- **提交（`gh.commitFiles`，五步）**：GET refs/heads/{branch} → GET commits/{HEAD} → POST git/trees `{base_tree, tree}` → POST git/commits → PATCH refs。tree 条目直接带 `content`（GitHub 代写 blob）、删除用 `sha: null`；**必须带 `base_tree`**，否则未列出的文件全被删除；PATCH 409 时重试（重取基线）。
- **渲染管线（`md.render`）**：先保护代码块（`@@CODE-n@@`）→ 提取 `$...$`/`$$...$$`（`@@MATH-n@@`，货币 `$数字` 启发式跳过）→ marked → DOMPurify（`FORBID_ATTR:['style']`）→ hljs 高亮 `pre code.language-*` → 回填 KaTeX HTML。
- **el() 约定**（site.js/admin.js 共用工具）：`onClick` 等事件属性 → `addEventListener(k.slice(2).toLowerCase())`；`null/undefined` 属性值跳过 `setAttribute`（否则复选框/下拉永远选中）。
- **数据结构**：`config.json`（站点+分类+GitHub 坐标）、`content/index.json`（唯一索引，含 `draft` 字段，草稿进索引但公开站点过滤）、`content/<分类>/<slug>.md`（frontmatter + body）。一次发布 = 一个 commit 原子更新 md + index.json。见 `docs/data-model.md`。
- 后台入口在 `/admin/`，相对路径要用 `../content/config.json`。

## 验证
- 语法检查与集成测试用 node（本机未装，可临时下载到 `/tmp/opencode/node`）：
  - `node --check <file>` 语法。
  - jsdom 集成测试在 `/tmp/opencode/jstest/`：`test-site`（列表/路由/主题）、`test-site2`（过滤/搜索/IME/归档/popstate）、`test-welcome`（种子帖渲染+灯箱）、`test-draft`（草稿直链拦截）、`test-empty`（无 config/index 仓库的连接）、`test-admin`（连接/发布）、`test-admin2`（草稿/编辑/删除/409 重试）、`test-img`（图片上传）、`test-pager`（分页）、`test-comments`（评论）、`test-init`（空仓库初始化）、`test-index-content`（索引内嵌/raw 回退）、`test-post`（详情/404/草稿/无参）。
- 本地预览：`python3 -m http.server 8080 --directory .`（可后台常驻：`nohup ... &`），站点在 `http://127.0.0.1:8080/`。
- 端到端验收：真实 token 发布一次 → raw 即时可见 → Pages 自动构建。
