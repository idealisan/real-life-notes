(function () {
  'use strict';

  var KEY = 'rln-theme';
  var ORDER = ['light', 'dark', 'auto'];
  var ICON = {
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.4M12 19v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.6 12h2.4M19 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 13.2A8.4 8.4 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z"/></svg>',
    auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/></svg>'
  };
  var LABEL = { light: '亮色', dark: '暗色', auto: '跟随系统' };

  function stored() {
    var v = null;
    try { v = localStorage.getItem(KEY); } catch (e) { v = null; }
    return (v === 'light' || v === 'dark' || v === 'auto') ? v : 'auto';
  }

  function systemDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function apply() {
    var t = stored();
    var dark = t === 'dark' || (t === 'auto' && systemDark());
    var root = document.documentElement;
    if (t === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#000000' : '#f2f2f7');
    /* 沉浸式状态栏：深色用 black-translucent（白字 + 内容透到状态栏下），
       浅色用 default（深字，自动适配浅底），避免白字压浅底看不清 */
    var status = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (status) status.setAttribute('content', dark ? 'black-translucent' : 'default');
    Array.prototype.forEach.call(document.querySelectorAll('link[data-hljs]'), function (link) {
      link.media = (link.getAttribute('data-hljs') === 'dark') === dark ? 'all' : 'not all';
    });
    var btn = document.getElementById('themeToggle');
    if (btn) {
      btn.innerHTML = ICON[t];
      btn.title = '主题：' + LABEL[t] + '（点击切换）';
      btn.setAttribute('aria-label', '切换主题，当前' + LABEL[t]);
    }
  }

  function cycle() {
    var next = ORDER[(ORDER.indexOf(stored()) + 1) % ORDER.length];
    try { localStorage.setItem(KEY, next); } catch (e) {}
    apply();
  }

  window.Theme = { current: stored, cycle: cycle, apply: apply };

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (stored() === 'auto') apply();
    });
  }

  apply();

  document.addEventListener('DOMContentLoaded', function () {
    apply();
    var btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', cycle);
  });
})();
