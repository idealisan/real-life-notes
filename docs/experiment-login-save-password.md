# 实验记录：触发浏览器「保存密码」自动保存 GitHub Token

> 状态：**已放弃**（2026-08-07）。结论：纯静态托管上无法可靠地让浏览器自动弹出「保存密码」；接受让用户手动在浏览器密码管理器里添加。
> 本文件是唯一权威记录，**不要再重复尝试**以下任何方案。

## 目标
管理员在后台输入 GitHub fine-grained PAT（Token）连接后，希望浏览器自动弹出「保存密码」提示，把 Token 存进浏览器密码管理器，下次打开自动填充。

## 尝试过的方案（按时间顺序）

### A1. 表单属性 + 原生提交（main 分支，已回退为 A2 补充）
- 做法：`<form action="./" method="get">` + token `type="password"` `autocomplete="current-password"` + `visually-hidden` 的 `autocomplete="username"` 隐藏字段（提交时 JS 填仓库 owner）。
- 结果：**不触发**。纯 SPA 里 submit 事件 `preventDefault()` 后走 fetch 登录，浏览器原生启发式根本不会弹保存框——它要求一次"真实的表单提交 + 页面跳转"。

### A2. Credential Management API（main 分支，当前保留）
- 做法：连接成功后显式调用 `navigator.credentials.store(new PasswordCredential({ id, password }))`。
- 结果：**不可靠**。`PasswordCredential` 是实验特性（非 Baseline），W3C 规范正计划删除 Password/Federated Credential（[w3c/webappsec-credential-management#274](https://github.com/w3c/webappsec-credential-management/pull/274)，2025-08 草案）；现代 Chrome 中 `store()` 已不再稳定触发保存提示，`window.PasswordCredential` 也可能不存在。代码里静默 catch，作为老浏览器的最佳努力，但**不能作为主方案**。

### A3. 独立登录页 + 真实表单提交跳转（experiment/login-page 分支）
动机：假设浏览器需要"真实导航"才弹保存框，SPA 做不到，就单独做一个提交后真实跳转的登录页。

- **A3a. POST 跳转**：`admin/login.html` `<form action="./index.html" method="post">`，提交处理器把 Token/仓库写入 `sessionStorage`（`adminToken`/`adminRepo`），**不 preventDefault**，让浏览器真实 POST 跳转到 `index.html`，后台 `boot()` 读 sessionStorage 自动连接。
  - 结果：**被否决**。静态托管（GitHub Pages / 任意静态服务器）没有后端接收 POST，不可行。
- **A3b. GET 跳转（改自 A3a）**：`method="get"`，Token/仓库输入**不带 `name`**（不序列化进 URL），隐藏 `adminUser` 字段保留 `name="adminUser"` + `autocomplete="username"`。
  - 结果：**仍不触发**。GET 表单提交在静态托管上可以完成真实跳转，sessionStorage 缓存、后台自动连接都正常（jsdom 16 项断言全绿），但 Chrome/Firefox **不会**为这类"GET 提交 + 无后端应答"的页面弹「保存密码」。保存框只对浏览器能明确归类为登录流程的 POST 提交（且通常要求页面自身是用户名/密码登录语义）触发。

## 根因分析
1. 浏览器密码保存框的触发条件是"可识别的真实登录表单提交"，本质绑定在 **POST + 后端应答** 的登录语义上。
2. 本项目是**纯静态、零后端**，没有任何接口接收 POST，因此永远构造不出浏览器认可的"登录提交"。
3. 程序化路径（Credential Management API）正被 Web 标准移除，不可依赖。
4. 结论：静态托管上**不存在**可靠、跨浏览器、自动触发保存框的方案。继续尝试 = 浪费迭代时间。

## 最终决策
- **放弃**自动触发「保存密码」。
- **接受**：让用户手动在浏览器密码管理器里添加 Token（一次操作，后续仍可自动填充）。
- Token 仍只存浏览器内存 + sessionStorage（不落盘），连接流程不变。
- 保留 A2 代码作为老浏览器的最佳努力（无害静默失败），但**不再追求**它触发保存框。

## 给用户的指引（已写入界面文案）
后台连接横幅提示用户：若浏览器未自动弹出保存，可在浏览器设置/密码管理器中手动添加：
- 网址：后台地址（如 `https://<host>/admin/`）
- 用户名：GitHub 用户名
- 密码：GitHub Token

## 以后避免重复尝试
- 看到需求"让浏览器自动保存 Token / 弹保存密码框"时，先读本文件。
- 不要重新实现：表单 action/method 组合、隐藏 autocomplete 字段、独立登录页真实跳转、`navigator.credentials.store`、`new PasswordCredential`、`type="button"` + 成功后 `form.submit()` 等任何变体。
- 直接把结论给出：静态零后端无法自动触发，走手动保存 + 内存/sessionStorage 持有。
