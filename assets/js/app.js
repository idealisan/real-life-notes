(function (global) {
  'use strict';

  /* Trip Track 主逻辑
     流程：boot → 探测仓库中的加密 Token（content/.trip-token）
       → 有：输入密码解锁（解密出 PAT）→ 读取并解密旅程数据 → 地图渲染
       → 无：首次设置（粘贴 PAT + 设置密码）→ 加密保存 → 进入
     存储布局：每段旅程一个加密文件 content/trips/<id>.trip（单文件损坏只影响一段）。
     保存旅程 = 只提交一个新文件（增量、低冲突）。
     兼容：旧版单文件 content/.trips-data 首次解锁时自动迁移拆分并删除。 */

  var TOKEN_FILE = 'content/.trip-token';
  var DATA_DIR = 'content/trips/';
  var LEGACY_DATA_FILE = 'content/.trips-data';
  var SS_PASS = 'ttPass';
  var SS_REPO = 'ttRepo';
  var DEFAULT_BRANCH = 'trip-track';

  var state = {
    mode: 'unlock',        /* unlock | setup */
    password: null,
    encryptedToken: null,  /* 仓库中读到的密文 */
    trips: [],
    loadWarnings: [],      /* 读取失败被跳过的文件列表 */
    connected: false
  };

  var els = {};
  ['map', 'tripCount', 'locateBtn', 'menuBtn', 'fabBtn',
   'authOverlay', 'authTitle', 'authSub', 'authForm', 'authPass', 'authPass2',
   'authToken', 'authRepo', 'authSubmit', 'modeSwitch', 'setupFields',
   'formOverlay', 'fromIata', 'fromDate', 'fromTime', 'toIata', 'toDate', 'toTime',
   'flightNo', 'noteText', 'noteCount', 'formCancel', 'formSave',
   'airportList', 'toast', 'busyMask', 'ttUser'
  ].forEach(function (id) { els[id] = document.getElementById(id); });

  var map = null;
  var tripLayer = null;

  /* ---------- 工具 ---------- */
  var busyTimer = null;
  function setBusy(on) {
    clearTimeout(busyTimer);
    if (on) {
      els.busyMask.hidden = false;
      /* 超过 30s 自动解除，避免卡死界面 */
      busyTimer = setTimeout(function () { els.busyMask.hidden = true; }, 30000);
    } else {
      els.busyMask.hidden = true;
    }
  }

  var toastTimer = null;
  function toast(msg, type) {
    clearTimeout(toastTimer);
    els.toast.textContent = msg;
    els.toast.className = 'tt-toast' + (type ? ' ' + type : '');
    els.toast.hidden = false;
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, 3200);
  }

  function errMsg(err) {
    return (err && err.message) ? err.message : String(err || '未知错误');
  }

  function readSession(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
  }
  function writeSession(key, value) {
    try {
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    } catch (e) {}
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- 仓库配置 ---------- */
  function applyRepo(repoUrl) {
    var owner = 'idealisan', repo = 'real-life-notes', branch = DEFAULT_BRANCH;
    if (repoUrl) {
      var parts = String(repoUrl).replace(/\/+$/, '').split('/').filter(Boolean);
      if (parts.length >= 2) {
        repo = parts[parts.length - 1];
        owner = parts[parts.length - 2];
      }
    }
    gh.config({ owner: owner, repo: repo, branch: branch });
  }

  /* ---------- 地图 ---------- */
  function initMap() {
    map = L.map('map', { zoomControl: false }).setView([32, 108], 4);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    tripLayer = L.layerGroup().addTo(map);
  }

  function renderTrips() {
    tripLayer.clearLayers();
    var bounds = [];
    var shown = 0;
    state.trips.forEach(function (t) {
      var from = Airports.find(t.from && t.from.iata);
      var to = Airports.find(t.to && t.to.iata);
      if (!from || !to) return;
      shown++;
      var pts = geo.arcPoints(
        { lat: from.lat, lon: from.lon },
        { lat: to.lat, lon: to.lon }
      );
      var line = L.polyline(pts, {
        color: '#0a84ff',
        weight: 3,
        opacity: 0.85
      }).addTo(tripLayer);
      L.circleMarker([from.lat, from.lon], {
        radius: 4, color: '#0a84ff', fillColor: '#ffffff',
        fillOpacity: 1, weight: 2
      }).addTo(tripLayer);
      L.circleMarker([to.lat, to.lon], {
        radius: 5, color: '#0a84ff', fillColor: '#0a84ff',
        fillOpacity: 1, weight: 2
      }).addTo(tripLayer);
      line.bindPopup(popupHtml(t, from, to));
      bounds.push([from.lat, from.lon], [to.lat, to.lon]);
    });
    els.tripCount.textContent = shown ? '· ' + shown + ' 段旅程' : '';
    if (bounds.length) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 8 });
    }
  }

  function popupHtml(t, from, to) {
    return '<div class="trip-popup">' +
      '<h3>' + escapeHtml(t.flight) + '</h3>' +
      '<div class="route">' + escapeHtml(from.iata) + ' ' + escapeHtml(from.name) + ' → ' +
        escapeHtml(to.iata) + ' ' + escapeHtml(to.name) + '</div>' +
      '<div class="meta">起飞：' + escapeHtml(t.from.date) + ' ' + escapeHtml(t.from.time || '') + '</div>' +
      '<div class="meta">降落：' + escapeHtml(t.to.date) + ' ' + escapeHtml(t.to.time || '') + '</div>' +
      (t.note ? '<div class="note">' + escapeHtml(t.note) + '</div>' : '') +
      '</div>';
  }

  /* ---------- 数据读取与保存（按旅程分文件） ---------- */

  /* 列出仓库中全部旅程文件路径 */
  function listTripPaths() {
    return gh.listTree().then(function (tree) {
      return (tree || [])
        .filter(function (e) {
          return e.type === 'blob' && e.path.indexOf(DATA_DIR) === 0 && /\.trip$/.test(e.path);
        })
        .map(function (e) { return e.path; });
    });
  }

  /* 读取并解密单个旅程文件；损坏/解密失败只跳过并记录，不影响其余数据 */
  function fetchTrip(path) {
    return gh.getContent(path).then(function (text) {
      return enc.decrypt(text, state.password).then(function (plain) {
        var t = JSON.parse(plain);
        if (!t || !t.id || !t.from || !t.to) throw new Error('结构不完整');
        return t;
      });
    }).catch(function (err) {
      state.loadWarnings.push(path + '：' + errMsg(err));
      return null;
    });
  }

  /* 读取旧版单文件数据（兼容迁移）；不存在返回 []，损坏也不阻塞 */
  function loadLegacyData() {
    return gh.getContent(LEGACY_DATA_FILE).then(function (text) {
      if (!text || !text.trim()) return [];
      return enc.decrypt(text, state.password).then(function (plain) {
        var data = JSON.parse(plain);
        return (data && Array.isArray(data.trips)) ? data.trips : [];
      });
    }).catch(function (err) {
      if (err && err.status === 404) return [];
      state.loadWarnings.push('旧数据文件：' + errMsg(err));
      return [];
    });
  }

  function encryptTrip(t) {
    return enc.encrypt(JSON.stringify(t), state.password);
  }

  /* 把旧单文件中的旅程拆分为独立文件提交，并删除旧文件 */
  function migrateLegacy(trips) {
    if (!trips.length) return Promise.resolve();
    return Promise.all(trips.map(function (t) {
      return encryptTrip(t).then(function (payload) {
        return { path: DATA_DIR + t.id + '.trip', content: payload };
      });
    })).then(function (files) {
      return gh.commitFiles({
        message: '迁移：单文件旅程数据拆分为按旅程加密文件',
        files: files,
        deletes: [LEGACY_DATA_FILE]
      });
    });
  }

  function loadData() {
    state.loadWarnings = [];
    return Promise.all([loadLegacyData(), listTripPaths().then(function (paths) {
      return Promise.all(paths.map(fetchTrip)).then(function (list) {
        return list.filter(Boolean);
      });
    })]).then(function (res) {
      var legacy = res[0], trips = res[1];
      var have = {};
      trips.forEach(function (t) { have[t.id] = true; });
      var missing = legacy.filter(function (t) { return t && t.id && !have[t.id]; });
      var all = trips.concat(missing);
      all.sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')); });
      if (!missing.length) return all;
      return migrateLegacy(missing).then(function () {
        state.migratedCount = missing.length;
        return all;
      }).catch(function (err) {
        /* 迁移失败不阻塞：旧文件保留，下次解锁重试 */
        state.loadWarnings.push('旧数据迁移失败（下次重试）：' + errMsg(err));
        return all;
      });
    });
  }

  function saveTrip(trip) {
    return encryptTrip(trip).then(function (payload) {
      return gh.commitFiles({
        message: '记录旅程：' + trip.flight + ' ' + trip.from.iata + '→' + trip.to.iata,
        files: [{ path: DATA_DIR + trip.id + '.trip', content: payload }]
      });
    });
  }

  /* ---------- 认证 ---------- */
  function showUnlockMode() {
    state.mode = 'unlock';
    els.authTitle.textContent = '解锁 Trip Track';
    els.authSub.textContent = '输入解锁密码，从仓库读取加密的旅程数据。';
    els.setupFields.hidden = true;
    els.authPass2.removeAttribute('required');
    els.authToken.removeAttribute('required');
    els.authSubmit.textContent = '解锁';
    els.modeSwitch.textContent = '首次使用？设置 Token 和密码';
    els.authOverlay.hidden = false;
    setTimeout(function () { els.authPass.focus(); }, 50);
  }

  function showSetupMode() {
    state.mode = 'setup';
    els.authTitle.textContent = '连接 Trip Track';
    els.authSub.textContent = '首次使用：粘贴 GitHub Token 并设置解锁密码。Token 会加密存入仓库，之后只需密码即可解锁。';
    els.setupFields.hidden = false;
    els.authPass2.setAttribute('required', '');
    els.authToken.setAttribute('required', '');
    els.authSubmit.textContent = '连接并开始使用';
    els.modeSwitch.textContent = '已有加密 Token？返回解锁';
    els.authOverlay.hidden = false;
    var savedRepo = readSession(SS_REPO);
    if (savedRepo) els.authRepo.value = savedRepo;
    setTimeout(function () { els.authPass.focus(); }, 50);
  }

  function afterConnect() {
    state.connected = true;
    els.authOverlay.hidden = true;
    els.fabBtn.hidden = false;
    els.locateBtn.hidden = false;
    setBusy(true);
    loadData().then(function (trips) {
      state.trips = trips;
      setBusy(false);
      renderTrips();
      if (state.migratedCount) {
        toast('已把旧单文件数据迁移为按旅程分文件（' + state.migratedCount + ' 段）✓', 'ok');
        state.migratedCount = 0;
      }
      if (state.loadWarnings.length) {
        toast('有 ' + state.loadWarnings.length + ' 个数据文件无法读取，已跳过', 'error');
      }
    }).catch(function (err) {
      /* 加载失败不影响保存（保存是增量提交，不会覆盖他人数据），仅提示 */
      setBusy(false);
      toast('读取旅程列表失败：' + errMsg(err), 'error');
    });
  }

  /* 解锁模式提交：用密码解密仓库中的 Token 密文 */
  function doUnlock(pass) {
    setBusy(true);
    enc.decrypt(state.encryptedToken, pass).then(function (token) {
      if (!token) throw new Error('解密结果为空');
      gh.config({ token: token });
      state.password = pass;
      writeSession(SS_PASS, pass);
      return gh.getRepo().then(function () {
        setBusy(false);
        afterConnect();
      }).catch(function (err) {
        /* Token 可能已失效：提示但不清密码，让用户看到具体错误 */
        setBusy(false);
        toast('Token 校验失败：' + errMsg(err), 'error');
      });
    }).catch(function (err) {
      setBusy(false);
      toast(errMsg(err), 'error');
      els.authPass.select();
    });
  }

  /* 首次设置：校验 Token → 加密保存 Token 与（空）数据 */
  function doSetup(pass, token, repoUrl) {
    applyRepo(repoUrl);
    gh.config({ token: token });
    setBusy(true);
    gh.getRepo().then(function (info) {
      /* 仓库校验通过；若用户填了 URL，用真实全名回填 */
      if (info && info.full_name) {
        gh.config({ owner: info.owner.login, repo: info.name });
      }
      state.password = pass;
      return enc.encrypt(token, pass).then(function (payload) {
        return gh.commitFiles({
          message: '初始化：保存加密的访问 Token',
          files: [{ path: TOKEN_FILE, content: payload }]
        });
      }).then(function () {
        writeSession(SS_PASS, pass);
        writeSession(SS_REPO, repoUrl || '');
        setBusy(false);
        toast('已连接，Token 已加密保存 ✓', 'ok');
        afterConnect();
      });
    }).catch(function (err) {
      setBusy(false);
      toast('连接失败：' + errMsg(err), 'error');
    });
  }

  function probeEncryptedToken() {
    return fetch(TOKEN_FILE).then(function (res) {
      if (!res.ok) throw new Error();
      return res.text();
    }).catch(function () {
      var g = gh.snapshot();
      if (!g.owner || !g.repo) return null;
      return gh.getContentPublic(g.owner, g.repo, TOKEN_FILE).catch(function () { return null; });
    }).then(function (text) {
      if (text && text.trim()) {
        state.encryptedToken = text;
        return true;
      }
      return false;
    });
  }

  /* ---------- 表单 ---------- */
  function openForm() {
    els.formOverlay.hidden = false;
    var now = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    var hm = pad(now.getHours()) + ':' + pad(now.getMinutes());
    if (!els.fromDate.value) els.fromDate.value = today;
    if (!els.fromTime.value) els.fromTime.value = hm;
    if (!els.toDate.value) els.toDate.value = today;
    setTimeout(function () { els.fromIata.focus(); }, 60);
  }

  function closeForm() {
    els.formOverlay.hidden = true;
  }

  function validateForm() {
    var fi = els.fromIata.value.trim().toUpperCase();
    var ti = els.toIata.value.trim().toUpperCase();
    var flight = els.flightNo.value.trim().toUpperCase();
    if (!Airports.has(fi)) return { error: '出发机场代码无效：' + (fi || '未填写') };
    if (!Airports.has(ti)) return { error: '到达机场代码无效：' + (ti || '未填写') };
    if (fi === ti) return { error: '出发和到达机场相同' };
    if (!flight) return { error: '请填写航班号' };
    if (!els.fromDate.value || !els.fromTime.value) return { error: '请填写出发日期和时间' };
    if (!els.toDate.value || !els.toTime.value) return { error: '请填写到达日期和时间' };
    return {
      trip: {
        id: 't' + Date.now() + Math.random().toString(36).slice(2, 6),
        flight: flight,
        from: { iata: fi, date: els.fromDate.value, time: els.fromTime.value },
        to: { iata: ti, date: els.toDate.value, time: els.toTime.value },
        note: els.noteText.value.trim(),
        createdAt: new Date().toISOString()
      }
    };
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    /* 机场 datalist */
    var frag = document.createDocumentFragment();
    Airports.codes().forEach(function (code) {
      var opt = document.createElement('option');
      opt.value = code;
      opt.label = Airports.find(code).name;
      frag.appendChild(opt);
    });
    els.airportList.appendChild(frag);

    /* 模式切换 */
    els.modeSwitch.addEventListener('click', function () {
      if (state.mode === 'unlock') showSetupMode();
      else showUnlockMode();
    });

    /* 认证表单：先做 GET 提交以触发浏览器保存密码，然后异步校验。
       校验失败留在本页即可（表单无敏感 name，URL 不携带 Token）。 */
    els.authForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var pass = els.authPass.value;
      if (!pass) { toast('请输入密码', 'error'); return; }
      try {
        els.ttUser.value = (gh.snapshot().owner) || 'github';
      } catch (err) {}
      if (state.mode === 'unlock') {
        doUnlock(pass);
      } else {
        var pass2 = els.authPass2.value;
        var token = els.authToken.value.trim();
        if (pass.length < 6) { toast('解锁密码至少 6 位', 'error'); return; }
        if (pass !== pass2) { toast('两次输入的密码不一致', 'error'); return; }
        if (!token) { toast('请粘贴 GitHub Token', 'error'); return; }
        doSetup(pass, token, els.authRepo.value.trim());
      }
    });

    /* FAB 与表单 */
    els.fabBtn.addEventListener('click', openForm);
    els.formCancel.addEventListener('click', closeForm);
    els.noteText.addEventListener('input', function () {
      els.noteCount.textContent = String(els.noteText.value.length);
    });
    els.formSave.addEventListener('click', function () {
      var v = validateForm();
      if (v.error) { toast(v.error, 'error'); return; }
      setBusy(true);
      saveTrip(v.trip).then(function () {
        setBusy(false);
        state.trips.push(v.trip);
        state.trips.sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });
        closeForm();
        toast('已保存到仓库 ✓', 'ok');
        renderTrips();
        els.flightNo.value = '';
        els.noteText.value = '';
        els.noteCount.textContent = '0';
        els.fromIata.value = '';
        els.toIata.value = '';
      }).catch(function (err) {
        setBusy(false);
        toast('保存失败：' + errMsg(err), 'error');
      });
    });

    /* 定位 */
    els.locateBtn.addEventListener('click', function () {
      if (!navigator.geolocation) { toast('当前浏览器不支持定位', 'error'); return; }
      setBusy(true);
      navigator.geolocation.getCurrentPosition(function (pos) {
        setBusy(false);
        map.setView([pos.coords.latitude, pos.coords.longitude], 12);
      }, function () {
        setBusy(false);
        toast('定位失败', 'error');
      }, { timeout: 10000 });
    });

    /* 菜单：退出登录 */
    els.menuBtn.addEventListener('click', function () {
      if (confirm('退出登录？将清除本页保存的密码（仓库数据不受影响）。')) {
        writeSession(SS_PASS, null);
        location.reload();
      }
    });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    initMap();
    bindEvents();

    /* 填充机场提示与默认仓库坐标 */
    fetch('content/config.json').then(function (res) {
      if (!res.ok) throw new Error();
      return res.json();
    }).then(function (cfg) {
      if (cfg && cfg.github) {
        applyRepo('https://github.com/' + cfg.github.owner + '/' + cfg.github.repo);
        if (cfg.github.branch) gh.config({ branch: cfg.github.branch });
      }
      return null;
    }).catch(function () { return null; }).then(function () {
      var g = gh.snapshot();
      els.ttUser.value = g.owner || 'github';

      var savedPass = readSession(SS_PASS);
      probeEncryptedToken().then(function (found) {
        if (found) {
          showUnlockMode();
          if (savedPass) {
            /* 同一会话刷新：自动解锁 */
            els.authPass.value = savedPass;
            doUnlock(savedPass);
          }
        } else {
          showSetupMode();
          if (savedPass) els.authPass.value = savedPass;
        }
      });
    });
  }

  boot();
})(window);
