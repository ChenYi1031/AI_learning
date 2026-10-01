// sync.js 同步引擎的本地测试 harness（node 环境桩替换浏览器全局）
// 运行: node tools/test_sync_engine.mjs
// 场景：初始化拉取合并上推 / 服务端故障离线 / 恢复补传 / 事件幂等标记 / 双设备 LWW
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(ROOT, "sync.js"), "utf-8");

// ---- 浏览器全局桩 ----
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.document = {
  visibilityState: "visible",
  addEventListener: () => {},
};
globalThis.addEventListener = () => {};
globalThis.window = globalThis;
// Node 24 自带 globalThis.crypto（webcrypto），无需覆盖

const calls = []; // 捕获的 API 请求 {method, body}
let failMode = null; // null | "get" | "post" | "all"

function okResp(obj) {
  return Promise.resolve(new Response(JSON.stringify(obj), { status: 200 }));
}
function setFetch() {
  globalThis.fetch = (url, init) => {
    if (failMode === "all") return Promise.reject(new TypeError("network down"));
    const method = init?.method || "GET";
    if (failMode === method) return Promise.reject(new TypeError("network down"));
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ method, body });
    if (method === "GET") {
      if (failMode === "get") return Promise.reject(new TypeError("down"));
      return okResp({
        ok: true,
        server_time: Date.now(),
        rows: serverRows,
        events: serverEvents,
      });
    }
    if (failMode === "post") return Promise.reject(new TypeError("down"));
    // 模拟服务端 LWW + 事件幂等
    for (const row of body.rows || []) {
      const old = serverProgress.get(row.concept_id);
      if (!old || row.updated_at > old.updated_at) {
        serverProgress.set(row.concept_id, { ...row });
      }
    }
    for (const ev of body.events || []) {
      if (!serverEventIds.has(ev.client_event_id)) {
        serverEventIds.add(ev.client_event_id);
        serverEvents.push(ev);
      }
    }
    return okResp({ ok: true, server_time: Date.now(), accepted: 1 });
  };
}

// 服务端状态
const serverProgress = new Map();
const serverEvents = [];
const serverEventIds = new Set();
let serverRows = [];
globalThis.setTimeout_real = setTimeout;

function loadEngine() {
  calls.length = 0;
  setFetch();
  (0, eval)(source); // IIFE 自执行，暴露 window.ProgressSync
  return globalThis.ProgressSync;
}
function wait(ms) {
  return new Promise((r) => setTimeout_real(r, ms));
}
async function waitFor(fn, desc, timeoutMs = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (fn()) return;
    } catch { /* 条件未满足 */ }
    await wait(50);
  }
  throw new Error("等待超时: " + desc);
}

// ========== 场景 1：初始化 → 拉取合并 → 脏行上推 ==========
{
  store.clear();
  serverProgress.clear();
  serverEvents.length = 0;
  serverEventIds.clear();
  serverRows = [{ concept_id: "rag", box: 2, due: 100, updated_at: 500 }];

  // 本地已有一条更旧的数据 + 一条远端没有的数据
  store.set("ail_progress_v1", JSON.stringify({
    transformer: { box: 1, due: 9, updated_at: 100 },
  }));
  store.set("sync_dirty", JSON.stringify(["transformer"]));

  const Sync = loadEngine();
  await waitFor(
    () => Sync.statusInfo().state === "ready",
    "初始化后应收敛到 ready",
  );

  // 远端较新：本地 rag 应被远端版本覆盖
  const prog = JSON.parse(localStorage.getItem("ail_progress_v1"));
  assert.equal(prog.rag.box, 2, "远端较新行应采纳");
  assert.equal(prog.rag.updated_at, 500);
  // 本地 transformer(100) 远端没有 → 标脏并上推
  assert.ok(calls.some((c) => c.method === "POST" &&
    c.body.rows.some((r) => r.concept_id === "transformer")),
  "本地独有行应上推");
  // 上推后脏队列清空
  assert.equal(JSON.parse(localStorage.getItem("sync_dirty")).length, 0,
    "成功上推后脏队列应清空");
  // 时钟偏移已写入
  assert.ok(localStorage.getItem("sync_clock_offset") !== null, "应记录时钟偏移");
  console.log("✓ 场景1: 拉取合并 + 脏行上推 + 偏移记录");
}

// ========== 场景 2：评分 → 防抖上推 → 服务端可见 ==========
{
  const Sync = globalThis.ProgressSync;
  Sync.markDirty("rag");
  Sync.logEvent("rag", "yes", 3);
  // 模拟本地进度更新
  const prog = JSON.parse(localStorage.getItem("ail_progress_v1"));
  prog.rag = { box: 3, due: 999, updated_at: Sync.now() };
  localStorage.setItem("ail_progress_v1", JSON.stringify(prog));

  await waitFor(
    () => serverProgress.get("rag")?.box === 3,
    "防抖上推后服务端应看到 box=3",
  );
  assert.ok(serverEventIds.size >= 1, "事件应入服务端");
  await waitFor(
    () => JSON.parse(localStorage.getItem("ail_events_v1"))
      .every((e) => e._sent),
    "事件应标记 _sent",
  );
  console.log("✓ 场景2: 评分上推 + 事件幂等入库 + _sent 标记");
}

// ========== 场景 3：POST 故障 → 离线 → 恢复补传 ==========
{
  const Sync = globalThis.ProgressSync;
  failMode = "post";
  Sync.markDirty("loop-guard");
  const prog = JSON.parse(localStorage.getItem("ail_progress_v1"));
  prog["loop-guard"] = { box: 1, due: 1, updated_at: Sync.now() };
  localStorage.setItem("ail_progress_v1", JSON.stringify(prog));

  await waitFor(
    () => Sync.statusInfo().state === "offline",
    "POST 故障应进入离线模式",
  );
  assert.ok(
    JSON.parse(localStorage.getItem("sync_dirty")).includes("loop-guard"),
    "离线时脏行保留",
  );

  failMode = null; // 恢复
  Sync.markDirty("loop-guard"); // 再次触发 → 退避重试
  await waitFor(
    () => serverProgress.get("loop-guard")?.box === 1,
    "恢复后应补传",
  );
  await waitFor(
    () => Sync.statusInfo().state === "ready",
    "补传后回到 ready",
  );
  console.log("✓ 场景3: 离线降级 + 恢复补传");
}

// ========== 场景 4：GET 故障 → 离线（页面刷新模拟） ==========
{
  failMode = "get";
  store.clear();
  store.set("ail_progress_v1", JSON.stringify({
    kv: { box: 1, due: 1, updated_at: 1 }, // 旧数据无偏移依赖
  }));
  const Sync = loadEngine(); // 重新加载引擎（模拟刷新）
  await waitFor(
    () => Sync.statusInfo().state === "offline",
    "GET 故障应离线且不阻塞",
  );
  assert.equal(Sync.statusInfo().pending, 0,
    "GET 失败不应清空/推送脏队列");
  console.log("✓ 场景4: GET 故障快速离线（不卡 pulling）");
}

// ========== 场景 5：双端 LWW（本地较新胜，远端较新覆盖） ==========
{
  serverProgress.clear();
  serverEvents.length = 0;
  serverEventIds.clear();
  // 服务端有 transformer@1000
  serverProgress.set("transformer", { concept_id: "transformer", box: 2, due: 20, updated_at: 1000 });
  serverRows = [{ concept_id: "transformer", box: 2, due: 20, updated_at: 1000 }];
  failMode = null;
  store.clear();
  // 本地 transformer@2000（较新）→ 合并后应上推覆盖服务端
  store.set("ail_progress_v1", JSON.stringify({
    transformer: { box: 5, due: 50, updated_at: 2000 },
  }));
  store.set("sync_dirty", JSON.stringify(["transformer"]));
  const Sync = loadEngine();
  await waitFor(
    () => serverProgress.get("transformer")?.box === 5,
    "本地较新应胜出并覆盖服务端",
  );

  // 反向：服务端@3000 较新 → 下次拉取应覆盖本地
  serverProgress.set("transformer", { concept_id: "transformer", box: 1, due: 10, updated_at: 3000 });
  serverRows = [{ concept_id: "transformer", box: 1, due: 10, updated_at: 3000 }];
  // 触发重新拉取：刷新引擎
  store.set("ail_progress_v1", JSON.stringify({
    transformer: { box: 5, due: 50, updated_at: 2000 },
  }));
  const Sync2 = loadEngine();
  await waitFor(() => {
    const p = JSON.parse(localStorage.getItem("ail_progress_v1")).transformer;
    return p.box === 1;
  }, "远端较新应覆盖本地");
  console.log("✓ 场景5: 双端 LWW 双向验证");
}

console.log("\n✓✓ sync.js 全部 5 个场景通过");
process.exit(0);
