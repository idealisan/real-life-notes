(function (global) {
  'use strict';

  /* Trip Track 主逻辑（运行在 CMS 内核之上）
     认证与存储全部由 CMS（assets/js/cms.js）提供：
       boot → 拉取 cms.config.json → CMS.init → 探测加密 Token
         → 有：输入密码解锁（CMS.auth.unlock）→ 读索引渲染地图
         → 无：首次设置（粘贴 PAT + 设置密码，CMS.auth.setup）→ 进入
     数据：CMS.store.put('trips', trip, trip) 单对象+索引原子提交；
       读取走索引（1 次 API 调用），不全量拉取对象文件。
     兼容迁移：旧版单文件 content/.trips-data 首次解锁自动拆分；
       trip-track 分支的旅程数据在 cms 分支为空时自动跨分支导入。 */

  var LEGACY_DATA_FILE = 'content/.trips-data';
  var SOURCE_BRANCH = 'trip-track';   /* 跨分支导入的数据来源 */
  var SS_PASS = 'ttPass';
  var SS_REPO = 'ttRepo';
  var COL = 'trips';                  /* 旅程集合名（cms.config.json 中定义） */

  var state = {
    mode: 'unlock',        /* unlock | setup */
    password: null,
    cmsRaw: null,          /* cms.config.json 原始内容 */
    trips: [],
    loadWarnings: [],
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

  /* ---------- CMS 初始化 ---------- */
  function initCMS(repoUrl) {
    var raw = state.cmsRaw;
    if (repoUrl) {
      var parts = String(repoUrl).replace(/\/+$/, '').split('/').filter(Boolean);
      if (parts.length >= 2) {
        raw = JSON.parse(JSON.stringify(raw));
        raw.github = {
          owner: parts[parts.length - 2],
          repo: parts[parts.length - 1],
          branch: (raw.github && raw.github.branch) || 'cms'
        };
      }
    }
    CMS.init(raw);
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

  /* ---------- 数据读取与保存（CMS 内核：索引驱动） ---------- */

  /* 索引条目 → 旅程对象（meta 即旅程对象本身） */
  function entryToTrip(e) {
    var t = Object.assign({}, e.meta, { id: e.id, updatedAt: e.updatedAt });
    return t;
  }

  function loadTrips() {
    return CMS.store.index(COL).then(function (res) {
      state.loadWarnings = CMS.store.lastErrors.slice();
      return res.items.map(entryToTrip);
    });
  }

  /* 旧版单文件迁移：content/.trips-data → 按旅程分文件 + 索引 */
  function migrateLegacy() {
    return gh.getContent(LEGACY_DATA_FILE).then(function (text) {
      if (!text || !text.trim()) return 0;
      return enc.decrypt(text, state.password).then(function (plain) {
        var data = JSON.parse(plain);
        var trips = (data && Array.isArray(data.trips)) ? data.trips : [];
        return Promise.all(trips.map(function (t) {
          return t && t.id ? CMS.store.put(COL, t, t) : null;
        })).then(function () { return trips.length; });
      });
    }).then(function (count) {
      if (!count) return 0;
      return gh.commitFiles({
        message: '迁移：删除旧版单文件旅程数据（已拆分为按旅程分文件）',
        deletes: [LEGACY_DATA_FILE]
      }).then(function () { return count; });
    }).catch(function (err) {
      if (err && err.status === 404) return 0;
      state.loadWarnings.push('旧数据迁移失败（下次重试）：' + errMsg(err));
      return 0;
    });
  }

  /* 跨分支导入：cms 分支为空时，从 trip-track 分支公开读取旅程文件导入
     （数据随 Pages 分支切换迁移；密码不一致导致解密失败时静默跳过） */
  function importFromSourceBranch() {
    var g = CMS.auth.snapshot();
    var imported = 0;
    return gh.listTreePublic(g.owner, g.repo, SOURCE_BRANCH).then(function (tree) {
      var paths = (tree || [])
        .filter(function (e) {
          return e.type === 'blob' && e.path.indexOf('content/trips/') === 0 && /\.trip$/.test(e.path) && !/\/index\./.test(e.path);
        })
        .map(function (e) { return e.path; });
      return Promise.all(paths.map(function (p) {
        return gh.getContentPublic(g.owner, g.repo, p, SOURCE_BRANCH).then(function (text) {
          return enc.decrypt(text, state.password).then(function (plain) {
            var t = JSON.parse(plain);
            if (t && t.id && t.from && t.to) {
              return CMS.store.put(COL, t, t).then(function () { imported++; });
            }
          }).catch(function () { /* 密码不一致或文件损坏：跳过 */ });
        }).catch(function () { /* 读取失败：跳过 */ });
      }));
    }).then(function () {
      return imported;
    }).catch(function () {
      return imported;
    });
  }

  function loadData() {
    return loadTrips().then(function (trips) {
      if (trips.length) return trips;
      /* 空集合：尝试旧单文件迁移与跨分支导入（均一次性） */
      return migrateLegacy().then(function (count) {
        if (count) return loadTrips().then(function (t) {
          state.migratedCount = count;
          return t;
        });
        return importFromSourceBranch().then(function (n) {
          if (n) return loadTrips().then(function (t) {
            state.importedCount = n;
            return t;
          });
          return trips;
        });
      });
    });
  }

  function saveTrip(trip) {
    return CMS.store.put(COL, trip, trip, {
      message: '记录旅程：' + trip.flight + ' ' + trip.from.iata + '→' + trip.to.iata
    });
  }

  /* ---------- 认证 UI ---------- */
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
      if (state.importedCount) {
        toast('已从 ' + SOURCE_BRANCH + ' 分支导入 ' + state.importedCount + ' 段旅程 ✓', 'ok');
        state.importedCount = 0;
      }
      if (state.loadWarnings.length) {
        toast('有 ' + state.loadWarnings.length + ' 个数据文件无法读取，已跳过', 'error');
      }
    }).catch(function (err) {
      /* 加载失败不影响保存（保存是增量提交），仅提示 */
      setBusy(false);
      toast('读取旅程索引失败：' + errMsg(err), 'error');
    });
  }

  /* 解锁模式提交 */
  function doUnlock(pass) {
    setBusy(true);
    CMS.auth.unlock(pass).then(function () {
      state.password = pass;
      writeSession(SS_PASS, pass);
      return gh.getRepo();
    }).then(function () {
      setBusy(false);
      afterConnect();
    }).catch(function (err) {
      setBusy(false);
      toast(errMsg(err), 'error');
      els.authPass.select();
    });
  }

  /* 首次设置 */
  function doSetup(pass, token, repoUrl) {
    setBusy(true);
    initCMS(repoUrl);
    CMS.auth.setup(pass, token).then(function () {
      state.password = pass;
      writeSession(SS_PASS, pass);
      writeSession(SS_REPO, repoUrl || '');
      setBusy(false);
      toast('已连接，Token 已加密保存 ✓', 'ok');
      afterConnect();
    }).catch(function (err) {
      setBusy(false);
      /* 恢复默认仓库配置，避免错误输入影响后续重试 */
      initCMS('');
      toast('连接失败：' + errMsg(err), 'error');
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
        els.ttUser.value = (CMS.auth.snapshot().owner) || 'github';
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

    fetch('cms.config.json').then(function (res) {
      if (!res.ok) throw new Error('cms.config.json 读取失败');
      return res.json();
    }).then(function (raw) {
      state.cmsRaw = raw;
      initCMS('');
      return null;
    }).catch(function (err) {
      toast('CMS 配置加载失败：' + errMsg(err), 'error');
      return null;
    }).then(function () {
      var g = CMS.auth.snapshot();
      els.ttUser.value = g.owner || 'github';

      var savedPass = readSession(SS_PASS);
      CMS.auth.probe().then(function (found) {
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
