# Real Life Notes

一个部署在 GitHub Pages 上的个人记录类项目，用于按类别记录生活中的各种事情（笔记/博客型内容）。

## 核心理念

**全链路浏览器更新**：把 GitHub Pages 的仓库真正当作一个笔记/博客项目来用，管理员无需在本地克隆仓库、做 commit、再 push，而是全部在浏览器中完成内容更新。

## 设计要点（2026-07 更新：纯静态优先）

- **纯静态、零后端**：整个项目是静态页面，可部署在 GitHub Pages、Cloudflare Pages 或任意静态托管。
- **身份 = 管理员自己的 fine-grained PAT**：无需登录页、无需 OAuth。
- **token 存放在浏览器密码管理器**：页面提供标准的 `type="password"` + `autocomplete="current-password"` 表单，浏览器负责保存与自动填充；前端只读取输入框，不写 localStorage。
- **前端直调 GitHub API 提交 commit**：用 Octokit 在浏览器中调用 Contents / Git Database API 把 Markdown 写入仓库（`api.github.com` 开放 CORS）。
- 一旦仓库有新的 commit，GitHub Pages 自动触发 build，完成整个生命周期。
- **备选形态**：Cloudflare Workers 集中管理 secret（多管理员场景），实现可复用同一套提交逻辑。

## 部署形态

- GitHub Pages（主）：Pages → Deploy from a branch → 选 `main`，push 即自动构建。
- Cloudflare Pages / 任意静态托管（备选）：与托管平台无关，admin 仍走浏览器直调。

## 文档

- [resource-analysis.md](resource-analysis.md) — 资源分析报告（API、权限、CORS、密码管理器长度调研）
- [system-design.md](system-design.md) — 系统设计报告（架构、token 管理、提交流程、实施计划）

## 状态

- [x] 记录项目描述
- [x] 搜索 API 与相关资源，写资源分析报告
- [x] 写系统设计报告
- [x] 更新为纯静态优先方案（密码管理器存 token + 浏览器直调）
- [ ] 正式开发（暂缓）
