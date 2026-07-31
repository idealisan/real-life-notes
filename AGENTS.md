# AGENTS.md

Real Life Notes — 把 GitHub 仓库当作笔记/博客后端，管理员在浏览器中直接通过 GitHub API 提交 commit，GitHub Pages 自动构建发布。

## 工作纪律
- 这是**长任务、需反复迭代**。每次调用 bash 命令，都必须在命令前用 `echo "== $(date '+%H:%M:%S') =="` 打印当前时间（便于核对进度与耗时）。

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
  - jsdom 集成测试在 `/tmp/opencode/jstest/`：`test-site`（列表/路由）、`test-site2`（过滤/搜索/详情/公式/404）、`test-admin`（连接/发布）、`test-admin2`（草稿/编辑/删除/409 重试）、`test-img`（图片上传）。
- 本地预览：`python3 -m http.server 8080 --directory .`。
- 端到端验收：真实 token 发布一次 → raw 即时可见 → Pages 自动构建。
