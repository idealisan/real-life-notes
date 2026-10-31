# Real Life Notes — 需求分析文档

> 本文档是**后续迭代需求的唯一来源**。新增需求时：先在本文件补齐条目（含优先级与可行性）→ 采纳后写入 `docs/requirements.md` 再动手。
>
> 硬约束：**纯静态、零后端、GitHub 仓库即数据库**。每条需求必须标注在此约束下的可行性。
>
> **决策（2026-08-09）**：除下方 R14 外，原需求清单中的其余条目（R01–R13、R15–R28 等）**全部删除、不再实现**。本项目的后续迭代只聚焦 R14 管理后台 PWA。
>
> **决策（2026-10-31）**：R08「私密文章」重新登记为 **R15** 并采纳（原 R08 只做前端隐藏，无法保密）。新定义为「整篇端侧加密 + 完全对外隐藏 + 复用后台解锁密码」，见 §2。

---

## 1. 项目定位与核心约束

- **形态**：公共站点（`index.html` / `post.html?p=`）+ 管理后台（`admin/`），纯原生 JS，无构建步骤。
- **数据层**：`config.json` + `content/index.json` + `content/<分类>/<slug>.md` + `content/images/`，一次发布 = 一个 commit 原子更新。
- **可用外部能力**：GitHub REST API（公开读 + PAT 私有写）、GitHub Issues（评论）、浏览器 localStorage/IndexedDB/Web Crypto、GitHub Pages 构建。
- **不可用能力**：任何服务端逻辑、Cron、需 OAuth 的秘密流程、需第三方付费服务的订阅/分析。

---

## 2. 当前需求（唯一待实现）

### R14 — 管理后台 PWA（仅后台）

- **范围**：**仅 `admin/` 后台**做成可安装的 PWA（manifest + service worker + 离线缓存）；**公共站点（首页 `index.html`、阅读页 `post.html`、404 页）保持普通 HTML，不注册 Service Worker、不加 manifest**。
- **目标**：
  1. `admin/manifest.webmanifest`：`name` / `short_name` / `start_url: ./` / `scope: ./` / `display: standalone` / `theme_color` / `background_color` / 图标（SVG `admin/icon.svg`）。
  2. `admin/sw.js`：App Shell 缓存（admin 的 HTML/CSS/JS/vendor，运行时缓存版本化 `assets/v<ts>/`），离线可打开后台；跨域的 GitHub API 请求**不走 SW 缓存**（network-only），避免读到陈旧数据；JSON（config/index）network-first，失败回退缓存。
  3. `admin/pwa-register.js`：后台页面（`admin/index.html`、`admin/login.html`）加载后注册 `./sw.js`（需安全上下文，失败静默忽略）。脚本独立文件，遵守后台 `script-src 'self'` CSP（不加内联脚本）。
- **布局约束（重要）**：PWA 仅引入 manifest + 后台 SW，**不得改动任何前台/后台的布局与样式**；PC 浏览器访问后台时外观须与普通 HTML 完全一致（SW/缓存不影响渲染，manifest 只在「安装到桌面」时生效）。
- **可行性**：纯静态天然支持；SW 作用域限制在 `/admin/`，与公共站点零耦合。
- **注意**：缓存失效策略需与 `assets/v<ts>/` 版本号配合（静态资源 cache-first 即可，版本 URL 变化即自然更新）；SW 自身变更靠字节比对触发重装。

---

### R15 — 私密文章（整篇端侧加密）

- **范围**：文章可以标记为「私密」；仓库里只存密文，**标题、标签、日期、封面、正文全部加密**，index.json 中该条只有 `{path, private:true}`。
- **可见性**：普通访客在列表、归档、标签、搜索、随机、上下篇、相关、双链、RSS、sitemap 中**都看不到**；即使拿到直链，看到的也只有解锁表单。
- **解密条件**：浏览器内输入**后台解锁密码**（即 `content/.admin-token` 所用的同一个密码），密钥由 PBKDF2-SHA256(120000) 派生，AES-256-GCM 解密；密码只在内存与 sessionStorage 中存在，刷新保留、关标签失效。
- **不引入第二个密码**：内容密钥与 Token 加密共用同一个密码；修改密码时必须原子重加密所有私密文章（否则内容永久无法解密）。
- **不保护**（纯静态无法保护）：文章存在性与篇数、密文长度、正文引用的图片（`content/images/*` 公开）、Git 历史中的旧明文、弱密码的离线爆破。
- **可行性**：Web Crypto 在浏览器内完成，无需后端；代价是"管理员凭证 = 密码"，无法区分多人。
- **优先级**：高（用户明确提出）。

---

## 3. 已删除的需求（不再实现）

原清单 R01 独立搜索索引、R02/R21 评论增强（**已实现**）、R03 封面（**已实现**）、R04 双链（**已实现**）、R05 系列文章、R06 标签管理、R07 定时发布、R08 私密文章（**已改登记为 R15 重新采纳**）、R09 关于/友链页、R10 面包屑（**已实现**）、R11 阅读量、R12 媒体库、R13 备份导出、R15 编辑器增强、R16 多平台分享（**已实现**）、R17 收藏、R18 二级分类、R19 版本回滚、R20 RSS 增强、R22 每日一言、R23 邮件订阅、R24 访客分析、R25 打赏码、R26 多管理员、R27 AI 问答、R28 知识图谱——**全部删除，不排入迭代**。
