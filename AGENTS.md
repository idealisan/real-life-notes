# AGENTS.md

Real Life Notes — 把 GitHub 仓库当作笔记/博客后端，管理员在浏览器中直接通过 GitHub API 提交 commit，GitHub Pages 自动构建发布。目前**只有设计文档，无任何代码**（无 package.json、无构建/测试/lint 配置）。

## 当前状态与约定
- 仓库仅 3 份文档：`README.md`、`resource-analysis.md`、`system-design.md`。正式开发尚未开始。
- 沟通与文档用中文；commit message 用中文。
- 分支 `main`，remote `origin` = `git@github.com:idealisan/real-life-notes.git`（SSH）。

## 核心设计（勿偏离主路线）
- 主方案：**纯静态、零后端**。管理员用自己的 fine-grained PAT（仅授权本仓库 `Contents: read/write`），token 存**浏览器密码管理器**，前端用 Octokit 直调 `api.github.com` 提交 commit → GitHub Pages 自动构建。
- 不可作为主路线的替代（已调研否决）：OAuth device/web flow 无法纯浏览器完成（`github.com/login/*` 无 CORS、换 token 需 `client_secret`）；`POST /pages/deployments` 不可用（要求 GitHub Actions 签发的 OIDC token）。Cloudflare Workers 仅作可选备选形态，见 `system-design.md`。

## 实现时的高信号要点（源自调研结论）
- token 表单必须：`type="password"` + `autocomplete="current-password"` + 稳定唯一的 `id`/`name` + 正常 `<form>`+submit 按钮，浏览器才会弹"保存密码"；**不要设 `maxlength`**（防截断）。站内不得把 token 写入 localStorage/IndexedDB。
- 提交 commit：Git Database API 六步流（ref → commit → blobs → trees → commit → ref，见 `resource-analysis.md` §2.2）。**建 tree 必须带 `base_tree`，否则会删光仓库其余文件**；`PATCH refs` 收到 409 时重取基线重试。
- 单文件改动可用 `PUT /contents/{path}`（更新需当前 blob SHA）。
- `api.github.com` 对任意 origin 开放 CORS（含 `Authorization` 头），浏览器版 Octokit 可直接使用，无需代理。

## 验证
- 无测试框架。验收方式是真实提交一次后观察 GitHub Pages 是否自动构建（Pages 配置 "Deploy from a branch" 选 `main`）。
