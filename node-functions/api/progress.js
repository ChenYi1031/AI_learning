// EdgeOne Pages Node Function: /api/progress
// 学习进度云同步 API —— 前端(sync.js)与 Turso(libSQL) 之间的薄代理。
//
// 运行时: Node.js（node-functions 目录，文件即路由 /api/progress）
// 数据面: libSQL HTTP v2 API（Hrana over HTTP）+ 原生 fetch —— 零 npm 依赖，
//         与 @libsql/client 走同一协议；如需换 SDK 只替换 tursoQuery() 一个函数。
// 鉴权:   X-App-Key 必验（APP_KEY 环境变量）；Origin 仅辅助过滤，不作为安全边界。
// 限流:   建议在 EdgeOne 控制台为 /api/progress 配边缘限流（如 30 次/分/IP）。

const USER_ID = "default"; // 单用户站点；多用户时改由请求携带并鉴权
const MAX_ROWS = 200;
const MAX_EVENTS = 500;
const EVENTS_PULL_LIMIT = 2000;
const EVENTS_PULL_WINDOW_MS = 90 * 86400000; // 拉回近 90 天事件供统计看板

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8" },
  });
}

function originAllowed(request) {
  // 辅助过滤：带了 Origin 但与请求主机不同 → 拒绝。无 Origin（curl 等）只看 APP_KEY。
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

// ---- libSQL HTTP v2 (Hrana over HTTP) ----
// Hrana 协议的 Value 是内嵌标签枚举，不接受裸 JSON 值：
// 文本 {"type":"text","value":"..."}、整数 {"type":"integer","value":"123"}（字符串化防精度丢失）
function toHranaArg(v) {
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? { type: "integer", value: String(v) }
      : { type: "float", value: v };
  }
  if (typeof v === "boolean") return { type: "integer", value: v ? "1" : "0" };
  return { type: "text", value: String(v) };
}

// 结果行单元格同为枚举编码 → 解包为原始值（integer 的 value 是字符串，转回数字交给调用方）
function unwrapCell(c) {
  if (c && typeof c === "object" && "value" in c) {
    return c.type === "integer" ? Number(c.value) : c.value;
  }
  return c;
}

function tursoBase(env) {
  // 兼容 libsql:// 与 https:// 两种配置格式
  return String(env.TURSO_DB_URL)
    .replace(/^libsql:\/\//, "https://")
    .replace(/\/+$/, "");
}

async function tursoQuery(env, stmts) {
  const res = await fetch(`${tursoBase(env)}/v2/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TURSO_AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: stmts
        .map((stmt) => ({
          type: "execute",
          stmt: { ...stmt, args: (stmt.args || []).map(toHranaArg) },
        }))
        .concat([{ type: "close" }]),
    }),
  });
  if (!res.ok) throw new Error(`turso_http_${res.status}`);
  const data = await res.json();
  for (const r of data.results || []) {
    if (r.type !== "ok") throw new Error("turso_stmt_error");
  }
  return (data.results || [])
    .filter((r) => r.type === "ok")
    .map((r) => r.response.result);
}

function validRow(row) {
  return (
    row &&
    typeof row.concept_id === "string" &&
    row.concept_id.length > 0 &&
    row.concept_id.length <= 128 &&
    Number.isFinite(Number(row.box)) &&
    Number.isFinite(Number(row.due)) &&
    Number.isFinite(Number(row.updated_at))
  );
}

function validEvent(ev) {
  return (
    ev &&
    typeof ev.client_event_id === "string" &&
    ev.client_event_id.length <= 64 &&
    typeof ev.concept_id === "string" &&
    ev.concept_id.length <= 128 &&
    typeof ev.grade === "string" &&
    ["yes", "no", "mark", "unmark"].includes(ev.grade)
  );
}

// GET: 全量进度 + 近期事件（供新设备冷启动与统计看板）
async function handleGet(env) {
  const [progress, events] = await tursoQuery(env, [
    {
      sql: "SELECT concept_id, box, due, updated_at FROM progress WHERE user_id = ? ORDER BY concept_id",
      args: [USER_ID],
    },
    {
      sql: `SELECT concept_id, grade, box, ts, client_event_id FROM review_events
            WHERE user_id = ? AND ts >= ?
            ORDER BY ts LIMIT ${EVENTS_PULL_LIMIT}`,
      args: [USER_ID, Date.now() - EVENTS_PULL_WINDOW_MS],
    },
  ]);
  return json({
    ok: true,
    server_time: Date.now(),
    rows: progress.rows.map((r) => {
      const [cid, box, due, updatedAt] = r.map(unwrapCell);
      return {
        concept_id: cid,
        box: Number(box),
        due: Number(due),
        updated_at: Number(updatedAt),
      };
    }),
    events: events.rows.map((r) => {
      const [cid, grade, box, ts, ceid] = r.map(unwrapCell);
      return {
        concept_id: cid,
        grade: grade,
        box: Number(box),
        ts: Number(ts),
        client_event_id: ceid,
      };
    }),
  });
}

// POST: progress 按 LWW upsert（服务端时间戳守卫），review_events 只追加（幂等）
async function handlePost(env, body) {
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS) : [];
  const events = Array.isArray(body.events)
    ? body.events.slice(0, MAX_EVENTS)
    : [];
  const stmts = [];

  for (const row of rows) {
    if (!validRow(row)) continue;
    stmts.push({
      sql: `INSERT INTO progress (user_id, concept_id, box, due, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, concept_id) DO UPDATE
            SET box = excluded.box,
                due = excluded.due,
                updated_at = excluded.updated_at
            WHERE excluded.updated_at > progress.updated_at`,
      args: [
        USER_ID,
        String(row.concept_id),
        Math.max(0, Math.min(5, Number(row.box) | 0)),
        Number(row.due) || 0,
        Number(row.updated_at) || 0,
      ],
    });
  }

  for (const ev of events) {
    if (!validEvent(ev)) continue;
    stmts.push({
      sql: `INSERT OR IGNORE INTO review_events
              (user_id, concept_id, grade, box, ts, client_event_id)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        USER_ID,
        String(ev.concept_id),
        String(ev.grade),
        Math.max(0, Math.min(5, Number(ev.box) | 0)),
        Number(ev.ts) || 0,
        String(ev.client_event_id),
      ],
    });
  }

  if (!stmts.length) {
    return json({ ok: true, server_time: Date.now(), accepted: 0 });
  }
  await tursoQuery(env, stmts);
  return json({ ok: true, server_time: Date.now(), accepted: stmts.length });
}

async function handle(request, env = {}) {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  const appKey = request.headers.get("x-app-key");
  if (!appKey || appKey !== env.APP_KEY) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (!originAllowed(request)) {
    return json({ ok: false, error: "bad_origin" }, 403);
  }
  if (!env.TURSO_DB_URL || !env.TURSO_AUTH_TOKEN) {
    return json({ ok: false, error: "server_misconfigured" }, 503);
  }
  try {
    if (request.method === "GET") return await handleGet(env);
    const body = await request.json().catch(() => ({}));
    return await handlePost(env, body);
  } catch {
    // 上游错误不回显细节，避免泄露内部信息
    return json({ ok: false, error: "upstream_error" }, 502);
  }
}

export async function onRequestGet(context) {
  return handle(context.request, context.env);
}

export async function onRequestPost(context) {
  return handle(context.request, context.env);
}

export default async function onRequest(context) {
  return handle(context.request, context.env);
}
