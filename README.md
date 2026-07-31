# Real Life Notes

一个部署在 GitHub Pages 上的个人记录类项目，用于按类别记录生活中的各种事情（笔记/博客型内容）。

## 核心理念

**全链路浏览器更新**：把 GitHub Pages 的仓库真正当作一个笔记/博客项目来用，管理员无需在本地克隆仓库、做 commit、再 push，而是全部在浏览器中完成内容更新。

## 设计要点

- 管理员路径采用身份认证（认证机制由部署层提供，项目本身不操心）。
- 认证之后，在网页编辑框中提交新内容。
- 通过调用 GitHub API 向仓库提交 commit（两条路径，二选一或都支持）：
  1. **Cloudflare Workers**：Workers 绑定身份认证，在 Workers 内部调用 GitHub API 提交 commit。只要 GitHub 提供更新仓库提交 commit 的 API 就一定能实现。
  2. **浏览器直调**：认证之后管理员能访问到一些 secret，直接在浏览器中调用 GitHub API 提交 commit。
- 一旦仓库有新的 commit，GitHub Pages / Cloudflare Pages 自动触发 build，完成整个生命周期。

## 部署形态（候选）

- GitHub Pages：纯前端静态托管方案，可能无法承载后端逻辑（需要验证）。
- Cloudflare Workers：肯定可行，能承载身份认证与 API 调用逻辑。

## 状态

- [x] 记录项目描述
- [x] 搜索 API 与相关资源，写资源分析报告
- [x] 写系统设计报告
- [ ] 正式开发（暂缓）
