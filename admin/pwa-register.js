/* 仅在管理后台注册 Service Worker（PWA）。前台站点（首页/阅读页）不注册。
 * 需要安全上下文（https 或 localhost）。注册失败静默忽略，不影响正常使用。 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function () { /* 忽略：非安全上下文或不支持 */ });
  });
}
