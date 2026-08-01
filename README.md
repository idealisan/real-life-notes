# Real Life Notes

一个纯静态的 GitHub Pages 记录类项目：把 GitHub 仓库当笔记/博客后端，管理员在浏览器里直接通过 GitHub API 提交 commit，GitHub Pages 自动构建发布。

## 功能特性

- **纯静态、零后端**：无服务器、无构建步骤，浏览器直调 `api.github.com`（开放 CORS）。
- **身份 = 管理员自己的 fine-grained PAT**：无登录页、无 OAuth。
- **Token 存浏览器密码管理器**：标准 `type="password"` + `autocomplete="current-password"` 表单，浏览器负责保存与自动填充；前端只读输入框、不落盘（不写 localStorage/IndexedDB）。
- **公共站点**：多页面结构——列表（分类过滤、关键词搜索、分页、归档）、详情 `post.html?p=…`（原生页内锚点）、全文搜索高亮、相关文章、上一篇/下一篇、暗色模式、移动端适配。
- **Markdown + LaTeX 公式**：`marked` 渲染 + `DOMPurify` 消毒 + `KaTeX` 公式（行内 `$...$` 与块级 `$$...$$`）。
- **社交分享与 SEO**：og:image（自动取正文首图）/og:site_name/article 时间戳、twitter 卡片、JSON-LD 结构化数据（BlogPosting 含作者与图片）。
- **相对路径部署**：`site.url` 留空时全站使用相对路径（RSS/sitemap/robots），适配 GitHub Pages 多仓库/子路径。
- **GitHub Issues 评论**：零第三方服务，可选开关（后台设置）。
- **管理后台**：文章新建/编辑/草稿/发布/删除、分类管理、站点设置，编辑器实时预览（含公式），一次保存 = 一个 commit（文件 + 索引原子更新）。
- **Git 即版本历史**：所有内容变更都可追溯、可回滚。

## 目录结构

```
index.html              公共站点列表页（分类/搜索/翻页/归档，query 路由）
post.html               公共站点详情页（post.html?p=<文章路径>，锚点原生可用）
404.html                未找到兜底页
admin/index.html        管理后台入口
assets/css|js/          共享样式与脚本（原生 JS，无构建）
assets/vendor/          本地托管的第三方库（marked / DOMPurify / KaTeX）
config.json             站点配置（标题、分类、GitHub 坐标）
content/index.json      帖子索引（公开站点列表的唯一入口，内嵌正文摘要与 content）
content/<分类>/<slug>.md  帖子正文
docs/                   设计文档
```

## 快速开始

### 1. 部署到 GitHub Pages

1. 把本项目推送到 GitHub 仓库。
2. 仓库 Settings → Pages → **Deploy from a branch** → 选 `main` / root。
3. 之后每次 push，Pages 自动构建，站点地址为 `https://<用户名>.github.io/<仓库名>/`。

### 2. 创建管理 Token（fine-grained PAT）

1. GitHub → Settings → **Developer settings** → **Fine-grained personal access tokens** → **Generate new token**。
2. **Repository access**：Only select repositories → 选择本项目仓库。
3. **Permissions** → Repository permissions：
   - **Contents: Read and write**（必须）
   - Metadata: Read（自动附带）
4. 生成并复制 token（`github_pat_…`）。

> 建议同时开启分支保护（Settings → Branches → Add rule，要求 PR）以防误删；token 只授权单仓库，泄露面最小。

### 3. 使用管理后台

1. 打开站点 → 页脚「管理」进入 `/admin/`。
2. 粘贴 token，浏览器会提示保存到密码管理器（下次自动填充）。
3. 新建文章 → 填写标题/分类/标签/正文 → **发布**（或存为草稿）。
4. 发布成功即写入 GitHub；raw 内容立即可见，Pages 构建完成后全站更新。

### 4. 本地预览

```bash
python3 -m http.server 8080 --directory .   # 需在仓库根目录
# 访问 http://localhost:8080/
```

## 安全说明

- Token 仅存内存；页面 CSP 收紧（`script-src 'self'`、零外部脚本）。
- Markdown 正文经 DOMPurify 消毒后再入 DOM；动态文本一律转义。
- 所有写操作依赖 `Authorization` 头的 token，无 cookie 会话，无 CSRF 面。
- 推荐 token 权限最小化（单仓库 + Contents 读写）。

## 文档

- [docs/architecture.md](docs/architecture.md) — 功能架构设计
- [docs/data-model.md](docs/data-model.md) — 数据结构规范（config.json / 索引 / 帖子 frontmatter）
- [resource-analysis.md](resource-analysis.md) — 资源分析报告（API、CORS、密码管理器长度）
- [system-design.md](system-design.md) — 系统设计（纯静态主方案 + Workers 备选）

## 状态

- [x] 设计：功能架构 + 数据结构
- [x] 实现：公共站点 + 管理后台 + gh.js 提交管线
- [x] Markdown + LaTeX 公式 + 代码高亮（marked / KaTeX / highlight.js，全部本地托管）
- [x] 图片上传（粘贴/拖拽 → assets/images/ 提交）、RSS 订阅、详情页灯箱/复制链接/元描述
- [x] 草稿隐私（草稿不进公开列表，直链也不渲染）、未保存修改提醒
- [x] 搜索手动提交（IME 安全）、列表卡片阅读时长、归档摘要、主题切换（亮/暗/跟随系统）
- [x] 相对路径部署、og/twitter 分享元数据、JSON-LD 结构化数据、GitHub Issues 评论
- [x] jsdom 集成测试（站点渲染、草稿/发布/编辑/删除/409 重试、图片上传、草稿拦截）
- [x] 本地 8080 预览（`python3 -m http.server 8080`）
- [ ] 真实 token 端到端验收（提交→Pages 构建）
- [ ] 空仓库一键初始化（token + 仓库地址输入、初始化模块、Pages 开启引导，见 `docs/architecture.md` §10）
- [ ] 多管理员 / Workers 备选形态
