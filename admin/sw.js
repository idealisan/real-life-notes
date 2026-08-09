/* Real Life Notes 管理后台 Service Worker（仅后台启用，前台站点不参与）
 * - 仅缓存同源（/admin/）资源，跨域的 GitHub API 请求直接走网络，不做缓存，避免读到陈旧数据。
 * - 静态资源（css/js/svg/图片/字体、含版本化 assets/v<ts>/）cache-first 并后台更新；
 *   页面与 JSON（config/index）network-first，离线时回退缓存，保证后台可离线打开。
 * - 不涉及任何布局改动，PC 浏览器上后台页面外观与普通 HTML 完全一致。
 */
var CACHE = 'rln-admin-v1';
var SHELL = ['./', './index.html', './login.html'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 跨域（GitHub API）走网络，不缓存
  var path = url.pathname;
  // 静态资源（含版本化 assets/v<ts>/）cache-first；页面与 JSON 内容 network-first，避免读到陈旧数据
  var isStatic = /\.(css|js|svg|png|jpe?g|gif|webp|woff2?|ttf|ico)$/i.test(path) ||
    /assets\/v\d+\//.test(path);
  if (isStatic) {
    e.respondWith(
      caches.match(req).then(function (cached) {
        var net = fetch(req).then(function (res) {
          if (res && res.status === 200) caches.open(CACHE).then(function (c) { c.put(req, res.clone()); });
          return res;
        }).catch(function () { return cached; });
        return cached || net;
      })
    );
  } else {
    // 页面与动态内容：network-first，失败回退缓存
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200) caches.open(CACHE).then(function (c) { c.put(req, res.clone()); });
        return res;
      }).catch(function () { return caches.match(req); })
    );
  }
});
