# Real Life Notes — 功能架构设计

> 本文档是本项目的**权威功能架构**。它规定了系统如何组成、各组件职责、数据如何在浏览器与 GitHub API 之间流动。实现必须以此为准；与实现冲突时以本文档修订为准。

---

## 1. 系统形态总览

- **纯静态、零后端**。整个项目是一个静态站点（HTML/CSS/JS），可部署在 GitHub Pages / Cloudflare Pages / 任意静态托管。
- **GitHub 仓库即数据库**。所有内容以 Markdown 文件存储在仓库中；Git 本身就是版本历史。
- **管理员用个人 fine-grained PAT** 在浏览器中直接调用 GitHub API 提交 commit；token 存放在浏览器密码管理器，页面不落盘。
- **构建闭环**：commit 推送到 `main` 分支后，GitHub Pages 自动构建发布；公开站点运行时直接读取仓库文件（raw / same-origin），内容即时可见，不依赖 Pages 构建耗时。

## 2. 目录结构

```
real-life-notes/
├── index.html              # 公共站点入口（单页，hash 路由）
├── admin/
│   └── index.html          # 管理后台入口（单页）
├── assets/
│   ├── css/
│   │   ├── base.css        # 设计令牌 + 基础元素样式（两站共用）
│   │   ├── site.css        # 公共站点样式
│   │   └── admin.css       # 管理后台样式
│   ├── js/
│   │   ├── gh.js           # GitHub REST API 客户端（读/写/提交）
│   │   ├── md.js           # Markdown 渲染 + XSS 消毒封装
│   │   ├── site.js         # 公共站点控制器
│   │   └── admin.js        # 管理后台控制器
│   └── vendor/             # 本地托管的第三方库（避免 CDN，收紧 CSP）
│       ├── marked.min.js
│       └── purify.min.js
├── config.json             # 站点配置（标题、简介、分类元数据）
├── content/                # 内容仓库（数据源）
│   ├── index.json          # 帖子索引（公开站点读取的唯一入口）
│   ├── notes/              # 分类 = 目录
│   │   └── 2026-07-31-hello.md
│   ├── life/
│   └── work/
└── docs/                   # 设计文档（不入站渲染）
    ├── architecture.md
    └── data-model.md
```

- 公共站点与管理员入口是**两个独立的单页应用**，共享 `base.css`、`gh.js`、`md.js`。
- 所有 JS 采用**原生 ES5/ES2015 兼容写法 + IIFE 暴露全局**（`Site`、`Admin`、`gh`、`md`），与现有项目风格一致：无需构建步骤、无需模块加载器、`python3 -m http.server` 即可运行。

## 3. 组件职责

### 3.1 gh.js — GitHub API 客户端（数据访问层）

职责：
- 统一封装请求：基础 URL `https://api.github.com`、`Accept: application/vnd.github+json`、`X-GitHub-Api-Version: 2022-11-28`、条件性 `Authorization: Bearer <token>`。
- 提供对外的领域方法（见 5.4），覆盖：认证校验、仓库信息、读取文件、目录树、以及 **五步 Git Database 提交流程**。
- 提交流程内置**乐观锁重试**（409 时重取基线重跑）。

设计要点：
- 无 token 时仍允许调用公共读接口（公开仓库），便于调试与只读场景。
- 所有方法返回 Promise，错误统一为 `Error`（带 `status`、`documentation_url`、原始 message）。
- 内部 `_request(method, path, body)` 处理 2xx/3xx/4xx/5xx 分支，4xx/5xx 抛错。

### 3.2 md.js — Markdown 渲染

职责：
- `md.render(markdown) -> sanitizedHtml`：`marked` 渲染（GFM、自动断行）+ `DOMPurify` 消毒。
- `md.parseFrontmatter(text) -> {meta, body}`：解析 `---` 包裹的最小 YAML 子集（title/tags/date/draft/updated）。
- `md.buildFrontmatter(meta) -> string`：从元数据反向生成 frontmatter 文本。
- `md.excerpt(text, maxChars=160) -> string`：提取纯文本摘要（剥离 frontmatter 与 Markdown 标记）。

安全约定：**所有进入 innerHTML 的动态内容必须经过消毒**——正文走 DOMPurify；元数据/列表项走 `esc()` 纯文本转义。`md.js` 导出 `md.esc` 供全局使用。

### 3.3 site.js — 公共站点控制器

职责：
- 启动流程：读取 `/config.json`（同源，失败则回退内嵌默认值）→ 读 `config.github` 确定 raw 源 → 拉取 `content/index.json` → 渲染首页列表。
- 路由（hash）：
  - `#/` 或空：文章列表视图（分类过滤 `?cat=`、关键词搜索）
  - `#/post/<path>`：文章详情视图
- 渲染：分类导航、文章卡片、文章正文、上一篇/下一篇（可选）、空态。
- 交互：分类切换、搜索防抖、点击进入详情、返回列表。
- 对服务端无任何写操作；全部是读取 GitHub raw / same-origin 静态文件。

### 3.4 admin.js — 管理后台控制器

职责：
- **连接区**：token 输入（密码管理器规范）、连接/断开、状态显示（当前用户、owner/repo、分支）。
- **工作区视图**：
  - 文章列表（分类过滤、搜索、草稿标记、编辑/删除入口）
  - 编辑器（新建/编辑）：标题、分类、标签、日期、草稿开关、正文、双栏预览、发布
  - 分类管理：增删改分类元数据（写入 config.json）
  - 站点设置：标题/简介/分类图标等（写入 config.json）
- **发布流程**：组装文件变更 → `gh.commitFiles()` → 展示 commit 链接。
- 状态管理：单一 `state` 对象 + 纯函数更新，视图重绘集中在 `render()`。

## 4. 视图与交互设计（UX）

### 4.1 公共站点
- PC：顶部导航（站点标题 + 分类）、左侧/顶部分类栏、右侧正文列表卡片（标题/日期/摘要/标签）、点击进入正文。
- 移动：单列卡片流；分类切换为顶部可横滑的 chip 行；正文大字号、行距宽松。
- 详情页：面包屑返回、大标题、日期/标签、Markdown 正文、底部"返回列表"。
- 深色模式：可选，随系统 `prefers-color-scheme`（低优先，视迭代时间）。

### 4.2 管理后台
- 布局：顶栏（连接状态 + 全局操作）+ 左侧窄导航（列表/分类/设置）+ 主内容区。
- 编辑器：PC 左右分栏（编辑 | 预览），移动端上下切换（Tab 切换）。
- 所有表单操作即时反馈：按钮 loading 态、成功 toast、失败错误条。
- 发布成功给出 commit 的 GitHub 链接与「查看站点」按钮。

### 4.3 可访问性
- 语义化标签、焦点可见性、表单 label 关联。
- 颜色对比度满足基本要求；不依赖单一颜色传达状态。

## 5. 核心流程设计

### 5.1 首次访问公开站点
```
浏览器 → GET /config.json (同源)
      → GET <raw>/content/index.json
      → 渲染分类 + 文章列表
```

### 5.2 查看一篇文章
```
点击卡片 → hash = #/post/<path>
       → GET <raw>/<path>  (raw.githubusercontent.com，即时最新)
       → 解析 frontmatter → md.render(body) → 渲染详情
```

### 5.3 管理员发布（新建/更新/删除）
```
admin 填表 → 组装 post 内容（frontmatter + body）
           → 计算新 index.json（读当前 + 改一条）
           → gh.commitFiles({
                branch, 
                files: [ {path: content/<cat>/<slug>.md, content}, 
                         {path: content/index.json, content: newIndex} ],
                message: "[post] 新建｜更新｜删除 <title>",
              })
           → 成功：展示 commit url；提示"Pages 将自动构建，raw 已即时可见"
```

### 5.4 提交实现（gh.commitFiles 五步 + 重试）

依据 Git Trees API 官方语义（已验证）：tree 条目可直接携带 `content`（GitHub 代写 blob），`sha: null` 表示删除文件。

1. `GET /git/refs/heads/{branch}` → HEAD sha
2. `GET /git/commits/{HEAD}` → tree sha
3. `POST /git/trees` `{base_tree: 第2步tree, tree: [...]}` → tree sha
   - **必须带 base_tree**（否则未列出的文件全部被视为删除）
   - 新增/更新条目：`{path, mode:"100644", type:"blob", content}`（content 传原始 UTF-8 字符串）
   - 删除条目：`{path, mode:"100644", type:"blob", sha: null}`
4. `POST /git/commits` `{message, tree, parents:[HEAD]}` → commit sha
5. `PATCH /git/refs/heads/{branch}` `{sha, force:false}`
- 步骤 5 返回 409（ref 冲突）→ 回到步骤 1，重试最多 3 次。
- 删除不存在的文件会返回 422（GitHub 语义）→ 前端先以 index.json / 列表数据为准，避免删除不存在的文件；收到 422 时给出友好提示。
- 树请求体上限 7MB：正文类文本远小于该值，无需分片。

## 6. 技术栈与库选型

| 领域 | 选型 | 理由 |
| --- | --- | --- |
| Markdown 渲染 | `marked`（vendored） | 主流、轻量、GFM 支持好；自实现成本高 |
| HTML 消毒 | `dompurify`（vendored） | 安全必需；浏览器实现成熟 |
| GitHub 客户端 | **自实现 gh.js**（fetch） | 仅需 ~10 个端点，Octokit 偏重；自实现可控、体积小 |
| 框架 | 无，原生 JS | 站点规模小，避免构建链 |
| CSS | 原生 CSS + 自定义属性 | 无需预处理器 |

- **平衡原则**：渲染与安全这类"做错代价高"的用成熟库；HTTP 封装这类"接口简单"的自实现。
- 所有第三方库**本地托管**于 `assets/vendor/`，不依赖 CDN（离线可用、CSP 可收紧）。

## 7. 安全设计

| 威胁 | 对策 |
| --- | --- |
| XSS（Markdown/元数据） | 正文 DOMPurify；动态文本一律 `esc()`；CSP 收紧 |
| token 泄露 | 不落盘（无 localStorage/IndexedDB）；仅内存持有；GitHub 端 fine-grained 限单仓库 |
| token 被第三方脚本读取 | 零外部脚本（vendor 本地）；`Content-Security-Policy` meta 标签 |
| CSRF | 无 cookie 会话；写操作全部依赖 Authorization 头中的 token |
| 仓库被误提交 token | 代码不将 token 值写入任何内容字段；editor 区域与 token 输入物理隔离 |
| 分支破坏 | GitHub 端开启分支保护（文档指引） |

## 8. 移动端策略

- 响应式断点：`640px`（移动）、`960px`（桌面）。
- 移动优先 CSS；touch 目标 ≥ 44px；横向滚动仅限分类 chips 与代码块。
- 管理后台移动端：编辑/预览改为 Tab 切换；表单控件自适应。

## 9. 验收与测试方式

- 无自动测试框架；验收以浏览器人工测试为准：
  1. `python3 -m http.server 8080` → 公共站点可浏览（列表/详情/分类/搜索）。
  2. 管理后台连接真实 token → 新建文章 → 发布 → raw 立即可见、Pages 自动构建。
  3. 更新/删除/草稿/分类/设置各流程走查。
- 提交前后在 `git status` 确认无误。

## 10. 演进路线

**已实现**（见 README 状态）：图片上传（`assets/images/`，Base64 经 Git tree 提交）、代码高亮（highlight.js 本地托管 + 深浅主题）、深色模式、RSS（发布时随 commit 重建）、详情页灯箱/复制链接/元描述、标签点击搜索、草稿直链拦截。

**未做/可演进**：
- 多作者（服务端 Workers 集中 secret，见 system-design 形态 B）。
- 评论系统、全文检索索引、站点 sitemap。
- 图片压缩/缩略图（上传时前端 canvas 压缩）。
- **空仓库一键初始化（记录中，未实施）**：
  1. 连接表单增加"GitHub 仓库地址"输入（token + 仓库地址 ≈ 用户名/密码的体验），浏览器密码管理器也能更清楚地对应用户/仓库。
  2. 新增"初始化"模块：检测到连接的是**空仓库**时，通过 Git API 把本站"工作代码文件"（除 content 内容数据外的一切）一次性 commit 交付到新仓库，新用户无需手动 fork。
  3. 初始化后引导配置 GitHub Pages：需调研是否存在 CNAME 文件 / 配置文件 / API 方式自动开启 Pages 与自定义域名。
  4. 非空仓库不支持此功能（避免误覆盖已有内容）。
  5. **实现要点（gh.js）**：空仓库无分支，首次提交与常规提交不同——建 tree **不带 `base_tree`**、建 commit **不带 `parents`**、更新引用用 **`POST /git/refs`**（而非 `PATCH`）。`commitFiles` 需增加该分支；`GET refs/heads/{branch}` 404 即判定空仓库。

