# -*- coding: utf-8 -*-
"""
为 concepts.json 中的每个概念生成教学示意图（CogView-3-Flash）。
- 首次运行会为每个概念补充 id 字段（作为图片文件名）
- 已存在图片的概念自动跳过（可重复运行、断点续跑）
- 单张失败重试 3 次，仍失败则 image 留空，不中断整体流程
用法: python tools/build_images.py [--workers 3]
"""
import json
import os
import re
import sys
import time
import base64
import concurrent.futures as cf
from pathlib import Path

import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parent.parent
CONCEPTS = ROOT / "concepts.json"
IMG_DIR = ROOT / "images"
ENV_FILE = Path(r"D:/project/mcp-servers/zhipu-vision/.env")
API = "https://open.bigmodel.cn/api/paas/v4/images/generations"
MODEL = "cogview-3-flash"
SIZE = "1024x1024"
OUT_SIZE = 640  # 下载后缩放并转 WebP，控制仓库体积与页面加载

# 中文名 -> 文件名 slug（未列出的走自动规则或 c{序号}）
SLUG_MAP = {
    "自注意力机制（Self-Attention）": "self-attention",
    "Encoder-Decoder / Decoder-only / Encoder-only": "encoder-decoder",
    "余弦相似度": "cosine-similarity",
    "Top-p（核采样）": "top-p",
    "Top-k": "top-k",
    "Prompt Engineering": "prompt-engineering",
    "思维链（Chain of Thought, CoT）": "chain-of-thought",
    "ReAct 模式": "react-pattern",
    "ReAct 循环": "react-loop",
    "幻觉（Hallucination）": "hallucination",
    "上下文窗口（Context Window）": "context-window",
    "模型选型": "model-selection",
    "规划（Planning）": "planning",
    "工具调用（Tool Use）": "tool-use",
    "工具描述（JSON Schema）": "json-schema-tools",
    "短期记忆": "short-term-memory",
    "长期记忆": "long-term-memory",
    "工作记忆": "working-memory",
    "多 Agent 协作": "multi-agent",
    "死循环保护": "loop-guard",
    "反思（Reflexion）": "reflexion",
    "自我批评（Self-Critique）": "self-critique",
    "RAG（Retrieval-Augmented Generation）": "rag",
    "文档解析": "document-parsing",
    "分块（Chunking）": "chunking",
    "Embedding 模型": "embedding-model",
    "向量数据库": "vector-database",
    "近似最近邻（ANN）": "ann",
    "混合检索": "hybrid-search",
    "重排（Rerank）": "rerank",
    "查询改写": "query-rewrite",
    "上下文压缩": "context-compression",
    "RAG 评估": "rag-evaluation",
    "LCEL（LangChain Expression Language）": "lcel",
    "MCP（Model Context Protocol）": "mcp",
    "Dify / Coze": "dify-coze",
    "OpenAI API / DeepSeek API": "llm-api",
    "Python 基础": "python-basics",
    "异步编程（asyncio）": "asyncio",
    "HTTP 请求与重试": "http-retry",
    "日志与监控": "logging-monitoring",
    "容错与降级": "fault-tolerance",
    "Feign / RestTemplate": "feign-resttemplate",
    "JVM 内存模型": "jvm-memory",
    "HashMap 原理": "hashmap",
    "Java 多线程": "java-concurrency",
    "智能知识库问答 Agent": "kb-qa-agent",
    "自动化工作流 Agent": "workflow-agent",
    "项目架构设计": "project-architecture",
    "难点与优化": "challenges-optimization",
    "评估指标": "evaluation-metrics",
}

CATEGORY_THEME = {
    "大模型基础": "神经网络、注意力连线与数据流主题",
    "AI Agent 核心": "机器人助手、任务流程循环与齿轮主题",
    "RAG 检索增强生成": "文档、知识库与向量检索主题",
    "开发框架与工具": "代码模块、流程图与积木组件主题",
    "工程与后端": "服务器、数据库与网络主题",
    "Java 相关": "企业级代码架构主题",
    "项目实战概念": "系统架构蓝图主题",
}


def load_key():
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("ZHIPU_API_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("未找到 ZHIPU_API_KEY")


def slugify(name, idx):
    if name in SLUG_MAP:
        return SLUG_MAP[name]
    ascii_part = re.sub(r"[^a-zA-Z0-9]+", "-", name).strip("-").lower()
    if ascii_part and len(ascii_part) >= 2:
        return ascii_part[:60]
    return f"c{idx:02d}"


def ensure_ids(concepts):
    used = set()
    for i, c in enumerate(concepts, 1):
        if not c.get("id"):
            sid = slugify(c["name"], i)
            base, n = sid, 2
            while sid in used:
                sid = f"{base}-{n}"
                n += 1
            c["id"] = sid
        used.add(c["id"])
        c.setdefault("image", "")
    CONCEPTS.write_text(
        json.dumps(concepts, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def build_prompt(c):
    theme = CATEGORY_THEME.get(c["category"], "科技概念主题")
    return (
        f"扁平化矢量教学插画：{c['name']}。{theme}。"
        "深蓝色背景(#1a1a2e)，紫色(#6c63ff)与亮青色(#4ecdc4)点缀，"
        "简洁几何图形与图标组合，现代科技感，居中构图，边缘留白，"
        "画面中不要出现任何文字。"
    )


def gen_one(c, key):
    if c.get("image"):
        return c["id"], "skip"
    out = IMG_DIR / f"{c['id']}.webp"
    if out.exists():
        c["image"] = f"images/{c['id']}.webp"
        return c["id"], "exists"
    body = json.dumps(
        {"model": MODEL, "prompt": build_prompt(c), "size": SIZE}
    ).encode("utf-8")
    last_err = ""
    for attempt in range(3):
        try:
            req = urllib.request.Request(
                API,
                data=body,
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=90) as r:
                data = json.loads(r.read().decode("utf-8"))
            url = data["data"][0]["url"]
            with urllib.request.urlopen(url, timeout=90) as r:
                raw = r.read()
            b64 = data["data"][0].get("b64_json")
            raw = base64.b64decode(b64) if b64 else raw
            out.write_bytes(raw)
            resize(out)
            c["image"] = f"images/{c['id']}.webp"
            return c["id"], "ok"
        except Exception as e:  # 网络错误、限流、内容审核拒绝都重试后放弃
            last_err = f"{getattr(e, 'code', '')} {e}"
            time.sleep(5 * (attempt + 1))
    print(f"[FAIL] {c['id']}: {last_err}", flush=True)
    return c["id"], "fail"


def resize(path):
    from PIL import Image

    with Image.open(path) as im:
        im = im.convert("RGB").resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)
        im.save(path.with_suffix(".webp"), "WEBP", quality=82, method=6)
    path.unlink()  # 删除原始 PNG，只保留 WebP


def save(concepts):
    CONCEPTS.write_text(
        json.dumps(concepts, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def main():
    workers = 3
    if "--workers" in sys.argv:
        workers = int(sys.argv[sys.argv.index("--workers") + 1])
    IMG_DIR.mkdir(exist_ok=True)
    key = load_key()
    concepts = json.loads(CONCEPTS.read_text(encoding="utf-8"))
    ensure_ids(concepts)
    print(f"共 {len(concepts)} 个概念，{workers} 并发生成中…", flush=True)
    done = 0
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(gen_one, c, key) for c in concepts]
        for f in cf.as_completed(futs):
            cid, status = f.result()
            done += 1
            if status not in ("fail",):
                print(f"[{done}/{len(concepts)}] {cid}: {status}", flush=True)
            if done % 10 == 0:
                save(concepts)
    save(concepts)
    ok = sum(1 for c in concepts if c["image"])
    print(f"完成：成功 {ok}/{len(concepts)}", flush=True)


if __name__ == "__main__":
    main()
