# AI Agent 概念学习中心

一个纯静态、零依赖的知识学习网站：87 个 AI/Agent 相关概念卡 + 论文精读 + 实战项目教程，内置基于间隔重复的自测复习。

**在线地址**：https://chenyi1031.github.io/AI_learning/

## 功能

- **概念图鉴**：87 个概念 × 9 层学习内容（是什么/背景/解决什么问题/类比/要点/误区/应用场景/代码实例/延伸），分类筛选 + 全文搜索，概念间互相跳转
- **实战项目**：智能客服机器人、LLM 统一网关、竞品监控日报 Agent、多 Agent 内容流水线——含架构图、请求链路分步、核心代码与事故复盘
- **论文精读**：《Attention Is All You Need》小白向逐节串讲（原文对照 + 公式人话拆解）
- **自测复习**：闪卡主动回忆 + Leitner 间隔重复（1/3/7/14/30 天），学习进度存本地浏览器

## 本地预览

```bash
cd AI_learning
python -m http.server     # 访问 http://localhost:8000
```

> 直接双击 index.html 无法加载 JSON（浏览器 file:// 限制），必须起本地服务。

## 添加新知识点

**方式一（推荐）**：已配置 `add-knowledge` skill 的环境里，直接说"给学习网站添加一个概念：XXX"。

**方式二手动操作**：

```bash
# 1. 把新概念（15 字段，见 tools/add_concept.py 头部说明）写入 JSON 文件
# 2. 校验并插入（自动定位到对应分类末尾）
python tools/add_concept.py tools/_new.json
# 3. 生成配图（自动只补缺图；必须单并发防限流）
python tools/build_images.py --workers 1
# 4. 全量校验
python tools/validate.py
# 5. 提交推送，CI 会再次校验，Pages 自动部署
git add -A && git commit -m "添加概念 xxx" && git push
```

教程（论文/实战项目）同理：向 `tutorials.json` 追加条目，块类型见 `script.js` 的 `renderBlock`。

## 目录结构

```
├── index.html          # 页面骨架（三视图 + 弹窗 + 阅读器）
├── style.css           # 全部样式（无预处理器）
├── script.js           # 全部交互（无框架无依赖）
├── concepts.json       # 概念数据（唯一真源）
├── tutorials.json      # 教程数据
├── images/             # 配图（{id}.webp）
├── tools/
│   ├── add_concept.py  # 概念校验 + 智能插入
│   ├── build_images.py # CogView-3-Flash 配图生成（断点续跑）
│   ├── validate.py     # 数据完整性校验（CI 共用）
│   └── archive/        # 历史一次性脚本（勿在生产流程使用）
└── .github/workflows/  # push 时自动跑数据校验
```

## 技术说明

- 纯静态：无框架、无构建、无外部依赖，本地起任意静态服务器即可运行
- 图片：CogView-3-Flash 生成，640×640 WebP（全站 ~2MB）
- 学习进度存 localStorage（`ail_progress_v1`），换浏览器不同步
- 部署：GitHub Pages（main 分支根目录），push 后自动构建
