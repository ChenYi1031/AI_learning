# AI Agent 概念学习中心

一个纯静态、零依赖的知识学习网站：99 个 AI/Agent 相关概念卡 + 论文精读 + 实战项目教程，内置间隔重复自测复习与跨设备云同步（Turso）。

**在线地址**：
- 主站（EdgeOne Pages，国内访问更快）：部署后由 EdgeOne 分配 `*.edgeone.app` 域名
- 兜底镜像（GitHub Pages）：https://chenyi1031.github.io/AI_learning/

## 功能

- **概念图鉴**：99 个概念 × 9 层学习内容（是什么/背景/解决什么问题/类比/要点/误区/应用场景/代码实例/延伸），分类筛选 + 全文搜索，概念间互相跳转
- **实战项目**：6 个项目（智能客服、LLM 网关、日报 Agent、多 Agent 流水线、秒杀系统、CI/CD 流水线）——含架构图、请求链路分步、核心代码与事故复盘
- **论文精读**：《Attention Is All You Need》小白向逐节串讲（原文对照 + 公式人话拆解）
- **自测复习**：闪卡主动回忆 + Leitner 间隔重复（1/3/7/14/30 天）
- **云同步**：学习进度经 EdgeOne Node Function 存入 Turso，跨设备跟随；离线时暂存 localStorage 自动补传
- **学习统计**：复习热力图（近 12 周）、分类掌握度、连续打卡天数
- **数据导出/导入**：一键备份 JSON，导入按 LWW 合并

## 架构

```
浏览器（纯静态）                EdgeOne Pages              Turso (libSQL)
┌───────────────────┐  fetch  ┌──────────────────┐ HTTP  ┌──────────────┐
│ localStorage       │◀──────▶│ node-functions/  │──────▶│ progress     │
│ 离线缓存+乐观写入   │ /api/  │ api/progress.js  │ v2 API│ review_events│
│ sync.js 同步引擎    │progress│ (token 在环境变量) │       │              │
└───────────────────┘        └──────────────────┘       └──────────────┘
```

- 同步策略：加载时 GET → 双向 LWW 合并 → POST 脏行；`server_time` 校准本机时钟偏差；2s 防抖 + pagehide + visibilitychange 三重 flush
- 可靠性：任何后端故障自动进入离线模式（纯 localStorage 照常工作），恢复后自动补传；`review_events` 以 `client_event_id` 幂等，服务端 `INSERT OR IGNORE` 防重复
- 安全：`X-App-Key` 共享密钥（个人单用户站点的务实方案）；生产环境建议在 EdgeOne 控制台为 `/api/progress` 配边缘限流（如 30 次/分/IP）

## 本地预览

```bash
# 方式一：纯静态（无后端，同步徽章显示"离线模式"，其余功能完整）
python -m http.server

# 方式二：带内存版后端（可完整体验云同步链路，数据重启即清）
node tools/dev_server.mjs        # http://localhost:8000
# 双设备模拟：127.0.0.1:8000 与 localhost:8000 是不同 origin，进度互相独立
```

> 直接双击 index.html 无法加载 JSON（浏览器 file:// 限制），必须起本地服务。

## 部署

### EdgeOne Pages（主站，国内访问更快）

1. 腾讯云 EdgeOne Pages 控制台 → 创建项目 → 连接本 GitHub 仓库
2. 构建配置：框架选"无/静态"，输出目录填仓库根 `.`
3. 环境变量（项目设置）：
   - `TURSO_DB_URL`：Turso 数据库地址
   - `TURSO_AUTH_TOKEN`：Turso 数据库 Token
   - `APP_KEY`：与 `sync.js` 中内置值一致的个人密钥（见 `.env.example`）
4. 建议为 `/api/progress` 配置边缘限流（如 30 次/分/IP）
5. push 到 main 后自动部署

访问延迟：未备案的 `*.edgeone.app` 域名走全球边缘节点，国内约 100–250ms；绑定已备案自定义域名可调度大陆节点，体验更优。

### GitHub Pages（兜底镜像）

绑定 main 分支根目录自动部署，作为主站故障时的备份入口。注意：Pages 域名下 `/api/progress` 不存在，同步徽章显示离线模式，学习功能不受影响（进度暂存本地，回主站后自动补传）。

### Turso 数据库（免费）

1. 注册 [turso.tech](https://turso.tech) → 创建数据库（区域选美东或新加坡）
2. 在 SQL Console 执行 `tools/schema.sql`
3. 获取 Database URL 与 Token 填入 EdgeOne 环境变量

配额以 [官方定价页](https://turso.tech/pricing) 为准；个人学习记录（百行级数据、每天几十次写入）远低于免费额度，实际零成本。

## 添加新知识点

**方式一（推荐）**：已配置 `add-knowledge` skill 的环境里，直接说"给学习网站添加一个概念：XXX"。

**方式二手动操作**：

```bash
# 1. 把新概念（15 字段，见 tools/add_concept.py 头部说明）写入 JSON 文件
# 2. 校验并插入（自动定位到对应分类末尾）
python tools/add_concept.py tools/_new.json
# 3. 生成配图（自动只补缺图；必须单并发防限流）
python tools/build_images.py --workers 1
# 4. 全量校验（含 node --check JS 语法）
python tools/validate.py
# 5. 提交推送，CI 再次校验，EdgeOne/Pages 自动部署
git add -A && git commit -m "添加概念 xxx" && git push
```

教程（论文/实战项目）同理：向 `tutorials.json` 追加条目，块类型见 `script.js` 的 `renderBlock`。

## 目录结构

```
├── index.html              # 页面骨架（四视图 + 弹窗 + 阅读器）
├── style.css               # 全部样式（无预处理器）
├── script.js               # 全部交互（无框架无依赖）
├── sync.js                 # 云同步引擎（LWW/时钟校准/离线降级）
├── concepts.json           # 概念数据（唯一真源）
├── tutorials.json          # 教程数据
├── images/                 # 配图（{id}.webp）
├── node-functions/
│   └── api/progress.js     # EdgeOne Node Function：/api/progress → Turso
├── tools/
│   ├── add_concept.py      # 概念校验 + 智能插入
│   ├── build_images.py     # CogView-3-Flash 配图生成（断点续跑）
│   ├── validate.py         # 数据完整性 + JS 语法校验（CI 共用）
│   ├── dev_server.mjs      # 本地开发服务器（静态 + 内存版 API）
│   ├── schema.sql          # Turso 建表语句
│   ├── test_progress_fn.mjs # Node Function 单元测试（stub fetch）
│   └── archive/            # 历史一次性脚本
├── .env.example            # 环境变量模板（.env 已被 gitignore）
└── .github/workflows/      # push 时自动跑数据校验
```

## 技术说明

- 纯静态：无框架、无构建、无外部依赖；后端为单文件 Node Function（libSQL HTTP v2 零 npm 依赖，与 @libsql/client 同协议）
- 图片：CogView-3-Flash 生成，640×640 WebP（全站 ~2MB）
- 学习进度：localStorage（`ail_progress_v1`）即时可用 + Turso 云端真源；导入导出 JSON 可作第三重备份
- 部署：EdgeOne Pages（主）+ GitHub Pages（兜底），CI 校验失败会邮件告警

## 故障排查

| 现象 | 处理 |
|---|---|
| 徽章一直"离线模式" | 检查 Node Function 是否部署成功、环境变量是否齐全；浏览器控制台看 /api/progress 返回码 |
| 401 unauthorized | EdgeOne 环境变量 APP_KEY 与 sync.js 内置值不一致 |
| 503 server_misconfigured | TURSO_DB_URL / TURSO_AUTH_TOKEN 未配置或为空 |
| 两台设备进度不一致 | 刷新即触发合并（LWW）；极端冲突以最后写入为准 |
