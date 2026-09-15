(function (global) {
  'use strict';

  /* CMS 核心：用 GitHub 仓库做对象存储的极简内容管理内核。
   *
   * 能力：
   * - 认证：密码解锁模式。Token 用 AES-256-GCM+PBKDF2 加密存入仓库
   *   （auth.tokenFile），之后只需密码解锁；密码仅内存持有，永不落盘。
   * - 对象存储：每个对象一个文件（<集合路径>/<id>.<ext>），通过 GitHub API
   *   增量提交（单文件损坏只影响该对象）。
   * - 索引驱动读取：每个集合一个索引文件 <集合路径>/index.<ext>，记录对象 id
   *   与元数据（meta）。列表/分页只读索引（1 次 API 调用），避免 1+N 全量拉取
   *   触发 GitHub 限流；明细按需 get/getMany 单读。
   *   索引是可重建的缓存：对象文件是事实源，索引损坏/丢失时可用
   *   store.rebuildIndex() 从对象文件重建。
   * - 加密可选：按集合配置 encrypt:true/false；加密集合的对象与索引均为密文
   *   （.enc），明文集合为 .json 且支持访客免登录公开读取。
   * - 原子写：put/remove 在同一个 commit 里同时更新对象文件与索引。
   *
   * 依赖：gh.js（GitHub API）、enc.js（加密）。 */

  var cfg = {
    owner: null, repo: null, branch: null,
    tokenFile: 'content/.cms-token',
    collections: {},       /* name -> {path, encrypt, label} */
    initialized: false
  };

  var session = { password: null, encryptedToken: null, unlocked: false };

  function errMsg(err) {
    return (err && err.message) ? err.message : String(err || '未知错误');
  }

  function is404(err) { return !!(err && (err.status === 404 || err.status === 409)); }

  /* ---------- 初始化与集合 ---------- */

  /* cfg 形如 cms.config.json：{ github:{owner,repo,branch}, auth:{tokenFile}, collections:{...} } */
  function init(raw) {
    if (!raw || !raw.github || !raw.github.owner || !raw.github.repo) {
      throw new Error('cms.config 缺少 github.owner/repo');
    }
    cfg.owner = raw.github.owner;
    cfg.repo = raw.github.repo;
    cfg.branch = raw.github.branch || 'main';
    if (raw.auth && raw.auth.tokenFile) cfg.tokenFile = raw.auth.tokenFile;
    var cols = {};
    Object.keys(raw.collections || {}).forEach(function (name) {
      var c = raw.collections[name] || {};
      if (!c.path) throw new Error('集合 ' + name + ' 缺少 path');
      cols[name] = {
        name: name,
        path: String(c.path).replace(/\/+$/, ''),
        encrypt: !!c.encrypt,
        label: c.label || name
      };
    });
    cfg.collections = cols;
    cfg.initialized = true;
    /* init 对应一次全新会话上下文（页面加载）：重置解锁状态 */
    session.password = null;
    session.encryptedToken = null;
    session.unlocked = false;
    gh.config({ owner: cfg.owner, repo: cfg.repo, branch: cfg.branch });
  }

  function requireInit() {
    if (!cfg.initialized) throw new Error('CMS 未初始化：请先 CMS.init(cmsConfig)');
  }

  function collections() {
    return Object.keys(cfg.collections);
  }

  function collection(name) {
    requireInit();
    var c = cfg.collections[name];
    if (!c) throw new Error('未知集合：' + name);
    return c;
  }

  /* ---------- 认证 ---------- */

  var auth = {};

  /* 探测仓库中是否存在加密 Token（本地静态读取 → 公开 API 回退） */
  auth.probe = function () {
    requireInit();
    return fetch(cfg.tokenFile).then(function (res) {
      if (!res.ok) throw new Error();
      return res.text();
    }).catch(function () {
      return gh.getContentPublic(cfg.owner, cfg.repo, cfg.tokenFile, cfg.branch).catch(function () { return null; });
    }).then(function (text) {
      if (text && text.trim()) {
        session.encryptedToken = text;
        return true;
      }
      return false;
    });
  };

  /* 首次设置：校验 Token → 用密码加密后存入仓库 */
  auth.setup = function (password, token) {
    requireInit();
    if (!password || password.length < 6) return Promise.reject(new Error('解锁密码至少 6 位'));
    if (!token) return Promise.reject(new Error('缺少 GitHub Token'));
    gh.config({ token: token });
    return gh.getRepo().then(function (info) {
      /* 以仓库真实全名为准 */
      if (info && info.full_name) {
        gh.config({ owner: info.owner.login, repo: info.name });
        cfg.owner = info.owner.login;
        cfg.repo = info.name;
      }
      session.password = password;
      return enc.encrypt(token, password);
    }).then(function (payload) {
      return gh.commitFiles({
        message: 'CMS 初始化：保存加密的访问 Token',
        files: [{ path: cfg.tokenFile, content: payload }]
      });
    }).then(function () {
      session.encryptedToken = null;
      session.unlocked = true;
      return true;
    });
  };

  /* 解锁：用密码解密仓库中的 Token 密文，挂到 gh 会话 */
  auth.unlock = function (password) {
    requireInit();
    if (!session.encryptedToken) return Promise.reject(new Error('仓库中没有已保存的加密 Token'));
    return enc.decrypt(session.encryptedToken, password).then(function (token) {
      if (!token) throw new Error('解密结果为空');
      session.password = password;
      session.unlocked = true;
      gh.config({ token: token });
      return true;
    });
  };

  auth.isUnlocked = function () { return session.unlocked; };
  auth.hasEncryptedToken = function () { return !!session.encryptedToken; };
  auth.snapshot = function () {
    return { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, unlocked: session.unlocked };
  };

  /* ---------- 对象存储（索引驱动） ---------- */

  function extOf(col) { return col.encrypt ? 'enc' : 'json'; }
  function pathOf(col, id) { return col.path + '/' + id + '.' + extOf(col); }
  function indexPathOf(col) { return col.path + '/index.' + extOf(col); }

  function validateId(id) {
    if (!id || !/^[A-Za-z0-9._-]+$/.test(String(id)) || String(id) === 'index') {
      throw new Error('对象 id 非法（仅允许字母数字._-，且不得为 index）：' + id);
    }
    return String(id);
  }

  /* 序列化 +（按集合配置）加密 */
  function encodeObject(col, obj) {
    var text = JSON.stringify(obj);
    return col.encrypt ? enc.encrypt(text, session.password) : Promise.resolve(text);
  }

  /* 解密/解析；失败抛错，由调用方决定跳过与否 */
  function decodeObject(col, text) {
    var p = col.encrypt ? enc.decrypt(text, session.password) : Promise.resolve(text);
    return p.then(function (plain) {
      var obj = JSON.parse(plain);
      if (!obj || typeof obj !== 'object') throw new Error('对象结构不完整');
      return obj;
    });
  }

  function requireReadAccess(col, usePublic) {
    if (usePublic && col.encrypt) throw new Error('加密集合不支持公开读取：' + col.name);
    if (col.encrypt && !session.unlocked) throw new Error('集合 ' + col.name + ' 已加密，请先解锁');
  }

  /* 读取索引；不存在返回空索引，损坏抛错（可 rebuildIndex 重建） */
  function fetchIndex(col, usePublic) {
    var path = indexPathOf(col);
    var p = usePublic
      ? gh.getContentPublic(cfg.owner, cfg.repo, path, cfg.branch)
      : gh.getContent(path);
    return p.then(function (text) {
      if (!text || !text.trim()) return { schema: 1, objects: [] };
      return decodeObject(col, text).then(function (data) {
        if (!data || !Array.isArray(data.objects)) throw new Error('索引结构不完整');
        return data;
      });
    }).catch(function (err) {
      if (is404(err)) return { schema: 1, objects: [] };
      err.hintIndexCorrupt = true;
      throw err;
    });
  }

  function commitIndexAndFiles(col, index, extraFiles, deletes, message) {
    return encodeObject(col, index).then(function (indexContent) {
      var files = (extraFiles || []).slice();
      files.push({ path: indexPathOf(col), content: indexContent });
      return gh.commitFiles({
        message: message || ('CMS：更新' + col.label + '（' + (extraFiles && extraFiles.length ? '对象+索引' : '仅索引') + '）'),
        files: files,
        deletes: deletes || []
      });
    });
  }

  /* 统一入口校验：返回 Error（应拒绝）或 null（放行） */
  function accessError(name, usePublic) {
    try {
      requireReadAccess(collection(name), usePublic);
      return null;
    } catch (e) {
      return e;
    }
  }

  var store = {};

  /* 上次 list/getMany 跳过的坏文件记录 */
  store.lastErrors = [];

  /*
   * 读取集合索引（1 次 API 调用，不逐个拉对象）。
   * opts.page（1 起）/ opts.pageSize → 分页；省略则返回全部。
   * opts.public=true → 公开读取（仅明文集合，访客免登录）。
   * 返回 { items:[{id, updatedAt, meta}], total, page, pageSize }
   */
  store.index = function (name, opts) {
    var usePublic = !!(opts && opts.public);
    var denied = accessError(name, usePublic);
    if (denied) return Promise.reject(denied);
    var col = collection(name);
    return fetchIndex(col, usePublic).then(function (index) {
      var all = index.objects.filter(function (e) { return e && e.id; });
      var pageSize = opts && opts.pageSize ? Math.max(1, opts.pageSize | 0) : all.length;
      var page = opts && opts.page ? Math.max(1, opts.page | 0) : 1;
      var start = (page - 1) * pageSize;
      return {
        items: all.slice(start, start + pageSize),
        total: all.length,
        page: page,
        pageSize: pageSize
      };
    });
  };

  /* 读取单个对象（1 次 API 调用） */
  store.get = function (name, id) {
    var denied = accessError(name, false);
    if (denied) return Promise.reject(denied);
    var col = collection(name);
    var vid;
    try { vid = validateId(id); } catch (e) { return Promise.reject(e); }
    return gh.getContent(pathOf(col, vid)).then(function (text) {
      return decodeObject(col, text);
    });
  };

  /* 按需批量读取指定 id 的对象（仅拉取给定文件，坏对象跳过并记入 lastErrors） */
  store.getMany = function (name, ids) {
    var denied = accessError(name, false);
    if (denied) return Promise.reject(denied);
    var col = collection(name);
    store.lastErrors = [];
    return Promise.all((ids || []).map(function (id) {
      return store.get(name, id).catch(function (err) {
        store.lastErrors.push(pathOf(col, id) + '：' + errMsg(err));
        return null;
      });
    })).then(function (list) { return list.filter(Boolean); });
  };

  /* 写入/更新一个对象：同一 commit 原子更新对象文件 + 索引。
     meta 为写入索引的元数据（列表/分页场景展示用；可传 obj 本身）。
     opts.message 可覆盖默认提交信息。 */
  store.put = function (name, obj, meta, opts) {
    var denied = accessError(name, false);
    if (denied) return Promise.reject(denied);
    var col = collection(name);
    var id;
    try { id = validateId(obj && obj.id); } catch (e) { return Promise.reject(e); }
    var msg = (opts && opts.message) || ('CMS：保存 ' + col.label + ' ' + id);
    var entry = {
      id: id,
      updatedAt: obj.updatedAt || obj.createdAt || new Date().toISOString(),
      meta: (meta === undefined ? {} : meta)
    };
    var extraFiles = [];
    return encodeObject(col, obj).then(function (content) {
      extraFiles.push({ path: pathOf(col, id), content: content });
      return fetchIndex(col, false);
    }).then(function (index) {
      index.objects = (index.objects || []).filter(function (e) { return e.id !== id; });
      index.objects.push(entry);
      return commitIndexAndFiles(col, index, extraFiles, [], msg);
    });
  };

  /* 删除一个对象：同一 commit 删除对象文件 + 更新索引 */
  store.remove = function (name, id) {
    var denied = accessError(name, false);
    if (denied) return Promise.reject(denied);
    var col = collection(name);
    var vid;
    try { vid = validateId(id); } catch (e) { return Promise.reject(e); }
    return fetchIndex(col, false).then(function (index) {
      index.objects = (index.objects || []).filter(function (e) { return e.id !== vid; });
      return commitIndexAndFiles(col, index, [], [pathOf(col, vid)]);
    });
  };

  /* 从对象文件重建索引（索引损坏/丢失时的恢复手段；逐文件读取，坏文件跳过）。
     metaFn(obj) 可选：从对象提取索引元数据；默认优先取 obj.meta，否则用对象本身。 */
  store.rebuildIndex = function (name, metaFn) {
    var denied = accessError(name, false);
    if (denied) return Promise.reject(denied);
    var col = collection(name);
    store.lastErrors = [];
    var re = new RegExp('^' + col.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/([A-Za-z0-9._-]+)\\.' + extOf(col) + '$');
    return gh.listTree().then(function (tree) {
      var paths = (tree || [])
        .filter(function (e) { return e.type === 'blob' && re.test(e.path) && !/\/index\./.test(e.path); })
        .map(function (e) { return e.path; });
      return Promise.all(paths.map(function (p) {
        var id = p.match(re)[1];
        return gh.getContent(p).then(function (text) {
          return decodeObject(col, text).then(function (obj) {
            var meta = typeof metaFn === 'function' ? metaFn(obj) : (obj.meta || obj);
            return {
              id: id,
              updatedAt: obj.updatedAt || obj.createdAt || '',
              meta: meta
            };
          });
        }).catch(function (err) {
          store.lastErrors.push(p + '：' + errMsg(err));
          return null;
        });
      }));
    }).then(function (entries) {
      var index = {
        schema: 1,
        objects: entries.filter(Boolean).sort(function (a, b) {
          return String(a.updatedAt).localeCompare(String(b.updatedAt));
        })
      };
      return commitIndexAndFiles(col, index, [], []);
    });
  };

  global.CMS = {
    init: init,
    collections: collections,
    collection: collection,
    auth: auth,
    store: store
  };
})(window);
