/* AI_learning 云同步引擎
 * localStorage = 离线缓存 + 乐观写入层；Turso（经 /api/progress 代理）= 跨设备真源。
 *
 * 设计要点：
 * - 统一同步流程：GET 远端 → 双向 LWW 合并进本地 → POST 合并后的脏行（双端同时首开不互覆）
 * - 时钟偏移：server_time - Date.now() 指数平滑存 sync_clock_offset，写入时间一律用校准值
 * - flush 三重触发：2s 防抖 / pagehide(keepalive) / visibilitychange→hidden；offline 事件立即补传
 * - 任何 API 失败 → 离线模式：纯 localStorage 照常工作，恢复后自动补传
 * - progress LWW upsert；review_events 只追加，client_event_id 幂等
 */
(function () {
  "use strict";

  var API = "/api/progress";
  // 与 EdgeOne 控制台环境变量 APP_KEY 保持一致（个人站点共享密钥 + 平台限流）
  var APP_KEY = "ail_d5207a4bbb992bf9405c68ef2e50ed93";

  var PROG_KEY = "ail_progress_v1";
  var EVENTS_KEY = "ail_events_v1";
  var DIRTY_KEY = "sync_dirty";
  var OFFSET_KEY = "sync_clock_offset";
  var MAX_EVENTS = 5000;

  var state = "init"; // init | pulling | ready | syncing | offline
  var listeners = [];
  var pushTimer = null;
  var pushFailures = 0;
  var initialized = false;

  /* ---------- 基础工具 ---------- */
  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { /* 隐私模式等场景静默降级 */ }
  }
  function uuid() {
    return (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : "ev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  /* ---------- 时钟校准 ---------- */
  function offset() {
    return Number(localStorage.getItem(OFFSET_KEY)) || 0;
  }
  function now() {
    return Date.now() + offset();
  }
  function updateOffset(serverTime) {
    if (!Number.isFinite(serverTime)) return;
    var sample = serverTime - Date.now();
    var old = offset();
    // 指数平滑：单次网络抖动不造成跳变；首次直接采纳
    var next = old === 0 ? sample : Math.round(old * 0.7 + sample * 0.3);
    localStorage.setItem(OFFSET_KEY, String(next));
  }

  /* ---------- 状态广播 ---------- */
  function statusInfo() {
    return {
      state: state,
      pending: readJSON(DIRTY_KEY, []).length,
      pendingEvents: readJSON(EVENTS_KEY, []).filter(function (e) {
        return !e._sent;
      }).length,
    };
  }
  function setStatus(s) {
    state = s;
    listeners.forEach(function (cb) {
      try { cb(statusInfo()); } catch (e) { /* 回调异常不影响主流程 */ }
    });
  }
  function onStatus(cb) {
    listeners.push(cb);
    cb(statusInfo());
  }

  /* ---------- API ---------- */
  function api(method, body, opts) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl
      ? setTimeout(function () { ctrl.abort(); }, (opts && opts.timeoutMs) || 8000)
      : null;
    return fetch(API, {
      method: method,
      headers: { "Content-Type": "application/json", "X-App-Key": APP_KEY },
      body: body ? JSON.stringify(body) : undefined,
      keepalive: !!(opts && opts.keepalive),
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error("api_" + r.status);
      return r.json();
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  /* ---------- 合并：每行 LWW ---------- */
  function mergePull(remoteRows) {
    var prog = readJSON(PROG_KEY, {});
    var dirty = {};
    readJSON(DIRTY_KEY, []).forEach(function (id) { dirty[id] = true; });
    var nowMs = now();
    var remoteIds = {};

    (remoteRows || []).forEach(function (row) {
      if (!row || !row.concept_id) return;
      remoteIds[row.concept_id] = true;
      var local = prog[row.concept_id];
      if (!local) {
        // 远端独有 → 采纳
        prog[row.concept_id] = {
          box: row.box, due: row.due, updated_at: row.updated_at,
        };
      } else {
        if (!Number.isFinite(local.updated_at)) local.updated_at = nowMs; // 旧数据迁移
        if (row.updated_at > local.updated_at) {
          prog[row.concept_id] = {
            box: row.box, due: row.due, updated_at: row.updated_at,
          };
        } else if (local.updated_at > row.updated_at) {
          dirty[row.concept_id] = true; // 本地较新 → 稍后上推
        }
      }
    });

    // 本地有但远端没有的行 → 全部标脏上推（含老 localStorage 数据迁移）
    Object.keys(prog).forEach(function (id) {
      if (!Number.isFinite(prog[id].updated_at)) prog[id].updated_at = nowMs;
      if (!remoteIds[id]) dirty[id] = true;
    });

    writeJSON(PROG_KEY, prog);
    writeJSON(DIRTY_KEY, Object.keys(dirty));
  }

  /* ---------- 事件存取 ---------- */
  function loadEvents() {
    return readJSON(EVENTS_KEY, []);
  }
  function trimEvents(events) {
    // 超限时先丢最老的已发送事件，保住未发送的
    var over = events.length - MAX_EVENTS;
    if (over <= 0) return events;
    for (var i = 0; i < events.length && over > 0; i++) {
      if (events[i]._sent) { events.splice(i, 1); i--; over--; }
    }
    if (over > 0) events.splice(0, over); // 全是未发送也必须丢弃（极端情况）
    return events;
  }

  /* ---------- 上推 ---------- */
  function flush(opts) {
    opts = opts || {};
    var prog = readJSON(PROG_KEY, {});
    var dirtyIds = readJSON(DIRTY_KEY, []);
    var events = loadEvents();
    var unsent = events.filter(function (e) { return !e._sent; });
    var eventBudget = opts.urgent ? 100 : unsent.length;

    if (!dirtyIds.length && !unsent.length) {
      if (state !== "ready") setStatus("ready");
      return Promise.resolve();
    }

    var rows = dirtyIds.slice(0, MAX_ROWS).map(function (id) {
      var p = prog[id] || {};
      return {
        concept_id: id,
        box: p.box || 0,
        due: p.due || 0,
        updated_at: Number.isFinite(p.updated_at) ? p.updated_at : now(),
      };
    });
    var sendEvents = unsent.slice(0, eventBudget).map(function (e) {
      return {
        client_event_id: e.client_event_id,
        concept_id: e.concept_id,
        grade: e.grade,
        box: e.box,
        ts: e.ts,
      };
    });

    setStatus("syncing");
    return api("POST", { rows: rows, events: sendEvents }, opts).then(
      function (resp) {
        updateOffset(resp.server_time);
        // 只清除"发送时版本未被再次修改"的脏行，防上推途中新改动被误清
        var progNow = readJSON(PROG_KEY, {});
        var sentAt = {};
        rows.forEach(function (r) { sentAt[r.concept_id] = r.updated_at; });
        var remain = dirtyIds.filter(function (id) {
          return progNow[id] && progNow[id].updated_at !== sentAt[id];
        });
        // 处理上推途中新标脏的 id（不在本次 rows 里但已在 dirty 集合）
        readJSON(DIRTY_KEY, []).forEach(function (id) {
          if (sentAt[id] === undefined) remain.push(id);
        });
        writeJSON(DIRTY_KEY, remain.filter(function (id, i, a) {
          return a.indexOf(id) === i;
        }));
        // 标记已发送事件
        var sentIds = {};
        sendEvents.forEach(function (e) { sentIds[e.client_event_id] = true; });
        events = loadEvents();
        events.forEach(function (e) {
          if (sentIds[e.client_event_id]) e._sent = true;
        });
        writeJSON(EVENTS_KEY, trimEvents(events));
        pushFailures = 0;
        setStatus("ready");
      },
      function () {
        pushFailures++;
        setStatus("offline");
        // 指数退避自动重试（上限 60s），期间用户操作仍会触发防抖 flush
        schedulePush(Math.min(60000, 2000 * Math.pow(2, pushFailures)));
      }
    );
  }

  function schedulePush(delay) {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushTimer = null;
      flush();
    }, delay == null ? 2000 : delay);
  }

  /* ---------- 拉取（统一同步流程第一步） ---------- */
  function pull() {
    setStatus("pulling");
    return api("GET", null, { timeoutMs: 8000 }).then(
      function (resp) {
        updateOffset(resp.server_time);
        mergePull(resp.rows || []);
        mergeEvents(resp.events || []);
        initialized = true;
        return flush(); // 合并出的脏行立刻上推
      },
      function () {
        setStatus("offline"); // 纯 localStorage 模式，恢复后由重试/事件触发补传
      }
    );
  }

  function mergeEvents(remoteEvents) {
    if (!remoteEvents || !remoteEvents.length) return;
    var events = loadEvents();
    var known = {};
    events.forEach(function (e) { known[e.client_event_id] = true; });
    remoteEvents.forEach(function (e) {
      if (!e || !e.client_event_id || known[e.client_event_id]) return;
      events.push({
        client_event_id: e.client_event_id,
        concept_id: e.concept_id,
        grade: e.grade,
        box: e.box,
        ts: e.ts,
        _sent: true, // 远端来的必然已入库
      });
    });
    writeJSON(EVENTS_KEY, trimEvents(events));
  }

  /* ---------- 对外接口（script.js 调用） ---------- */
  function backfillLocal() {
    // 旧版 localStorage 数据没有 updated_at：本地即时回填并标脏（离线路径也能迁移）
    var prog = readJSON(PROG_KEY, {});
    var dirty = readJSON(DIRTY_KEY, []);
    var changed = false;
    Object.keys(prog).forEach(function (id) {
      if (!Number.isFinite(prog[id].updated_at)) {
        prog[id].updated_at = now();
        if (dirty.indexOf(id) === -1) dirty.push(id);
        changed = true;
      }
    });
    if (changed) {
      writeJSON(PROG_KEY, prog);
      writeJSON(DIRTY_KEY, dirty);
    }
  }

  function markDirty(conceptId) {
    var dirty = readJSON(DIRTY_KEY, []);
    if (dirty.indexOf(conceptId) === -1) {
      dirty.push(conceptId);
      writeJSON(DIRTY_KEY, dirty);
    }
    if (state === "offline") setStatus("offline"); // 保持徽章提示
    schedulePush(2000);
  }

  function logEvent(conceptId, grade, box) {
    var events = loadEvents();
    events.push({
      client_event_id: uuid(),
      concept_id: conceptId,
      grade: grade,
      box: box || 0,
      ts: now(),
      _sent: false,
    });
    writeJSON(EVENTS_KEY, trimEvents(events));
    schedulePush(2000);
  }

  function init() {
    if (!window.fetch) { setStatus("offline"); return; }
    backfillLocal();
    pull();

    // 三重 flush 之外的兜底：网络恢复立即补传
    window.addEventListener("online", function () {
      if (state === "offline") pull();
    });
    window.addEventListener("offline", function () {
      setStatus("offline");
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        flush({ urgent: true, keepalive: true, timeoutMs: 4000 });
      }
    });
    window.addEventListener("pagehide", function () {
      flush({ urgent: true, keepalive: true, timeoutMs: 4000 });
    });
  }

  /* 导出导入（统计看板功能）使用 */
  function exportData() {
    return {
      progress: readJSON(PROG_KEY, {}),
      events: loadEvents().map(function (e) {
        return {
          client_event_id: e.client_event_id,
          concept_id: e.concept_id,
          grade: e.grade,
          box: e.box,
          ts: e.ts,
        };
      }),
    };
  }
  function importData(data) {
    if (!data || typeof data !== "object") return { rows: 0, events: 0 };
    var prog = readJSON(PROG_KEY, {});
    var dirty = {};
    readJSON(DIRTY_KEY, []).forEach(function (id) { dirty[id] = true; });
    var rows = 0;
    var remote = data.progress || {};
    Object.keys(remote).forEach(function (id) {
      var r = remote[id] || {};
      var local = prog[id];
      if (!local || (r.updated_at || 0) > (local.updated_at || 0)) {
        prog[id] = {
          box: r.box || 0,
          due: r.due || 0,
          updated_at: r.updated_at || now(),
        };
        rows++;
      }
      dirty[id] = true;
    });
    writeJSON(PROG_KEY, prog);
    writeJSON(DIRTY_KEY, Object.keys(dirty));

    var events = loadEvents();
    var known = {};
    events.forEach(function (e) { known[e.client_event_id] = true; });
    var evAdded = 0;
    (data.events || []).forEach(function (e) {
      if (!e || !e.client_event_id || known[e.client_event_id]) return;
      events.push({
        client_event_id: e.client_event_id,
        concept_id: e.concept_id,
        grade: e.grade,
        box: e.box || 0,
        ts: e.ts || 0,
        _sent: false,
      });
      evAdded++;
    });
    writeJSON(EVENTS_KEY, trimEvents(events));
    schedulePush(500);
    return { rows: rows, events: evAdded };
  }

  window.ProgressSync = {
    init: init,
    now: now,
    markDirty: markDirty,
    logEvent: logEvent,
    onStatus: onStatus,
    getEvents: function () { return loadEvents(); },
    exportData: exportData,
    importData: importData,
    statusInfo: statusInfo,
  };

  init();
})();
