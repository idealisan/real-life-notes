(function (global) {
  'use strict';

  var API = 'https://api.github.com';
  var COMMON_HEADERS = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  var cfg = { owner: null, repo: null, branch: 'main', token: null };

  function gh() {}

  gh.config = function (opts) {
    if (!opts) return;
    if (opts.owner !== undefined) cfg.owner = opts.owner;
    if (opts.repo !== undefined) cfg.repo = opts.repo;
    if (opts.branch !== undefined) cfg.branch = opts.branch;
    if (opts.token !== undefined) cfg.token = opts.token;
  };

  gh.connected = function () { return !!cfg.token; };
  gh.snapshot = function () {
    return { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, token: !!cfg.token };
  };

  function apiError(status, message, docUrl) {
    var err = new Error(message || 'GitHub API 请求失败');
    err.status = status;
    err.documentation_url = docUrl;
    return err;
  }

  function _request(method, path, body) {
    var headers = Object.create(null);
    Object.keys(COMMON_HEADERS).forEach(function (k) { headers[k] = COMMON_HEADERS[k]; });
    if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
    var opts = { method: method, headers: headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(API + path, opts).then(function (res) {
      if (res.status === 204) return null;
      return res.json().catch(function () { return null; }).then(function (data) {
        if (res.ok) return data;
        var msg = (data && (data.message || data.error)) || ('HTTP ' + res.status);
        if (data && Array.isArray(data.errors) && data.errors.length) {
          msg += ' (' + data.errors.map(function (e) { return e.message || ''; }).join('; ') + ')';
        }
        throw apiError(res.status, msg, data && data.documentation_url);
      });
    }).catch(function (err) {
      if (err && err.status) throw err;
      throw apiError(0, '网络请求失败：' + (err && err.message ? err.message : '无法连接 GitHub'));
    });
  }

  function requireRepo() {
    if (!cfg.owner || !cfg.repo) throw apiError(0, '缺少仓库配置（owner/repo）');
    if (!cfg.token) throw apiError(0, '尚未连接：请先填入 GitHub token');
  }

  function base64ToUtf8(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  gh.getUser = function () {
    requireRepo();
    return _request('GET', '/user');
  };

  gh.getRepo = function () {
    requireRepo();
    return _request('GET', '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo));
  };

  gh.getContent = function (path) {
    requireRepo();
    return _request('GET', '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) + '/contents/' + path.split('/').map(encodeURIComponent).join('/'))
      .then(function (data) {
        if (data && data.content !== undefined) return base64ToUtf8(data.content);
        throw apiError(0, '读取文件内容失败：' + path);
      });
  };

  gh.listTree = function () {
    requireRepo();
    return _request('GET', '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) + '/git/trees/' + encodeURIComponent(cfg.branch) + '?recursive=1')
      .then(function (data) {
        return (data && data.tree) || [];
      });
  };

  gh.getBranchRef = function () {
    requireRepo();
    return _request('GET', '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) + '/git/refs/heads/' + encodeURIComponent(cfg.branch))
      .catch(function (err) {
        if (err && err.status === 404) return null;
        throw err;
      });
  };

  gh.listTreePublic = function (owner, repo, branch) {
    if (!owner || !repo) throw apiError(0, '缺少源仓库配置');
    return fetch(API + '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/git/trees/' + encodeURIComponent(branch || 'main') + '?recursive=1', {
      headers: COMMON_HEADERS
    }).then(function (res) {
      if (!res.ok) return res.json().catch(function () { return null; }).then(function (data) {
        throw apiError(res.status, (data && data.message) || ('HTTP ' + res.status), data && data.documentation_url);
      });
      return res.json().then(function (data) {
        return (data && data.tree) || [];
      });
    }).catch(function (err) {
      if (err && err.status) throw err;
      throw apiError(0, '网络请求失败：' + (err && err.message ? err.message : '无法读取源仓库'));
    });
  };

  gh.commitInitial = function (opts) {
    if (!opts || !opts.message) throw apiError(0, '提交缺少 message');
    var files = opts.files || [];
    if (!files.length) throw apiError(0, '没有可提交的变更');
    var owner = cfg.owner, repo = cfg.repo, branch = cfg.branch;
    requireRepo();

    var entries = [];
    var blobPromises = [];
    files.forEach(function (f) {
      if (f.binary) {
        blobPromises.push(_request('POST', '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/git/blobs', {
          content: String(f.content),
          encoding: 'base64'
        }).then(function (blob) {
          entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
        }));
      } else {
        entries.push({ path: f.path, mode: '100644', type: 'blob', content: String(f.content) });
      }
    });

    return Promise.all(blobPromises).then(function () {
      return _request('POST', '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/git/trees', {
        tree: entries
      }).then(function (tree) {
        return _request('POST', '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/git/commits', {
          message: opts.message,
          tree: tree.sha
        }).then(function (commit) {
          return _request('POST', '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/git/refs', {
            ref: 'refs/heads/' + branch,
            sha: commit.sha
          }).then(function () {
            commit.html_url = 'https://github.com/' + owner + '/' + repo + '/commit/' + commit.sha;
            return commit;
          });
        });
      });
    });
  };

  gh.commitFiles = function (opts) {
    if (!opts || !opts.message) throw apiError(0, '提交缺少 message');
    var files = opts.files || [];
    var deletes = opts.deletes || [];
    if (!files.length && !deletes.length) throw apiError(0, '没有可提交的变更');
    var maxRetries = opts.retries === undefined ? 3 : opts.retries;
    var attempt = 0;

    var owner = cfg.owner, repo = cfg.repo, branch = cfg.branch;
    requireRepo();

    function getHeadSha() {
      return _request('GET', '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/git/refs/heads/' + encodeURIComponent(branch))
        .then(function (ref) {
          if (!ref || !ref.object) throw apiError(0, '无法获取分支 ' + branch + ' 的引用');
          return ref.object.sha;
        });
    }

    function getCommitTree(headSha) {
      return _request('GET', '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/git/commits/' + headSha)
        .then(function (commit) { return commit.tree.sha; });
    }

    function createTree(baseTree, entries) {
      return _request('POST', '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/git/trees', {
        base_tree: baseTree,
        tree: entries
      });
    }

    function createCommit(message, treeSha, headSha) {
      return _request('POST', '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/git/commits', {
        message: message,
        tree: treeSha,
        parents: [headSha]
      });
    }

    function updateRef(commitSha) {
      return _request('PATCH', '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/git/refs/heads/' + encodeURIComponent(branch), {
        sha: commitSha,
        force: false
      });
    }

    function tryCommit() {
      attempt++;
      return getHeadSha().then(function (headSha) {
        return getCommitTree(headSha).then(function (treeSha) {
          var entries = [];
          files.forEach(function (f) {
            entries.push({ path: f.path, mode: '100644', type: 'blob', content: String(f.content) });
          });
          deletes.forEach(function (p) {
            entries.push({ path: p, mode: '100644', type: 'blob', sha: null });
          });
          return createTree(treeSha, entries).then(function (newTree) {
            return createCommit(opts.message, newTree.sha, headSha).then(function (commit) {
              return updateRef(commit.sha).then(function () {
                commit.html_url = 'https://github.com/' + owner + '/' + repo + '/commit/' + commit.sha;
                return commit;
              });
            });
          });
        });
      }).catch(function (err) {
        if (err && err.status === 409 && attempt <= maxRetries) return tryCommit();
        throw err;
      });
    }

    return tryCommit();
  };

  global.gh = gh;
})(window);
