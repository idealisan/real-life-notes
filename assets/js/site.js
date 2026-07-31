(function () {
  'use strict';

  var DEFAULT_CONFIG = {
    site: { title: 'Real Life Notes', subtitle: '', footer: '' },
    categories: {}
  };
  var PAGE_SIZE = 8;

  var state = {
    config: DEFAULT_CONFIG,
    posts: [],
    route: 'list',
    cat: null,
    q: '',
    page: 1
  };

  var els = {
    view: document.getElementById('view'),
    catNav: document.getElementById('catNav'),
    siteTitle: document.getElementById('siteTitle'),
    footerText: document.getElementById('footerText'),
    metaDesc: document.querySelector('meta[name="description"]')
  };

  function setMetaDescription(text) {
    if (els.metaDesc) els.metaDesc.setAttribute('content', text || '');
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (e) { reject(e); }
    });
  }

  function fetchJSON(url, fallback) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error(res.statusText || ('HTTP ' + res.status));
      return res.json();
    }).catch(function (err) {
      if (fallback !== undefined) return fallback;
      throw err;
    });
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'style') node.style.cssText = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function notFoundView() {
    return el('div', { class: 'notice notice-error' }, [
      '找不到该页面。',
      el('a', { href: '#/', text: ' 返回首页' })
    ]);
  }

  /* ---------- 分类导航 ---------- */
  function renderCats() {
    els.catNav.textContent = '';
    els.catNav.appendChild(el('button', {
      class: state.cat === null ? 'active' : '',
      text: '全部',
      onClick: function () { state.cat = null; state.page = 1; render(); }
    }));
    Object.keys(state.config.categories).forEach(function (key) {
      var c = state.config.categories[key];
      els.catNav.appendChild(el('button', {
        class: state.cat === key ? 'active' : '',
        text: (c.icon ? c.icon + ' ' : '') + c.label,
        onClick: function () { state.cat = key; state.page = 1; render(); }
      }));
    });
  }

  /* ---------- 列表 ---------- */
  function filteredPosts() {
    var posts = state.posts.filter(function (p) {
      if (p.draft) return false;
      if (state.cat && p.category !== state.cat) return false;
      if (state.q) {
        var hay = (p.title + ' ' + (p.excerpt || '') + ' ' + (p.tags || []).join(' ')).toLowerCase();
        if (hay.indexOf(state.q.toLowerCase()) === -1) return false;
      }
      return true;
    });
    return posts;
  }

  function renderList() {
    var posts = filteredPosts();
    var total = posts.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var slice = posts.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

    var head = el('div', { class: 'list-head' }, [
      el('div', {}, [
        el('h1', { class: 'list-title', text: state.cat ? (state.config.categories[state.cat].icon ? state.config.categories[state.cat].icon + ' ' : '') + state.config.categories[state.cat].label : '全部文章' }),
        state.q ? el('p', { class: 'list-subtitle', text: '搜索「' + state.q + '」· ' + total + ' 篇' })
          : el('p', { class: 'list-subtitle', text: total + ' 篇记录' })
      ]),
      el('label', { class: 'search-box', 'aria-label': '搜索文章' }, [
        searchIcon(),
        el('input', {
          type: 'search',
          placeholder: '搜索标题、标签…',
          value: state.q,
          'aria-label': '搜索文章',
          oninput: function (e) {
            state.q = e.target.value;
            state.page = 1;
            render();
          }
        })
      ])
    ]);

    var body;
    if (!total) {
      body = el('div', { class: 'empty-state' }, [
        el('div', { class: 'big', text: '🍃' }),
        el('p', { text: state.q ? '没有匹配「' + state.q + '」的文章' : (state.cat ? '该分类暂无文章' : '还没有文章') })
      ]);
    } else {
      body = el('div', {}, slice.map(postCard));
      if (pages > 1) body.appendChild(pager(pages, state.page, function (p) {
        state.page = p;
        render();
      }));
    }

    els.view.textContent = '';
    els.view.appendChild(head);
    els.view.appendChild(body);
  }

  function postCard(p) {
    return el('a', { class: 'post-card', href: '#/post/' + encodeURIComponent(p.path) }, [
      el('div', { class: 'post-card-meta' }, [
        el('span', { class: 'cat-badge', text: (state.config.categories[p.category] || {}).label || p.category }),
        el('time', { datetime: p.date, text: md.formatDate(p.date) }),
        p.updated ? el('span', { text: '更新于 ' + md.formatDate(p.updated) }) : null
      ]),
      el('h2', { class: 'post-card-title', text: p.title }),
      p.excerpt ? el('p', { class: 'post-card-excerpt', text: p.excerpt }) : null,
      (p.tags && p.tags.length) ? el('div', { class: 'post-card-tags' }, p.tags.map(function (t) {
        return el('span', { class: 'tag', text: t });
      })) : null
    ]);
  }

  function searchIcon() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'currentColor');
    var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '7'); circle.setAttribute('cy', '7'); circle.setAttribute('r', '5');
    circle.setAttribute('fill', 'none'); circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', '1.5');
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '11'); line.setAttribute('y1', '11'); line.setAttribute('x2', '14.5'); line.setAttribute('y2', '14.5');
    line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', '1.5'); line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(circle); svg.appendChild(line);
    return svg;
  }

  function pager(pages, current, go) {
    var btns = [];
    for (var i = 1; i <= pages; i++) {
      btns.push(el('button', {
        class: i === current ? 'btn-primary' : '',
        text: String(i),
        onClick: function (n) { return function () { go(n); }; }(i)
      }));
    }
    return el('div', { class: 'pager' }, btns);
  }

  /* ---------- 详情 ---------- */
  function renderDetail(path) {
    var inIndex = null;
    state.posts.forEach(function (p) { if (p.path === path) inIndex = p; });
    if (inIndex && inIndex.draft) {
      els.view.textContent = '';
      els.view.appendChild(notFoundView());
      document.title = state.config.site.title;
      return;
    }
    els.view.textContent = '';
    els.view.appendChild(skeletonDetail());
    fetch(path).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (text) {
      var parsed = md.parseFrontmatter(text);
      var meta = parsed.meta;
      if (!meta.title) meta.title = path.split('/').pop().replace(/\.md$/, '');
      document.title = meta.title + ' · ' + state.config.site.title;
      renderDetailBody(path, parsed);
    }).catch(function (err) {
      els.view.textContent = '';
      if (err.message === 'HTTP 404') {
        els.view.appendChild(notFoundView());
      } else {
        els.view.appendChild(el('div', { class: 'notice notice-error' }, [
          '加载文章失败：' + md.esc(err.message)
        ]));
      }
    });
  }

  function renderDetailBody(path, parsed) {
    var meta = parsed.meta;
    var catKey = (path.split('/')[1] || '') in (state.config.categories || {}) ? path.split('/')[1] : '';
    var cat = state.config.categories[catKey] || {};
    var tags = (meta.tags && meta.tags.length) ? el('div', { class: 'post-card-tags' }, meta.tags.map(function (t) {
      return el('span', { class: 'tag', text: t });
    })) : null;

    var body = el('article', { class: 'detail-body', html: md.render(parsed.body) });
    externalizeLinks(body);
    attachLightbox(body);
    var plain = body.textContent.replace(/\s+/g, ' ').trim();
    if (plain) setMetaDescription(plain.slice(0, 150));

    var sourceLink;
    if (state.config.github && state.config.github.owner) {
      sourceLink = el('a', {
        href: 'https://github.com/' + encodeURIComponent(state.config.github.owner) + '/' +
          encodeURIComponent(state.config.github.repo) + '/blob/' +
          encodeURIComponent(state.config.github.branch || 'main') + '/' + path,
        target: '_blank', rel: 'noopener', text: '源文件'
      });
    }

    els.view.textContent = '';
    els.view.appendChild(el('div', { class: 'detail-head' }, [
      el('h1', { class: 'detail-title', text: meta.title }),
      el('div', { class: 'detail-meta' }, [
        el('span', { class: 'cat-badge', text: cat.label || catKey || '未分类' }),
        el('time', { datetime: meta.date, text: md.formatDate(meta.date) }),
        meta.updated ? el('span', { text: '· 更新于 ' + md.fullDate(meta.updated) }) : null
      ]),
      tags
    ]));
    els.view.appendChild(body);
    els.view.appendChild(renderDetailNav(path));
    els.view.appendChild(el('div', { class: 'detail-foot' }, [
      el('a', { href: '#/', text: '← 返回列表' }),
      el('a', { href: '#/', text: '复制链接', class: 'link-copy', onClick: function (e) {
        e.preventDefault();
        copyText(location.href).then(function () {
          var self = e.currentTarget;
          self.textContent = '已复制 ✓';
          setTimeout(function () { self.textContent = '复制链接'; }, 2000);
        }).catch(function () {});
      } }),
      sourceLink
    ]));
  }

  function attachLightbox(root) {
    var overlay = null;
    Array.prototype.forEach.call(root.querySelectorAll('img'), function (img) {
      img.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (overlay) overlay.remove();
        var big = el('img', { src: img.getAttribute('src'), alt: img.getAttribute('alt') || '' });
        overlay = el('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true' }, [big]);
        document.body.appendChild(overlay);
        function close() {
          if (overlay) { overlay.remove(); overlay = null; }
          document.removeEventListener('keydown', onKey, true);
        }
        function onKey(e) { if (e.key === 'Escape') close(); }
        document.addEventListener('keydown', onKey, true);
        overlay.addEventListener('click', function (ev) {
          if (ev.target === overlay || ev.target === big) close();
        });
      });
    });
  }

  function renderDetailNav(path) {
    var published = state.posts.filter(function (p) { return !p.draft; })
      .slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var idx = -1;
    published.forEach(function (p, i) { if (p.path === path) idx = i; });
    var prev = idx > 0 ? published[idx - 1] : null;
    var next = idx !== -1 && idx < published.length - 1 ? published[idx + 1] : null;
    return el('nav', { class: 'detail-nav', 'aria-label': '文章导航' }, [
      prev ? el('a', { class: 'nav-prev', href: '#/post/' + encodeURIComponent(prev.path) }, [
        el('span', { class: 'nav-dir', text: '← 上一篇' }),
        el('span', { class: 'nav-title', text: prev.title })
      ]) : el('span', { class: 'nav-prev is-empty' }),
      next ? el('a', { class: 'nav-next', href: '#/post/' + encodeURIComponent(next.path) }, [
        el('span', { class: 'nav-dir', text: '下一篇 →' }),
        el('span', { class: 'nav-title', text: next.title })
      ]) : el('span', { class: 'nav-next is-empty' })
    ]);
  }

  function externalizeLinks(root) {
    var links = root.querySelectorAll('a');
    Array.prototype.forEach.call(links, function (a) {
      if (/^https?:\/\//i.test(a.getAttribute('href') || '') && !/^https?:\/\/idealisan\.github\.io/i.test(a.getAttribute('href') || '')) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }

  function skeletonDetail() {
    return el('div', {}, [
      el('div', { class: 'skeleton', style: 'height:36px;width:70%;margin:24px 0 16px' }),
      el('div', { class: 'skeleton', style: 'height:18px;width:40%;margin-bottom:24px' }),
      el('div', { class: 'skeleton', style: 'height:220px;width:100%' })
    ]);
  }

  function skeletonList() {
    var cards = [];
    for (var i = 0; i < 4; i++) {
      cards.push(el('div', { class: 'post-card' }, [
        el('div', { class: 'skeleton', style: 'height:18px;width:30%;margin-bottom:12px' }),
        el('div', { class: 'skeleton', style: 'height:24px;width:65%;margin-bottom:10px' }),
        el('div', { class: 'skeleton', style: 'height:16px;width:95%' })
      ]));
    }
    return el('div', {}, cards);
  }

  /* ---------- 路由与渲染 ---------- */
  function parseHash() {
    var h = location.hash || '#/';
    if (h.indexOf('#/post/') === 0) return { route: 'post', path: decodeURIComponent(h.slice(7)) };
    return { route: 'list' };
  }

  function render() {
    var r = parseHash();
    document.title = state.config.site.title;
    setMetaDescription(state.config.site.subtitle || state.config.site.title);
    if (r.route === 'post') {
      renderDetail(r.path);
    } else {
      els.view.textContent = '';
      els.view.appendChild(skeletonList());
      renderList();
    }
  }

  window.addEventListener('hashchange', render);

  function boot() {
    fetchJSON('config.json', null).then(function (cfg) {
      if (cfg) state.config = Object.assign({}, DEFAULT_CONFIG, cfg);
      if (!state.config.site) state.config.site = DEFAULT_CONFIG.site;
      if (!state.config.categories) state.config.categories = {};
      els.siteTitle.textContent = state.config.site.title || DEFAULT_CONFIG.site.title;
      els.footerText.textContent = state.config.site.footer || '';
      document.title = state.config.site.title;
      renderCats();
      return fetchJSON('content/index.json', { posts: [] });
    }).then(function (index) {
      state.posts = (index && Array.isArray(index.posts)) ? index.posts : [];
      render();
    }).catch(function () {
      els.view.textContent = '';
      els.view.appendChild(el('div', { class: 'notice notice-error' }, [
        '无法加载内容索引 content/index.json。请确认文件存在。'
      ]));
    });
  }

  boot();
})();
