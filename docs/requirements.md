# 需求与工作记录

本文件集中记录**工作需求**：已规划/待办、已知问题（Bug 跟踪）、已完成的功能决策。工作准则与纪律见 `AGENTS.md`。

> **需求来源**：功能缺口、待补能力的完整清单与优先级见 **`docs/requirements-analysis.md`**（需求分析文档，后续迭代需求唯一来源）。本文档只记录已被采纳、进入执行的具体条目。

## 已规划/待办

- **空仓库一键初始化**（远期，见 `docs/architecture.md` §10）：token + 仓库地址输入、初始化模块、Pages 开启引导。
- 持续迭代：需求来源为 **`docs/requirements-analysis.md`**（R01~R28，含优先级与可行性），按 §6 路线分批实施。

## 已知问题（待修 Bug）

1. ~~**详情页 TOC sticky 悬浮与正文重叠**~~（已修复 `04b8aba`）：正文阅读时展开目录（`<details class="toc">`）后往下滚动，目录 sticky 悬浮在页面上方、不随滚动消失，与正文排版重叠。桌面端 `≥980px` 的 `.detail-body .toc { position: sticky; … }` 效果不正确。**已移除该 sticky 规则**（`.toc` 恢复普通文档流）。
2. ~~**详情页顶部标签点击无效果**~~（已修复 `08acaee`）：正文阅读（`post.html?p=…`）时点击详情头部的标签/分类导航，页面无变化。**根因**：`catLink()` 的 `onClick` 无条件 `preventDefault()` + `render()`，而 `render()` 在 `MODE==='post'` 只会重渲染当前详情页。**已修复**：`catLink()` 与 `tagLink()` 在 `MODE==='post'` 分支改为 `window.location.href` 显式跳转；列表页仍原地渲染。测试：`test-post.js`。
3. **首页顶部分类导航激活态样式不刷新**：在首页（`index.html`）点击顶部「分类」标签后，筛选功能正常，但激活项高亮样式不跟随实际选中的分类刷新（停留在页面初次加载时 URL 对应的分类）。正文阅读页（`post.html`）无此问题（导航点击为整页跳转，每次加载重建导航）。**根因**：`catLink()` 的 `onClick` 只调用 `render()`，而 `render()` 从未重新渲染分类导航（`renderCats()` 只在 boot 与 popstate 时执行），`.cat-nav a.active` 停留在初次渲染值。**修复**：在 `render()` 开头调用 `renderCats()`，使任何 `state.cat` 变化都同步到导航激活态。测试：`test-site2.js` 断言点击「生活」分类后 `#catNav a.active` 为该分类。

## 已完成功能决策（历史，勿回退）

### MPA 重构（公开站点 SPA/hash 路由 → 传统多页面 + query 参数路由）
- 列表：`index.html`；分类/搜索/翻页/归档：`index.html?cat=…&q=…&page=2&view=archive`（全部查询参数，不用 hash）。
- 详情：`post.html?p=content/notes/slug.md`（读 `content/index.json`，索引内嵌 `content` 正文，旧索引回退 fetch raw）；无 `p` 参数/未知路径/草稿 → 404 提示；`404.html` 兜底。
- 页内锚点原生可用：`post.html?p=…&#heading`；TOC 用 `href="#id"` 原生跳转。
- `site.js` 按页面路径自动检测模式（`MODE = location.pathname…==='post.html'`）；列表页筛选变化用 `history.replaceState(null,'',buildListUrl())` 同步 URL、监听 `popstate` 重渲染；详情页内标签链接 `index.html?q=…`、列表页标签点击 `preventDefault` + 原地渲染。
- 全部内部链接（卡片、上一篇/下一篇、相关文章、标签、归档、TOC）与 RSS/sitemap 链接均为 `post.html?p=` / `index.html?…` 形式。
- 测试：`test-post.js`（详情/404/草稿/无参）、`test-site2.js`（列表/搜索/IME/归档/popstate）、`test-index-content.js`（索引内嵌/raw 回退）等。

### 评论系统（基于 GitHub Issues，路线 B）
- 实现方式：原生 GitHub Issues 评论，**零第三方服务、零外部脚本**。`post.html` 详情页底部渲染评论区：`GET api.github.com/repos/{owner}/{repo}/issues?labels=评论&state=all` → 按 `title === 文章路径` 匹配 Issue → 展示 Issue 正文 + 全部回复；未建 Issue 时显示「写第一条评论」链接（预填标题+标签跳转 GitHub 创建）。
- 门控：`config.comments = { enabled, label }`，**默认关闭**；后台站点设置可开关并配置标签。
- CSP：公共站点 `connect-src` 放行 `https://api.github.com`（仅为评论读取，仍无第三方脚本）。
- 测试：`test-comments.js`。

### 搜索框手动提交（替代自动搜索）
- 自动搜索（input 防抖 + IME 组合事件处理）在真实浏览器中表现不佳、且每次整页重渲染开销大。**改为普通 `<input type="search">` + 「搜索」按钮的手动提交**（`.search-form` 表单 `onsubmit`）。
- 输入框**不绑定任何 `input`/`keydown`/`composition*` 监听**，天然 IME 安全。
- 仅表单提交（点按钮或输入框内回车）时执行 `render()`，并重置 `page/view/cat`、同步 `q=` 到 URL。
- 标签/分类点击仍是独立链接（`index.html?q=`/`?cat=`），`preventDefault` + 原地渲染不变。
- 后台编辑器列表的过滤框仍保留防抖（内存过滤、开销小）。
- 测试：`test-site2.js` 搜索断言全部改为「输入不触发 + 提交才过滤 + IME 不干扰」。

### 相对路径支持
- **`site.url` 为空时全部使用相对路径**，不再按 `github.owner/repo` 推导 `https://<owner>.github.io/<repo>/`——适配 GitHub Pages 多仓库/子路径部署。
- `admin.js`：`siteBaseUrl()` 无 `site.url` 时返回 `''`；`absUrl(path)`（base 为空 → 直接 `path`）与 `homeUrl()`（base 为空 → `index.html`）；RSS、sitemap、robots.txt 均经这两个函数生成，无前导 `/`。
- 公开站点内部链接本就是相对路径，canonical/og:url 用 `location.href` 天然正确。
- 后台站点设置「站点地址」占位提示改为「留空则用相对路径」。

### 社交分享与 SEO 元数据
- og:image 自动取正文首图（相对路径解析为绝对 URL），无图/非详情页清空；og:site_name 动态取自配置。
- twitter:title/description/image/card 随内容更新（有图时 `summary_large_image`）。
- 详情页设置 `article:published_time`/`article:modified_time`；JSON-LD `BlogPosting` 含 `image` 与 `author`（`site.author`）。
- RSS 全文输出绝对化图片/链接（`site.url` 已配置时）；`index.html`/`post.html` 增加 RSS 自动发现 link。
- sitemap 增加归档/标签页 URL。

### 其他已完成的细节
- 列表卡片显示阅读时长（`index.json` 内嵌正文时按字数估算）；搜索命中正文时显示命中上下文片段并高亮。
- 归档视图支持分类过滤（`?view=archive&cat=…`），分类列表页有「该分类归档」链接。
- 分页链接保留 `q`/`cat` 过滤参数（`buildListUrl(pageOverride)`）；搜索态副标题有「清除 ✕」链接。
- `externalizeLinks` 移除硬编码的 `idealisan.github.io` 域名判断（消除多租户耦合）。
- 后台设置新增「作者」字段与「重新生成 RSS/站点地图/robots」按钮；文章列表新增「查看」按钮。
- 主题切换（亮/暗/跟随系统，`assets/js/theme.js`）已在全部页面启用。
- 键盘快捷键：列表页 `/` 聚焦搜索；详情页 `←`/`→` 上一篇/下一篇（输入态或有选区时不触发）。
- 404 页（详情/草稿/无参）内嵌搜索框，可直接搜索而非死胡同。
- 搜索匹配范围含分类标签（按分类中文名可搜到该分类文章）；`index.html`/`post.html` 增加 RSS 自动发现 link。

### 后台文章管理增强
- 文章列表新增「字数」列（索引内嵌正文时按 CJK+拉丁词统计）。
- 文章列表支持**复选框多选** + 批量操作条：批量发布 / 批量存草稿 / 批量删除（一次 commit 原子完成；索引未内嵌正文的旧文章自动先读取 raw 再重写 frontmatter）。
- 详情页新增「复制原文」按钮：一键复制含 frontmatter 的 Markdown 源文。
- RSS item 增加 `<author>` 标签（取 `site.author`，未配置则省略）。
- 无障碍：`focus-visible` 焦点环、`prefers-reduced-motion` 减少动效（含详情页 smooth scroll）。

### 后台连接页支持多种仓库地址格式
- 目标仓库输入框可直接粘贴 **浏览器地址栏 URL**、**HTTPS 克隆 URL**、**SSH 克隆 URL**（含 `ssh://git@…`）、裸 `owner/repo`、`/tree/branch` 指定分支、尾斜杠。
- 输入时 200ms 防抖**实时识别提示**（「已识别：owner / repo @branch」或「无法识别为 GitHub 仓库地址」）。
- 解析器 `parseRepoAddress`：依次处理 `scheme://host/` 前缀、`git@host:…` scp 风格前缀，去 `.git` 后缀与尾斜杠，识别 `/tree/<branch>`；`https://github.com` 等无仓库路径输入视为无效。
- 测试：`test-repourl.js`（三种格式 + ssh:// + 裸地址 + /tree/dev + 尾斜杠 + 无效输入）。

### 置顶文章（pinned）
- frontmatter / 索引新增可选 `pinned: true`；后台编辑器新增「置顶」复选框，保存时写入 frontmatter 与 `index.json`。
- 列表（含分页前）排序：置顶优先（置顶内部仍按日期倒序），搜索态仍按相关性排序；归档按日期不变，但带「置顶」标记。
- 列表卡片与后台文章表显示「置顶」徽标；批量发布/转草稿保留 pinned 字段。
- 测试：`test-pinned.js`（排序 + 徽标）、`test-admin.js`（index/frontmatter/徽标断言）。

### 空仓库（409/404）连接流程修复
- **Bug**：全新空仓库（无初始提交）`GET /git/refs/heads/<branch>` 返回 **409 Conflict**（Git Repository is empty），旧代码只把 404 当作空仓库，导致连接直接报错中断。
- **修复**：`gh.getBranchRef` 将 404 与 409 都视为「无分支」返回 `null` → `state.emptyRepo=true`，不再报错。
- **体验**：连接空仓库后**自动跳转「设置」页并直接展示「初始化仓库」面板**（此前落在文章列表、初始化入口藏在设置里）；文章列表页的空仓库横幅附带「去初始化 →」按钮；初始化成功后自动回到文章列表。
- 测试：`test-empty409.js`（409 连接自动进初始化视图 + 一键初始化全流程 + 成功后回到文章列表）、`test-init.js`（同步改为自动跳转断言）。

### 代码块行号（详情页）
- 详情页多行代码块按行包裹 `.cline`，CSS `counter` 生成行号，覆盖 highlight.js 高亮（保留 hljs span）。
- 单行代码不加行号；复制按钮仍取 `textContent`（每行末补 `\n`，最后一行不加，原有去尾换行逻辑兼容）。
- **Bug 修复**：初版遍历 `code.childNodes`（live NodeList）时因 `appendChild` 移动元素节点导致迭代跳过文本节点，行号与文本内容损坏；改为先 `slice` 快照再分组，且未满两行时不改动原 DOM。
- 测试：`test-welcome.js`（多行代码 clines≥3 + hljs 高亮并存）、`test-post.js`（单行代码无行号）。

### 首页标签点击改为真实导航（与内容页一致）
- **问题**：首页（index.html 列表态）点击标签（卡片标签 / 标签云）此前用 `e.preventDefault()` + 就地 `render()` 过滤，未真正刷新页面；内容页（post.html）点击标签是 `window.location.href` 真实跳转。
- **修复**：`tagLink` 与 `renderTags` 标签云统一改为 `e.preventDefault(); window.location.href = href`（跳转 `index.html?q=<tag>`），与内容页行为一致；列表/详情共用同一 `tagLink`，删除 MODE 分支。
- 测试：`test-site2.js` 卡片标签点击改为断言「触发 MPA 导航 + 不就地过滤」，并过滤 jsdom 的 `Not implemented: navigation` 提示。

### 顶部分类导航改为真实 URL 跳转
- **问题**：首页（index.html）顶部标题栏的分类导航（如 笔记/生活/工作）点击时用 `e.preventDefault()` + 就地 `render()` 切换，不触发任何网络请求；正文阅读页（post.html）点击同类链接是 `window.location.href` 真实跳转。
- **修复**：`catLink` 统一改为 `e.preventDefault(); window.location.href = href`（`index.html?cat=<分类>` / `index.html`），与内容页一致，点击即发起新的页面加载；删除 MODE 分支。
- 测试：`test-site2.js` 分类导航点击改为断言「触发 MPA 导航 + 不就地过滤」，分类筛选效果改由 `replaceState('index.html?cat=life') + popstate`（模拟导航到达）验证。

### 代码资源版本化目录（解决 CDN 缓存旧版本）
- **问题**：站点经 Cloudflare 代理访问（`prevoclxd.809030.xyz` → 本机 8080）时，`assets/js/*.js`、`assets/css/*.css` 被 Cloudflare 按默认策略缓存（`max-age=14400`，约 4 小时），代码改动后浏览器仍拿到旧 JS/CSS；`index.html` 是 `DYNAMIC` 不缓存。
- **方案（架构变更，取代 `?v=` 手动版本号）**：所有会被 CDN 缓存的**代码资源**（js / css；vendor 第三方库固定版本不变、不版本化；用户内容如图片、markdown 及每次发布都会重写的用户数据 `config.json`/`content/index.json` 一律**不**进版本目录）统一复制到 **`assets/v<改代码的unix时间戳>/`** 目录；`index.html`/`post.html`/`404.html`/`admin/index.html` 统一引用该目录下的资源。
- **版本目录名** = 各代码资源源文件 mtime 的最大值（unix 秒），同一批改动共用一个版本目录；换版本时删除旧版本目录，仓库只保留当前版本（旧 CDN 缓存按 TTL 自然过期）。浏览器/CDN 请求新 URL → 必然 MISS → 立即拿到新代码，无需手工递增版本号。
- **工具**：`tools/version-bump.js`。改完代码后运行 `node tools/version-bump.js`（幂等：时间戳与内容指纹都一致才跳过；同时比对版本目录内文件内容防"同秒改动"失效），再 `git add -A && git commit && git push` —— 保证 HTML 与版本目录在**同一个提交**里上线。`--dry-run` 只预览不写入。
- 验证：`curl -I https://prevoclxd.809030.xyz/assets/v<ts>/site.js` 返回新内容；旧 URL 不再被引用。

### 图片上传二进制通道修复
- **Bug**：后台 `uploadImage` 用 FileReader 把图片转成 base64 字符串后，经 `gh.commitFiles` 直接写入 tree 的 `content` 字段，而该字段按 **UTF-8 文本**写入 → 仓库里的 `.png` 文件实际存的是 base64 文本，浏览器拿到 `content-type: image/png` 却无法解码显示。
- **修复**：`gh.commitFiles` 支持 `{ binary: true }`（与 `commitInitial` 一致），二进制文件改走 `POST /git/blobs`（`content` + `encoding: "base64"`）拿到 blob sha，tree 条目引用该 sha；`uploadImage` 传 `binary: true`。已损坏的图片（当时位于 `assets/images/`，现已随结构迁移到 `content/images/`）解码还原为真实 PNG。
- 测试：`test-binary.js`（mock fetch，断言调用序列 refs→commit→blobs→trees(引用 blob sha)→commits→PATCH refs）。

### 空仓库初始化失败修复（Git Repository is empty 409）
- **Bug**：全新空仓库（无任何提交）点「一键初始化」报 `初始化失败：Git Repository is empty.（HTTP 409）`。GitHub 的 Git Data API（blobs/trees/commits/refs）在零提交仓库上直接返回 409，无法创建首个提交；官方文档要求先用 Contents API（`PUT /contents/{path}`）引导出一个首个提交。
- **修复**：`gh.commitInitial` 改为先探测分支 ref —— 若不存在（404/409），先用 Contents API 写 `README.md` 创建首个提交拿到基线 sha；然后走 blobs/trees（空仓库不带 `base_tree`，全量替换）→ commits（`parents=[基线]`）→ `PATCH refs`（改为更新而非创建 ref，兼容已存在分支）。仓库已有内容时保留 `base_tree` 增量写入。
- 测试：`test-init-commit.js`（空仓库：409→README 引导→无 base_tree→parents=[引导提交]；非空：带 base_tree→parents=[HEAD]）。

### 仓库匹配校验（当前仓库 ≠ 预览目标仓库时拦截）
- **问题**：站点不一定部署在 GitHub Pages（也可能经 Cloudflare/自定义域名指向后台所在站点），后台无法只靠 URL 判断「当前管理仓库」；若用户在 A 仓库部署的后台里连接了 B 仓库发布内容，「查看」链接会生成指向 B 的 URL，而 B 并没有站点，预览必然失败。
- **方案**：**当前管理仓库以数据记录** —— `content/config.json` 的 `github{owner,repo,branch}`，连接时从 `gh.snapshot()` 强制同步为该仓库（连接即覆盖），一键初始化新仓库时同样正确写入。
- **匹配判定** `repoMismatch`：后台启动时把本地 `../content/config.json` 读到的宿主仓库记为 `state.sourceRepo`（后台部署位置）；若 `site.url` 为空 → 用 `sourceRepo` 与当前仓库比对；若 `site.url` 是 `https://<owner>.github.io/<repo>` → 解析比对；自定义域名无法自动判定 → 信任用户在设置中填写的 `site.url`。
- **拦截**：不匹配时页面顶部显示警示横幅（可关闭，改连接/改 `site.url` 后自动恢复），并阻止「查看」与发布/保存操作（`assertRepoTargets`）。
- **便捷**：设置页新增「填入 GitHub Pages 地址」按钮，按当前仓库一键填 `https://<owner>.github.io/<repo>/`。
- 测试：`test-repo-mismatch.js`（同仓库可查看、异仓库横幅+拦截、填地址保存后恢复）。

### 用户内容与代码/项目资源分离（目录结构调整）
- **问题**：用户内容（markdown、上传图片、站点配置、派生的 RSS/sitemap/robots）与代码/项目资源混放在仓库根与 `assets/` 下：`assets/images/`（图片在代码资源目录里）、根目录 `config.json`/`rss.xml`/`sitemap.xml`/`robots.txt` 与页面 HTML 平级。
- **方案**：全部**用户内容**统一收进顶层 `content/` 目录，与代码完全分离：
  - `config.json` → `content/config.json`（站点启动/后台 boot 改读该路径）
  - `assets/images/` → `content/images/`（上传与历史内容引用同步迁移）
  - `rss.xml`/`sitemap.xml`/`robots.txt` → `content/`（后台随发布重建时写入 `content/`；HTML 的 RSS 链接改为 `content/rss.xml`）
  - `content/index.json` 与 `content/<分类>/<slug>.md` 位置不变（`posts[].path` 语义不变）
- `assets/` 现在只放代码（`js/`、`css/`、`vendor/`、版本目录 `v<ts>/`）；页面 HTML、`admin/`、`tools/`、`docs/` 为项目资源。
- **影响**：RSS/站点地图/robots 从根路径移到 `content/`；爬虫默认抓取根 `/robots.txt` 会 404（视为不限制，可接受）；`initRepo` 复制源仓库时 `content/` 整体跳过（本来就是用户内容）。
- 验证：jsdom 集成测试全绿；代理线上 `content/config.json`、`content/images/`、版本化资源均 200，旧根路径 404。

### 管理后台布局改版（侧栏上移 / 预览下移 / 工具菜单化）
- **问题**：后台正文编辑区右侧固定 1:1 分栏，编辑框与预览都太窄（页面显得窄小）；左侧 170px 固定菜单占据一行空间；顶部工具条按钮一字排开混乱、Emoji 面板悬浮。
- **方案**：
  - **导航上移**：`.admin-side` 左侧栏删除，`.side-nav` 移入顶部 `.admin-topbar`（品牌 / 导航居中 / 操作按钮右置），顶栏保持 sticky。
  - **容器加宽**：后台页面 `body.admin-page` 覆盖 `--maxw` 为 1280px（仅后台生效），编辑区与预览都更宽。
  - **预览下移**：编辑区在上、预览在下（`.preview-pane` 带"预览"标签，往下滚动即可看到，不做分割视图）；正文 textarea **高度随输入自动增高**（`autoGrowTextarea`：input 时 `style.height=scrollHeight`，初始 min-height 320px），宽度为容器全宽。
  - **工具栏 Typora 化**：`.editor-toolbar` 改 `.editor-menubar`，三个层叠展开菜单「格式 / 段落 / 插入」：格式=加粗/斜体/删除线/行内代码/链接/图片；段落=引用/无序/有序/任务列表/分隔线/表格/代码块；插入=上传图片 + Emoji 网格（28 个）。点击外部自动收起（document 级监听，boot 时挂一次）。
- 测试：`test-admin-layout.js`（旧类不再出现、导航位于顶栏、预览在编辑框下、正文自动增高、三个菜单展开/插入/收起、emoji 网格、顶栏导航切换）。
- 验证：代理线上 admin/ 与新版本资源 200、旧版本目录 404；jsdom 全绿已推送（`f0fb6d3`）。

### 三处小修复（预览图片 / 草稿查看 / 完整性检查补字数）
- **预览图片不显示**：预览渲染在 `/admin/` 下，正文里相对路径图片 `content/images/xx.png` 解析成了 `/admin/content/...` 而 404。修复：`updatePreview` 渲染后把非绝对路径（非 http/data/blob/开头斜杠）的 `img src` 前缀 `../`，绝对地址不动（幂等，重复渲染不会二次加前缀）。
- **草稿行显示「查看」按钮**：草稿在公开站点被过滤，查看必然 404。修复：列表行 `p.draft` 时不渲染「查看」按钮（仍保留编辑/删除）。
- **完整性检查不补字数**：列表字数列依赖索引内嵌的 `content`，草稿/旧索引没有时显示空白。修复：`checkIntegrity` 本就逐个拉取文件，现顺带 `parseFrontmatter` 后写回 `p.content`，检查后列表即时补全字数。
- 测试：`test-admin-layout.js`（预览 `../` 前缀、草稿无查看、检查前后字数对比），33 项全绿。


