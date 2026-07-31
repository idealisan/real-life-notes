# Real Life Notes — 资源分析报告

> 目的：验证「浏览器 / Cloudflare Workers 通过 GitHub API 直接向仓库提交 commit，再由 GitHub Pages 自动构建」这一技术路线是否可行，并盘点所需 API、权限与参考项目。

## 1. 核心结论（TL;DR）

| 问题 | 结论 |
| --- | --- |
| GitHub 是否提供「无本地克隆即可提交 commit」的 API？ | **是**。有两条路：Contents API（单文件）与 Git Database API（完整 git 对象流） |
| 浏览器能否直调这些 API？ | **可以**。`api.github.com` 对任意来源开放 CORS（`Access-Control-Allow-Origin: *`），支持 `Authorization` 头 |
| OAuth 能否纯浏览器完成？ | **不能直接做**。`github.com/login/*` 不支持 CORS；device flow / code 换 token 都必须走一个服务端（可用 Cloudflare Workers 充当） |
| Cloudflare Workers 能否提交 commit？ | **可以**。GitHub App 或 fine-grained PAT 作为 Worker secret，服务端调 API |
| commit 之后 GitHub Pages 会自动构建吗？ | **可以**。Pages 配置为 "Deploy from a branch"，push 到该分支即自动构建发布 |
| `POST /pages/deployments`（免 push 部署）能用吗？ | **受限**。该端点要求 GitHub Actions 签发的 OIDC token，Cloudflare 侧无法直接使用，仅作记录 |

**总体路线是可行的**，推荐主路线为：**Cloudflare Workers（管理员端 + 认证 + 服务端调 GitHub API）→ push 到仓库 source 分支 → GitHub Pages 自动构建**。

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

### 2.3 鉴权方式对比（选型素材）

| 方式 | 获取途径 | 权限范围 | 有效期 | 适用 |
| --- | --- | --- | --- | --- |
| fine-grained PAT | 管理员在 GitHub 网页生成 | 可精确到"仅某仓库 + Contents 读写" | 可设过期（最长 1 年） | 单管理员、Worker secret 或浏览器直调 |
| classic PAT | 管理员生成 | `repo` scope（较宽） | 可设过期 | 兼容性最好，但权限面大 |
| GitHub App（installation token） | 签 JWT → `POST /app/installations/{id}/access_tokens` | 按 App 配置的仓库 + 权限 | **1 小时** | 多管理员、bot 身份、需 Worker 定时换 token |
| OAuth App（user token） | device flow / web flow | 按用户授权 scope | 不主动过期 | 需在 Workers 上做完整的第三方登录 |

- 权限要求：
  - classic PAT / OAuth token：需要 `repo` scope。
  - fine-grained token：需要 **Contents: Read and write**（改 `.github/workflows` 还需 Workflows 权限）。
  - GitHub App：Repository permissions → **Contents: Read and write**。
- 推荐：主方案用 **fine-grained PAT** 存 Worker secret（最简单）；若未来要多管理员/多人协作，升级为 **GitHub App**。

### 2.4 读取侧 API（管理界面需要）

- `GET /repos/{owner}/{repo}/contents/{path}` — 读单个文件（Base64）
- `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1` — 列目录树，用于构建分类/文章列表
- `GET /repos/{owner}/{repo}/commits` — 历史记录
- 公开仓库的读取甚至无需鉴权；私有仓库需以上任意 token。

### 2.5 GitHub Pages 相关 API

- `GET /repos/{owner}/{repo}/pages` — 查看 Pages 配置
- `POST /repos/{owner}/{repo}/pages/deployments` — 从 artifact（zip/tar）直接部署，**无需 push 到分支**。
  - **限制**：body 必填 `oidc_token`（由 GitHub Actions 的 `id-token: write` 签发），本质是为 Actions 设计的端点；Cloudflare Workers / 浏览器**无法**拿到该 token，故不采用。
  - 结论：构建发布仍走"push 到 source 分支 → Pages 自动构建"的标准链路，无需（也无法）绕开。

---

## 3. 浏览器端可行性

### 3.1 CORS：可行 ✅

GitHub 官方文档《Using CORS and JSONP to make cross-origin requests》明确：REST API 支持任意来源的 CORS AJAX：

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Authorization, Content-Type, If-Match, ...
Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE
```

- 意味着：带 `Authorization: Bearer <token>` 的 `fetch()` 可从任何前端页面直调 `api.github.com`。
- 浏览器 SDK：官方 **Octokit**（`octokit/rest.js`）即可，无需代理。

### 3.2 OAuth 在纯浏览器中做不了 ❌（关键限制）

- `POST https://github.com/login/device/code` 与 `POST https://github.com/login/oauth/access_token` 位于 `github.com`，**不支持 CORS**。
- 官方 OAuth 2.0 **web application flow** 换 token 需要 `client_secret`，不能放前端。
- 所以纯 GitHub Pages 上无法完成"让用户点 GitHub 登录并拿到 token"的完整流程（设备码交互 + 轮询需要一个服务端代理）。
  - 参考：[zonca.dev — Authenticate to GitHub in the browser with the device flow](https://www.zonca.dev/posts/2025-01-29-github-auth-browser-device-flow)：device flow 需要服务端进程代管 device code 生成、轮询与 token 存储。

### 3.3 浏览器直调的可行形态

在"管理员身份已由别处认证（如 Cloudflare Access / Workers 会话）"的前提下，前端可持有并使用：

- **方案 A：fine-grained PAT 存在浏览器内存/localStorage**，前端用 Octokit 直接调 Contents / Git Database API。
  - 优点：完全无后端参与、实现最简单。
  - 代价：token 暴露于前端（localStorage 有 XSS 风险）。需将 token 权限收敛到"仅目标仓库 Contents 读写"，并建议只在内存中短期持有。
- **方案 B：token 只存在 Workers secret，前端请求 Workers，Workers 代为提交**（即本项目主路线）。浏览器不接触任何 secret。

> 用户原话中"认证之后能够访问到一些 secret"——对应方案 A 的"前端拿 token"或方案 B 的"Workers 拿 token"，两者皆可实现。

---

## 4. Cloudflare Workers 可行性

### 4.1 提交 commit：可行 ✅

在 Worker 内用 `fetch` 调上面 2.1 / 2.2 的 GitHub API 即可，与语言无关。实测过的公开参考：

- [gr2m/cloudflare-worker-github-app-example](https://github.com/gr2m/cloudflare-worker-github-app-example)：Worker 内用 GitHub App 私钥签发 JWT → installation token。注意 WebCrypto 只支持 **PKCS#8** 格式私钥（`openssl pkcs8 -topk8 ...`）。
- [concertypin/deplodash](https://github.com/concertypin/deplodash)：Hono on Workers 的 GitHub App Token 服务，含 installation token 缓存（KV）、OAuth 登录。
- [asamborski/github-mcp-server](https://github.com/asamborski/github-mcp-server)：Workers + Durable Objects 上的 GitHub OAuth 与文件提交，含 CSRF/会话管理参考。
- [JoshLuedeman/teamwork](https://github.com/JoshLuedeman/teamwork/blob/main/docs/github-app-setup.md)：GitHub App + Worker 自动向仓库推送文件，四步 API 提交的完整示例。

### 4.2 secret 管理

- `wrangler secret put GITHUB_TOKEN`（PAT）或 `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY`。
- fine-grained PAT 只授权目标仓库 + `Contents: read/write`，即使泄露影响面也小。
- GitHub App 模式：私钥 + App ID 存 secret，Worker 内签 JWT（`jose` 或 `@octokit/auth-app`），installation token 1 小时有效，建议 KV 缓存复用。

### 4.3 管理员认证（不归本项目实现，但需确认承载）

- **Cloudflare Access（Zero Trust）**：可为某个路由/应用设置身份认证（邮箱 OTP、Google/GitHub SSO 等），认证通过才可访问管理员路径。这是用户所说"认证不需要项目本身操心"最契合的方案。
- 备选：Worker 内自建 session（密码 + 加密 Cookie / GitHub OAuth web flow）。

### 4.4 Workers 配额（免费版，够用）

- 请求数：100,000/天；CPU 10ms/请求（worker 免费档）——一次提交约 2~6 次 GitHub API 调用，体量极小。
- 注意 GitHub API 限流：认证请求 5,000 次/小时（按 token 计），个人笔记场景远不会触及。

---

## 5. 构建发布链路

### 5.1 GitHub Pages（推荐主链路）✅

- 仓库 Settings → Pages → Build and deployment → Source = **Deploy from a branch**，选择内容分支（如 `main` 或独立 `gh-pages`）。
- 之后**每次 push 到该分支都会自动触发构建**，无需任何操作。
- 我们的 commit 正是通过 Git Database API 写入该分支的，因此闭环成立：
  `Workers 提交 commit → push 到 main → Pages 自动 build → 网站更新`。

### 5.2 Cloudflare Pages（备选）

- 若内容仓库改为接 Cloudflare Pages（Git 集成），同样 push 即自动构建；管理端 Worker 与 Pages 可以是同一项目或用同一仓库的另一个分支。

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
- 授权 OAuth App（web flow / device flow）：https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- GitHub App 安装认证（installation token）：https://github.com/github/docs/blob/main/content/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation.md

### 社区实践
- 免克隆批量改文件：https://brtkwr.com/posts/2026-02-06-batch-updating-files-across-github-repos-without-cloning/
- REST API 提交四步脚本（blob/tree/commit/ref）：https://claudelab.net/en/articles/claude-code/claude-code-github-rest-api-commit-push
- Stack Overflow：Commit to GitHub API without cloning：https://stackoverflow.com/questions/51617188/commit-to-github-api-without-cloning-the-repo
- 浏览器 device flow 需要服务端代理：https://www.zonca.dev/posts/2025-01-29-github-auth-browser-device-flow

### Cloudflare Workers + GitHub
- Workers GitHub 集成（Worker 代码本身的 CI/CD）：https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/
- GitHub App token 服务参考：https://github.com/concertypin/deplodash
- GitHub MCP server on Workers：https://github.com/asamborski/github-mcp-server
- GitHub App + Worker 推送文件：https://github.com/JoshLuedeman/teamwork/blob/main/docs/github-app-setup.md
