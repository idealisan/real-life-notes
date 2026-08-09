(function () {
  'use strict';

  var KEY = 'rln-theme';
  var ORDER = ['light', 'dark', 'auto'];
  var ICON = { light: '☀️', dark: '🌙', auto: '🌗' };
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
    Array.prototype.forEach.call(document.querySelectorAll('link[data-hljs]'), function (link) {
      link.media = (link.getAttribute('data-hljs') === 'dark') === dark ? 'all' : 'not all';
    });
    var btn = document.getElementById('themeToggle');
    if (btn) {
      btn.textContent = ICON[t];
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
