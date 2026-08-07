(function () {
  'use strict';

  var DEFAULT_CONFIG = function () {
    var snap = gh.snapshot();
    return {
      schema: 1,
      site: { title: 'Real Life Notes', subtitle: '', author: '', footer: 'Powered by Real Life Notes', url: '' },
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
    integrity: null,
    emptyRepo: false,
    sourceRepo: null,
    listSel: {}
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
    repoWarn: document.getElementById('repoWarn'),
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
    return '';
  }

  function absUrl(path) {
    var base = siteBaseUrl();
    return base ? base + '/' + path : path;
  }

  function absolutizeRss(html) {
    return String(html)
      .replace(/src="(?!https?:|data:|#)([^"]+)"/gi, function (m, u) { return 'src="' + escXml(absUrl(u)) + '"'; })
      .replace(/href="(?!https?:|mailto:|#)([^"]+)"/gi, function (m, u) { return 'href="' + escXml(absUrl(u)) + '"'; });
  }

  function homeUrl() {
    var base = siteBaseUrl();
    return base ? base + '/' : 'index.html';
  }

  function publicUrl(path) {
    var base = siteBaseUrl();
    return base ? base + '/' + path : '../' + path;
  }

  /* 当前仓库标记：state.cfg.github 始终等于所连接仓库（fetchRepoConfig 强制同步）。
     检测站点链接实际指向的仓库与当前仓库是否一致。
     站点地址已配置时：能解析出 github.io owner/repo 就比对；自定义域名无法判定则信任用户配置。
     未配置站点地址时：链接是相对路径，落在后台所在站点（state.sourceRepo），与之比对。 */
  function repoMismatch() {
    var g = (state.cfg || {}).github || {};
    if (!g.owner || !g.repo) return null;
    var url = ((state.cfg || {}).site || {}).url || '';
    var cur = g.owner.toLowerCase() + '/' + g.repo.toLowerCase();
    if (url) {
      var m = url.match(/github\.io\/([^/]+)\/([^/?]+)/);
      if (m && (m[1].toLowerCase() + '/' + m[2].toLowerCase()) !== cur) {
        return '站点地址指向了其他仓库（' + m[1] + '/' + m[2] + '），而当前管理的是 ' + g.owner + '/' + g.repo + '。请到「设置」中改为当前仓库的站点地址。';
      }
      return null;
    }
    var sr = state.sourceRepo;
    if (sr && (sr.owner.toLowerCase() + '/' + sr.repo.toLowerCase()) !== cur) {
      return '当前后台所在站点属于仓库 ' + sr.owner + '/' + sr.repo + '，不是当前管理的 ' + g.owner + '/' + g.repo + '。预览链接将指向错误仓库。请到该仓库部署的站点使用后台，或在「设置」中填写正确的站点地址。';
    }
    return null;
  }

  var repoWarnDismissed = false;
  function updateRepoWarn() {
    if (!els.repoWarn) return;
    var m = repoWarnDismissed ? null : repoMismatch();
    els.repoWarn.textContent = '';
    els.repoWarn.hidden = !m;
    if (m) {
      els.repoWarn.appendChild(el('span', { text: m }));
      var close = el('button', {
        class: 'repo-warn-close', type: 'button', 'aria-label': '关闭提醒', text: '✕',
        onClick: function () { repoWarnDismissed = true; updateRepoWarn(); }
      });
      els.repoWarn.appendChild(close);
    }
  }

  function assertRepoTargets() {
    var m = repoMismatch();
    if (m) { toast(m, 'error'); return false; }
    return true;
  }

  function buildRss(list) {
    var site = state.cfg.site || {};
    var base = siteBaseUrl();
    var published = (list || state.index.posts || []).filter(function (p) { return !p.draft; })
      .slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); })
      .slice(0, 20);
    var items = published.map(function (p) {
      var link = absUrl('post.html?p=' + encodeURIComponent(p.path));
      var pub = (function () { var d = new Date(p.date); return isNaN(d.getTime()) ? '' : d.toUTCString(); })();
      var cats = [];
      var catKey = p.category || '';
      if (catKey && state.cfg.categories[catKey]) cats.push('<category>' + escXml(state.cfg.categories[catKey].label) + '</category>');
      (p.tags || []).forEach(function (t) { cats.push('<category>' + escXml(t) + '</category>'); });
      var desc = typeof p.content === 'string' && p.content.trim() ? absolutizeRss(md.render(p.content)) : (p.excerpt || '');
      return '  <item>\n' +
        '    <title>' + escXml(p.title) + '</title>\n' +
        '    <link>' + escXml(link) + '</link>\n' +
        '    <guid isPermaLink="false">' + escXml(p.path + '@' + (p.updated || p.date)) + '</guid>\n' +
        '    <pubDate>' + pub + '</pubDate>\n' +
        (site.author ? '    <author>' + escXml(site.author) + '</author>\n' : '') +
        cats.join('\n') + (cats.length ? '\n' : '') +
        '    <description><![CDATA[' + desc + ']]></description>\n' +
        '  </item>';
    }).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
      '<channel>\n' +
      '  <title>' + escXml(site.title || '') + '</title>\n' +
      '  <link>' + escXml(homeUrl()) + '</link>\n' +
      '  <description>' + escXml(site.subtitle || '') + '</description>\n' +
      '  <atom:link href="' + escXml(absUrl('content/rss.xml')) + '" rel="self" type="application/rss+xml"/>\n' +
      '  <lastBuildDate>' + new Date().toUTCString() + '</lastBuildDate>\n' +
      items + '\n' +
      '</channel>\n</rss>\n';
  }

  function buildSitemap(list) {
    var published = (list || state.index.posts || []).filter(function (p) { return !p.draft; });
    var urls = published.map(function (p) {
      var lastmod = (p.updated || p.date || '').slice(0, 10);
      return '  <url>\n' +
        '    <loc>' + escXml(absUrl('post.html?p=' + encodeURIComponent(p.path))) + '</loc>\n' +
        (lastmod ? '    <lastmod>' + escXml(lastmod) + '</lastmod>\n' : '') +
        '  </url>';
    }).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      '  <url>\n    <loc>' + escXml(homeUrl()) + '</loc>\n  </url>\n' +
      '  <url>\n    <loc>' + escXml(absUrl('index.html?view=archive')) + '</loc>\n  </url>\n' +
      '  <url>\n    <loc>' + escXml(absUrl('index.html?view=tags')) + '</loc>\n  </url>\n' +
      (urls ? urls + '\n' : '') +
      '</urlset>\n';
  }

  function buildRobots() {
    return 'User-agent: *\n' +
      'Allow: /\n\n' +
      'Sitemap: ' + absUrl('content/sitemap.xml') + '\n';
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

  function parseRepoAddress(addr) {
    var s = String(addr || '').trim().replace(/\/+$/, '');
    if (!s) return null;
    if (s.indexOf('://') !== -1) {
      s = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/]+)\//, '');
      if (s.indexOf('://') !== -1) return null;
    } else if (s.indexOf('@') !== -1 && s.indexOf(':') !== -1) {
      s = s.slice(s.lastIndexOf(':') + 1);
    }
    var parts = s.split('/').filter(function (x) { return x.length; });
    if (parts.length < 2) return null;
    var owner = parts[0];
    var repo = parts[1].replace(/\.git$/, '');
    var branch = null;
    if (parts.length >= 4 && parts[2] === 'tree' && parts[3]) branch = parts[3];
    if (!owner || !repo || owner === 'github.com' || owner === 'www.github.com') return null;
    return { owner: owner, repo: repo, branch: branch };
  }

  function connect(token, repoAddr) {
    setBusy(true);
    els.connectError.hidden = true;
    gh.config({ token: token });
    var parsed = parseRepoAddress(repoAddr);
    if (parsed) {
      gh.config({ owner: parsed.owner, repo: parsed.repo });
      if (parsed.branch) gh.config({ branch: parsed.branch });
    }
    gh.getUser().then(function (user) {
      state.user = user;
      els.connectMeta.textContent = '已登录：' + user.login;
      els.connectMeta.hidden = false;
      return gh.getRepo().then(function (repo) {
        if (!parsed || !parsed.branch) gh.config({ branch: repo.default_branch });
        return gh.getBranchRef().then(function (ref) {
          state.emptyRepo = !ref;
          return Promise.all([
            fetchRepoConfig(),
            fetchRepoIndex()
          ]);
        });
      });
    }).then(function () {
      setBusy(false);
      writeSession('adminToken', token);
      writeSession('adminRepo', repoAddr || '');
      storeCredential(token);
      els.connectView.hidden = true;
      els.workspace.hidden = false;
      els.repoBadge.hidden = false;
      els.repoBadge.textContent = state.cfg.github.owner + '/' + state.cfg.github.repo + ' @' + state.cfg.github.branch;
      if (state.emptyRepo) {
        state.view = 'settings';
        toast('检测到空仓库，请先一键初始化再发布内容', 'ok');
      }
      updateRepoWarn();
      render();
    }).catch(function (err) {
      setBusy(false);
      gh.config({ token: null });
      state.token = null;
      els.connectError.textContent = errMsg(err);
      els.connectError.hidden = false;
    });
  }

  function readSession(key) {
    try { return sessionStorage.getItem(key) || ''; } catch (e) { return ''; }
  }
  function writeSession(key, val) {
    try { sessionStorage.setItem(key, val); } catch (e) {}
  }
  function clearSession() {
    try { sessionStorage.removeItem('adminToken'); sessionStorage.removeItem('adminRepo'); } catch (e) {}
  }

  function storeCredential(token) {
    // 通过 Credential Management API 主动触发浏览器的「保存密码」提示（仅在 HTTPS 下可用）。
    // 纯 SPA + preventDefault 时，浏览器原生启发式不会弹出保存框，必须显式调用 store()。
    if (!state.user || !window.PasswordCredential) return;
    if (!navigator.credentials || !navigator.credentials.store) return;
    try {
      var cred = new PasswordCredential({ id: state.user.login, password: token });
      navigator.credentials.store(cred).catch(function () {});
    } catch (e) { /* 浏览器不支持或策略拒绝时静默忽略 */ }
  }

  function fetchRepoConfig() {
    return gh.getContent('content/config.json').then(function (text) {
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
    clearSession();
    showConnect();
  }

  els.connectForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var token = els.connectForm.elements.adminToken.value.trim();
    if (!token) return;
    var addr = els.connectForm.elements.adminRepo.value.trim();
    var parsed = addr ? parseRepoAddress(addr) : null;
    // 预填隐藏的用户名字段（密码管理器把 Token 存到该用户名下，保存提示才会弹出）
    var userEl = els.connectForm.elements.adminUser;
    if (userEl) userEl.value = (parsed && parsed.owner) || 'github';
    connect(token, addr);
  });

  var repoHint = document.getElementById('connectRepoHint');
  var repoHintTimer = null;
  els.connectForm.elements.adminRepo.addEventListener('input', function () {
    clearTimeout(repoHintTimer);
    repoHintTimer = setTimeout(function () {
      var addr = els.connectForm.elements.adminRepo.value.trim();
      var parsed = addr ? parseRepoAddress(addr) : null;
      if (addr && parsed) {
        repoHint.textContent = '已识别：' + parsed.owner + ' / ' + parsed.repo +
          (parsed.branch ? '  @' + parsed.branch : '');
        repoHint.hidden = false;
      } else if (addr) {
        repoHint.textContent = '无法识别为 GitHub 仓库地址';
        repoHint.hidden = false;
      } else {
        repoHint.hidden = true;
      }
    }, 200);
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
    updateRepoWarn();
  }

  function sortedPosts() {
    return state.index.posts.slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });
  }

  function wordCount(text) {
    var cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    var latin = (text.replace(/[\u4e00-\u9fff]/g, ' ').trim().match(/\S+/g) || []).length;
    return cjk + latin;
  }

  /* ---------- 文章列表 ---------- */
  var listFilter = { cat: '', q: '', status: 'all' };
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
      if (listFilter.status === 'pub' && p.draft) return false;
      if (listFilter.status === 'draft' && !p.draft) return false;
      if (listFilter.status === 'pin' && !p.pinned) return false;
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
      el('select', {
        'aria-label': '按状态过滤',
        value: listFilter.status,
        onChange: function (e) { listFilter.status = e.target.value; renderPosts(); }
      }, ['all', 'pub', 'draft', 'pin'].map(function (s) {
        var label = { all: '全部状态', pub: '已发布', draft: '草稿', pin: '置顶' }[s];
        return el('option', { value: s, text: label, selected: listFilter.status === s ? '' : null });
      })),
      filterInputElement(),
      el('div', { class: 'spacer' }),
      el('button', { text: '完整性检查', onClick: checkIntegrity }),
      el('span', { class: 'repo-badge', style: 'font-size:0.85em', text: '共 ' + posts.length + ' 篇' })
    ]);

    var body;
    if (state.emptyRepo) {
      els.mainContent.appendChild(el('div', { class: 'notice notice-error' }, [
        el('strong', { text: '这是一个空仓库。' }),
        el('span', { text: ' 发布文章前需要先初始化（把本站程序文件提交进来）。' }),
        el('button', { class: 'btn-primary', style: 'margin-left:8px', text: '去初始化 →', onClick: function () { state.view = 'settings'; render(); } })
      ]));
    }
    if (state.integrity && state.integrity.length) {
      els.mainContent.appendChild(el('div', { class: 'notice notice-error' }, [
        el('strong', { text: '以下索引中的文件缺失：' }),
        state.integrity.map(function (p) { return el('div', { class: 'integrity-item', text: p }); })
      ]));
    }
    if (!posts.length) {
      body = el('div', { class: 'notice notice-info', text: '还没有文章。点击「新建文章」开始记录。' });
    } else {
      var selCount = Object.keys(state.listSel).length;
      var allChecked = posts.length > 0 && posts.every(function (p) { return state.listSel[p.path]; });
      var bulkBar = selCount ? el('div', { class: 'bulk-bar' }, [
        el('span', { class: 'bulk-count', text: '已选 ' + selCount + ' 篇' }),
        el('button', { text: '批量发布', onClick: function () { bulkAction(Object.keys(state.listSel), 'publish'); } }),
        el('button', { text: '批量存草稿', onClick: function () { bulkAction(Object.keys(state.listSel), 'draft'); } }),
        el('label', { text: '移动到分类', style: 'display:inline-flex;align-items:center;gap:4px' }, [
          el('select', {
            id: 'bulkMoveCat', 'aria-label': '选择目标分类',
            value: '',
            onChange: function () { bulkBar.dataset.movedone = '1'; }
          }, cats.map(function (c) {
            return el('option', { value: c, text: state.cfg.categories[c].label || c });
          }))
        ]),
        el('button', { text: '移动', onClick: function () {
          var sel = document.getElementById('bulkMoveCat');
          if (!sel || !sel.value) { toast('请先选择目标分类', 'error'); return; }
          bulkMoveCategory(Object.keys(state.listSel), sel.value);
        } }),
        el('button', { class: 'btn-danger', text: '批量删除', onClick: function () { bulkAction(Object.keys(state.listSel), 'delete'); } }),
        el('span', { class: 'spacer' }),
        el('button', { text: '取消选择', onClick: function () { state.listSel = {}; renderPosts(); } })
      ]) : null;

      var rows = posts.map(function (p) {
        var catLabel = (state.cfg.categories[p.category] || {}).label || p.category;
        return el('tr', {}, [
          el('td', {}, [
            el('input', {
              type: 'checkbox', 'aria-label': '选择《' + p.title + '》',
              checked: state.listSel[p.path] ? '' : null,
              onChange: function (e) {
                if (e.target.checked) state.listSel[p.path] = true;
                else delete state.listSel[p.path];
                renderPosts();
              }
            })
          ]),
          el('td', { class: 'row-title' }, [
            p.title,
            p.pinned ? el('span', { class: 'pin-badge', text: '置顶' }) : null,
            p.draft ? el('span', { class: 'draft-badge', text: '草稿' }) : null
          ]),
          el('td', { text: catLabel }),
          el('td', {}, [
            el('span', { text: md.formatDate(p.date) }),
            p.updated && !p.draft ? el('span', { class: 'status-pub', text: ' · 已更新' }) : null
          ]),
          el('td', { text: (typeof p.content === 'string' && p.content.trim()) ? wordCount(p.content) + ' 字' : '' }),
          el('td', {}, [
            el('span', { class: p.draft ? 'status-draft' : 'status-pub', text: p.draft ? '草稿' : '已发布' })
          ]),
          el('td', { class: 'row-actions' }, [
            el('button', { text: '编辑', onClick: function () { startEditPost(p); } }),
            p.draft ? null : el('button', { text: '查看', onClick: function () { if (!assertRepoTargets()) return; window.open(publicUrl('post.html?p=' + encodeURIComponent(p.path)), '_blank'); } }),
            el('button', { class: 'btn-danger', text: '删除', onClick: function () { deletePost(p); } })
          ])
        ]);
      });
      body = el('div', {}, [
        bulkBar,
        el('table', { class: 'posts-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', {}, [
              el('input', {
                type: 'checkbox', 'aria-label': '全选当前列表',
                checked: allChecked ? '' : null,
                onChange: function (e) {
                  state.listSel = {};
                  if (e.target.checked) {
                    posts.forEach(function (p) { state.listSel[p.path] = true; });
                  }
                  renderPosts();
                }
              })
            ]),
            el('th', { text: '标题' }), el('th', { text: '分类' }),
            el('th', { text: '日期' }), el('th', { text: '字数' }), el('th', { text: '状态' }), el('th', {})
          ])]),
          el('tbody', {}, rows)
        ])
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
      return gh.getContent(p.path).then(function (text) {
        // 顺带补全正文，供列表字数统计使用（草稿/旧索引缺少 content 时也能显示）
        var parsed = md.parseFrontmatter(text);
        p.content = parsed.body;
        return null;
      }).catch(function () { return p.path; });
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
      date: md.isoNow(), tags: [], draft: false, pinned: false, body: ''
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
        pinned: parsed.meta.pinned !== undefined ? parsed.meta.pinned : !!p.pinned,
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
      el('input', { id: 'edTags', type: 'text', value: (ed.tags || []).join(', '), placeholder: '用逗号分隔', oninput: markDirty }),
      el('div', { class: 'hint', text: '多个标签用逗号分隔' })
    ]);

    var draftField = el('div', { class: 'field' }, [
      el('label', { for: 'edDraft', style: 'display:inline-flex;align-items:center;gap:8px;font-weight:550;color:var(--text)' }, [
        el('input', { id: 'edDraft', type: 'checkbox', checked: ed.draft ? 'checked' : null, onChange: markDirty }),
        '草稿（仅自己可见，不公开显示）'
      ]),
      el('label', { for: 'edPinned', style: 'display:inline-flex;align-items:center;gap:8px;font-weight:550;color:var(--text)' }, [
        el('input', { id: 'edPinned', type: 'checkbox', checked: ed.pinned ? 'checked' : null, onChange: markDirty }),
        '置顶（列表与归档优先展示）'
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
    editor.pinned = draftField.querySelector('#edPinned');
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
      el('div', { class: 'preview-wrap' }, [el('label', { text: '预览' }), preview])
    ]);

    els.mainContent.appendChild(el('section', { class: 'panel' }, [
      el('h2', { class: 'panel-title', text: ed.mode === 'edit' ? '编辑文章' : '新建文章' }),
      grid, footer
    ]));

    editor.body.value = ed.body;
    editor.dirty = false;
    autoGrowTextarea(editor.body);
    editor.body.addEventListener('input', function () { autoGrowTextarea(editor.body); });
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

  function markDirty() {
    if (editor) editor.dirty = true;
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

  function autoGrowTextarea(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
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

  function closeAllMenus() {
    document.querySelectorAll('.menu-dropdown').forEach(function (dd) { dd.hidden = true; });
    document.querySelectorAll('.menu-trigger.open').forEach(function (b) { b.classList.remove('open'); });
  }

  function buildMenuButton(label, items) {
    var dd = el('div', { class: 'menu-dropdown', hidden: '', role: 'menu' });
    dd.addEventListener('click', function (e) { e.stopPropagation(); });
    items.forEach(function (it) {
      if (it === 'sep') { dd.appendChild(el('div', { class: 'menu-sep' })); return; }
      if (it.emoji) {
        dd.appendChild(el('div', { class: 'menu-emoji-grid' }, EMOJIS.map(function (em) {
          return el('button', {
            type: 'button', class: 'emoji-btn', 'aria-label': em, text: em,
            onClick: function () { closeAllMenus(); wrapSelection(editor.body, '', '', em); }
          });
        })));
        return;
      }
      dd.appendChild(el('button', {
        type: 'button',
        class: it.cls ? ('menu-action ' + it.cls) : 'menu-action',
        role: 'menuitem',
        title: it.title || '',
        text: it.label,
        onClick: function () { closeAllMenus(); it.onClick(); }
      }));
    });
    var trigger = el('button', {
      type: 'button', class: 'menu-trigger', text: label, 'aria-haspopup': 'menu',
      onClick: function (e) {
        e.stopPropagation();
        var willOpen = dd.hidden;
        closeAllMenus();
        if (willOpen) { dd.hidden = false; trigger.classList.add('open'); }
      }
    });
    return el('div', { class: 'menu' }, [trigger, dd]);
  }

  function buildEditorToolbar(imageInput) {
    var toolbar = el('div', { class: 'editor-menubar', role: 'menubar' }, [
      buildMenuButton('格式', [
        { label: 'B', cls: 'menu-bold', title: '加粗（Ctrl+B）', onClick: function () { wrapSelection(editor.body, '**', '**', '加粗文字'); } },
        { label: 'I', cls: 'menu-italic', title: '斜体（Ctrl+I）', onClick: function () { wrapSelection(editor.body, '*', '*', '斜体文字'); } },
        { label: 'S', cls: 'menu-strike', title: '删除线', onClick: function () { wrapSelection(editor.body, '~~', '~~', '删除线文字'); } },
        { label: '`code`', cls: 'menu-mono', title: '行内代码（Ctrl+E）', onClick: function () { wrapSelection(editor.body, '`', '`', '代码'); } },
        'sep',
        { label: '🔗 链接', title: '插入链接（Ctrl+K）', onClick: function () { wrapSelection(editor.body, '[', '](https://example.com)', '链接文字'); } },
        { label: '🖼 图片', title: '插入图片地址', onClick: function () { wrapSelection(editor.body, '![', '](https://example.com/image.png)', '图片描述'); } }
      ]),
      buildMenuButton('段落', [
        { label: '❝ 引用', title: '引用（>）', onClick: function () { lineAction(editor.body, '> '); } },
        { label: '• 无序列表', title: '无序列表（-）', onClick: function () { lineAction(editor.body, '- '); } },
        { label: '1. 有序列表', title: '有序列表（1.）', onClick: function () { lineAction(editor.body, '1. '); } },
        { label: '☑ 任务列表', title: '任务列表（- [ ]）', onClick: function () { lineAction(editor.body, '- [ ] '); } },
        'sep',
        { label: '— 分隔线', title: '插入分隔线', onClick: function () { wrapSelection(editor.body, '\n\n---\n\n', '', ''); } },
        { label: '▦ 表格', title: '插入表格', onClick: function () { wrapSelection(editor.body, '\n\n| 列1 | 列2 |\n| --- | --- |\n| 内容 | 内容 |\n', '', ''); } },
        { label: '◧ 代码块', title: '代码块（Ctrl+Shift+E）', onClick: function () { wrapSelection(editor.body, '\n```\n', '\n```\n', '代码'); } }
      ]),
      buildMenuButton('插入', [
        { label: '📷 上传图片', title: '上传图片到仓库', onClick: function () {
          if (!state.user) { toast('请先连接 GitHub Token', 'error'); return; }
          imageInput.click();
        } },
        'sep',
        { emoji: true }
      ])
    ]);
    return el('div', {}, [toolbar, el('div', { class: 'hint', text: '可粘贴或拖拽图片到正文框 · 选中文字后点菜单即可包裹格式 · Ctrl+Enter 或 Ctrl+S 保存' })]);
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
      else if (mod && e.key === 's') { e.preventDefault(); savePost(editor.draft && editor.draft.checked); }
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
    // 预览页位于 /admin/ 下，相对路径图片要相对站点根解析（../content/images/...），绝对路径不动
    Array.prototype.forEach.call(editor.preview.querySelectorAll('.preview-body img'), function (img) {
      var src = img.getAttribute('src');
      if (src && !/^(https?:|data:|blob:|\/)/i.test(src)) {
        img.setAttribute('src', '../' + src);
      }
    });
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
      var path = 'content/images/' + p + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      var markdown = '![' + (file.name || path.split('/').pop()).replace(/[[\]()]/g, '') + '](' + path + ')';
      setBusy(true);
      toast('正在上传图片…', 'ok');
      gh.commitFiles({
        message: '[图片] ' + path.split('/').pop(),
        files: [{ path: path, content: base64, binary: true }]
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
    if (!assertRepoTargets()) return;
    var ed = state.editing;
    var title = editor.title.value.trim();
    var category = editor.category.value;
    var body = editor.body.value;
    var tags = editor.tags.value.split(/[,，\s]+/).filter(Boolean);

    if (!title) { toast('请填写标题', 'error'); editor.title.focus(); return; }
    if (!category) { toast('请选择分类', 'error'); return; }
    if (state.emptyRepo) { toast('请先在「设置」中一键初始化仓库', 'error'); return; }
    if (!Object.prototype.hasOwnProperty.call(state.cfg.categories, category)) {
      toast('分类不存在，请先在分类页添加', 'error'); return;
    }

    var dateIso = editor.date.value ? fmtToIso(editor.date.value) : md.isoNow();
    var pinned = !!(editor.pinned && editor.pinned.checked);
    var meta = {
      title: title,
      tags: tags,
      date: dateIso,
      updated: ed.mode === 'edit' ? md.isoNow() : null,
      draft: draft,
      pinned: pinned
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
      draft: draft,
      pinned: pinned
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
        { path: 'content/rss.xml', content: buildRss(posts) },
        { path: 'content/sitemap.xml', content: buildSitemap(posts) },
        { path: 'content/robots.txt', content: buildRobots() }
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
        { path: 'content/rss.xml', content: buildRss(posts) },
        { path: 'content/sitemap.xml', content: buildSitemap(posts) },
        { path: 'content/robots.txt', content: buildRobots() }
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

  function bulkAction(paths, action) {
    var selected = state.index.posts.filter(function (p) { return paths.indexOf(p.path) !== -1; });
    if (!selected.length) return;
    var label = action === 'delete' ? '删除' : (action === 'draft' ? '转为草稿' : '批量发布');
    if (!confirm('确定' + label + '所选 ' + selected.length + ' 篇文章吗？')) return;

    var ensureBody = function (p) {
      if (typeof p.content === 'string') return Promise.resolve(p.content);
      return gh.getContent(p.path).catch(function () { return ''; });
    };

    setBusy(true);
    Promise.all(selected.map(ensureBody)).then(function (bodies) {
      var posts = state.index.posts.map(function (p) {
        var i = paths.indexOf(p.path);
        if (i === -1) return p;
        if (action === 'delete') return null;
        var body = bodies[i] || '';
        var meta = { title: p.title, tags: p.tags || [], date: p.date, updated: p.updated, draft: action === 'draft', pinned: !!p.pinned };
        var content = md.buildFrontmatter(meta) + body;
        return {
          path: p.path, slug: p.slug, title: p.title, category: p.category, tags: p.tags || [],
          date: p.date, updated: action === 'draft' ? p.updated : md.isoNow(),
          excerpt: md.excerpt(content), draft: action === 'draft', pinned: !!p.pinned,
          content: action === 'draft' ? undefined : body
        };
      }).filter(Boolean);

      var newIndex = JSON.stringify({ schema: 1, posts: posts }, null, 2) + '\n';
      var files = [
        { path: 'content/index.json', content: newIndex },
        { path: 'content/rss.xml', content: buildRss(posts) },
        { path: 'content/sitemap.xml', content: buildSitemap(posts) },
        { path: 'content/robots.txt', content: buildRobots() }
      ];
      var deletes = action === 'delete' ? paths : [];
      return gh.commitFiles({
        message: '[' + label + '] 共 ' + selected.length + ' 篇',
        files: files,
        deletes: deletes
      }).then(function () {
        setBusy(false);
        state.index = { schema: 1, posts: posts };
        state.listSel = {};
        toast(label + '完成 ✓', 'ok');
        render();
      });
    }).catch(function (err) {
      setBusy(false);
      toast(label + '失败：' + errMsg(err), 'error');
    });
  }

  function bulkMoveCategory(paths, newCat) {
    var selected = state.index.posts.filter(function (p) { return paths.indexOf(p.path) !== -1; });
    if (!selected.length) return;
    if (!Object.prototype.hasOwnProperty.call(state.cfg.categories, newCat)) {
      toast('目标分类不存在', 'error'); return;
    }
    var moves = selected.filter(function (p) { return p.category !== newCat; });
    if (!moves.length) { toast('所选文章已在此分类', 'ok'); state.listSel = {}; renderPosts(); return; }
    var label = (state.cfg.categories[newCat] || {}).label || newCat;
    if (!confirm('把所选 ' + moves.length + ' 篇文章移动到分类「' + label + '」吗？\n文件将移动到 content/' + newCat + '/ 目录。')) return;

    setBusy(true);
    Promise.all(moves.map(function (p) { return gh.getContent(p.path); })).then(function (raws) {
      var posts = state.index.posts.map(function (p) {
        var i = paths.indexOf(p.path);
        if (i === -1) return p;
        var oldPath = p.path;
        var slug = p.slug || oldPath.split('/').pop().replace(/\.md$/, '');
        var newPath = 'content/' + newCat + '/' + slug + '.md';
        p = Object.assign({}, p, { path: newPath, category: newCat });
        return p;
      });
      var newIndex = JSON.stringify({ schema: 1, posts: posts }, null, 2) + '\n';
      return gh.commitFiles({
        message: '[移动分类] ' + moves.length + ' 篇 → ' + label,
        files: moves.map(function (p, i) {
          var slug = p.slug || p.path.split('/').pop().replace(/\.md$/, '');
          return { path: 'content/' + newCat + '/' + slug + '.md', content: raws[i] };
        }).concat([
          { path: 'content/index.json', content: newIndex },
          { path: 'content/rss.xml', content: buildRss(posts) },
          { path: 'content/sitemap.xml', content: buildSitemap(posts) },
          { path: 'content/robots.txt', content: buildRobots() }
        ]),
        deletes: moves.map(function (p) { return p.path; })
      }).then(function () {
        setBusy(false);
        state.index = { schema: 1, posts: posts };
        state.listSel = {};
        toast('已移动 ' + moves.length + ' 篇到「' + label + '」✓', 'ok');
        render();
      });
    }).catch(function (err) {
      setBusy(false);
      toast('移动失败：' + errMsg(err), 'error');
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

    var listChildren = [
      el('h2', { class: 'panel-title', text: '分类列表' }),
      el('div', { class: 'cat-head' }, [
        el('div', { text: '图标' }),
        el('div', { class: 'cat-label-s', text: 'ID / 名称' }),
        el('div', { text: '描述' }),
        el('div', { text: '文章数' }),
        el('div', {})
      ])
    ];
    if (rows.length) listChildren = listChildren.concat(rows);
    else listChildren.push(el('div', { class: 'notice notice-info', text: '还没有分类，先添加一个。' }));
    var listPanel = el('section', { class: 'panel' }, listChildren);

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
        { path: 'content/config.json', content: content },
        { path: 'content/rss.xml', content: buildRss() },
        { path: 'content/sitemap.xml', content: buildSitemap() },
        { path: 'content/robots.txt', content: buildRobots() }
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

  function regeneratePublishFiles() {
    setBusy(true);
    gh.commitFiles({
      message: '重新生成 RSS/站点地图/robots',
      files: [
        { path: 'content/rss.xml', content: buildRss() },
        { path: 'content/sitemap.xml', content: buildSitemap() },
        { path: 'content/robots.txt', content: buildRobots() }
      ]
    }).then(function () {
      setBusy(false);
      toast('已重新生成 ✓', 'ok');
    }).catch(function (err) {
      setBusy(false);
      toast('生成失败：' + errMsg(err), 'error');
    });
  }

  /* ---------- 空仓库初始化 ---------- */
  function fetchSourceFile(path) {
    var binary = /\.(woff2?|ttf|otf|eot|png|jpe?g|gif|webp|ico)$/i.test(path);
    return fetch('../' + path).then(function (res) {
      if (!res.ok) throw new Error('读取文件失败：' + path);
      if (binary) {
        return res.arrayBuffer().then(function (buf) {
          var bytes = new Uint8Array(buf);
          var bin = '';
          var chunk = 0x8000;
          for (var i = 0; i < bytes.length; i += chunk) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
          }
          return { path: path, content: btoa(bin), binary: true };
        });
      }
      return res.text().then(function (t) { return { path: path, content: t }; });
    });
  }

  function initRepo() {
    if (!state.sourceRepo) { toast('无法确定源仓库（本站 content/config.json 缺失）', 'error'); return; }
    if (state.emptyRepo === false) { toast('该仓库已有内容，不支持初始化', 'error'); return; }
    setBusy(true);
    toast('正在读取本站代码文件…', 'ok');
    gh.listTreePublic(state.sourceRepo.owner, state.sourceRepo.repo, state.sourceRepo.branch).then(function (tree) {
      var paths = tree
        .filter(function (t) { return t.type === 'blob'; })
        .map(function (t) { return t.path; })
        .filter(function (p) {
          if (p.indexOf('content/') === 0) return false;
          return true;
        });
      if (!paths.length) throw new Error('源仓库没有可复制的文件');
      return Promise.all(paths.map(fetchSourceFile)).then(function (files) {
        var snap = gh.snapshot();
        var cfg = DEFAULT_CONFIG();
        cfg.github = { owner: snap.owner, repo: snap.repo, branch: snap.branch || 'main' };
        files.push({ path: 'content/config.json', content: JSON.stringify(cfg, null, 2) + '\n' });
        files.push({ path: 'content/index.json', content: '{\n  "schema": 1,\n  "posts": []\n}\n' });
        return gh.commitInitial({
          message: '初始化：提交本站程序文件',
          files: files
        });
      });
    }).then(function () {
      setBusy(false);
      state.emptyRepo = false;
      state.view = 'posts';
      toast('初始化完成 ✓ 仓库已就绪，可开启 GitHub Pages', 'ok');
      return Promise.all([fetchRepoConfig(), fetchRepoIndex()]).then(function () { render(); });
    }).catch(function (err) {
      setBusy(false);
      toast('初始化失败：' + errMsg(err), 'error');
      render();
    });
  }

  function initPanel() {
    var g = state.cfg.github || {};
    var pagesUrl = 'https://github.com/' + encodeURIComponent(g.owner) + '/' + encodeURIComponent(g.repo) + '/settings/pages';
    return el('section', { class: 'panel' }, [
      el('h2', { class: 'panel-title', text: '初始化仓库' }),
      el('div', { class: 'hint', text: '检测到这是一个空仓库。可一键把本站程序文件（不含文章数据）提交到该仓库，之后即可正常发布内容。' }),
      el('div', { class: 'panel-toolbar', style: 'margin-top:8px' }, [
        el('button', { class: 'btn-primary', text: '一键初始化', onClick: initRepo })
      ]),
      el('div', { class: 'hint', style: 'margin-top:12px', text: '初始化完成后，去仓库设置开启 GitHub Pages（Build from branch）即可访问站点。' }),
      el('div', { style: 'margin-top:6px' }, [el('a', { href: pagesUrl, target: '_blank', rel: 'noopener', text: pagesUrl })])
    ]);
  }

  /* ---------- 设置 ---------- */
  function renderSettings() {
    if (state.emptyRepo) {
      els.mainContent.appendChild(initPanel());
    }
    var site = state.cfg.site;
    var g = state.cfg.github;

    var titleInput = el('input', { type: 'text', value: site.title || '', id: 'setTitle', maxlength: 60 });
    var subtitleInput = el('input', { type: 'text', value: site.subtitle || '', id: 'setSubtitle', maxlength: 200 });
    var authorInput = el('input', { type: 'text', value: site.author || '', id: 'setAuthor', maxlength: 60 });
    var footerInput = el('input', { type: 'text', value: site.footer || '', id: 'setFooter', maxlength: 200 });
    var urlInput = el('input', {
      type: 'url', value: site.url || '', id: 'setUrl', maxlength: 200,
      placeholder: 'https://<用户名>.github.io/<仓库>/（留空则用相对路径）'
    });
    var pagesFillBtn = el('button', {
      class: 'btn', type: 'button', text: '填入 GitHub Pages 地址',
      onClick: function () {
        var g = state.cfg.github;
        urlInput.value = 'https://' + g.owner + '.github.io/' + g.repo + '/';
        toast('已按当前仓库填入，保存后生效', 'ok');
      }
    });
    var comments = state.cfg.comments || {};
    var commentsOn = el('input', { type: 'checkbox', id: 'setComments', checked: comments.enabled ? 'checked' : null });
    var commentsLabel = el('input', { type: 'text', id: 'setCommentsLabel', value: comments.label || '评论', maxlength: 30 });

    var saveBtn = el('button', { class: 'btn-primary', text: '保存设置', onClick: function () {
      if (!titleInput.value.trim()) { toast('站点标题不能为空', 'error'); return; }
      site.title = titleInput.value.trim();
      site.subtitle = subtitleInput.value.trim();
      site.author = authorInput.value.trim();
      site.footer = footerInput.value.trim();
      site.url = urlInput.value.trim();
      state.cfg.comments = { enabled: commentsOn.checked, label: commentsLabel.value.trim() || '评论' };
      saveConfig('更新站点设置', function () {
        updateRepoWarn();
        renderSettings();
      });
    } });

    els.mainContent.appendChild(el('section', { class: 'panel' }, [
      el('h2', { class: 'panel-title', text: '站点设置' }),
      el('div', { class: 'field' }, [el('label', { for: 'setTitle', text: '站点标题' }), titleInput]),
      el('div', { class: 'field' }, [el('label', { for: 'setSubtitle', text: '副标题' }), subtitleInput]),
      el('div', { class: 'field' }, [el('label', { for: 'setAuthor', text: '作者（用于结构化数据）' }), authorInput]),
      el('div', { class: 'field' }, [el('label', { for: 'setUrl', text: '站点地址（RSS 链接用）' }), urlInput]),
      el('div', { class: 'hint', style: 'margin-top:-6px' }, [
        pagesFillBtn,
        el('span', { text: ' 站点地址必须是「当前管理仓库」的站点；留空时预览链接按相对路径指向后台所在站点。' })
      ]),
      el('div', { class: 'field' }, [el('label', { for: 'setFooter', text: '页脚文字' }), footerInput]),
      el('div', { class: 'field' }, [el('label', { for: 'setComments', text: '启用评论（GitHub Issues）' }), commentsOn]),
      el('div', { class: 'field' }, [el('label', { for: 'setCommentsLabel', text: '评论标签' }), commentsLabel]),
      el('div', { class: 'hint', text: '评论基于 GitHub Issues：读者用 GitHub 账号在对应 Issue 下回复，公开仓库匿名可读，无需任何第三方服务。' }),
      saveBtn,
      el('button', { class: 'btn', text: '重新生成 RSS / 站点地图 / robots', onClick: regeneratePublishFiles })
    ]));

    els.mainContent.appendChild(el('section', { class: 'panel' }, [
      el('h2', { class: 'panel-title', text: '仓库信息' }),
      el('div', { class: 'field' }, [
        el('div', { class: 'hint', text: '以下信息来自已连接的仓库，如需修改请直接更新 content/config.json。' }),
        el('div', { class: 'repo-badge', style: 'display:inline-block;margin-top:8px', text: g.owner + '/' + g.repo + ' @' + g.branch })
      ]),
      state.user ? el('div', { class: 'field' }, [
        el('label', { text: '当前登录用户' }),
        el('div', { text: state.user.login + '（' + state.user.name + '）' })
      ]) : null
    ]));
  }

  /* ---------- 启动 ---------- */
  window.addEventListener('beforeunload', function (e) {
    if (editor && editor.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  function boot() {
    document.addEventListener('click', closeAllMenus);
    fetch('../content/config.json').then(function (res) {
      if (!res.ok) throw new Error();
      return res.json();
    }).then(function (cfg) {
      if (cfg && cfg.github) {
        gh.config({ owner: cfg.github.owner, repo: cfg.github.repo, branch: cfg.github.branch || 'main' });
        state.sourceRepo = {
          owner: cfg.github.owner,
          repo: cfg.github.repo,
          branch: cfg.github.branch || 'main'
        };
      }
    }).catch(function () {}).then(function () {
      var t = gh.snapshot();
      if (t.owner && t.repo) {
        els.connectTargetText.textContent = t.owner + '/' + t.repo + ' @' + (t.branch || 'main');
        els.connectTarget.hidden = false;
      }
      var savedToken = readSession('adminToken');
      if (savedToken) {
        // 独立登录页已把 Token/仓库写入 sessionStorage：自动连接，成功后直接进入工作区
        els.connectView.hidden = false;
        els.workspace.hidden = true;
        els.connectError.hidden = true;
        els.connectMeta.hidden = false;
        els.connectMeta.textContent = '正在连接 GitHub…';
        connect(savedToken, readSession('adminRepo'));
      } else {
        showConnect();
      }
    });
  }

  boot();
})();
