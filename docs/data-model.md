# Real Life Notes — 数据结构设计

> 规定仓库中所有持久化数据的精确格式。实现必须严格遵守本文件；任何格式变更需先修订本文档。

---

## 1. 仓库数据总览

```
config.json          — 站点配置（站点元信息 + 分类元数据 + GitHub 源坐标）
content/index.json   — 帖子索引（公开站点列表的唯一入口）
content/<category>/<slug>.md  — 帖子正文（frontmatter + Markdown）
```

三种文件全部是普通文本，可直接用 Git 版本控制；所有读写都通过 GitHub API 完成。

---

## 2. config.json

`config.json` 位于仓库根目录。

```jsonc
{
  "schema": 1,
  "site": {
    "title": "Real Life Notes",
    "subtitle": "记录生活中的各种事情",
    "footer": "Powered by Real Life Notes"
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
| `site.subtitle` | string | ≤ 200 字符，可空 |
| `site.footer` | string | 可空 |
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
| `posts[].draft` | boolean | **必填**。`true`=草稿（公开站点隐藏）；`false`=已发布 |

> **排序约定**：index.json 中的顺序 = 展示顺序（按 date 降序）。公开站点不再自行排序，只渲染；同时**过滤 `draft: true`**。

> **草稿约定**：草稿帖子**同样写入 index.json**，标记 `draft: true`。index.json 因此是内容唯一真相源——admin 直接从中列出草稿，无需遍历仓库文件。发布（去草稿）只需在同一次提交中把该条 `draft` 置为 `false`。

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

---

## 5. slug 生成规则

`slug = YYYY-MM-DD-<kebab-case(标题)>`

- 日期取帖子发布日（本地时区）。
- 标题 kebab-case：中文保留；字母数字转小写；连续非 [a-z0-9\u4e00-\u9fa5] 折叠为单个 `-`；去除首尾 `-`。
- 标题为空 → 用 `YYYY-MM-DD-<HHMMSS>` 兜底，保证唯一。
- 冲突（同目录已存在同 slug）→ 追加 `-2`、`-3`…（admin 检查 index.json + 仓库目录）。

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
- 保证公开站点与 raw 内容永远一致，不会出现"有索引无文件"或"有文件无索引"。

---

## 8. 版本与迁移

- 所有 schema 字段固定为 `1`。升级 schema 时：admin 读取旧版本 → 转换 → 单次 commit 提交新版本文件。
- 本文档变更需与实现同步；前后端（site.js / admin.js）共享 `data-model.md` 为唯一契约。
