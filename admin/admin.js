(function () {
  'use strict';

  var DEFAULT_CONFIG = function () {
    var snap = gh.snapshot();
    return {
      schema: 1,
      site: { title: 'Real Life Notes', subtitle: '', footer: 'Powered by Real Life Notes', url: '' },
      github: { owner: snap.owner, repo: snap.repo, branch: snap.branch || 'main' },
      categories: {
        notes: { label: '笔记', icon: '📝', description: '' },
        life: { label: '生活', icon: '🌱', description: '' },
        work: { label: '工作', icon: '💼', description: '' }
      }
    };
  };

  var state = {
    cfg: null,
    index: { posts: [] },
    token: null,
    user: null,
    view: 'posts',
    editing: null,
    busy: false,
    integrity: null
  };

  var els = {
    connectView: document.getElementById('connectView'),
    workspace: document.getElementById('workspace'),
    connectForm: document.getElementById('connectForm'),
    connectError: document.getElementById('connectError'),
    connectMeta: document.getElementById('connectMeta'),
    connectTarget: document.getElementById('connectTarget'),
    connectTargetText: document.getElementById('connectTargetText'),
    mainContent: document.getElementById('mainContent'),
    repoBadge: document.getElementById('repoBadge'),
    disconnectBtn: document.getElementById('disconnectBtn'),
    busyOverlay: document.getElementById('busyOverlay'),
    toast: document.getElementById('toast')
  };

  /* ---------- 基础工具 ---------- */
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

  function toast(msg, type) {
    els.toast.textContent = msg;
    els.toast.className = 'toast' + (type ? ' toast-' + type : '');
    els.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { els.toast.hidden = true; }, type === 'error' ? 5000 : 2600);
  }

  function setBusy(b) {
    state.busy = b;
    Array.prototype.forEach.call(document.querySelectorAll('button'), function (btn) {
      btn.disabled = b;
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

  function escXml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  function siteBaseUrl() {
    var site = state.cfg.site || {};
    if (site.url) return site.url.replace(/\/+$/, '');
    var g = state.cfg.github || {};
    return 'https://' + g.owner + '.github.io/' + g.repo;
  }

  function buildRss(list) {
    var site = state.cfg.site || {};
    var base = siteBaseUrl();
    var published = (list || state.index.posts || []).filter(function (p) { return !p.draft; })
      .slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); })
      .slice(0, 20);
    var items = published.map(function (p) {
      var link = base + '/post.html?p=' + encodeURIComponent(p.path);
      var pub = (function () { var d = new Date(p.date); return isNaN(d.getTime()) ? '' : d.toUTCString(); })();
      var cats = [];
      var catKey = p.category || '';
      if (catKey && state.cfg.categories[catKey]) cats.push('<category>' + escXml(state.cfg.categories[catKey].label) + '</category>');
      (p.tags || []).forEach(function (t) { cats.push('<category>' + escXml(t) + '</category>'); });
      var desc = typeof p.content === 'string' && p.content.trim() ? md.render(p.content) : (p.excerpt || '');
      return '  <item>\n' +
        '    <title>' + escXml(p.title) + '</title>\n' +
        '    <link>' + escXml(link) + '</link>\n' +
        '    <guid isPermaLink="false">' + escXml(p.path + '@' + (p.updated || p.date)) + '</guid>\n' +
        '    <pubDate>' + pub + '</pubDate>\n' +
        cats.join('\n') + (cats.length ? '\n' : '') +
        '    <description><![CDATA[' + desc + ']]></description>\n' +
        '  </item>';
    }).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
      '<channel>\n' +
      '  <title>' + escXml(site.title || '') + '</title>\n' +
      '  <link>' + escXml(base + '/') + '</link>\n' +
      '  <description>' + escXml(site.subtitle || '') + '</description>\n' +
      '  <atom:link href="' + escXml(base + '/rss.xml') + '" rel="self" type="application/rss+xml"/>\n' +
      '  <lastBuildDate>' + new Date().toUTCString() + '</lastBuildDate>\n' +
      items + '\n' +
      '</channel>\n</rss>\n';
  }

  function buildSitemap(list) {
    var base = siteBaseUrl();
    var published = (list || state.index.posts || []).filter(function (p) { return !p.draft; });
    var urls = published.map(function (p) {
      var lastmod = (p.updated || p.date || '').slice(0, 10);
      return '  <url>\n' +
        '    <loc>' + escXml(base + '/post.html?p=' + encodeURIComponent(p.path)) + '</loc>\n' +
        (lastmod ? '    <lastmod>' + escXml(lastmod) + '</lastmod>\n' : '') +
        '  </url>';
    }).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      '  <url>\n    <loc>' + escXml(base + '/') + '</loc>\n  </url>\n' +
      (urls ? urls + '\n' : '') +
      '</urlset>\n';
  }

  function buildRobots() {
    var base = siteBaseUrl();
    return 'User-agent: *\n' +
      'Allow: /\n\n' +
      'Sitemap: ' + base + '/sitemap.xml\n';
  }

  function errMsg(err) {
    if (!err) return '未知错误';
    if (err.status === 401) return 'Token 无效或已被撤销';
    if (err.status === 403) return '没有权限（403）。请确认 Token 已授权本仓库的 Contents: Read and write，并开启了写权限';
    if (err.status === 404) return '资源不存在（404）。请确认仓库名与所有者正确';
    return (err.message || String(err)) + (err.status ? '（HTTP ' + err.status + '）' : '');
  }

  function fmtLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------- 连接流程 ---------- */
  function showConnect() {
    els.connectView.hidden = false;
    els.workspace.hidden = true;
    els.connectError.hidden = true;
    els.connectMeta.hidden = true;
    els.connectForm.reset();
  }

  function connect(token) {
    setBusy(true);
    els.connectError.hidden = true;
    gh.config({ token: token });
    gh.getUser().then(function (user) {
      state.user = user;
      els.connectMeta.textContent = '已登录：' + user.login;
      els.connectMeta.hidden = false;
      return gh.getRepo().then(function (repo) {
        gh.config({ branch: repo.default_branch });
        return Promise.all([
          fetchRepoConfig(),
          fetchRepoIndex()
        ]);
      });
    }).then(function () {
      setBusy(false);
      els.connectView.hidden = true;
      els.workspace.hidden = false;
      els.repoBadge.hidden = false;
      els.repoBadge.textContent = state.cfg.github.owner + '/' + state.cfg.github.repo + ' @' + state.cfg.github.branch;
      render();
    }).catch(function (err) {
      setBusy(false);
      gh.config({ token: null });
      state.token = null;
      els.connectError.textContent = errMsg(err);
      els.connectError.hidden = false;
    });
  }

  function fetchRepoConfig() {
    return gh.getContent('config.json').then(function (text) {
      try {
        state.cfg = Object.assign(DEFAULT_CONFIG(), JSON.parse(text));
        if (!state.cfg.categories) state.cfg.categories = {};
        if (!state.cfg.site) state.cfg.site = {};
        var snap = gh.snapshot();
        state.cfg.github = Object.assign(state.cfg.github, {
          owner: snap.owner,
          repo: snap.repo,
          branch: snap.branch
        });
        gh.config({ branch: state.cfg.github.branch });
      } catch (e) {
        state.cfg = DEFAULT_CONFIG();
      }
    }).catch(function (err) {
      if (err.status === 404) {
        state.cfg = DEFAULT_CONFIG();
      } else {
        throw err;
      }
    });
  }

  function fetchRepoIndex() {
    return gh.getContent('content/index.json').then(function (text) {
      try {
        state.index = JSON.parse(text);
        if (!Array.isArray(state.index.posts)) state.index.posts = [];
      } catch (e) {
        state.index = { posts: [] };
      }
    }).catch(function (err) {
      if (err.status === 404) {
        state.index = { posts: [] };
      } else {
        throw err;
      }
    });
  }

  function disconnect() {
    state.token = null;
    state.user = null;
    state.cfg = null;
    state.index = { posts: [] };
    gh.config({ token: null });
    showConnect();
  }

  els.connectForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var token = els.connectForm.elements.adminToken.value.trim();
    if (!token) return;
    connect(token);
  });
  els.disconnectBtn.addEventListener('click', disconnect);

  Array.prototype.forEach.call(document.querySelectorAll('.side-nav button'), function (btn) {
    btn.addEventListener('click', function () {
      if (state.view === 'editor' && editor && editor.dirty) {
        if (!confirm('有未保存的修改，确定离开吗？')) return;
      }
      state.view = btn.getAttribute('data-view');
      editor = null;
      render();
    });
  });

  window.addEventListener('beforeunload', function (e) {
    if (state.view === 'editor' && editor && editor.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* ---------- 渲染分发 ---------- */
  function render() {
    Array.prototype.forEach.call(document.querySelectorAll('.side-nav button'), function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-view') === state.view);
    });
    els.mainContent.textContent = '';
    if (state.view === 'posts') renderPosts();
    else if (state.view === 'editor') renderEditor();
    else if (state.view === 'categories') renderCategories();
    else if (state.view === 'settings') renderSettings();
  }

  function sortedPosts() {
    return state.index.posts.slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });
  }

  /* ---------- 文章列表 ---------- */
  var listFilter = { cat: '', q: '' };
  var filterInputEl = null;
  var filterComposing = false;
  var filterSettleTimer = null;
  var debouncedFilter = debounce(function () {
    if (filterComposing) return;
    listFilter.q = filterInputEl ? filterInputEl.value : '';
    renderPosts();
  }, 300);
  function filterImeSettle() {
    filterComposing = false;
    if (filterInputEl && filterInputEl.value !== listFilter.q) {
      listFilter.q = filterInputEl.value;
      renderPosts();
    }
  }
  function onFilterImeKeydown() {
    filterComposing = true;
    if (filterSettleTimer) clearTimeout(filterSettleTimer);
    filterSettleTimer = setTimeout(filterImeSettle, 400);
  }
  function filterInputElement() {
    if (filterInputEl) return filterInputEl;
    filterInputEl = el('input', {
      type: 'search', placeholder: '搜索标题…', value: listFilter.q, 'aria-label': '搜索文章'
    });
    filterInputEl.addEventListener('compositionstart', function () {
      filterComposing = true;
      if (filterSettleTimer) clearTimeout(filterSettleTimer);
    });
    filterInputEl.addEventListener('compositionend', function () {
      filterComposing = false;
      if (filterSettleTimer) clearTimeout(filterSettleTimer);
      debouncedFilter();
    });
    filterInputEl.addEventListener('input', function (e) {
      if (filterComposing || e.isComposing) return;
      debouncedFilter();
    });
    filterInputEl.addEventListener('keydown', function (e) {
      if (e.keyCode === 229 || e.key === 'Process') { onFilterImeKeydown(); return; }
      if (filterComposing || e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        debouncedFilter.cancel();
        filterInputEl.value = '';
        listFilter.q = '';
        renderPosts();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        debouncedFilter.cancel();
        listFilter.q = filterInputEl.value;
        renderPosts();
      }
    });
    return filterInputEl;
  }

  function renderPosts() {
    els.mainContent.textContent = '';
    var posts = sortedPosts().filter(function (p) {
      if (listFilter.cat && p.category !== listFilter.cat) return false;
      if (listFilter.q) {
        var hay = (p.title + ' ' + (p.tags || []).join(' ') + ' ' + p.category).toLowerCase();
        if (hay.indexOf(listFilter.q.toLowerCase()) === -1) return false;
      }
      return true;
    });

    var cats = Object.keys(state.cfg.categories);

    if (filterInputEl && document.activeElement !== filterInputEl && filterInputEl.value !== listFilter.q) filterInputEl.value = listFilter.q;

    var toolbar = el('div', { class: 'panel-toolbar' }, [
      el('button', { class: 'btn-primary', text: '＋ 新建文章', onClick: startNewPost }),
      el('select', {
        'aria-label': '按分类过滤',
        onChange: function (e) { listFilter.cat = e.target.value; renderPosts(); }
      }, [
        el('option', { value: '', text: '全部分类' })
      ].concat(cats.map(function (c) {
        return el('option', { value: c, text: state.cfg.categories[c].label, selected: listFilter.cat === c ? '' : null });
      }))),
      filterInputElement(),
      el('div', { class: 'spacer' }),
      el('button', { text: '完整性检查', onClick: checkIntegrity }),
      el('span', { class: 'repo-badge', style: 'font-size:0.85em', text: '共 ' + posts.length + ' 篇' })
    ]);

    var body;
    if (state.integrity && state.integrity.length) {
      els.mainContent.appendChild(el('div', { class: 'notice notice-error' }, [
        el('strong', { text: '以下索引中的文件缺失：' }),
        state.integrity.map(function (p) { return el('div', { class: 'integrity-item', text: p }); })
      ]));
    }
    if (!posts.length) {
      body = el('div', { class: 'notice notice-info', text: '还没有文章。点击「新建文章」开始记录。' });
    } else {
      var rows = posts.map(function (p) {
        var catLabel = (state.cfg.categories[p.category] || {}).label || p.category;
        return el('tr', {}, [
          el('td', { class: 'row-title' }, [
            p.title,
            p.draft ? el('span', { class: 'draft-badge', text: '草稿' }) : null
          ]),
          el('td', { text: catLabel }),
          el('td', {}, [
            el('span', { text: md.formatDate(p.date) }),
            p.updated && !p.draft ? el('span', { class: 'status-pub', text: ' · 已更新' }) : null
          ]),
          el('td', {}, [
            el('span', { class: p.draft ? 'status-draft' : 'status-pub', text: p.draft ? '草稿' : '已发布' })
          ]),
          el('td', { class: 'row-actions' }, [
            el('button', { text: '编辑', onClick: function () { startEditPost(p); } }),
            el('button', { class: 'btn-danger', text: '删除', onClick: function () { deletePost(p); } })
          ])
        ]);
      });
      body = el('table', { class: 'posts-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: '标题' }), el('th', { text: '分类' }),
          el('th', { text: '日期' }), el('th', { text: '状态' }), el('th', {})
        ])]),
        el('tbody', {}, rows)
      ]);
    }

    els.mainContent.appendChild(el('section', { class: 'panel' }, [
      el('h2', { class: 'panel-title', text: '文章管理' }),
      toolbar, body
    ]));
  }

  function checkIntegrity() {
    if (!state.index.posts.length) { toast('暂无文章，无需检查', 'ok'); return; }
    setBusy(true);
    toast('正在检查文件一致性…', 'ok');
    Promise.all(state.index.posts.map(function (p) {
      return gh.getContent(p.path).then(function () { return null; }).catch(function () { return p.path; });
    })).then(function (missing) {
      setBusy(false);
      missing = missing.filter(Boolean);
      state.integrity = missing;
      if (!missing.length) {
        toast('全部 ' + state.index.posts.length + ' 篇索引文件完整 ✓', 'ok');
      } else {
        toast('发现 ' + missing.length + ' 个缺失文件', 'error');
      }
      renderPosts();
    });
  }

  function startNewPost() {
    state.editing = {
      mode: 'new', path: null,
      title: '', category: Object.keys(state.cfg.categories)[0] || '',
      date: md.isoNow(), tags: [], draft: false, body: ''
    };
    state.view = 'editor';
    render();
  }

  function startEditPost(p) {
    gh.getContent(p.path).then(function (text) {
      var parsed = md.parseFrontmatter(text);
      state.editing = {
        mode: 'edit', path: p.path,
        title: parsed.meta.title || p.title,
        category: p.category,
        date: parsed.meta.date || p.date,
        tags: parsed.meta.tags.length ? parsed.meta.tags : (p.tags || []),
        draft: parsed.meta.draft !== undefined ? parsed.meta.draft : !!p.draft,
        body: parsed.body
      };
      state.view = 'editor';
      render();
    }).catch(function (err) {
      toast('读取文章失败：' + errMsg(err), 'error');
    });
  }

  /* ---------- 编辑器 ---------- */
  var editor = null;

  function computeSlug(over) {
    var title = over ? over.title : editor.title.value;
    var base = md.slugify(title) || 'post';
    var prefix = (over ? over.date : editor.date.value).slice(0, 10) || md.isoNow().slice(0, 10);
    var slug = prefix + '-' + base;
    var taken = {};
    state.index.posts.forEach(function (p) {
      if (state.editing && state.editing.path === p.path) return;
      taken[p.slug] = true;
    });
    var n = 2;
    while (taken[slug]) { slug = prefix + '-' + base + '-' + n++; }
    return slug;
  }

  function renderEditor() {
    var ed = state.editing;
    editor = { title: null, date: null, tags: null, body: null, draft: null, category: null, preview: null, slug: null };

    var titleField = el('div', { class: 'field' }, [
      el('label', { for: 'edTitle', text: '标题' }),
      el('input', { id: 'edTitle', type: 'text', value: ed.title, required: true, maxlength: 100, oninput: updateSlug })
    ]);

    var catOptions = Object.keys(state.cfg.categories).map(function (c) {
      return el('option', { value: c, text: state.cfg.categories[c].label, selected: ed.category === c ? '' : null });
    });
    if (!catOptions.length) {
      catOptions.push(el('option', { value: '', text: '（暂无分类，请先到「分类管理」添加）' }));
    }

    var fieldRow = el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'edCategory', text: '分类' }),
        el('select', { id: 'edCategory', onChange: updateSlug }, catOptions)
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'edDate', text: '日期时间' }),
        el('input', { id: 'edDate', type: 'datetime-local', value: fmtLocalInput(ed.date), onChange: updateSlug })
      ])
    ]);

    var slugField = el('div', { class: 'field' }, [
      el('label', { for: 'edSlug', text: '文件名（自动）' }),
      el('input', { id: 'edSlug', type: 'text', readonly: true }),
      el('div', { class: 'hint', text: '由日期与标题自动生成，保存后即为 GitHub 上的文件路径' })
    ]);

    var tagsField = el('div', { class: 'field' }, [
      el('label', { for: 'edTags', text: '标签' }),
      el('input', { id: 'edTags', type: 'text', value: (ed.tags || []).join(', '), placeholder: '用逗号分隔' }),
      el('div', { class: 'hint', text: '多个标签用逗号分隔' })
    ]);

    var draftField = el('div', { class: 'field' }, [
      el('label', { for: 'edDraft', style: 'display:inline-flex;align-items:center;gap:8px;font-weight:550;color:var(--text)' }, [
        el('input', { id: 'edDraft', type: 'checkbox', checked: ed.draft ? 'checked' : null }),
        '草稿（仅自己可见，不公开显示）'
      ])
    ]);

    var imageInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    imageInput.addEventListener('change', function () {
      if (imageInput.files && imageInput.files[0]) uploadImage(imageInput.files[0]);
      imageInput.value = '';
    });

    var bodyField = el('div', { class: 'field' }, [
      el('label', { for: 'edBody', text: '正文（Markdown，支持 $LaTeX$ 公式）' }),
      buildEditorToolbar(imageInput),
      el('textarea', { id: 'edBody', 'aria-label': '正文', oninput: updatePreview }),
      el('div', { class: 'editor-status' }, [
        el('span', { id: 'edStats', text: '0 字' }),
        el('span', { class: 'hint', text: '快捷键：Ctrl+B 加粗 · Ctrl+I 斜体 · Ctrl+K 链接 · Ctrl+E 代码 · Ctrl+Shift+E 代码块 · Tab 缩进' })
      ])
    ]);

    var preview = el('div', { class: 'preview-pane', 'aria-label': '预览' }, [
      el('p', { class: 'preview-placeholder', text: '预览将在此显示…' })
    ]);

    editor.title = titleField.querySelector('#edTitle');
    editor.category = fieldRow.querySelector('#edCategory');
    editor.date = fieldRow.querySelector('#edDate');
    editor.tags = tagsField.querySelector('#edTags');
    editor.draft = draftField.querySelector('#edDraft');
    editor.body = bodyField.querySelector('#edBody');
    editor.preview = preview;
    editor.slug = slugField.querySelector('#edSlug');

    var footer = el('div', { class: 'editor-footer' }, [
      el('button', { text: '← 返回列表', onClick: function () {
        if (editor.dirty && !confirm('有未保存的修改，确定离开吗？')) return;
        state.view = 'posts';
        editor = null;
        render();
      } }),
      el('div', { class: 'spacer' }),
      ed.mode === 'edit' ? el('button', { class: 'btn-danger', text: '删除文章', onClick: function () { deletePostByPath(ed.path, ed.title); } }) : null,
      el('button', { text: '保存草稿', onClick: function () { savePost(true); } }),
      el('button', { class: 'btn-primary', text: '发布', onClick: function () { savePost(false); } })
    ]);

    var grid = el('div', { class: 'editor-grid' }, [
      el('div', { class: 'editor-pane' }, [titleField, fieldRow, slugField, tagsField, draftField, bodyField]),
      el('div', {}, [el('label', { text: '预览' }), preview])
    ]);

    els.mainContent.appendChild(el('section', { class: 'panel' }, [
      el('h2', { class: 'panel-title', text: ed.mode === 'edit' ? '编辑文章' : '新建文章' }),
      grid, footer
    ]));

    editor.body.value = ed.body;
    editor.dirty = false;
    editor.body.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      for (var i = 0; items && i < items.length; i++) {
        if (items[i].kind === 'file' && ALLOWED_IMAGE[items[i].type]) {
          e.preventDefault();
          uploadImage(items[i].getAsFile());
          return;
        }
      }
    });
    editor.body.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files[0]) {
        e.preventDefault();
        uploadImage(files[0]);
      }
    });
    editor.body.focus();
    attachEditorKeys(editor.body);
    updateSlug();
    updatePreview();
    editor.dirty = false;
  }

  function updateSlug() {
    if (!editor) return;
    editor.dirty = true;
    var ed = state.editing;
    var dateVal = editor.date.value || md.isoNow().slice(0, 10);
    var slug = md.slugify(editor.title.value) || 'post';
    editor.slug.value = dateVal.slice(0, 10) + '-' + slug;
    ed._catForSlug = editor.category.value;
  }

  function wrapSelection(ta, before, after, placeholder) {
    var s = ta.selectionStart;
    var e = ta.selectionEnd;
    var sel = ta.value.slice(s, e);
    var ins = sel ? before + sel + after : before + placeholder + after;
    ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + (sel ? before.length : before.length + placeholder.length);
    ta.focus();
    updatePreview();
  }

  function lineAction(ta, prefix) {
    var s = ta.selectionStart;
    var start = ta.value.lastIndexOf('\n', s - 1) + 1;
    var end = ta.value.indexOf('\n', s);
    if (end === -1) end = ta.value.length;
    var line = ta.value.slice(start, end);
    if (line.indexOf(prefix) === 0) {
      ta.value = ta.value.slice(0, start) + line.slice(prefix.length) + ta.value.slice(end);
    } else {
      ta.value = ta.value.slice(0, start) + prefix + line + ta.value.slice(end);
    }
    ta.selectionStart = ta.selectionEnd = Math.min(start + prefix.length + line.length, ta.value.length);
    ta.focus();
    updatePreview();
  }

  var EMOJIS = ['😀', '😂', '🤣', '😊', '😍', '😎', '🤔', '🥳', '😤', '😴', '🤗', '😇', '👍', '👎', '👏', '🙏', '💪', '🔥', '✨', '🎉', '💡', '📌', '🚀', '❤️', '🌟', '🍀', '🎯', '💯'];

  function buildEditorToolbar(imageInput) {
    var emojiPanel = el('div', { class: 'emoji-panel', hidden: '' }, EMOJIS.map(function (em) {
      return el('button', {
        type: 'button', class: 'emoji-btn', 'aria-label': em, text: em,
        onClick: function () {
          wrapSelection(editor.body, '', '', em);
        }
      });
    }));
    function wrap(before, after, placeholder, title, label) {
      return el('button', {
        type: 'button', title: title, text: label,
        onClick: function () { wrapSelection(editor.body, before, after, placeholder); }
      });
    }
    function line(prefix, title, label) {
      return el('button', {
        type: 'button', title: title, text: label,
        onClick: function () { lineAction(editor.body, prefix); }
      });
    }
    var toolbar = el('div', { class: 'editor-toolbar' }, [
      wrap('**', '**', '加粗文字', '加粗（Ctrl+B）', 'B'),
      wrap('*', '*', '斜体文字', '斜体（Ctrl+I）', 'I'),
      line('> ', '引用（>）', '❝ 引用'),
      line('- ', '无序列表（-）', '• 列表'),
      line('1. ', '有序列表（1.）', '1. 列表'),
      line('- [ ] ', '任务列表（- [ ]）', '☑ 任务'),
      wrap('`', '`', '代码', '行内代码（Ctrl+E）', '`代码`'),
      wrap('\n```\n', '\n```\n', '代码', '代码块（Ctrl+Shift+E）', '◧ 代码块'),
      wrap('[', '](https://example.com)', '链接文字', '链接（Ctrl+K）', '🔗 链接'),
      wrap('![', '](https://example.com/image.png)', '图片描述', '图片地址', '🖼 图片'),
      line('---', '分隔线', '— 分隔线'),
      wrap('\n\n| 列1 | 列2 |\n| --- | --- |\n| 内容 | 内容 |\n', '', '', '表格', '▦ 表格'),
      el('span', { class: 'toolbar-sep' }),
      el('button', {
        type: 'button', title: '插入 Emoji', text: '😀 Emoji',
        onClick: function () {
          emojiPanel.hidden = !emojiPanel.hidden;
        }
      }),
      el('button', {
        type: 'button', title: '插入图片（上传到仓库）', text: '📷 上传图片',
        onClick: function () {
          if (!state.user) { toast('请先连接 GitHub Token', 'error'); return; }
          imageInput.click();
        }
      })
    ]);
    return el('div', {}, [toolbar, emojiPanel, el('div', { class: 'hint', text: '可粘贴或拖拽图片到正文框 · 选中文字后点按钮即可包裹格式 · Ctrl+Enter 保存' })]);
  }

  function attachEditorKeys(ta) {
    ta.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'b') { e.preventDefault(); wrapSelection(ta, '**', '**', '加粗文字'); }
      else if (mod && e.key === 'i') { e.preventDefault(); wrapSelection(ta, '*', '*', '斜体文字'); }
      else if (mod && e.key === 'k') { e.preventDefault(); wrapSelection(ta, '[', '](https://example.com)', '链接文字'); }
      else if (mod && e.key === 'e' && !e.shiftKey) { e.preventDefault(); wrapSelection(ta, '`', '`', '代码'); }
      else if (mod && e.key === 'e' && e.shiftKey) { e.preventDefault(); wrapSelection(ta, '\n```\n', '\n```\n', '代码'); }
      else if (mod && e.key === 'Enter') { e.preventDefault(); savePost(editor.draft && editor.draft.checked); }
      else if (e.key === 'Tab') {
        e.preventDefault();
        wrapSelection(ta, '  ', '', '');
        ta.selectionStart = ta.selectionEnd;
      }
    });
  }

  function updatePreview() {
    if (!editor || !editor.preview) return;
    editor.dirty = true;
    var meta = {
      title: editor.title.value || '（无标题）',
      tags: editor.tags.value.split(/[,，\s]+/).filter(Boolean),
      date: editor.date.value ? fmtToIso(editor.date.value) : md.isoNow(),
      updated: state.editing.mode === 'edit' ? md.isoNow() : null,
      draft: editor.draft.checked
    };
    var content = md.buildFrontmatter(meta) + '\n' + editor.body.value;
    editor.preview.innerHTML = '<div class="preview-head"></div><div class="preview-body">' + md.render(content) + '</div>';
    var head = editor.preview.querySelector('.preview-head');
    head.appendChild(el('h3', { style: 'margin:0 0 8px', text: meta.title }));
    head.appendChild(el('div', { style: 'color:var(--text-faint);font-size:0.85em', text: md.formatDate(meta.date) + (meta.draft ? ' · 草稿' : '') }));
    var stats = document.getElementById('edStats');
    if (stats) {
      var raw = editor.body.value;
      var cjk = (raw.match(/[\u4e00-\u9fff]/g) || []).length;
      var latin = (raw.replace(/[\u4e00-\u9fff]/g, ' ').trim().match(/\S+/g) || []).length;
      stats.textContent = (cjk + latin) + ' 字 · ' + raw.length + ' 字符';
    }
  }

  var ALLOWED_IMAGE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
  var MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  function uploadImage(file, at) {
    if (!state.user) { toast('请先连接 GitHub Token 后再插入图片', 'error'); return; }
    var ext = ALLOWED_IMAGE[file.type];
    if (!ext) { toast('不支持的图片格式：' + (file.type || '未知'), 'error'); return; }
    if (file.size > MAX_IMAGE_BYTES) { toast('图片超过 5MB，请压缩后重试', 'error'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = String(reader.result);
      var base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      var now = new Date();
      var p = String(now.getFullYear()) + ('0' + (now.getMonth() + 1)).slice(-2) + ('0' + now.getDate()).slice(-2);
      var path = 'assets/images/' + p + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      var markdown = '![' + (file.name || path.split('/').pop()).replace(/[[\]()]/g, '') + '](' + path + ')';
      setBusy(true);
      toast('正在上传图片…', 'ok');
      gh.commitFiles({
        message: '[图片] ' + path.split('/').pop(),
        files: [{ path: path, content: base64 }]
      }).then(function (commit) {
        setBusy(false);
        if (editor && editor.body) {
          var pos = (typeof at === 'number' ? at : editor.body.selectionStart);
          var v = editor.body.value;
          var before = v.slice(0, pos);
          var after = v.slice(pos);
          var prefix = before && !/\n$/.test(before) ? '\n' : '';
          var suffix = after && !/^\n/.test(after) ? '\n' : '';
          editor.body.value = before + prefix + markdown + '\n' + suffix + after;
          editor.body.focus();
          updatePreview();
        }
        toast('图片已上传并插入 ✓' + (commit.sha ? '（' + commit.sha.slice(0, 7) + '）' : ''), 'ok');
      }).catch(function (err) {
        setBusy(false);
        toast('图片上传失败：' + errMsg(err), 'error');
      });
    };
    reader.readAsDataURL(file);
  }

  function fmtToIso(dt) {
    var d = new Date(dt);
    if (isNaN(d.getTime())) return md.isoNow();
    return md.isoNow(d);
  }

  function savePost(draft) {
    var ed = state.editing;
    var title = editor.title.value.trim();
    var category = editor.category.value;
    var body = editor.body.value;
    var tags = editor.tags.value.split(/[,，\s]+/).filter(Boolean);

    if (!title) { toast('请填写标题', 'error'); editor.title.focus(); return; }
    if (!category) { toast('请选择分类', 'error'); return; }
    if (!Object.prototype.hasOwnProperty.call(state.cfg.categories, category)) {
      toast('分类不存在，请先在分类页添加', 'error'); return;
    }

    var dateIso = editor.date.value ? fmtToIso(editor.date.value) : md.isoNow();
    var meta = {
      title: title,
      tags: tags,
      date: dateIso,
      updated: ed.mode === 'edit' ? md.isoNow() : null,
      draft: draft
    };

    var slug = computeSlug({ title: title, date: dateIso });
    var contentPath = 'content/' + category + '/' + slug + '.md';
    var content = md.buildFrontmatter(meta) + body;

    var posts = state.index.posts.slice();
    var oldIndex = -1;
    if (ed.mode === 'edit') {
      oldIndex = posts.findIndex(function (p) { return p.path === ed.path; });
    }

    var entry = {
      path: contentPath,
      slug: slug,
      title: title,
      category: category,
      tags: tags,
      date: dateIso,
      updated: meta.updated || null,
      excerpt: md.excerpt(content),
      draft: draft
    };
    if (!draft) entry.content = body;

    var deletes = [];
    if (ed.mode === 'edit' && ed.path !== contentPath) {
      if (oldIndex !== -1) posts.splice(oldIndex, 1);
      deletes.push(ed.path);
      posts.push(entry);
    } else if (oldIndex !== -1) {
      posts[oldIndex] = entry;
    } else {
      posts.push(entry);
    }
    posts.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var newIndex = JSON.stringify({ schema: 1, posts: posts }, null, 2) + '\n';

    var action = ed.mode === 'new' ? (draft ? '保存草稿' : '发布') : (draft ? '转为草稿' : '更新');
    setBusy(true);
    gh.commitFiles({
      message: '[' + action + '] ' + title,
      files: [
        { path: contentPath, content: content },
        { path: 'content/index.json', content: newIndex },
        { path: 'rss.xml', content: buildRss(posts) },
        { path: 'sitemap.xml', content: buildSitemap(posts) },
        { path: 'robots.txt', content: buildRobots() }
      ],
      deletes: deletes
    }).then(function (commit) {
      setBusy(false);
      state.index = { schema: 1, posts: posts };
      toast(action + '成功 ✓' + (commit.sha ? '（' + commit.sha.slice(0, 7) + '）' : ''), 'ok');
      state.view = 'posts';
      render();
    }).catch(function (err) {
      setBusy(false);
      toast('保存失败：' + errMsg(err), 'error');
    });
  }

  function deletePost(p) {
    if (!confirm('确定删除《' + p.title + '》吗？\n文件与索引都将被移除（Git 历史仍可找回）。')) return;
    deletePostByPath(p.path, p.title);
  }

  function deletePostByPath(path, title) {
    var posts = state.index.posts.filter(function (p) { return p.path !== path; });
    var newIndex = JSON.stringify({ schema: 1, posts: posts }, null, 2) + '\n';
    setBusy(true);
    gh.commitFiles({
      message: '[删除] ' + (title || path),
      files: [
        { path: 'content/index.json', content: newIndex },
        { path: 'rss.xml', content: buildRss(posts) },
        { path: 'sitemap.xml', content: buildSitemap(posts) },
        { path: 'robots.txt', content: buildRobots() }
      ],
      deletes: [path]
    }).then(function () {
      setBusy(false);
      state.index = { schema: 1, posts: posts };
      toast('已删除 ✓', 'ok');
      if (state.view === 'editor') state.view = 'posts';
      render();
    }).catch(function (err) {
      setBusy(false);
      toast('删除失败：' + errMsg(err), 'error');
    });
  }

  /* ---------- 分类管理 ---------- */
  function renderCategories() {
    var panel = el('section', { class: 'panel' }, [
      el('h2', { class: 'panel-title', text: '分类管理' }),
      addCategoryForm()
    ]);

    var rows = Object.keys(state.cfg.categories).map(function (key) {
      var c = state.cfg.categories[key];
      var count = state.index.posts.filter(function (p) { return p.category === key; }).length;
      return categoryRow(key, c, count);
    });

    var listPanel = el('section', { class: 'panel' }, [
      el('h2', { class: 'panel-title', text: '分类列表' }),
      el('div', { class: 'cat-head' }, [
        el('div', { text: '图标' }),
        el('div', { class: 'cat-label-s', text: 'ID / 名称' }),
        el('div', { text: '描述' }),
        el('div', { text: '文章数' }),
        el('div', {})
      ]),
      rows.length ? rows : el('div', { class: 'notice notice-info', text: '还没有分类，先添加一个。' })
    ]);

    els.mainContent.appendChild(panel);
    els.mainContent.appendChild(listPanel);
  }

  function addCategoryForm() {
    var nameInput = el('input', { type: 'text', placeholder: '分类 id（小写字母/数字/-/_）', id: 'newCatName', 'aria-label': '分类 id' });
    var labelInput = el('input', { type: 'text', placeholder: '显示名称', id: 'newCatLabel', 'aria-label': '显示名称' });
    var iconInput = el('input', { type: 'text', placeholder: '图标（可选）', id: 'newCatIcon', maxlength: 8, 'aria-label': '图标' });
    var descInput = el('input', { type: 'text', placeholder: '描述（可选）', id: 'newCatDesc', 'aria-label': '描述' });

    return el('div', { class: 'panel-toolbar' }, [
      nameInput, labelInput, iconInput, descInput,
      el('button', { class: 'btn-primary', text: '添加', onClick: function () {
        addCategory(nameInput.value.trim(), labelInput.value.trim(), iconInput.value.trim(), descInput.value.trim());
      } })
    ]);
  }

  function categoryRow(key, c, count) {
    var idText = el('span', { text: key, class: 'cat-id' });
    var labelInput = el('input', { type: 'text', value: c.label || key, 'aria-label': '显示名称' });
    var iconInput = el('input', { type: 'text', value: c.icon || '', maxlength: 8, 'aria-label': '图标' });
    var descInput = el('input', { type: 'text', value: c.description || '', 'aria-label': '描述' });

    return el('div', { class: 'cat-row' }, [
      el('div', { class: 'cat-icon', text: c.icon || '📁' }),
      el('div', { class: 'cat-label-c' }, [idText]),
      el('div', { class: 'cat-desc', style: 'min-width:0' }, [
        el('label', { for: 'catLabel-' + key, style: 'font-size:0.75em', text: '名称' }),
        labelInput,
        el('label', { for: 'catDesc-' + key, style: 'font-size:0.75em;margin-top:4px', text: '描述' }),
        descInput
      ]),
      el('div', { class: 'cat-count', text: String(count) }),
      el('div', { class: 'cat-actions' }, [
        el('button', { text: '保存', onClick: function () {
          saveCategory(key, labelInput.value.trim(), iconInput.value.trim(), descInput.value.trim());
        } }),
        el('button', { class: 'btn-danger', text: '删除', onClick: function () { deleteCategory(key, count); } })
      ])
    ]);
  }

  function addCategory(key, label, icon, desc) {
    if (!/^[a-z0-9_-]{2,32}$/.test(key)) { toast('分类 id 需为 2~32 位小写字母/数字/-/_', 'error'); return; }
    if (!label) label = key;
    if (state.cfg.categories[key]) { toast('分类 ' + key + ' 已存在', 'error'); return; }
    state.cfg.categories[key] = { label: label, icon: icon, description: desc };
    saveConfig('添加分类 ' + key, function () {
      render();
    });
  }

  function saveCategory(key, label, icon, desc) {
    if (!label) { toast('显示名称不能为空', 'error'); return; }
    state.cfg.categories[key] = { label: label, icon: icon, description: desc };
    saveConfig('更新分类 ' + key, function () {
      render();
    });
  }

  function deleteCategory(key, count) {
    if (count > 0) { toast('该分类下还有 ' + count + ' 篇文章，无法删除', 'error'); return; }
    if (!confirm('确定删除分类「' + state.cfg.categories[key].label + '」吗？')) return;
    delete state.cfg.categories[key];
    saveConfig('删除分类 ' + key, function () {
      render();
    });
  }

  function saveConfig(message, done) {
    var content = JSON.stringify(state.cfg, null, 2) + '\n';
    setBusy(true);
    gh.commitFiles({
      message: message,
      files: [
        { path: 'config.json', content: content },
        { path: 'rss.xml', content: buildRss() },
        { path: 'sitemap.xml', content: buildSitemap() },
        { path: 'robots.txt', content: buildRobots() }
      ]
    }).then(function () {
      setBusy(false);
      toast('已保存 ✓', 'ok');
      if (done) done();
    }).catch(function (err) {
      setBusy(false);
      toast('保存失败：' + errMsg(err), 'error');
    });
  }

  /* ---------- 设置 ---------- */
  function renderSettings() {
    var site = state.cfg.site;
    var g = state.cfg.github;

    var titleInput = el('input', { type: 'text', value: site.title || '', id: 'setTitle', maxlength: 60 });
    var subtitleInput = el('input', { type: 'text', value: site.subtitle || '', id: 'setSubtitle', maxlength: 200 });
    var footerInput = el('input', { type: 'text', value: site.footer || '', id: 'setFooter', maxlength: 200 });
    var urlInput = el('input', {
      type: 'url', value: site.url || '', id: 'setUrl', maxlength: 200,
      placeholder: 'https://<用户名>.github.io/<仓库>/（默认自动推导）'
    });
    var comments = state.cfg.comments || {};
    var commentsOn = el('input', { type: 'checkbox', id: 'setComments', checked: comments.enabled ? 'checked' : null });
    var commentsLabel = el('input', { type: 'text', id: 'setCommentsLabel', value: comments.label || '评论', maxlength: 30 });

    var saveBtn = el('button', { class: 'btn-primary', text: '保存设置', onClick: function () {
      if (!titleInput.value.trim()) { toast('站点标题不能为空', 'error'); return; }
      site.title = titleInput.value.trim();
      site.subtitle = subtitleInput.value.trim();
      site.footer = footerInput.value.trim();
      site.url = urlInput.value.trim();
      state.cfg.comments = { enabled: commentsOn.checked, label: commentsLabel.value.trim() || '评论' };
      saveConfig('更新站点设置', function () {
        renderSettings();
      });
    } });

    els.mainContent.appendChild(el('section', { class: 'panel' }, [
      el('h2', { class: 'panel-title', text: '站点设置' }),
      el('div', { class: 'field' }, [el('label', { for: 'setTitle', text: '站点标题' }), titleInput]),
      el('div', { class: 'field' }, [el('label', { for: 'setSubtitle', text: '副标题' }), subtitleInput]),
      el('div', { class: 'field' }, [el('label', { for: 'setUrl', text: '站点地址（RSS 链接用）' }), urlInput]),
      el('div', { class: 'field' }, [el('label', { for: 'setFooter', text: '页脚文字' }), footerInput]),
      el('div', { class: 'field' }, [el('label', { for: 'setComments', text: '启用评论（GitHub Issues）' }), commentsOn]),
      el('div', { class: 'field' }, [el('label', { for: 'setCommentsLabel', text: '评论标签' }), commentsLabel]),
      el('div', { class: 'hint', text: '评论基于 GitHub Issues：读者用 GitHub 账号在对应 Issue 下回复，公开仓库匿名可读，无需任何第三方服务。' }),
      saveBtn
    ]));

    els.mainContent.appendChild(el('section', { class: 'panel' }, [
      el('h2', { class: 'panel-title', text: '仓库信息' }),
      el('div', { class: 'field' }, [
        el('div', { class: 'hint', text: '以下信息来自已连接的仓库，如需修改请直接更新 config.json。' }),
        el('div', { class: 'repo-badge', style: 'display:inline-block;margin-top:8px', text: g.owner + '/' + g.repo + ' @' + g.branch })
      ]),
      state.user ? el('div', { class: 'field' }, [
        el('label', { text: '当前登录用户' }),
        el('div', { text: state.user.login + '（' + state.user.name + '）' })
      ]) : null
    ]));
  }

  /* ---------- 启动 ---------- */
  function boot() {
    fetch('../config.json').then(function (res) {
      if (!res.ok) throw new Error();
      return res.json();
    }).then(function (cfg) {
      if (cfg && cfg.github) {
        gh.config({ owner: cfg.github.owner, repo: cfg.github.repo, branch: cfg.github.branch || 'main' });
      }
    }).catch(function () {}).then(function () {
      var t = gh.snapshot();
      if (t.owner && t.repo) {
        els.connectTargetText.textContent = t.owner + '/' + t.repo + ' @' + (t.branch || 'main');
        els.connectTarget.hidden = false;
      }
    });
    showConnect();
  }

  boot();
})();
