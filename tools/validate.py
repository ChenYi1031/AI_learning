# -*- coding: utf-8 -*-
"""站点数据完整性校验（CI 与本地共用）。
用法: python tools/validate.py  —— 全部通过退出码 0，否则非 0。
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
errors, warnings = [], []

# ---------- concepts.json ----------
cs_path = ROOT / "concepts.json"
try:
    cs = json.loads(cs_path.read_text(encoding="utf-8"))
except Exception as e:
    sys.exit(f"concepts.json 解析失败: {e}")

REQUIRED = ["id", "category", "name", "summary", "description", "background",
            "problem", "analogy", "points", "pitfalls", "applications",
            "example", "related", "extended", "image"]

ids = set()
for i, c in enumerate(cs):
    cid = c.get("id", f"#{i}")
    missing = [k for k in REQUIRED if k not in c or c[k] in ("", [], {})]
    if missing:
        errors.append(f"概念[{cid}] 缺字段: {missing}")
    if cid in ids:
        errors.append(f"概念 id 重复: {cid}")
    ids.add(cid)
    img = c.get("image", "")
    if not (ROOT / img).exists():
        errors.append(f"概念[{cid}] 图片不存在: {img}")
    if img and not img.endswith(".webp"):
        errors.append(f"概念[{cid}] 图片不是 webp: {img}")
    ex = c.get("example", {})
    if not isinstance(ex, dict) or not (ex.get("scenario") or ex.get("code")):
        errors.append(f"概念[{cid}] example 缺 scenario/code")

# ---------- tutorials.json ----------
tut_path = ROOT / "tutorials.json"
tut_ids = set()
try:
    tuts = json.loads(tut_path.read_text(encoding="utf-8"))["tutorials"]
    for t in tuts:
        tid = t.get("id", "?")
        if tid in ids:
            errors.append(f"教程 id 与概念冲突: {tid}")
        if tid in tut_ids:
            errors.append(f"教程 id 重复: {tid}")
        tut_ids.add(tid)
        if t.get("type") not in ("paper", "project"):
            errors.append(f"教程[{tid}] type 非法: {t.get('type')}")
        for s in t.get("sections", []):
            for b in s.get("blocks", []):
                if b.get("type") == "concepts":
                    for ref in b.get("ids", []):
                        if ref not in ids:
                            errors.append(f"教程[{tid}] 引用不存在的概念: {ref}")
except Exception as e:
    errors.append(f"tutorials.json 校验失败: {e}")

# ---------- related 双向引用 ----------
for c in cs:
    for ref in c.get("related", []):
        if ref not in ids and ref not in tut_ids:
            errors.append(f"概念[{c['id']}] related 引用不存在: {ref}")

# ---------- index.html 引用的资源 ----------
html = (ROOT / "index.html").read_text(encoding="utf-8")
for f in ["script.js", "style.css"]:
    if f not in html or not (ROOT / f).exists():
        errors.append(f"index.html 引用的 {f} 缺失")

# ---------- 汇总 ----------
for w in warnings:
    print("WARN:", w)
if errors:
    for e in errors:
        print("ERROR:", e)
    print(f"\n校验失败: {len(errors)} 个错误")
    sys.exit(1)
print(f"校验通过: {len(cs)} 个概念, {len(tut_ids)} 个教程, 图片与引用完整")
