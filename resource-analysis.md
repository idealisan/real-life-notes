# Real Life Notes — 资源分析报告

> 目的：验证「浏览器 / Cloudflare Workers 通过 GitHub API 直接向仓库提交 commit，再由 GitHub Pages 自动构建」这一技术路线是否可行，并盘点所需 API、权限与参考项目。

> **2026-07 设计更新**：经再次调研，本项目已转向 **纯静态优先** 方案——管理员用自己的 GitHub token（存于浏览器密码管理器），前端在浏览器中直接调用 GitHub API 提交 commit，**无需任何后端/Worker**。因此 GitHub Pages、Cloudflare Pages、任意静态托管均能承载。Cloudflare Workers 方案降级为可选的"服务端集中管理 secret"备选路线。本报告补充了密码管理器长度、自动填充机制等关键调研结论。

---

## 1. 核心结论（TL;DR）

| 问题 | 结论 |
| --- | --- |
| GitHub 是否提供「无本地克隆即可提交 commit」的 API？ | **是**。Contents API（单文件）与 Git Database API（完整 git 对象流） |
| 浏览器能否直调这些 API？ | **可以**。`api.github.com` 对任意来源开放 CORS（`Access-Control-Allow-Origin: *`），支持 `Authorization` 头 |
| OAuth 能否纯浏览器完成？ | **不能直接做**。`github.com/login/*` 不支持 CORS；但本方案**不需要 OAuth**，管理员直接使用自己的 PAT 即可 |
| GitHub token 的长度能否放进浏览器密码管理器？ | **能**。最长 classic PAT 约 255 字符、fine-grained PAT 约 93 字符；浏览器密码管理器普遍支持 1000+ 字符，且官方本就推荐用密码管理器存 token |
| 浏览器密码管理器能否在静态页面上「记住并自动填充」token？ | **能**。标准表单（`type="password"` + `autocomplete="current-password"` + 稳定 `name`/`id` + submit）即可触发保存/自动填充，GitHub Pages 自带 HTTPS 满足要求 |
| commit 之后 GitHub Pages 会自动构建吗？ | **可以**。Pages 配置为 "Deploy from a branch"，push 到该分支即自动构建发布 |
| Cloudflare Workers 提交 commit（旧路线）？ | 仍然可行（GitHub App / PAT 作 secret），但已非必须 |
| `POST /pages/deployments`（免 push 部署）能用吗？ | **受限**。要求 GitHub Actions 签发的 OIDC token，静态侧无法使用，不作考虑 |

**总体路线：纯静态全浏览器闭环可行**——管理员在 `/admin` 页面（浏览器自动填充其存在密码管理器中的 fine-grained PAT）→ 前端用 Octokit 直调 `api.github.com` 提交 commit → GitHub Pages 自动构建发布。全程零后端。

---

## 2. GitHub REST API 能力盘点

### 2.1 Contents API — 单文件提交（最简单）

`PUT /repos/{owner}/{repo}/contents/{path}`

- 创建或更新**单个文件**，一次请求完成一次 commit。
- 关键 body 字段：
  - `message`（必填）：commit 信息
  - `content`（必填）：文件内容，**Base64 编码**
  - `sha`：更新已有文件时必填（该文件的当前 blob SHA，乐观锁）
  - `branch`：目标分支（默认 default 分支）
  - `author` / `committer`：可指定 `name` / `email` / `date`
- 冲突处理：若 fetch 与 commit 之间文件被改动，返回 `409`，需重取 SHA 重试。
- 局限：一次只能操作一个文件。

> 参考：GitHub Docs《Create or update file contents》；[brtkwr.com 批量改文件实践](https://brtkwr.com/posts/2026-02-06-batch-updating-files-across-github-repos-without-cloning/)。

### 2.2 Git Database API — 任意/多文件提交（完整能力）

一次性 commit 多个文件（如"新增一篇文章 + 更新索引"）必须走这条路。流程（GitHub 官方文档给出的标准步骤）：

1. `GET /repos/{owner}/{repo}/git/refs/heads/{branch}` — 取当前 HEAD commit SHA
2. `GET /repos/{owner}/{repo}/git/commits/{sha}` — 取当前 tree SHA
3. `POST /repos/{owner}/{repo}/git/blobs` — 逐个上传文件内容（`content` + `encoding: utf-8`），返回 blob SHA（可并行）
4. `POST /repos/{owner}/{repo}/git/trees` — 组装 tree（`base_tree` 传第 2 步的 SHA，`tree` 数组列 path/mode/type/sha），**必须带 `base_tree`，否则会丢失仓库原有文件**
5. `POST /repos/{owner}/{repo}/git/commits` — 创建 commit（`message`、`tree`、`parents: [HEAD_SHA]`）
6. `PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}` — 把分支 ref 指向新 commit SHA

- 并发控制：第 1 步与第 6 步之间若仓库有他人 push，`PATCH refs` 会返回 `409`，需重跑整个流程。
- 空仓库初始化：`PUT /contents/{path}` 可初始化仓库后再用 Git Database API。
- 以上全部可在浏览器中通过 Octokit 执行（CORS 已开放，见 §3）。

### 2.3 鉴权方式对比（选型素材）

| 方式 | 获取途径 | 权限范围 | 有效期 | 本方案适用 |
| --- | --- | --- | --- | --- |
| **fine-grained PAT** ⭐ | 管理员在 GitHub 网页生成 | 可精确到"仅某仓库 + Contents 读写" | 可设最长 1 年（也可无过期） | **主方案**：存浏览器密码管理器，前端直调 |
| classic PAT | 管理员生成 | `repo` scope（较宽） | 可设过期 | 兼容性最好，但权限面大 |
| GitHub App（installation token） | 签 JWT → `POST /app/installations/{id}/access_tokens` | 按 App 配置的仓库 + 权限 | 1 小时 | 仅适合 Workers/服务端集中管理（旧路线） |
| OAuth App（user token） | device flow / web flow | 按用户授权 scope | 不主动过期 | 需服务端，浏览器直调不可行 |

- 权限要求：
  - classic PAT / OAuth token：需要 `repo` scope。
  - fine-grained token：需要 **Contents: Read and write**（改 `.github/workflows` 还需 Workflows 权限）。
  - GitHub App：Repository permissions → **Contents: Read and write**。
- **推荐（纯静态方案）**：fine-grained PAT，Resource owner 选自己，Repository access 仅选本笔记仓库，Permissions 勾 `Contents: Read and write`（读取列表如需则再加 `Metadata: read`，该权限默认授予）。limit：一个账号最多 50 个 fine-grained token。

### 2.4 读取侧 API（管理界面需要）

- `GET /repos/{owner}/{repo}/contents/{path}` — 读单个文件（Base64）
- `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1` — 列目录树，用于构建分类/文章列表
- `GET /repos/{owner}/{repo}/commits` — 历史记录
- `GET /user` — 校验 token 是否有效、显示登录人
- 公开仓库的读取甚至无需鉴权；私有仓库需以上任意 token。

### 2.5 GitHub Pages 相关 API

- `GET /repos/{owner}/{repo}/pages` — 查看 Pages 配置
- `POST /repos/{owner}/{repo}/pages/deployments` — 从 artifact（zip/tar）直接部署，**无需 push 到分支**。
  - **限制**：body 必填 `oidc_token`（由 GitHub Actions 的 `id-token: write` 签发），静态侧/浏览器**无法**拿到，故不采用。
  - 结论：构建发布仍走"push 到 source 分支 → Pages 自动构建"的标准链路，无需（也无法）绕开。

---

## 3. 浏览器端可行性（重点更新）

### 3.1 CORS：可行 ✅（核心前提）

GitHub 官方文档《Using CORS and JSONP to make cross-origin requests》明确：REST API 支持任意来源的 CORS AJAX：

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Authorization, Content-Type, If-Match, ...
Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE
```

- 意味着：带 `Authorization: Bearer <token>` 的 `fetch()` 可从任何前端页面（GitHub Pages / Cloudflare Pages / 任意静态托管）直调 `api.github.com`。
- 浏览器 SDK：官方 **Octokit**（`octokit/rest.js`）即可，无需代理。

### 3.2 OAuth 在纯浏览器中做不了 ❌（但本方案不需要它）

- `POST https://github.com/login/device/code` 与 `POST https://github.com/login/oauth/access_token` 位于 `github.com`，**不支持 CORS**。
- 官方 OAuth 2.0 **web application flow** 换 token 需要 `client_secret`，不能放前端。
- **结论**：不做"GitHub 登录"，改为管理员**自带 fine-grained PAT**。PAT 由管理员在 GitHub 官网生成、官方本就建议存密码管理器，浏览器页面的责任只是"读取它并用它调 API"。

### 3.3 token 长度 vs 浏览器密码管理器（关键调研）

**GitHub token 实际长度（官方格式，见 §3.4）**：

| 类型 | 前缀 | 总长度 |
| --- | --- | --- |
| classic PAT | `ghp_` + 36~251 字符 | **40~255 字符** |
| fine-grained PAT | `github_pat_` + 22 + `_` + 59 | **约 93 字符** |
| OAuth token | `gho_` + 36 | 40 字符 |
| App installation token | `ghs_` + 36 | 40 字符 |

**浏览器密码管理器长度能力**：

| 管理器 | 长度能力 | 说明/来源 |
| --- | --- | --- |
| Chrome / Google Password Manager | 有讨论指约 1024 字符上限 | Google 官方支持社区 2024 帖子质疑"是否限制在 1024 字符内"；即使如此，1024 ≫ 255 |
| Firefox Password Manager | 无相关长度阻塞；Firefox 77+ 起**粘贴超过 `maxlength` 的内容不再截断** | Bugzilla bug 1320229 |
| HTML 表单字段本身 | `<input>` 默认最大长度 524288（2^19）字符 | 只要**不设置 `maxlength` 属性**，输入框即可容纳任何 token |

**结论**：GitHub token（最长 ~255 字符）放入任何主流浏览器密码管理器**绰绰有余**。真正要注意的是**页面代码不要给 token 输入框设置 `maxlength`**，以免个别浏览器截断（Firefox 77+ 已修复该问题）。

### 3.4 让浏览器记住并自动填充 token

机制依据：web.dev《Sign-in form best practices》——`type="password"` + `autocomplete="current-password"` + **稳定**的 `name`/`id` + 一个 `<form>` 与 submit 按钮，浏览器就会：

1. 首次在 `/admin` 的 token 输入框粘贴并提交 → 弹出"要保存此密码吗"→ 保存（条目名可让用户改成 `real-life-notes admin`）。
2. 之后每次访问 `/admin` → 密码管理器自动填充该 token（或点开填充下拉）。

实现要点：

```html
<form id="token-form">
  <label for="admin-token">GitHub Token</label>
  <input id="admin-token" name="admin-token"
         type="password"
         autocomplete="current-password"
         placeholder="github_pat_...">
  <button type="submit">连接 GitHub</button>
</form>
```

- 域名必须为 HTTPS（GitHub Pages 默认 HTTPS ✅；本地开发 `localhost` 也被视为安全上下文 ✅）。
- 密码管理器按 **origin（协议+域名+端口）** 匹配，所以 token 会与站点绑定，不会泄漏到别的站点。
- 密码填充输入框与普通登录页语法完全一致，因此兼容 Chrome/Firefox/Safari/Edge 内置管理器以及 1Password、Bitwarden、KeePass 等第三方管理器（它们均支持 1000+ 字符的密码字段）。

### 3.5 浏览器直调的完整交互形态（本方案主形态）

1. 管理员首次访问 `/admin`，在"GitHub Token"输入框粘贴 fine-grained PAT，点"连接"。
2. 浏览器询问保存 → 管理员确认。
3. 前端 `new Octokit({ auth: token })`，先 `GET /user` 验证 → 显示管理员身份。
4. 之后每次访问，密码管理器自动填充；前端读取 `input.value` 即时使用。
5. 编辑/发布时前端直接调 Contents / Git Database API 提交 commit。
6. 不在 localStorage / IndexedDB 落盘（密码管理器本身就是更安全的载体），token 只在内存中短暂持有。

### 3.6 备选：token 存在 localStorage / IndexedDB

- 可行但**不推荐**：localStorage 明文暴露于 XSS 风险下；IndexedDB 也非加密。若一定要，建议至少用 Web Crypto 派生密钥加密后再存，但密钥仍在前端，仅防"误提交"而非防攻击者。
- 密码管理器方案更安全、零代码、可同步、可撤销（管理入口在 GitHub 端）。

---

## 4. Cloudflare Workers 可行性（保留为备选路线）

> 若未来希望"多管理员共用 secret / 集中审计 / 不把 token 交到各管理员浏览器"，仍可退回 Workers 方案。以下结论不变。

### 4.1 提交 commit：可行 ✅

在 Worker 内用 `fetch` 调上面 2.1 / 2.2 的 GitHub API 即可。公开参考：

- [gr2m/cloudflare-worker-github-app-example](https://github.com/gr2m/cloudflare-worker-github-app-example)：Worker 内用 GitHub App 私钥签发 JWT → installation token。注意 WebCrypto 只支持 **PKCS#8** 格式私钥（`openssl pkcs8 -topk8 ...`）。
- [concertypin/deplodash](https://github.com/concertypin/deplodash)：Hono on Workers 的 GitHub App Token 服务，含 installation token 缓存（KV）、OAuth 登录。
- [asamborski/github-mcp-server](https://github.com/asamborski/github-mcp-server)：Workers + Durable Objects 上的 GitHub OAuth 与文件提交，含 CSRF/会话管理参考。
- [JoshLuedeman/teamwork](https://github.com/JoshLuedeman/teamwork/blob/main/docs/github-app-setup.md)：GitHub App + Worker 自动向仓库推送文件，四步 API 提交的完整示例。

### 4.2 认证与配额

- 认证：Cloudflare Access（Zero Trust）保护 `/admin`；secret 用 `wrangler secret put`。
- Workers 免费版：100,000 请求/天，CPU 10ms/请求，个人场景足够。
- GitHub API 限流：认证请求 5,000 次/小时（按 token 计）。

---

## 5. 构建发布链路

### 5.1 GitHub Pages（主）✅

- 仓库 Settings → Pages → Build and deployment → Source = **Deploy from a branch**，选择内容分支（如 `main`）。
- **每次 push 到该分支都会自动触发构建**，无需任何操作。
- 我们的 commit 正是通过 Contents / Git Database API 写入该分支的，因此闭环成立：
  `浏览器提交 commit → push 到 main → Pages 自动 build → 网站更新`。

### 5.2 Cloudflare Pages（备选）

- 若内容仓库改为接 Cloudflare Pages（Git 集成），同样 push 即自动构建；且 Cloudflare Pages 也支持直接在浏览器用 token 走 API 的静态方案（本方案与托管平台无关）。

### 5.3 手动/兼容兜底

- `POST /repos/{owner}/{repo}/pages/builds`：重新触发 Pages 构建（无法触发"首次创建"）。
- `actions/deploy-pages`：Actions 专用，与本项目无关。

---

## 6. 参考资源清单

### GitHub 官方文档
- Contents API（create/update file）：https://docs.github.com/en/rest/repos/contents
- Git Database 交互指南（blob→tree→commit→ref）：https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-your-git-database
- Git commits API：https://docs.github.com/en/rest/git/commits
- GitHub Pages API：https://docs.github.com/en/rest/pages/pages
- CORS / JSONP：https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests
- 管理 PAT（含 fine-grained 生成步骤与 50 个上限）：https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- fine-grained PAT 所需权限：https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
- 凭据类型与前缀（ghp_/github_pat_/gho_/ghu_/ghs_）：https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/github-credential-types
- token 自动吊销规则（推入公共仓库即吊销）：https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation
- 授权 OAuth App（web flow / device flow）：https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps

### 密码管理器 / 表单最佳实践
- 登录表单最佳实践（autocomplete/保存机制）：https://web.dev/articles/sign-in-form-best-practices
- Chrome 密码长度讨论（~1024 字符）：https://support.google.com/accounts/thread/256216645/
- Firefox 粘贴不截断（Bugzilla 1320229）：https://bugzilla.mozilla.org/show_bug.cgi?id=1320229
- GitHub 强烈密码/密码管理器（"use a password manager"）：https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-strong-password

### 社区实践
- 免克隆批量改文件：https://brtkwr.com/posts/2026-02-06-batch-updating-files-across-github-repos-without-cloning/
- REST API 提交四步脚本（blob/tree/commit/ref）：https://claudelab.net/en/articles/claude-code/claude-code-github-rest-api-commit-push
- Stack Overflow：Commit to GitHub API without cloning：https://stackoverflow.com/questions/51617188/commit-to-github-api-without-cloning-the-repo
- 浏览器 device flow 需要服务端代理（说明为何不走 OAuth）：https://www.zonca.dev/posts/2025-01-29-github-auth-browser-device-flow

### Cloudflare Workers + GitHub（备选路线）
- Workers GitHub 集成（Worker 代码本身的 CI/CD）：https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/
- GitHub App token 服务参考：https://github.com/concertypin/deplodash
- GitHub MCP server on Workers：https://github.com/asamborski/github-mcp-server
- GitHub App + Worker 推送文件：https://github.com/JoshLuedeman/teamwork/blob/main/docs/github-app-setup.md
