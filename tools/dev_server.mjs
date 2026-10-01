// 本地开发服务器：静态站点 + 内存版 /api/progress（与 Node Function 同一契约）
// 用途：本地完整体验云同步链路，无需 EdgeOne/Turso。数据存内存，重启即清。
// 运行: node tools/dev_server.mjs [端口]   默认 8000
// 双设备模拟: 127.0.0.1:8000 与 localhost:8000 是不同 origin，localStorage 互相独立。

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.argv[2]) || 8000;
const APP_KEY = process.env.APP_KEY || "ail_d5207a4bbb992bf9405c68ef2e50ed93";

// ---- 内存版进度库（语义与 tools/schema.sql + node-functions/api/progress.js 一致） ----
const progress = new Map(); // concept_id -> {box, due, updated_at}
const events = [];          // {concept_id, grade, box, ts, client_event_id}
const eventIds = new Set();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function json(res, obj, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=UTF-8" });
  res.end(JSON.stringify(obj));
}

async function handleApi(req, res) {
  if (req.headers["x-app-key"] !== APP_KEY) {
    return json(res, { ok: false, error: "unauthorized" }, 401);
  }
  if (req.method === "GET") {
    return json(res, {
      ok: true,
      server_time: Date.now(),
      rows: [...progress.entries()].map(([concept_id, p]) => ({
        concept_id, box: p.box, due: p.due, updated_at: p.updated_at,
      })),
      events: events.map(({ concept_id, grade, box, ts, client_event_id }) => ({
        concept_id, grade, box, ts, client_event_id,
      })),
    });
  }
  if (req.method === "POST") {
    const body = await new Promise((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => resolve(JSON.parse(raw || "{}")));
    });
    let accepted = 0;
    for (const row of body.rows || []) {
      const old = progress.get(row.concept_id);
      // LWW 服务端守卫：与生产函数同款
      if (!old || row.updated_at > old.updated_at) {
        progress.set(row.concept_id, {
          box: row.box | 0, due: row.due | 0, updated_at: row.updated_at,
        });
        accepted++;
      }
    }
    for (const ev of body.events || []) {
      if (eventIds.has(ev.client_event_id)) continue; // 幂等
      eventIds.add(ev.client_event_id);
      events.push(ev);
      accepted++;
    }
    return json(res, { ok: true, server_time: Date.now(), accepted });
  }
  json(res, { ok: false, error: "method_not_allowed" }, 405);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/progress") return handleApi(req, res);

  let path = decodeURIComponent(url.pathname);
  if (path === "/" || path === "") path = "/index.html";
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
});

server.listen(PORT, () => {
  console.log(`AI_learning dev server: http://localhost:${PORT}`);
  console.log("内存版 /api/progress 已就绪（重启即清空，仅用于本地联调）");
});
