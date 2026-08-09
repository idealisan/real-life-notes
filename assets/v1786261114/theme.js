(function () {
  'use strict';

  var KEY = 'rln-theme';
  var ORDER = ['light', 'dark', 'auto'];
  var ICON = {
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>',
    auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3v18" fill="currentColor" stroke="none"/></svg>'
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
