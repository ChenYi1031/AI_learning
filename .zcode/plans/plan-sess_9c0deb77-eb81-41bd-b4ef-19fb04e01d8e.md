# EdgeOne Pages + Turso 云同步 · 修订版实施计划

## 可行性结论（不变）
- **EdgeOne Pages**：✅ 静态站零改造，GitHub 集成自动部署，GitHub Pages 保留兜底
- **Turso 云同步**：✅ 可行，经 Node Functions 代理（token 服务端），localStorage 保留为离线层

## 已并入的修订（逐条落实）

**1. 函数选型**：`node-functions/api/progress.js`（Node.js 运行时，`onRequestGet/Post(context)` 导出，`context.env` 读环境变量——已查官方文档确认）。数据面用 **libSQL HTTP v2 API + 原生 fetch**（与 @libsql/client 同一协议，零 npm 依赖，规避构建/平台兼容风险；README 注明如需 SDK 可替换 tursoQuery 单函数）。

**2. Schema**：`review_events` 增加 `client_event_id TEXT UNIQUE` + `CREATE INDEX idx_review_events_user_ts ON review_events(user_id, ts)`；前端 UUID，服务端 `INSERT OR IGNORE` 防重复。

**3. 同步策略**：
- 时钟偏移存 `sync_clock_offset`（指数平滑更新），`updated_at` 一律用校准后时间
- flush 三重触发：2s 防抖 + `pagehide`（keepalive fetch）+ `visibilitychange→hidden`
- 首次迁移统一为：GET 远端 → 双向 LWW 合并进本地 → POST 合并后脏行（双端同时首开不互相覆盖）
- `progress` LWW upsert（服务端 `WHERE excluded.updated_at > progress.updated_at` 兜底）；`review_events` 只追加
- GET/POST 失败 → 离线模式徽章，纯 localStorage 继续用，恢复后补传

**4. 安全**：`X-App-Key` 必验（401）；Origin 仅辅助过滤（同域请求不做 CORS 白名单）；EdgeOne 控制台 `/api/progress` 配边缘限流 30次/分/IP（写入你的操作清单）；环境变量仅 `TURSO_DB_URL`、`TURSO_AUTH_TOKEN`、`APP_KEY`

**5. 本地开发与 CI**：`edgeone pages dev` 读 `.env`；提交 `.env.example`，`.gitignore` 增加 `.env`；`validate.py` 增加 `node --check`（script.js、sync.js、node-functions/**/*.js）；README 配额以官方为准 + 注明"未备案 *.edgeone.app 国内约 100–250ms，备案域名更优"

**6. 提交顺序**（4 个提交，验收含全部补充标准）：
1. 云同步本体：schema.sql + node-functions/api/progress.js + sync.js + script.js 接线（徽章/updated_at/markDirty/事件）+ node 测试 harness（stub fetch 验证 LWW SQL、幂等、401、上限截断）
2. 统计看板（复习热力图/分类掌握度/连续天数，数据源含跨设备拉回的事件）+ 导出导入（LWW 合并 + client_event_id 去重）
3. validate.py node --check + README + .env.example + add-knowledge skill 更新
4. 端到端验证：离线降级、断网补传、时钟偏移合并、事件不重复、后端挂掉站点完全可用；CI/Pages 状态确认

## 你需要手动做的（实施完成后我给精确清单）
1. Turso 建库（美东/新加坡）→ 执行 schema.sql → 拿 URL/Token
2. EdgeOne Pages 连 GitHub 仓库（静态，输出目录 `.`）→ 配 3 个环境变量 → `/api/progress` 配限流 → 发我分配的域名
3. APP_KEY：代码里已内置生成值，你填同一个到控制台
