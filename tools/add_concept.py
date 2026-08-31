# -*- coding: utf-8 -*-
"""
向 AI_learning 知识库添加新概念（带完整校验与智能插入）。

用法:
    python tools/add_concept.py <新概念.json> [--after <已有概念id>]

新概念 JSON 为数组，每项需包含全部 15 个字段（image 可省略，自动置空）:
    id, category, name, summary, description, background, problem,
    analogy, points[], pitfalls[], applications[], example{scenario,code,lang},
    related[], extended

插入规则:
    - 默认插入到各自分类最后一个概念之后（新分类追加到文件末尾）
    - --after 指定锚点概念 id 时，整批插到它之后
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONCEPTS = ROOT / "concepts.json"
TUTORIALS = ROOT / "tutorials.json"

REQUIRED = ["id", "category", "name", "summary", "description", "background",
            "problem", "analogy", "points", "pitfalls", "applications",
            "example", "related", "extended"]
ARRAY_FIELDS = ["points", "pitfalls", "applications", "related"]


def main():
    if len(sys.argv) < 2:
        sys.exit("用法: python tools/add_concept.py <新概念.json> [--after <概念id>]")
    src = Path(sys.argv[1])
    after = None
    if "--after" in sys.argv:
        after = sys.argv[sys.argv.index("--after") + 1]

    items = json.loads(src.read_text(encoding="utf-8"))
    if isinstance(items, dict):
        items = [items]
    cs = json.loads(CONCEPTS.read_text(encoding="utf-8"))
    existing = {c["id"] for c in cs}
    tut_ids = set()
    if TUTORIALS.exists():
        tut_ids = {t["id"] for t in
                   json.loads(TUTORIALS.read_text(encoding="utf-8"))["tutorials"]}

    # ---- 校验 ----
    errors = []
    batch_ids = [c.get("id") for c in items]   # 同批引用先于校验收集
    seen_in_batch = set()
    for c in items:
        cid = c.get("id", "?")
        if cid in existing or cid in seen_in_batch:
            errors.append(f"[{cid}] id 已存在")
        seen_in_batch.add(cid)
        missing = [k for k in REQUIRED if not c.get(k)]
        if missing:
            errors.append(f"[{cid}] 缺字段: {missing}")
        for f in ARRAY_FIELDS:
            if f in c and (not isinstance(c[f], list) or not c[f]):
                errors.append(f"[{cid}] {f} 必须是非空数组")
        ex = c.get("example", {})
        if not (isinstance(ex, dict) and (ex.get("scenario") or ex.get("code"))):
            errors.append(f"[{cid}] example 需要 scenario 或 code 至少其一")
        bad = [r for r in c.get("related", [])
               if r not in existing and r not in tut_ids and r not in batch_ids]
        if bad:
            errors.append(f"[{cid}] related 引用不存在: {bad}")
    if errors:
        sys.exit("校验失败:\n" + "\n".join(errors))

    for c in items:
        c["image"] = ""  # 置空，让 build_images.py 生成新配图

    # ---- 插入 ----
    if after:
        pos = next((i for i, c in enumerate(cs) if c["id"] == after), None)
        if pos is None:
            sys.exit(f"锚点概念不存在: {after}")
        cs[pos + 1:pos + 1] = items
    else:
        groups = {}
        for c in items:
            groups.setdefault(c["category"], []).append(c)
        for category, group in groups.items():
            cat_pos = [i for i, c in enumerate(cs) if c["category"] == category]
            if cat_pos:
                end = cat_pos[-1] + 1
                cs[end:end] = group
            else:
                cs.extend(group)

    CONCEPTS.write_text(json.dumps(cs, ensure_ascii=False, indent=2),
                        encoding="utf-8")

    # ---- 复核 ----
    cs2 = json.loads(CONCEPTS.read_text(encoding="utf-8"))
    assert len({c["id"] for c in cs2}) == len(cs2), "id 重复!"
    no_img = [c["id"] for c in cs2 if not c.get("image")]
    cats = {}
    for c in cs2:
        cats[c["category"]] = cats.get(c["category"], 0) + 1
    print(f"已添加 {len(items)} 个概念，总数 {len(cs2)}")
    print(f"待生成配图: {len(no_img)} 张")
    print("下一步: python tools/build_images.py --workers 1")
    print("分类分布:", cats)


if __name__ == "__main__":
    main()
