# Real Life Notes — 技术手册

> 本文档描述**当前已实现**的技术方案：系统如何组成、各模块如何工作、数据如何流动。面向接手开发者与想要深入了解实现的读者；使用层面的说明见《用户手册（docs/user-manual.md）》。

---

## 1. 系统形态

- **纯静态、零后端**。全站是 HTML/CSS/JS，无构建步骤，可直接部署到 GitHub Pages / Cloudflare Pages / 任意静态托管。
- **GitHub 仓库即数据库**：内容以 Markdown 文件存于仓库，Git 天然是版本历史；浏览器通过 GitHub REST API（开放 CORS）读写。
- **身份 = 管理员自持的 fine-grained PAT**：无登录页、无 OAuth、无服务端密钥；token 存在浏览器密码管理器，页面不落盘。
- **发布闭环**：管理员在浏览器提交 commit → GitHub Pages 自动构建；公开站点运行时不依赖 Pages，直接读仓库文件（同源 / raw），内容即时可见。

## 2. 技术栈

| 领域 | 选型 | 说明 |
| --- | --- | --- |
| 语言 | 原生 ES5 兼容 JS（IIFE + 全局暴露 `gh`/`md`/`Site`/`Admin`） | 无构建、无模块加载器 |
| Markdown | `marked` 4.3.0（本地托管 `assets/vendor/`） | GFM + 自动断行 |
| 消毒 | `dompurify` 3.0.6（本地托管） | XSS 防御 |
| 公式 | `katex` 0.16.11 + 字体（本地托管） | 行内/块级 |
| 高亮 | `highlight.js` 11.9.0 + 深浅主题（本地托管） | `pre code.language-*` |
| GitHub | 自实现 `gh.js`（fetch） | 约 10 个 REST 端点，无依赖 |
| 样式 | 原生 CSS + CSS 自定义属性（设计令牌） | `base.css` 两站共用 |

> 全部第三方库本地托管（不依赖 CDN），离线可用、CSP 可收紧到 `script-src 'self'`。

## 3. 目录结构

```
index.html            公共站点列表页（?cat/?q/?page/?view=archive）
post.html             公共站点详情页（post.html?p=<文章路径>）
404.html              未找到兜底页（内嵌搜索）
admin/index.html      管理后台入口（单页应用）
assets/
  css/  base.css      设计令牌 + 基础元素（两站共用）
        site.css      公共站点样式
        admin.css     管理后台样式
  js/   gh.js         GitHub REST API 客户端
        md.js         Markdown 渲染 + 消毒 + frontmatter 封装
        site.js       公共站点控制器
        theme.js      主题切换（亮/暗/跟随系统）
  vendor/             本地托管第三方库（marked/purify/katex+字体/hljs+主题）
content/config.json   站点配置（标题、分类、GitHub 坐标、评论开关）
content/index.json    帖子索引（公开站点唯一入口；含正文 content 与 draft）
content/<分类>/<slug>.md  帖子正文（frontmatter + Markdown）
content/images/       编辑器上传的图片
content/rss.xml / sitemap.xml / robots.txt   由后台随发布重建
docs/                 设计文档
```

## 4. 模块详解

### 4.1 gh.js — GitHub API 客户端（数据访问层）

统一封装：
- 基础 URL `https://api.github.com`；公共请求头 `Accept: application/vnd.github+json`、`X-GitHub-Api-Version: 2022-11-28`；有 token 时加 `Authorization: Bearer <token>`。
- `_request(method, path, body)`：2xx 返回 JSON（204 返回 null）；4xx/5xx 抛 `Error`（带 `status`、`message`、`documentation_url`）；网络失败归一为 `status=0`。

领域方法：
| 方法 | 用途 |
| --- | --- |
| `getUser()` | 校验 token、取当前登录用户 |
| `getRepo()` | 仓库信息（存在性、权限） |
| `getContent(path)` | 读文件（Base64 → UTF-8 解码） |
| `listTree()` | 递归目录树（媒体库/图片统计用） |
| `getBranchRef()` | 分支引用；**404/409 均返回 null**（空仓库判定） |
| `listTreePublic(owner,repo,branch)` | 免 token 读源仓库树（一键初始化用） |
| `commitFiles({message, files, deletes})` | **常规五步提交** + 409 乐观锁重试 |
| `commitInitial({message, files})` | **空仓库首次提交**（建分支） |

**常规提交流程（`commitFiles`，5 步）**：
1. `GET /git/refs/heads/{branch}` → HEAD sha
2. `GET /git/commits/{HEAD}` → 当前 tree sha
3. `POST /git/trees` `{base_tree, tree}` → 新 tree sha
   - **必须带 `base_tree`**（否则未列出的文件全被删除）
   - 新增/更新：`{path, mode:"100644", type:"blob", content}`
   - 删除：`{path, mode:"100644", type:"blob", sha:null}`
4. `POST /git/commits` `{message, tree, parents:[HEAD]}` → commit sha
5. `PATCH /git/refs/heads/{branch}` `{sha, force:false}`
- 第 5 步 `409`（ref 冲突）→ 回到第 1 步重试（默认最多 3 次）。
- 删除不存在的文件会 422 → 调用方（admin）先按索引判定，避免空删除。

**空仓库首次提交（`commitInitial`）**：建 tree **不带 `base_tree`**、建 commit **不带 `parents`**、建分支用 **`POST /git/refs`**；二进制文件先 `POST /git/blobs`（Base64）。

### 4.2 md.js — Markdown 渲染管线

**frontmatter**（最小 YAML 子集）：
- `parseFrontmatter(text) -> {meta, body}`：首尾 `---` 包裹，逐行 `key: value`；支持 `title/tags/date/updated/draft/pinned`；`tags` 解析 `[...]` 逗号分隔。
- `buildFrontmatter(meta) -> string`：反向生成（`draft`/`pinned`/`updated` 仅在为真/存在时输出）。

**渲染管线（`md.render`）**，顺序敏感：
1. `renderMath`：先保护代码块（``` / ~~~ / `` `x` `` → `@@CODE-n@@`）→ 提取 `$$...$$`（块级）与 `$...$`（行内，带货币启发式：`^\d` 或两侧空格跳过）→ KaTeX `renderToString` → 回填占位 `@@MATH-n@@`。
2. `marked.parse`（GFM + breaks）。
3. `DOMPurify.sanitize`（`FORBID_ATTR:['style']`，html profile）。
4. 对 `pre code.language-*` 调 `hljs.highlightElement`（语言不存在则跳过）。
5. 回填 `@@MATH-n@@` 为 KaTeX HTML。

**其他工具**：`excerpt(text, max)`（去 frontmatter 与 Markdown 标记 → 纯文本摘要）、`esc()`（HTML 转义，动态文本一律走它）、`slugify()`、`isoNow()`、`formatDate()/fullDate()`。

**安全约定**：正文走 DOMPurify 消毒后才入 `innerHTML`；元数据/列表文本一律 `esc()`。

### 4.3 site.js — 公共站点控制器

**模式检测**：`MODE = location.pathname 末尾是否为 post.html ? 'post' : 'list'`。

**路由（MPA + query，无 hash）**：
- 列表：`parseParams()` 读 `?cat&q&page&view`；筛选变化用 `history.replaceState(null,'',buildListUrl())` 同步 URL；监听 `popstate` 重渲染（前进/后退）。
- 详情：`post.html?p=content/<cat>/<slug>.md`；优先用索引内嵌 `content` 渲染（免请求），旧索引回退 `fetch` raw；无 `p`/未知/草稿 → 404 视图。
- 页面内锚点原生可用：`post.html?p=…&#heading`；TOC 链接 `href="#id"`。

**列表渲染（`renderList`）**：
- `filteredPosts()`：过滤 draft → 按 `state.cat` → 关键词（标题/分类名/摘要/标签/正文，`searchScore` 加权排序，搜索态按相关性）。
- 分页 `PAGE_SIZE=8`，`pager()` 保留 `q/cat` 参数。
- 排序：置顶优先（`pinned`），置顶内部按日期倒序；搜索态按相关性。
- 卡片：分类徽标、日期、更新标记、阅读时长（正文 CJK+拉丁词估算）、摘要、标签、置顶徽标；标题命中高亮 `<mark>`。

**详情渲染（`renderDetail`/`renderDetailBody`）**：
- `md.render` 渲染正文 → 附加交互：
  - `externalizeLinks`：站内相对链接保持、外链加 `target=_blank rel=noopener`。
  - `attachLightbox`：正文图片点击放大（`loading=lazy`/`decoding=async`），Esc 关闭。
  - `attachCodeCopy`：每个 `pre` 右上角「复制」按钮（取 `textContent`）。
  - `addCodeLines`：多行代码块按行包裹 `.cline`（CSS counter 行号），**保留 hljs 高亮 span**；先 `slice` 快照 childNodes 再分组，避免 live NodeList 迭代跳坑；单行不加行号；每行末补 `\n`（末行除外）保证复制内容完整。
  - `renderFontCtl`：返回 `{ btn, row }`；「Aa」按钮内嵌进 `.detail-meta`（flex-wrap，宽度不足自动换行），点击显示 `.read-slider-row`（含 `input[type=range]` 滑动条 + 左端「↺」重置按钮 + 倍数标签，默认 `hidden`），该行位于 `.detail-head` 之后、正文之前，随文档流排布不覆盖正文；`.detail-body` 设 `fontSize`。
  - `buildToc` + `setupTocSpy`：正文目录 + 滚动高亮。
  - `relatedPosts`：按共享标签数推荐；`renderDetailNav`：上一篇/下一篇（同分类按日期）。
- SEO：`setStructuredData`（JSON-LD `BlogPosting`）、og/twitter 元数据、`article:published_time/modified_time`、摘要 → `meta description`。
- 阅读进度条 `updateReadingProgress`。

**评论（GitHub Issues，默认关）**：
- 门控 `config.comments.enabled`；`GET /issues?state=all&labels=<label>&per_page=100` → 按 `title === 文章路径` 匹配 → 展示 issue 正文 + 全部回复（`/issues/{n}/comments`）。
- 未建 Issue → 「写第一条评论」链接（预填 title+label 跳 GitHub 创建）；已有 → 「在 GitHub 参与评论」。
- 评论正文经 `md.render` 渲染；头像 `loading=lazy`。

**导航**：顶部分类导航（`catLink`，`index.html?cat=`，点击 `window.location.href` 真实跳转）、标签链接（`index.html?q=`，真实跳转）。

**其他**：`/` 聚焦搜索、`←/→` 上一篇/下一篇快捷键（输入态/选区不触发）、深色模式（`theme.js`）、`?view=archive` 归档（按月的分组 + 统计块）、`?view=tags` 标签云（热度排序 + 计数）。

### 4.4 admin.js — 管理后台控制器

**连接区**：
- `parseRepoAddress(addr)`：识别浏览器 URL / HTTPS / SSH（`git@host:…` / `ssh://…`）/ 裸 `owner/repo` / `/tree/<branch>` / 尾斜杠 / `.git` 后缀；输入防抖 200ms 实时识别提示。
- `connect(token, repoAddr)`：`getUser → getRepo → getBranchRef`；404/409 → `emptyRepo=true`，自动跳「初始化」面板；成功 → 拉取 config + index。

**工作区**：
- 文章列表：`renderPosts`（筛选/状态徽标/字数列/置顶徽标/批量勾选条）。
- 编辑器 `renderEditor`：标题、分类、标签、日期、草稿/置顶开关、正文（textarea）+ 双栏实时预览；`markDirty` 未保存提醒（beforeunload）；工具栏（`lineAction`/`wrapSelection`/`attachEditorKeys` 加粗斜体等）；公式/代码高亮预览复用 `md.render`。
- 图片上传 `uploadImage`：粘贴/拖拽/选择文件 → 前端校验类型与大小 → 转 Base64 → 随保存 commit 写入 `content/images/<YYYYMMDD>-<rand>.<ext>`。
- 发布 `savePost`：计算 slug（`YYYY-MM-DD-<kebab-case>`，冲突加 `-2`）→ 组装 md + frontmatter → 计算新 index.json → 同 commit 原子更新（md + index + content/rss.xml）；删除 `deletePost` 同理（tree `sha:null`）。
- 批量 `bulkAction`：勾选多篇 → 批量发布/存草稿/删除（一次 commit）；`bulkMoveCategory`：批量移动分类。
- 分类管理 `renderCategories`：增删改（写入 content/config.json，校验重名/非法 key）。
- 站点设置 `renderSettings`：标题/副标题/作者/站点地址/评论开关与标签、「重新生成 RSS/sitemap/robots」（`regeneratePublishFiles`，`buildRss/buildSitemap/buildRobots` 纯生成）。
- 空仓库初始化 `initRepo`：读源仓库（本项目模板）公开树 → 逐文件 fetch（二进制转 Base64）→ `commitInitial` 一次性交付。

### 4.5 theme.js — 主题切换

- `prefers-color-scheme` 跟随系统；手动切换存 localStorage（`theme` key）；全站页面生效。

## 5. 关键数据流

**发布一篇文章（admin）**：
```
编辑表单 → savePost：
  计算 slug / frontmatter → 更新本地 index.posts（含 draft、pinned、content）
  → gh.commitFiles({
      message: "[post] 新建|更新|删除 <title>",
      files: [ {path: content/<cat>/<slug>.md, content},
               {path: content/index.json, content: newIndex},
               {path: content/rss.xml, content: buildRss()} ]  // 站点设置/删除也重建
    })
  → 成功：展示 commit 链接；提示 Pages 将自动构建、raw 已即时可见
```

**访客阅读一篇文章（site）**：
```
post.html?p=… → parseParams 取 p → fetch content/index.json
  → 命中索引：直接用内嵌 content 渲染详情（无额外请求）
  → 旧索引无 content：fetch <raw>/<path> 回退渲染
  → 草稿/未知/无 p → 404 视图
```

**评论（site，读）**：`GET /issues?labels=<评论label>` → 匹配文章路径的 Issue → `GET /issues/{n}/comments` → 渲染。

**空仓库初始化（admin）**：`listTreePublic(源仓库)` → `fetchSourceFile`（含 Base64 二进制）→ `commitInitial`（建 tree 无 base_tree / commit 无 parents / POST refs 建分支）。

## 6. 安全设计

| 威胁 | 对策 |
| --- | --- |
| XSS | 正文 DOMPurify（禁 `style`）；动态文本 `esc()`；CSP 收紧 |
| token 泄露 | 不落盘（无 localStorage/IndexedDB）；仅内存持有；GitHub 端 fine-grained 限单仓库 |
| token 被第三方读取 | 零外部脚本（vendor 本地）；CSP `script-src 'self'` |
| CSRF | 无 cookie 会话，写操作依赖 Authorization 头 token |
| 仓库误提交 token | 代码不把 token 写入任何内容字段 |
| 分支破坏 | 文档指引 GitHub 分支保护（PR 流程） |
| 缓存穿透 | 开发资源带 `?v=` 版本号（规避 Cloudflare 默认缓存，见 §8.3） |

## 7. 部署与运行

### 7.1 静态托管（GitHub Pages）
1. 推送到 GitHub 仓库；Settings → Pages → **Deploy from a branch** → `main` / root。
2. 之后每次 push 自动构建；地址 `https://<用户名>.github.io/<仓库名>/`。
3. `site.url` 配置绝对地址；**留空则全站相对路径**（适配多仓库/子路径）。

### 7.2 本地预览
```bash
python3 -m http.server 8080 --directory .   # 仓库根目录
# 访问 http://127.0.0.1:8080/
```

### 7.3 缓存版本号约定
- 站点经 Cloudflare 等 CDN 代理时，`assets/js|css` 可能被默认缓存（本项目实测 `max-age=14400` ≈ 4h）。
- 因此 `index.html/post.html/admin/index.html/404.html` 中对**随开发变更的资源**统一带 `?v=<版本>`；**改动这些资源时必须同步递增版本号**，否则线上仍是旧文件。vendor 固定版本不加。

## 8. 测试与验收

- **语法检查**：`node --check <file>`。
- **集成测试（jsdom）**：`/tmp/opencode/jstest/`，覆盖：
  - 站点渲染/路由/主题（test-site）、过滤/搜索/IME/归档/popstate（test-site2）、种子帖渲染+灯箱（test-welcome）、草稿拦截（test-draft）、空仓库连接（test-empty/test-empty409）、后台连接/发布（test-admin）、草稿/编辑/删除/409（test-admin2）、图片上传（test-img）、分页（test-pager）、评论（test-comments）、空仓库初始化（test-init）、索引内嵌/raw 回退（test-index-content）、详情/404/单行代码（test-post）、仓库地址解析（test-repourl）、置顶排序（test-pinned）、批量操作（test-bulk）。
- **端到端**：真实 token 发布 → raw 即时可见 → Pages 自动构建。

## 9. 已知限制（当前实现边界）

- 搜索为运行时内存过滤（依赖索引内嵌 `content`），大索引体量有上限；独立 `search-index.json` 检索属待办（见 `requirements-analysis.md` R01）。
- 评论依赖 GitHub Issues 页操作，无站内直接提交表单；@提及为 GitHub 原生行为，前台未额外解析渲染。
- 无阅读量/访客统计（纯前端无法精确统计）。
- 多管理员需服务端集中密钥（备选 Workers 形态，见 `system-design.md`）。
- 空仓库初始化从「模板源仓库」复制，非"fork 自己"；初始化后仍需手动在 GitHub 开启 Pages（文档指引）。
