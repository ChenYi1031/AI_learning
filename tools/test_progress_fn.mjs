// node-functions/api/progress.js 的本地测试 harness（无外部依赖）
// 运行: node tools/test_progress_fn.mjs
// 通过 stub fetch 捕获发往 Turso 的 SQL，验证：鉴权、LWW 守卫、事件幂等、上限截断、Origin 过滤
import assert from "node:assert";

const captured = [];

function stubTurso(results) {
  // results 可为数组（按语句一一对应，不足时循环复用）或单个对象（所有语句共用）
  const list = Array.isArray(results) ? results : [results];
  globalThis.fetch = async (url, init) => {
    captured.push({ url, body: JSON.parse(init.body) });
    const reqs = JSON.parse(init.body).requests || [];
    return new Response(
      JSON.stringify({
        results: reqs.map((_, i) => ({
          type: "ok",
          response: { result: list[i % list.length] },
        })),
      }),
      { status: 200 },
    );
  };
}

const mod = await import("../node-functions/api/progress.js");
const env = {
  APP_KEY: "test-key",
  TURSO_DB_URL: "https://db.example.turso.io",
  TURSO_AUTH_TOKEN: "tok",
};

function req(method, { key = "test-key", body, origin } = {}) {
  return new Request("https://site.example.com/api/progress", {
    method,
    headers: {
      "x-app-key": key,
      ...(origin ? { origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ① 无/错 APP_KEY → 401
stubTurso();
let r = await mod.onRequestPost({ request: req("POST", { key: "wrong" }), env });
assert.equal(r.status, 401, "错误密钥应 401");
r = await mod.onRequestGet({ request: new Request("https://x/api/progress"), env });
assert.equal(r.status, 401, "缺密钥应 401");

// ② Origin 辅助过滤：跨域 Origin → 403
r = await mod.onRequestGet({
  request: req("GET", { origin: "https://evil.example.com" }),
  env,
});
assert.equal(r.status, 403, "跨域 Origin 应 403");

// ③ GET：透传 SELECT 且返回 server_time
captured.length = 0;
stubTurso([
  { cols: [], rows: [["rag", 2, 123, 456]] }, // progress 语句结果
  { cols: [], rows: [] },                      // events 语句结果
]);
r = await mod.onRequestGet({ request: req("GET"), env });
let data = await r.json();
assert.equal(r.status, 200);
assert.ok(captured[0].url.includes("/v2/pipeline"), "应请求 libSQL HTTP v2");
assert.ok(
  captured[0].body.requests[0].stmt.sql.includes("FROM progress"),
  "GET 应查 progress 表",
);
assert.equal(data.rows[0].concept_id, "rag");
assert.ok(Number.isFinite(data.server_time), "应返回 server_time");
assert.equal(data.events.length, 0);

// ④ POST：progress LWW 守卫 + 事件 INSERT OR IGNORE
captured.length = 0;
stubTurso();
r = await mod.onRequestPost({
  request: req("POST", {
    body: {
      rows: [
        { concept_id: "rag", box: 3, due: 100, updated_at: 999 },
        { concept_id: "bad-row", box: "x" }, // 非法行应被过滤
      ],
      events: [
        { client_event_id: "ev-1", concept_id: "rag", grade: "yes", box: 3, ts: 1 },
        { client_event_id: "ev-1", concept_id: "rag", grade: "yes", box: 3, ts: 1 }, // 重复
      ],
    },
  }),
  env,
});
data = await r.json();
assert.equal(r.status, 200);
const stmts = captured[0].body.requests.filter((q) => q.stmt);
const upsert = stmts.find((q) => q.stmt.sql.includes("ON CONFLICT"));
assert.ok(upsert, "应有 upsert 语句");
assert.ok(
  upsert.stmt.sql.includes("WHERE excluded.updated_at > progress.updated_at"),
  "upsert 必须带 LWW 服务端守卫",
);
assert.deepEqual(upsert.stmt.args, ["default", "rag", 3, 100, 999]);
const evStmts = stmts.filter((q) => q.stmt.sql.includes("INSERT OR IGNORE"));
assert.equal(evStmts.length, 2, "两条事件都应发往 DB（含重复），由 client_event_id UNIQUE + OR IGNORE 在库层去重");
assert.ok(
  evStmts[0].stmt.sql.includes("client_event_id"),
  "事件应携带幂等键",
);

// ⑤ 上限截断：300 行只处理前 200
captured.length = 0;
stubTurso();
const manyRows = Array.from({ length: 300 }, (_, i) => ({
  concept_id: "c" + i,
  box: 1,
  due: 1,
  updated_at: i,
}));
r = await mod.onRequestPost({ request: req("POST", { body: { rows: manyRows } }), env });
data = await r.json();
assert.ok(data.accepted <= 200, "行数上限截断生效");

// ⑥ 缺 Turso 配置 → 503
r = await mod.onRequestGet({ request: req("GET"), env: { APP_KEY: "test-key" } });
assert.equal(r.status, 503, "服务端未配置应 503");

console.log("✓ progress.js 全部 6 组断言通过");
