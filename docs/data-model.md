# Real Life Notes — 数据结构设计

> 规定仓库中所有持久化数据的精确格式。实现必须严格遵守本文件；任何格式变更需先修订本文档。

---

## 1. 仓库数据总览

```
content/config.json   — 站点配置（站点元信息 + 分类元数据 + GitHub 源坐标）
content/index.json   — 帖子索引（公开站点列表的唯一入口）
content/<category>/<slug>.md  — 帖子正文（frontmatter + Markdown）
content/private/<slug>.md  — 私密文章（frontmatter 只有 private: true，正文为密文块）
content/private-key.json   — 私密文章内容密钥的 KDF 参数与校验值（无密钥本身）
content/images/      — 编辑器上传的图片（<YYYYMMDD>-<rand>.<ext>）
content/rss.xml / content/sitemap.xml / content/robots.txt  — 派生的 RSS/站点地图/robots（每次内容变更时随 commit 重建）
```

**结构约定**：所有**用户内容**（markdown、图片、配置、派生的 RSS/sitemap/robots）统一放在顶层 `content/` 目录下，与代码/项目资源（`assets/`、`admin/`、`tools/`、`docs/`、页面 HTML）完全分离。`assets/` 下只有代码（`js/`、`css/`、`vendor/`、版本目录 `v<ts>/`）。三种文件全部是普通文本，可直接用 Git 版本控制；所有读写都通过 GitHub API 完成。

---

## 2. config.json

`content/config.json`（位于 `content/` 目录内）。

```jsonc
{
  "schema": 1,
  "site": {
    "title": "Real Life Notes",
    "subtitle": "记录生活中的各种事情",
    "author": "作者名（用于 JSON-LD 结构化数据）",
    "footer": "Powered by Real Life Notes",
    "url": "https://idealisan.github.io/real-life-notes/"
  },
  "github": {
    "owner": "idealisan",
    "repo": "real-life-notes",
    "branch": "main"
  },
  "categories": {
    "notes": { "label": "笔记", "icon": "📝", "description": "技术、学习笔记" },
    "life":  { "label": "生活", "icon": "🌱", "description": "日常点滴" },
    "work":  { "label": "工作", "icon": "💼", "description": "工作相关" }
  }
}
```

### 字段约束

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `schema` | int | 固定 `1`，用于未来迁移判断 |
| `site.title` | string | 非空，≤ 60 字符 |
| `site.subtitle` | string | ≤ 200 字符，可空；列表页 meta description 兜底 |
| `site.author` | string? | 作者名，写入 JSON-LD `BlogPosting.author`；可空（空时回退站点标题） |
| `site.footer` | string | 可空 |
| `site.url` | string? | 站点绝对地址（生成 RSS/sitemap 链接用）；**为空时使用相对路径**（`post.html?p=…`、`content/rss.xml`），适配 GitHub Pages 多仓库/子路径部署 |
| `github.owner` / `github.repo` | string | 非空；公开站点据此构造 raw 源 |
| `github.branch` | string | 默认 `main` |
| `categories` | object | key = 分类 id（即 content/ 下目录名），value 见下 |

分类条目（value）：
- `label`（必填）：显示名
- `icon`（可选）：emoji 或短文本，≤ 8 字符
- `description`（可选）：≤ 100 字符

> **分类 id 命名规则**：小写字母、数字、`-`、`_`；长度 2~32。作为目录名使用，因此禁止 `/`、空格等非法字符。

---

## 3. content/index.json

`content/index.json` 是公开站点文章列表的唯一数据入口。管理员每次发布/更新/删除帖子都必须**在同一次 commit** 中同步写入它。

```jsonc
{
  "schema": 1,
  "posts": [
    {
      "path": "content/notes/2026-07-31-hello.md",
      "slug": "2026-07-31-hello",
      "title": "你好，世界",
      "category": "notes",
      "tags": ["入门"],
      "date": "2026-07-31T06:00:00+08:00",
      "updated": "2026-07-31T07:00:00+08:00",
      "excerpt": "这是我的第一篇记录……",
      "draft": false
    }
  ]
}
```

### 字段约束

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `schema` | int | 固定 `1` |
| `posts` | array | 按 `date` 降序（新在前）；空数组合法 |
| `posts[].path` | string | 相对仓库根的 Markdown 文件路径，`content/<cat>/<slug>.md`，全库唯一 |
| `posts[].slug` | string | 文件名（不含 `.md`），全库唯一 |
| `posts[].title` | string | 非空，≤ 100 字符 |
| `posts[].category` | string | 必须是 `config.categories` 的 key |
| `posts[].tags` | string[] | 可为空数组；每个 tag ≤ 24 字符 |
| `posts[].date` | string | ISO 8601，带时区 |
| `posts[].updated` | string? | 可选，ISO 8601；更新帖子时写入 |
| `posts[].excerpt` | string | 纯文本摘要，≤ 200 字符（服务端无关，由 admin 生成） |
| `posts[].content` | string? | **可选**，帖子正文（不含 frontmatter）。由 admin 写入，用于：公开站点免请求直接渲染详情、RSS 全文输出；旧条目无此字段时两端自动回退（site 改为拉取 raw 文件，RSS 回退 excerpt） |
| `posts[].draft` | boolean | **必填**。`true`=草稿（公开站点隐藏）；`false`=已发布 |
| `posts[].private` | boolean? | 可选，缺省为公开。`true`=私密文章：**条目只允许包含 `path` 与 `private` 两个字段**，不得出现 `title/slug/category/tags/date/updated/excerpt/content`（index.json 是公开文件，任何明文元数据都会泄露） |

> **排序约定**：index.json 中的顺序 = 展示顺序（按 date 降序）。公开站点不再自行排序，只渲染；同时**过滤 `draft: true`**。

> **草稿约定**：草稿帖子**同样写入 index.json**，标记 `draft: true`。index.json 因此是内容唯一真相源——admin 直接从中列出草稿，无需遍历仓库文件。发布（去草稿）只需在同一次提交中把该条 `draft` 置为 `false`。

> **私密约定**：私密文章的条目形如 `{"path":"content/private/<slug>.md","private":true}`，**没有任何元数据**，公开站点据此过滤掉该条，只在直链访问时提供解锁入口。`draft` 与 `private` 正交，`draft: true` 优先（直链同样 404）。私密条目不计入 RSS/sitemap，不参与分类、标签、搜索、归档、随机、上下篇、相关文章与反链。

---

## 4. 帖子文件 `content/<category>/<slug>.md`

```markdown
---
title: 你好，世界
tags: [入门, 生活]
date: 2026-07-31T06:00:00+08:00
---

# 你好

正文从这里开始……
```

### frontmatter 规范（最小 YAML 子集）

- 由首尾两行 `---` 包裹；frontmatter 必须是文件最开头。
- 字段：
  - `title`（必填）：≤ 100 字符
  - `tags`（可选）：`[a, b, c]` 或省略
  - `date`（必填）：ISO 8601 带时区
  - `updated`（可选）：ISO 8601
  - `draft`（可选）：`true/false`，与 index.json 中的 `draft` 保持一致；去草稿时同步更新
- 解析规则（与实现约定，避免依赖完整 YAML 库）：
  - 逐行读取，遇到以 `---` 开头的第一行开始，到下一个 `---` 行为止。
  - 每行 `key: value`；value 为 `[...]` 时解析为数组（逗号分隔、去空白）。
  - 值不做引号转义（约定：title/tag 不含 `:` 换行等特殊字符；admin 编辑器自动过滤）。

### 生成规则（admin 发布时）

```
---\n
title: <escaped title>\n
tags: [a, b]\n        # 无 tag 时省略该行
date: <ISO8601>\n
updated: <ISO8601>\n  # 仅更新时
---
\n
<body>
```

### 摘要提取（excerpt）

1. 去掉 frontmatter。
2. 去掉 Markdown 语法：标题符 `#`、`*`/`_`、`` ` ``、`> `、列表 `- `、链接 `[t](u)` 提取文字、图片 `![a](b)` 提取 alt、行内代码 `` `x` `` 取内容。
3. 折叠空白，截断 ≤ 160 字符；非末尾截断时追加 `…`。

### 私密文章文件 `content/private/<slug>.md`

私密文章**不写任何明文元数据**：frontmatter 只有一行 `private: true`，正文位置是一个 `rln-enc` 围栏块，里面是整篇内容（含标题、标签、日期、封面与正文）的密文。

```markdown
---
private: true
---

```rln-enc
{"v":1,"algo":"AES-256-GCM","iv":"<b64 12B>","ct":"<b64>"}
```
```

- 明文 = `JSON.stringify({title, tags, date, updated, cover, body})`，`body` 为 Markdown 正文（不含 frontmatter）。
- `ct` 用「内容密钥」+ 每次保存新生成的随机 IV 加密（AES-256-GCM）。
- 围栏必须**锚定整个 body**：fence 之外不允许出现任何明文；解析不到围栏即视为文件损坏，拒绝渲染。
- `md.excerpt` 对这类文件返回空串，永不为密文生成摘要。

### 私密文章的内容密钥 `content/private-key.json`

```jsonc
{
  "v": 1,
  "kdf": "PBKDF2-SHA256",
  "iter": 120000,
  "salt": "<b64 16B>",
  "verifierIv": "<b64 12B>",
  "verifier": "<b64>"
}
```

- 密钥 = `PBKDF2-SHA256(密码, salt, iter, 32B)`，密码即**后台解锁密码**（与 `content/.admin-token` 所用密码相同），不引入第二个密码。派生在浏览器内完成，密码不落盘。
- `verifier` = AES-GCM 加密固定串 `rln-private-v1`，用于在不读取任何文章的情况下判断密码是否正确。
- 文件名为**不带前导点**的 `private-key.json`：GitHub Pages 不保证提供 dotfile，公开站点需要能直接 fetch 它。
- 该文件本身不含密钥，可公开；salt 公开不影响安全性（PBKDF2 的作用是提高离线爆破成本）。
- **不额外要求用户设置密码**：解锁后台时输入的密码就是唯一密码，密钥在登录过程中静默派生；文件不存在时，在发布第一篇私密文章的同一提交里用该密码自动创建（界面不出现"设置私密密码"步骤）。只有访客在公开站点打开私密链接时，才需要输入同一密码。

---

## 5. slug 生成规则

`slug = YYYY-MM-DD-<kebab-case(标题)>`

- 日期取帖子发布日（本地时区）。
- 标题 kebab-case：中文保留；字母数字转小写；连续非 [a-z0-9\u4e00-\u9fa5] 折叠为单个 `-`；去除首尾 `-`。
- 标题为空 → 用 `YYYY-MM-DD-<HHMMSS>` 兜底，保证唯一。
- 冲突（同目录已存在同 slug）→ 追加 `-2`、`-3`…（admin 检查 index.json + 仓库目录）。

**私密文章例外**：`slug = <12 位随机 hex>`（如 `a1b2c3d4e5f6`），不使用标题——标题会泄露在文件路径里。编辑已有私密文章时**保持原 slug 不变**，避免每次保存都改写 URL；由私密转公开、或公开转私密时才重新生成。

---

## 6. 删除语义（Git Trees API）

- 删除文件：tree 条目 `{path, mode:"100644", type:"blob", sha: null}`。
- base_tree 保留其余所有文件；新增/更新条目用 `content` 字段。
- 删除**不存在的**文件会返回 422 → 调用方（admin）先基于当前索引判定，避免删除空操作。

---

## 7. 一次性提交的原子性

- 一次发布 = **一个 commit**，其 tree 同时包含：
  - 帖子 md 文件（新增/更新/删除）
  - `content/index.json`（索引同步：新增/更新/删除条目、draft 翻转）
  - `content/private-key.json`（首次使用私密文章、或修改解锁密码时）
  - `content/rss.xml`（按最新已发布列表重建；发布/删除/站点设置变更时都重建）
- `rss.xml` / `sitemap.xml` **必须排除** `draft: true` 与 `private: true` 的条目。
- 保证公开站点与 raw 内容永远一致，不会出现"有索引无文件"或"有文件无索引"。

---

## 8. 版本与迁移

- 所有 schema 字段固定为 `1`。升级 schema 时：admin 读取旧版本 → 转换 → 单次 commit 提交新版本文件。
- `posts[].private`、frontmatter `private`、`content/private/`、`content/private-key.json` 都是**可选增量**，不改变 schema，旧仓库无需迁移。
- 本文档变更需与实现同步；前后端（site.js / admin.js）共享 `data-model.md` 为唯一契约。
