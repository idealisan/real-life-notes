(function () {
  'use strict';

  var DEFAULT_CONFIG = {
    site: { title: 'Real Life Notes', subtitle: '', author: '', footer: '' },
    categories: {},
    comments: { enabled: false, label: '评论' }
  };
  var PAGE_SIZE = 8;

  var MODE = location.pathname.split('/').pop() === 'post.html' ? 'post' : 'list';

  var state = {
    config: DEFAULT_CONFIG,
    posts: [],
    view: null,
    cat: null,
    q: '',
    page: 1,
    p: null
  };

  function parseParams() {
    var sp = new URLSearchParams(location.search);
    state.view = sp.get('view') || null;
    state.cat = sp.get('cat') || null;
    state.q = sp.get('q') || '';
    state.page = parseInt(sp.get('page'), 10);
    if (!state.page || state.page < 1) state.page = 1;
    state.p = sp.get('p');
  }

  function buildListUrl(pageOverride) {
    var p = pageOverride || state.page;
    var parts = [];
    if (state.view === 'archive') parts.push('view=archive');
    if (state.view === 'tags') parts.push('view=tags');
    if (state.cat) parts.push('cat=' + encodeURIComponent(state.cat));
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (p > 1) parts.push('page=' + p);
    return 'index.html' + (parts.length ? '?' + parts.join('&') : '');
  }

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

  function setMetaName(name, content) {
    var node = document.querySelector('meta[name="twitter:' + name + '"]');
    if (node) node.setAttribute('content', content == null ? '' : content);
  }

  function setPageMeta(title, desc) {
    document.title = title;
    setMetaDescription(desc || '');
    setMetaProperty('title', title);
    setMetaProperty('description', desc || '');
    setMetaProperty('url', location.href);
    var sn = document.querySelector('meta[property="og:site_name"]');
    if (sn) sn.setAttribute('content', (state.config && state.config.site && state.config.site.title) || '');
    setMetaName('title', title);
    setMetaName('description', desc || '');
    var can = document.querySelector('link[rel="canonical"]');
    if (!can) {
      can = document.createElement('link');
      can.setAttribute('rel', 'canonical');
      document.head.appendChild(can);
    }
    can.setAttribute('href', location.href);
  }

  function setOgImage(src) {
    if (!src) {
      setMetaProperty('image', '');
      setMetaProperty('image:alt', '');
      setMetaName('image', '');
      setMetaName('card', 'summary');
      return;
    }
    var resolved;
    try { resolved = new URL(src, location.href).href; } catch (e) { resolved = src; }
    setMetaProperty('image', resolved);
    setMetaProperty('image:alt', (document.title || '').slice(0, 80));
    setMetaName('image', resolved);
    setMetaName('card', 'summary_large_image');
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
    return el('div', {}, [
      el('div', { class: 'notice notice-error' }, [
        '找不到该页面。',
        el('a', { href: 'index.html', text: ' 返回首页' })
      ]),
      el('form', { class: 'search-form', 'aria-label': '搜索文章', onSubmit: function (e) {
        e.preventDefault();
        var input = this.querySelector('input');
        window.location.href = 'index.html?q=' + encodeURIComponent((input && input.value || '').trim());
      } }, [
        el('label', { class: 'search-box' }, [
          searchIcon(),
          el('input', { type: 'search', placeholder: '搜索文章…', 'aria-label': '搜索文章' })
        ]),
        el('button', { type: 'submit', class: 'search-submit', text: '搜索' })
      ])
    ]);
  }

  /* ---------- 分类导航（真实链接 + 真实导航） ---------- */
  function catLink(key, label) {
    var href = 'index.html' + (key ? '?cat=' + encodeURIComponent(key) : '');
    return el('a', {
      class: state.cat === key ? 'active' : '',
      href: href,
      text: label,
      onClick: function (e) {
        e.preventDefault();
        window.location.href = href;
      }
    });
  }

  function renderCats() {
    els.catNav.textContent = '';
    els.catNav.appendChild(catLink(null, '全部'));
    Object.keys(state.config.categories).forEach(function (key) {
      var c = state.config.categories[key];
      els.catNav.appendChild(catLink(key, (c.icon ? c.icon + ' ' : '') + c.label));
    });
  }

  /* 底部 tab bar 激活态（纯 UI 增强，不影响导航行为） */
  function updateTabBar() {
    var bar = document.querySelector('.tab-bar');
    if (!bar) return;
    var active = 'home';
    if (MODE === 'list' && state.view === 'archive') active = 'archive';
    else if (MODE === 'list' && state.view === 'tags') active = 'tags';
    Array.prototype.forEach.call(bar.querySelectorAll('.tab-bar-item'), function (a) {
      a.classList.toggle('is-active', a.getAttribute('data-tab') === active);
    });
  }

  /* ---------- 列表 ---------- */
  function searchScore(p, q) {
    var s = 0;
    if (p.title.toLowerCase().indexOf(q) !== -1) s += 100;
    if ((p.tags || []).some(function (t) { return t.toLowerCase().indexOf(q) !== -1; })) s += 40;
    if ((p.excerpt || '').toLowerCase().indexOf(q) !== -1) s += 20;
    if (typeof p.content === 'string' && p.content.toLowerCase().indexOf(q) !== -1) s += 5;
    return s;
  }

  function filteredPosts() {
    var q = state.q ? state.q.toLowerCase() : '';
    var posts = state.posts.filter(function (p) {
      if (p.draft) return false;
      if (state.cat && p.category !== state.cat) return false;
      if (q) {
        var catLabel = (state.config.categories[p.category] || {}).label || p.category;
        var hay = (p.title + ' ' + catLabel + ' ' + (p.excerpt || '') + ' ' + (p.tags || []).join(' ') + ' ' + (typeof p.content === 'string' ? p.content : '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    if (q) {
      posts = posts.slice().sort(function (a, b) {
        return searchScore(b, q) - searchScore(a, q);
      });
    } else {
      posts = posts.slice().sort(function (a, b) {
        if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
        return (b.date || '').localeCompare(a.date || '');
      });
    }
    return posts;
  }

  function highlightText(text) {
    if (!state.q) return [text];
    var q = state.q.toLowerCase();
    var lower = text.toLowerCase();
    var out = [];
    var last = 0;
    var at = lower.indexOf(q);
    while (at !== -1) {
      if (at > last) out.push(text.slice(last, at));
      out.push(el('mark', { class: 'hl', text: text.slice(at, at + q.length) }));
      last = at + q.length;
      at = lower.indexOf(q, last);
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  function stripMd(s) {
    return String(s == null ? '' : s)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/\$\$[\s\S]*?\$\$/g, ' ')
      .replace(/\$[^$]*\$/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/[*_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function excerptChildren(p) {
    if (state.q && typeof p.content === 'string') {
      var q = state.q.toLowerCase();
      var plain = stripMd(p.content);
      var lower = plain.toLowerCase();
      var at = lower.indexOf(q);
      if (at !== -1) {
        var start = Math.max(0, at - 50);
        var end = Math.min(plain.length, at + q.length + 80);
        var snip = (start > 0 ? '…' : '') + plain.slice(start, end) + (end < plain.length ? '…' : '');
        return highlightText(snip);
      }
    }
    return p.excerpt ? highlightText(p.excerpt) : null;
  }

  /* ---------- 搜索输入（手动提交） ---------- */
  var searchEl = null;
  function searchInputElement() {
    if (searchEl) return searchEl;
    searchEl = el('input', {
      type: 'search',
      placeholder: '搜索标题、标签、正文…',
      value: state.q,
      'aria-label': '搜索文章'
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
        el('h1', { class: 'list-title', text: (state.cat && state.config.categories[state.cat]) ? (state.config.categories[state.cat].icon ? state.config.categories[state.cat].icon + ' ' : '') + state.config.categories[state.cat].label : '全部文章' }),
        state.q ? el('p', { class: 'list-subtitle' }, [
          '搜索「' + state.q + '」· ' + total + ' 篇 ',
          el('a', { class: 'search-clear', href: 'index.html', text: '清除 ✕', onClick: function (e) {
            e.preventDefault();
            state.q = '';
            state.page = 1;
            state.cat = null;
            state.view = null;
            render();
          } })
        ])
          : el('p', { class: 'list-subtitle', text: (state.cat && state.config.categories[state.cat] && state.config.categories[state.cat].description) ? state.config.categories[state.cat].description + ' · ' + total + ' 篇' : total + ' 篇记录' })
      ]),
      state.cat ? el('a', { class: 'cat-archive-link', href: 'index.html?view=archive&cat=' + encodeURIComponent(state.cat), text: '该分类归档 →', onClick: function (e) {
        e.preventDefault();
        state.view = 'archive';
        state.page = 1;
        render();
      } }) : null,
      el('form', { class: 'search-form', 'aria-label': '搜索文章', onSubmit: function (e) {
        e.preventDefault();
        if (searchEl) {
          state.q = searchEl.value;
          state.page = 1;
          state.view = null;
          state.cat = null;
          render();
        }
      } }, [
        el('label', { class: 'search-box' }, [
          searchIcon(),
          searchInputElement()
        ]),
        el('button', { type: 'submit', class: 'search-submit', text: '搜索' })
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
      if (pages > 1) body.appendChild(pager(pages, state.page));
    }

    els.view.textContent = '';
    els.view.appendChild(head);
    els.view.appendChild(body);
  }

  function postCard(p) {
    var mins = (typeof p.content === 'string' && p.content.trim()) ? wordCounts(p.content.replace(/\s+/g, ' ').trim()).minutes : null;
    return el('a', { class: 'post-card', href: 'post.html?p=' + encodeURIComponent(p.path) }, [
      el('div', { class: 'post-card-meta' }, [
        el('span', { class: 'cat-badge', text: (state.config.categories[p.category] || {}).label || p.category }),
        el('time', { datetime: p.date, text: md.formatDate(p.date) }),
        p.updated ? el('span', { text: '更新于 ' + md.formatDate(p.updated) }) : null,
        mins ? el('span', { text: '约 ' + mins + ' 分钟' }) : null
      ]),
      el('h2', { class: 'post-card-title' }, (p.pinned ? [el('span', { class: 'pin-badge', text: '置顶' }), el('span', { class: 'post-card-title-text' }, highlightText(p.title))] : highlightText(p.title))),
      excerptChildren(p) ? el('p', { class: 'post-card-excerpt' }, excerptChildren(p)) : null,
      (p.tags && p.tags.length) ? el('div', { class: 'post-card-tags' }, p.tags.map(tagLink)) : null
    ]);
  }

  function tagLink(t) {
    var href = 'index.html?q=' + encodeURIComponent(t);
    return el('a', {
      class: 'tag', href: href, text: t,
      onClick: function (e) {
        e.preventDefault();
        window.location.href = href;
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

  function pager(pages, current) {
    function goLink(n) {
      return el('a', {
        class: n === current ? 'is-active' : '',
        href: buildListUrl(n),
        text: String(n),
        'aria-current': n === current ? 'page' : null,
        onClick: function (e) {
          e.preventDefault();
          state.page = n;
          render();
        }
      });
    }
    var links = [];
    if (current > 1) {
      links.push(el('a', {
        class: 'pager-prev', href: buildListUrl(current - 1), text: '← 上一页',
        onClick: function (e) { e.preventDefault(); state.page = current - 1; render(); }
      }));
    }
    for (var i = 1; i <= pages; i++) links.push(goLink(i));
    if (current < pages) {
      links.push(el('a', {
        class: 'pager-next', href: buildListUrl(current + 1), text: '下一页 →',
        onClick: function (e) { e.preventDefault(); state.page = current + 1; render(); }
      }));
    }
    return el('nav', { class: 'pager', 'aria-label': '分页' }, links);
  }

  /* ---------- 详情 ---------- */
  function ensureWikiMaps() {
    if (state.wikiMapped) return;
    state.wikiMapped = true;
    state.wikiByPath = {};
    state.wikiByTitle = {};
    state.wikiBySlug = {};
    state.posts.forEach(function (p) {
      if (p.draft) return;
      state.wikiByPath[String(p.path).toLowerCase()] = p;
      if (p.title) state.wikiByTitle[String(p.title).toLowerCase()] = p;
      var slug = p.path.split('/').pop().replace(/\.md$/, '');
      if (slug) state.wikiBySlug[slug.toLowerCase()] = p;
    });
  }

  function resolveWikiTarget(target) {
    ensureWikiMaps();
    var t = String(target).trim().toLowerCase();
    if (!t) return null;
    return state.wikiByPath[t] || state.wikiByTitle[t] || state.wikiBySlug[t] || null;
  }

  function applyWikiLinks(root) {
    ensureWikiMaps();
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentNode;
        if (!p || /^(PRE|CODE|A|SCRIPT|STYLE)$/.test(p.nodeName)) return NodeFilter.FILTER_REJECT;
        if (p.classList && p.classList.contains('wl')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var texts = [];
    var node;
    while ((node = walker.nextNode())) texts.push(node);
    texts.forEach(function (textNode) {
      var text = textNode.nodeValue;
      var re = /\[\[([^\]\]]+)\]\]/g;
      var m, last = 0, any = false;
      var frag = document.createDocumentFragment();
      while ((m = re.exec(text))) {
        var post = resolveWikiTarget(m[1]);
        var display = post ? (post.title || m[1].trim()) : m[1].trim();
        var span;
        if (post) {
          span = document.createElement('a');
          span.className = 'wl';
          span.href = 'post.html?p=' + encodeURIComponent(post.path);
        } else {
          span = document.createElement('span');
          span.className = 'wl wl-missing';
          span.title = '未找到对应文章';
        }
        span.textContent = display;
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        frag.appendChild(span);
        last = m.index + m[0].length;
        any = true;
      }
      if (!any) return;
      frag.appendChild(document.createTextNode(text.slice(last)));
      textNode.parentNode.replaceChild(frag, textNode);
    });
  }

  function backlinksOf(path) {
    ensureWikiMaps();
    var cur = null;
    state.posts.forEach(function (p) { if (p.path === path) cur = p; });
    if (!cur) return [];
    var names = [];
    if (cur.title) names.push(String(cur.title).toLowerCase());
    var slug = cur.path.split('/').pop().replace(/\.md$/, '');
    if (slug) names.push(slug.toLowerCase());
    names = names.filter(function (s) { return !!s; });
    if (!names.length) return [];
    var out = [];
    state.posts.forEach(function (p) {
      if (p.draft || p.path === path) return;
      if (typeof p.content !== 'string' || !p.content) return;
      var c = p.content.toLowerCase();
      if (names.some(function (name) { return c.indexOf('[[' + name + ']]') !== -1; })) out.push(p);
    });
    return out;
  }

  function renderDetail(path) {
    var inIndex = null;
    state.posts.forEach(function (p) { if (p.path === path) inIndex = p; });
    if (inIndex && inIndex.draft) {
      els.view.textContent = '';
      els.view.appendChild(notFoundView());
      setPageMeta(state.config.site.title, state.config.site.subtitle || state.config.site.title);
      setOgImage('');
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
    applyWikiLinks(body);
    applyFontSize(body);
    externalizeLinks(body);
    attachLightbox(body);
    attachCodeCopy(body);
    addCodeLines(body);
    var firstImg = body.querySelector('img');
    var firstImgSrc = firstImg ? firstImg.getAttribute('src') : '';
    setOgImage(firstImgSrc);
    var plain = body.textContent.replace(/\s+/g, ' ').trim();
    var counts = wordCounts(plain);
    if (plain) {
      setMetaDescription(plain.slice(0, 150));
      setMetaProperty('description', plain.slice(0, 150));
    }
    var resolvedImg;
    if (firstImgSrc) {
      try { resolvedImg = new URL(firstImgSrc, location.href).href; } catch (e) { resolvedImg = firstImgSrc; }
    }
    var apt = document.querySelector('meta[property="article:published_time"]');
    if (apt) apt.setAttribute('content', meta.date || '');
    var amt = document.querySelector('meta[property="article:modified_time"]');
    if (amt) amt.setAttribute('content', meta.updated || meta.date || '');
    setStructuredData({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      mainEntityOfPage: { '@type': 'WebPage', '@id': location.href },
      headline: meta.title,
      image: resolvedImg || undefined,
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
        catKey ? el('a', { class: 'cat-badge', href: 'index.html?cat=' + encodeURIComponent(catKey), text: cat.label || catKey || '未分类' })
          : el('span', { class: 'cat-badge', text: '未分类' }),
        el('time', { datetime: meta.date, text: md.formatDate(meta.date) }),
        meta.updated ? el('span', { text: '· 更新于 ' + md.fullDate(meta.updated) }) : null,
        counts.words ? el('span', { text: '· ' + counts.words + ' 字 · 约 ' + counts.minutes + ' 分钟' }) : null
      ]),
      tags
    ]));
    els.view.appendChild(renderFontCtl(body));
    els.view.appendChild(body);
    els.view.appendChild(renderDetailNav(path));
    var related = relatedPosts(path);
    if (related) els.view.appendChild(related);
    var bl = backlinksOf(path);
    if (bl.length) {
      els.view.appendChild(el('section', { class: 'backlinks' }, [
        el('h2', { class: 'backlinks-title', text: '反向链接' }),
        el('ul', { class: 'backlinks-list' }, bl.map(function (p) {
          return         el('li', {}, [el('a', { href: 'post.html?p=' + encodeURIComponent(p.path), text: p.title || p.path })]);
        }))
      ]));
    }
    els.view.appendChild(el('div', { class: 'detail-foot' }, [
      el('a', { href: 'index.html', text: '← 返回列表' }),
      el('span', { class: 'detail-foot-actions' }, [
        el('button', { type: 'button', class: 'link-copy', text: '分享', onClick: function (e) {
          e.preventDefault();
          sharePost();
        } }),
        el('a', { href: location.href, text: '复制链接', class: 'link-copy', onClick: function (e) {
          e.preventDefault();
          copyText(location.href).then(function () {
            var self = e.currentTarget;
            self.textContent = '已复制 ✓';
            setTimeout(function () { self.textContent = '复制链接'; }, 2000);
          }).catch(function () {});
        } }),
        el('button', { type: 'button', class: 'link-copy', text: '复制原文', onClick: function (e) {
          e.preventDefault();
          copyText(md.buildFrontmatter(meta) + parsed.body).then(function () {
            var self = e.currentTarget;
            self.textContent = '已复制 ✓';
            setTimeout(function () { self.textContent = '复制原文'; }, 2000);
          }).catch(function () {});
        } }),
        sourceLink
      ])
    ]));
    renderComments();
  }

  /* ---------- 评论（GitHub Issues，config 门控，默认关闭） ---------- */
  function commentsApi(path, query) {
    var g = state.config.github || {};
    return 'https://api.github.com/repos/' + encodeURIComponent(g.owner) + '/' +
      encodeURIComponent(g.repo) + path + (query || '');
  }

  function commentDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function renderCommentItem(c) {
    return el('div', { class: 'comment' }, [
      el('div', { class: 'comment-head' }, [
        el('img', {
          class: 'comment-avatar', src: c.user && c.user.avatar_url, alt: '',
          loading: 'lazy', decoding: 'async'
        }),
        el('span', { class: 'comment-author', text: (c.user && (c.user.login || c.user.name)) || '匿名' }),
        el('time', { class: 'comment-date', datetime: c.created_at, text: commentDate(c.created_at) })
      ]),
      el('div', { class: 'comment-body', html: md.render(c.body || '') })
    ]);
  }

  function renderComments() {
    var cfg = state.config.comments || {};
    var g = state.config.github || {};
    if (!cfg.enabled || !g.owner || !g.repo || !state.p) return;
    var path = state.p;
    var label = cfg.label || '评论';
    var wrap = el('section', { class: 'post-comments', 'aria-label': '评论' }, [
      el('h2', { class: 'comments-title', text: '评论' }),
      el('div', { class: 'comments-status', text: '加载评论…' })
    ]);
    els.view.appendChild(wrap);
    var status = wrap.querySelector('.comments-status');
    function setStatus(text) { status.textContent = text; }
    fetch(commentsApi('/issues', '?state=all&labels=' + encodeURIComponent(label) + '&per_page=100'), {
      headers: { Accept: 'application/vnd.github+json' }
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (issues) {
      var issue = (Array.isArray(issues) ? issues : []).filter(function (i) {
        return i.title === path && i.pull_request === undefined;
      })[0];
      if (issue) {
        var commentLink = el('a', {
          class: 'comments-new', target: '_blank', rel: 'noopener',
          href: 'https://github.com/' + g.owner + '/' + g.repo + '/issues/' + issue.number,
          text: '在 GitHub 参与评论'
        });
        wrap.appendChild(commentLink);
        if (issue.body) {
          wrap.appendChild(renderCommentItem({
            user: issue.user, created_at: issue.created_at, body: issue.body
          }));
        }
        return fetch(commentsApi('/issues/' + issue.number + '/comments', '?per_page=100'), {
          headers: { Accept: 'application/vnd.github+json' }
        }).then(function (res) { return res.ok ? res.json() : []; });
      }
      wrap.appendChild(el('a', {
        class: 'comments-new', target: '_blank', rel: 'noopener',
        href: 'https://github.com/' + g.owner + '/' + g.repo + '/issues/new?title=' + encodeURIComponent(path) +
          '&labels=' + encodeURIComponent(label),
        text: '写第一条评论'
      }));
      return [];
    }).then(function (comments) {
      (Array.isArray(comments) ? comments : []).forEach(function (c) {
        wrap.appendChild(renderCommentItem(c));
      });
      if (!wrap.querySelector('.comment')) {
        wrap.appendChild(el('p', { class: 'comments-empty', text: '还没有评论，来抢沙发。' }));
      }
      status.remove();
    }).catch(function (err) {
      setStatus('评论加载失败：' + (err.message || '未知错误'));
    });
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
      prev ? el('a', { class: 'nav-prev', href: 'post.html?p=' + encodeURIComponent(prev.path) }, [
        el('span', { class: 'nav-dir', text: '← 上一篇' }),
        el('span', { class: 'nav-title', text: prev.title })
      ]) : el('span', { class: 'nav-prev is-empty' }),
      next ? el('a', { class: 'nav-next', href: 'post.html?p=' + encodeURIComponent(next.path) }, [
        el('span', { class: 'nav-dir', text: '下一篇 →' }),
        el('span', { class: 'nav-title', text: next.title })
      ]) : el('span', { class: 'nav-next is-empty' })
    ]);
  }

  function externalizeLinks(root) {
    var links = root.querySelectorAll('a');
    Array.prototype.forEach.call(links, function (a) {
      if (/^https?:\/\//i.test(a.getAttribute('href') || '')) {
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

  function addCodeLines(root) {
    function splitLines(code) {
      var nodes = Array.prototype.slice.call(code.childNodes);
      var lines = [[]];
      nodes.forEach(function (n) {
        if (n.nodeType === 3) {
          var seg = n.nodeValue.split('\n');
          for (var i = 0; i < seg.length; i++) {
            if (i > 0) lines.push([]);
            if (seg[i]) lines[lines.length - 1].push(document.createTextNode(seg[i]));
          }
        } else {
          lines[lines.length - 1].push(n);
        }
      });
      if (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop();
      return lines;
    }
    Array.prototype.forEach.call(root.querySelectorAll('pre code'), function (code) {
      var lines = splitLines(code);
      if (lines.length < 2) return;
      var frag = document.createDocumentFragment();
      lines.forEach(function (parts, i) {
        var span = document.createElement('span');
        span.className = 'cline';
        parts.forEach(function (n) { span.appendChild(n); });
        if (i < lines.length - 1) span.appendChild(document.createTextNode('\n'));
        frag.appendChild(span);
      });
      code.textContent = '';
      code.appendChild(frag);
    });
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

  /* ---------- 阅读字号 ---------- */
  var FONT_KEY = 'rln-fontsize';
  function fontSteps() {
    var v = 0;
    try { v = parseInt(localStorage.getItem(FONT_KEY), 10) || 0; } catch (e) { v = 0; }
    return Math.max(-3, Math.min(5, v));
  }
  function applyFontSize(body) {
    if (!body) return;
    var s = Math.round((1.02 + fontSteps() * 0.05) * 100) / 100;
    body.style.fontSize = s + 'em';
    body.style.lineHeight = (s >= 1.1 ? 1.85 : 1.75).toFixed(2);
  }
  function renderFontCtl(body) {
    var wrap = el('span', { class: 'read-ctl', 'aria-label': '阅读字号调整' }, [
      el('button', { type: 'button', class: 'ctl-btn', text: 'A−', title: '减小字号', 'aria-label': '减小字号', onClick: function (e) {
        e.preventDefault();
        var steps = Math.max(-3, fontSteps() - 1);
        try { localStorage.setItem(FONT_KEY, String(steps)); } catch (err) {}
        applyFontSize(body);
      } }),
      el('button', { type: 'button', class: 'ctl-btn', text: 'A+', title: '增大字号', 'aria-label': '增大字号', onClick: function (e) {
        e.preventDefault();
        var steps = Math.min(5, fontSteps() + 1);
        try { localStorage.setItem(FONT_KEY, String(steps)); } catch (err) {}
        applyFontSize(body);
      } }),
      el('button', { type: 'button', class: 'ctl-btn ctl-reset', text: '默认', title: '恢复默认字号', onClick: function (e) {
        e.preventDefault();
        try { localStorage.removeItem(FONT_KEY); } catch (err) {}
        applyFontSize(body);
      } })
    ]);
    return el('div', { class: 'read-ctl-row' }, [wrap]);
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
        el('a', { href: '#' + id, text: h.textContent })
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
        return el('li', {}, [el('a', { href: 'post.html?p=' + encodeURIComponent(r.p.path), text: r.p.title })]);
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

  /* ---------- 返回顶部 ---------- */
  var backTop = document.getElementById('backTop');
  if (backTop) {
    var updateBackTop = function () {
      backTop.hidden = (window.scrollY || document.documentElement.scrollTop || 0) < 600;
    };
    if (navigator.userAgent.indexOf('jsdom') === -1) {
      document.addEventListener('scroll', updateBackTop, { passive: true });
    }
    updateBackTop();
    backTop.addEventListener('click', function () {
      if (window.scrollTo) window.scrollTo({ top: 0, behavior: 'smooth' });
      else window.scrollTo(0, 0);
    });
  }

  /* ---------- 随机一篇 ---------- */
  var randomLink = document.getElementById('randomPost');
  if (randomLink) {
    randomLink.addEventListener('click', function (e) {
      e.preventDefault();
      var pub = state.posts.filter(function (p) { return !p.draft; });
      if (!pub.length) return;
      var p = pub[Math.floor(Math.random() * pub.length)];
      window.location.href = 'post.html?p=' + encodeURIComponent(p.path);
    });
  }

  /* ---------- 快捷键：/ 聚焦搜索 ---------- */
  if (MODE === 'list' && navigator.userAgent.indexOf('jsdom') === -1) {
    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      var tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      var input = document.querySelector('#view .search-box input');
      if (input) {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });
  }

  /* ---------- 快捷键：详情页 ←/→ 上一篇/下一篇 ---------- */
  if (MODE === 'post' && navigator.userAgent.indexOf('jsdom') === -1) {
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      var tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      var sel = window.getSelection && window.getSelection();
      if (sel && sel.toString()) return;
      var href = null;
      if (e.key === 'ArrowRight') {
        var next = document.querySelector('.detail-nav .nav-next');
        href = next && next.getAttribute('href');
      } else if (e.key === 'ArrowLeft') {
        var prev = document.querySelector('.detail-nav .nav-prev');
        href = prev && prev.getAttribute('href');
      }
      if (href) {
        e.preventDefault();
        window.location.href = href;
      }
    });
  }

  /* ---------- 路由与渲染（MPA：index.html?cat&q&page&view / post.html?p） ---------- */
  function statsBlock(posts) {
    var totalWords = 0;
    var counted = 0;
    posts.forEach(function (p) {
      if (typeof p.content === 'string' && p.content.trim()) {
        totalWords += wordCounts(p.content.replace(/\s+/g, ' ').trim()).words;
        counted++;
      }
    });
    var tags = {};
    posts.forEach(function (p) {
      (p.tags || []).forEach(function (t) { tags[t] = (tags[t] || 0) + 1; });
    });
    var catCount = state.cat ? 1 : Object.keys(state.config.categories || {}).length;
    var items = [
      { label: '文章', value: posts.length },
      { label: '分类', value: catCount },
      { label: '标签', value: Object.keys(tags).length },
      { label: '字数', value: counted ? totalWords.toLocaleString('en-US') : '—' }
    ];
    return el('div', { class: 'stats-grid', 'aria-label': '站点统计' }, items.map(function (it) {
      return el('div', { class: 'stat' }, [
        el('span', { class: 'stat-value', text: String(it.value) }),
        el('span', { class: 'stat-label', text: it.label })
      ]);
    }));
  }

  function renderArchive() {
    var posts = state.posts.filter(function (p) { return !p.draft && (!state.cat || p.category === state.cat); })
      .slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var groups = {};
    posts.forEach(function (p) {
      var m = (p.date || '').slice(0, 7) || '未知';
      if (!groups[m]) groups[m] = [];
      groups[m].push(p);
    });
    var months = Object.keys(groups).sort().reverse();

    els.view.textContent = '';
    var catLabel = (state.cat && state.config.categories[state.cat]) ? (state.config.categories[state.cat].icon ? state.config.categories[state.cat].icon + ' ' : '') + state.config.categories[state.cat].label : null;
    els.view.appendChild(el('div', { class: 'list-head' }, [
      el('div', {}, [
        el('h1', { class: 'list-title', text: catLabel ? catLabel + ' 归档' : '归档' }),
        el('p', { class: 'list-subtitle', text: posts.length + ' 篇文章' })
      ])
    ]));
    if (!posts.length) {
      els.view.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'big', text: '🍃' }),
        el('p', { text: '还没有文章' })
      ]));
      return;
    }
    els.view.appendChild(statsBlock(posts));
    months.forEach(function (m) {
      var group = groups[m];
      els.view.appendChild(el('section', { class: 'archive-month' }, [
        el('h2', { class: 'archive-month-title', text: m.slice(0, 4) + ' 年 ' + parseInt(m.slice(5), 10) + ' 月 · ' + group.length + ' 篇' }),
        el('ul', { class: 'archive-list' }, group.map(function (p) {
          return el('li', {}, [
            el('time', { datetime: p.date, text: (p.date || '').slice(0, 10) }),
            p.pinned ? el('span', { class: 'pin-badge', text: '置顶' }) : null,
            el('a', { href: 'post.html?p=' + encodeURIComponent(p.path), text: p.title }),
            p.excerpt ? el('span', { class: 'archive-excerpt', text: ' · ' + p.excerpt }) : null
          ]);
        }))
      ]));
    });
  }

  function renderTags() {
    var counts = {};
    state.posts.forEach(function (p) {
      if (p.draft) return;
      (p.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    var keys = Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || a.localeCompare(b, 'zh-CN');
    });
    els.view.textContent = '';
    els.view.appendChild(el('div', { class: 'list-head' }, [
      el('div', {}, [
        el('h1', { class: 'list-title', text: '标签' }),
        el('p', { class: 'list-subtitle', text: keys.length ? keys.length + ' 个标签' : '还没有标签' })
      ])
    ]));
    if (!keys.length) {
      els.view.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'big', text: '🏷️' }),
        el('p', { text: '还没有标签' })
      ]));
      return;
    }
    els.view.appendChild(el('div', { class: 'tags-cloud' }, keys.map(function (t) {
      var href = 'index.html?q=' + encodeURIComponent(t);
      return el('a', {
        class: 'tag', href: href, text: t + ' · ' + counts[t],
        onClick: function (e) {
          e.preventDefault();
          window.location.href = href;
        }
      });
    })));
  }

  function render() {
    renderCats();
    updateTabBar();
    if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
    if (MODE === 'list' && navigator.userAgent.indexOf('jsdom') === -1) window.scrollTo(0, 0);
    updateReadingProgress();
    if (MODE === 'post') {
      setStructuredData(null);
      setOgImage('');
      if (!state.p) {
        els.view.textContent = '';
        els.view.appendChild(notFoundView());
        setPageMeta(state.config.site.title, state.config.site.subtitle || state.config.site.title);
        return;
      }
      renderDetail(state.p);
      return;
    }
    if (state.view === 'archive') {
      setPageMeta('归档 · ' + state.config.site.title, state.config.site.subtitle || state.config.site.title);
      renderArchive();
    } else if (state.view === 'tags') {
      setPageMeta('标签 · ' + state.config.site.title, state.config.site.subtitle || state.config.site.title);
      renderTags();
    } else {
      setPageMeta(state.config.site.title, state.config.site.subtitle || state.config.site.title);
      els.view.textContent = '';
      els.view.appendChild(skeletonList());
      renderList();
    }
    try { history.replaceState(null, '', buildListUrl()); } catch (e) {}
  }

  window.addEventListener('popstate', function () {
    if (MODE !== 'list') return;
    parseParams();
    renderCats();
    render();
  });

  function boot() {
    parseParams();
    fetchJSON('content/config.json', null).then(function (cfg) {
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
