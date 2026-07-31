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

  function setMetaProperty(prop, content) {
    var node = document.querySelector('meta[property="og:' + prop + '"]');
    if (node) node.setAttribute('content', content == null ? '' : content);
  }

  function setPageMeta(title, desc) {
    document.title = title;
    setMetaDescription(desc || '');
    setMetaProperty('title', title);
    setMetaProperty('description', desc || '');
    setMetaProperty('url', location.href);
  }

  function setStructuredData(data) {
    var node = document.getElementById('jsonld');
    if (!data) {
      if (node) node.remove();
      return;
    }
    if (!node) {
      node = document.createElement('script');
      node.type = 'application/ld+json';
      node.id = 'jsonld';
      document.head.appendChild(node);
    }
    node.textContent = JSON.stringify(data);
  }

  function sharePost() {
    var url = location.href;
    var title = document.title || '分享';
    function fallback() {
      return copyText(url).then(function () {
        toast('链接已复制，可粘贴分享 ✓');
      });
    }
    if (navigator.share && navigator.canShare && navigator.canShare({ url: url })) {
      return navigator.share({ title: title, url: url }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        return fallback();
      });
    }
    return fallback();
  }

  var toastTimer = null;
  function toast(text) {
    var node = document.getElementById('toast') || (function () {
      var t = el('div', { id: 'toast', class: 'toast', role: 'status' });
      document.body.appendChild(t);
      return t;
    })();
    node.textContent = text;
    node.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('show'); }, 2600);
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

  function debounce(fn, delay) {
    var timer = null;
    var wrapped = function () {
      clearTimeout(timer);
      timer = setTimeout(fn, delay);
    };
    wrapped.cancel = function () { clearTimeout(timer); timer = null; };
    return wrapped;
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

  /* ---------- 搜索输入（IME 组合输入安全 + 防抖） ---------- */
  var searchEl = null;
  var composing = false;
  function doSearch() {
    if (!searchEl) return;
    if (composing) return;
    state.q = searchEl.value;
    state.page = 1;
    render();
  }
  var debouncedSearch = debounce(doSearch, 300);
  function searchInputElement() {
    if (searchEl) return searchEl;
    searchEl = el('input', {
      type: 'search',
      placeholder: '搜索标题、标签…',
      value: state.q,
      'aria-label': '搜索文章'
    });
    searchEl.addEventListener('compositionstart', function () { composing = true; });
    searchEl.addEventListener('compositionend', function () { composing = false; debouncedSearch(); });
    searchEl.addEventListener('input', function (e) {
      if (composing || e.isComposing) return;
      debouncedSearch();
    });
    searchEl.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        debouncedSearch.cancel();
        searchEl.value = '';
        doSearch();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        debouncedSearch.cancel();
        doSearch();
      }
    });
    return searchEl;
  }

  function renderList() {
    var posts = filteredPosts();
    var total = posts.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var slice = posts.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    if (searchEl && document.activeElement !== searchEl && searchEl.value !== state.q) searchEl.value = state.q;

    var head = el('div', { class: 'list-head' }, [
      el('div', {}, [
        el('h1', { class: 'list-title', text: state.cat ? (state.config.categories[state.cat].icon ? state.config.categories[state.cat].icon + ' ' : '') + state.config.categories[state.cat].label : '全部文章' }),
        state.q ? el('p', { class: 'list-subtitle', text: '搜索「' + state.q + '」· ' + total + ' 篇' })
          : el('p', { class: 'list-subtitle', text: total + ' 篇记录' })
      ]),
      el('label', { class: 'search-box', 'aria-label': '搜索文章' }, [
        searchIcon(),
        searchInputElement()
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
      (p.tags && p.tags.length) ? el('div', { class: 'post-card-tags' }, p.tags.map(tagLink)) : null
    ]);
  }

  function tagLink(t) {
    return el('a', {
      class: 'tag', href: '#/', text: t,
      onClick: function (e) {
        e.preventDefault();
        state.q = t;
        state.cat = null;
        state.page = 1;
        location.hash = '#/';
      }
    });
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
      setPageMeta(state.config.site.title, state.config.site.subtitle || state.config.site.title);
      return;
    }
    els.view.textContent = '';
    if (inIndex && typeof inIndex.content === 'string') {
      var idxMeta = {
        title: inIndex.title || path.split('/').pop().replace(/\.md$/, ''),
        date: inIndex.date || '',
        updated: inIndex.updated || null,
        tags: inIndex.tags || []
      };
      setPageMeta(idxMeta.title + ' · ' + state.config.site.title, '');
      renderDetailBody(path, { meta: idxMeta, body: inIndex.content });
      return;
    }
    els.view.appendChild(skeletonDetail());
    fetch(path).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (text) {
      var parsed = md.parseFrontmatter(text);
      var meta = parsed.meta;
      if (!meta.title) meta.title = path.split('/').pop().replace(/\.md$/, '');
      setPageMeta(meta.title + ' · ' + state.config.site.title, '');
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
    var tags = (meta.tags && meta.tags.length) ? el('div', { class: 'post-card-tags' }, meta.tags.map(tagLink)) : null;

    var body = el('article', { class: 'detail-body', html: md.render(parsed.body) });
    externalizeLinks(body);
    attachLightbox(body);
    attachCodeCopy(body);
    var plain = body.textContent.replace(/\s+/g, ' ').trim();
    var counts = wordCounts(plain);
    if (plain) {
      setMetaDescription(plain.slice(0, 150));
      setMetaProperty('description', plain.slice(0, 150));
    }
    setStructuredData({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      mainEntityOfPage: { '@type': 'WebPage', '@id': location.href },
      headline: meta.title,
      datePublished: meta.date || undefined,
      dateModified: meta.updated || meta.date || undefined,
      description: plain.slice(0, 200),
      author: { '@type': 'Person', name: state.config.site.author || state.config.site.title },
      publisher: { '@type': 'Organization', name: state.config.site.title }
    });
    var toc = buildToc(body);
    if (toc) {
      body.insertBefore(toc, body.firstChild);
      setupTocSpy(body);
    }
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
        meta.updated ? el('span', { text: '· 更新于 ' + md.fullDate(meta.updated) }) : null,
        counts.words ? el('span', { text: '· ' + counts.words + ' 字 · 约 ' + counts.minutes + ' 分钟' }) : null
      ]),
      tags
    ]));
    els.view.appendChild(body);
    els.view.appendChild(renderDetailNav(path));
    var related = relatedPosts(path);
    if (related) els.view.appendChild(related);
    els.view.appendChild(el('div', { class: 'detail-foot' }, [
      el('a', { href: '#/', text: '← 返回列表' }),
      el('span', { class: 'detail-foot-actions' }, [
        el('button', { type: 'button', class: 'link-copy', text: '分享', onClick: function (e) {
          e.preventDefault();
          sharePost();
        } }),
        el('a', { href: '#/', text: '复制链接', class: 'link-copy', onClick: function (e) {
          e.preventDefault();
          copyText(location.href).then(function () {
            var self = e.currentTarget;
            self.textContent = '已复制 ✓';
            setTimeout(function () { self.textContent = '复制链接'; }, 2000);
          }).catch(function () {});
        } }),
        sourceLink
      ])
    ]));
  }

  function attachLightbox(root) {
    var overlay = null;
    Array.prototype.forEach.call(root.querySelectorAll('img'), function (img) {
      if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
      if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');
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

  function wordCounts(plain) {
    if (!plain) return { words: 0, minutes: 0 };
    var cjk = (plain.match(/[\u4e00-\u9fff]/g) || []).length;
    var latin = (plain.replace(/[\u4e00-\u9fff]/g, ' ').trim().match(/\S+/g) || []).length;
    var words = cjk + latin;
    var minutes = Math.max(1, Math.round(words / 400));
    return { words: words, minutes: minutes };
  }

  function attachCodeCopy(root) {
    Array.prototype.forEach.call(root.querySelectorAll('pre code'), function (code) {
      var pre = code.parentNode;
      if (!pre || pre._copyBtn) return;
      pre.style.position = 'relative';
      var btn = el('button', {
        type: 'button', class: 'code-copy', 'aria-label': '复制代码',
        text: '复制',
        onClick: function (e) {
          var self = e.currentTarget;
          var text = code.textContent.replace(/\n$/, '');
          copyText(text).then(function () {
            self.textContent = '已复制 ✓';
            setTimeout(function () { self.textContent = '复制'; }, 2000);
          }).catch(function () {});
        }
      });
      pre._copyBtn = btn;
      pre.appendChild(btn);
    });
  }

  /* ---------- 目录 TOC ---------- */
  var tocObserver = null;
  function buildToc(body) {
    var heads = body.querySelectorAll('h2, h3');
    if (heads.length < 2) return null;
    var items = [];
    Array.prototype.forEach.call(heads, function (h, i) {
      var id = h.id || 'toc-' + i;
      h.id = id;
      items.push(el('li', { class: 'toc-' + h.tagName.toLowerCase() }, [
        el('a', {
          href: '#' + id, text: h.textContent,
          onClick: function (e) {
            e.preventDefault();
            var t = document.getElementById(id);
            if (t) {
              if (typeof t.scrollIntoView === 'function') t.scrollIntoView({ behavior: 'smooth', block: 'start' });
              scheduleProgress();
            }
          }
        })
      ]));
    });
    return el('details', { class: 'toc' }, [
      el('summary', { text: '目录' }),
      el('ol', {}, items)
    ]);
  }
  function setupTocSpy(body) {
    if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
    var links = body.querySelectorAll('.toc a');
    var heads = body.querySelectorAll('h2[id], h3[id]');
    if (!links.length || !heads.length) return;
    if (typeof IntersectionObserver === 'undefined') return;
    tocObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          Array.prototype.forEach.call(links, function (a) {
            a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id);
          });
        }
      });
    }, { rootMargin: '-72px 0px -72% 0px', threshold: 0 });
    Array.prototype.forEach.call(heads, function (h) { tocObserver.observe(h); });
  }

  /* ---------- 相关文章 ---------- */
  function relatedPosts(path) {
    var cur = null;
    state.posts.forEach(function (p) { if (p.path === path) cur = p; });
    if (!cur) return null;
    var tags = cur.tags || [];
    var rel = state.posts.filter(function (p) {
      return p.path !== path && !p.draft && (p.tags || []).some(function (t) { return tags.indexOf(t) !== -1; });
    }).map(function (p) {
      var share = (p.tags || []).filter(function (t) { return tags.indexOf(t) !== -1; }).length;
      return { p: p, share: share };
    }).sort(function (a, b) {
      return b.share - a.share || (b.p.date || '').localeCompare(a.p.date || '');
    }).slice(0, 3);
    if (!rel.length) return null;
    return el('div', { class: 'related-posts' }, [
      el('h3', { class: 'related-title', text: '相关文章' }),
      el('ul', {}, rel.map(function (r) {
        return el('li', {}, [el('a', { href: '#/post/' + encodeURIComponent(r.p.path), text: r.p.title })]);
      }))
    ]);
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

  /* ---------- 阅读进度 ---------- */
  var progressPending = false;
  function updateReadingProgress() {
    var bar = document.getElementById('readingProgress');
    if (!bar) return;
    var hasDetail = !!document.querySelector('#view .detail-body');
    var w = 0;
    if (hasDetail && typeof document.documentElement.scrollTop === 'number') {
      var max = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      if (max > 0) w = Math.max(0, Math.min(100, (document.documentElement.scrollTop / max) * 100));
    }
    bar.style.width = w.toFixed(2) + '%';
    progressPending = false;
  }
  function scheduleProgress() {
    if (progressPending) return;
    progressPending = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(updateReadingProgress);
    else updateReadingProgress();
  }
  if (typeof document !== 'undefined' && typeof window !== 'undefined' && navigator.userAgent.indexOf('jsdom') === -1) {
    window.addEventListener('scroll', scheduleProgress, { passive: true });
    window.addEventListener('resize', scheduleProgress);
  }

  /* ---------- 路由与渲染 ---------- */
  function parseHash() {
    var h = location.hash || '#/';
    if (h.indexOf('#/post/') === 0) return { route: 'post', path: decodeURIComponent(h.slice(7)) };
    return { route: 'list' };
  }

  function render() {
    if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
    if (navigator.userAgent.indexOf('jsdom') === -1) window.scrollTo(0, 0);
    updateReadingProgress();
    var r = parseHash();
    if (r.route !== 'post') setStructuredData(null);
    setPageMeta(state.config.site.title, state.config.site.subtitle || state.config.site.title);
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
