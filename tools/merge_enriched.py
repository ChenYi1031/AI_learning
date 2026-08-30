# -*- coding: utf-8 -*-
"""合并增强内容批次到 concepts.json。
批次文件只含新字段；description/analogy/points/example/image 沿用现有数据。
字段顺序面向学习动线编排。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARTS = ["part1", "part2", "part3", "part4"]

existing = json.loads((ROOT / "concepts.json").read_text(encoding="utf-8"))
by_id = {c["id"]: c for c in existing}

FIELD_ORDER = [
    "id", "category", "name", "summary", "description",
    "background", "problem", "analogy", "points", "pitfalls",
    "applications", "example", "related", "extended", "image",
]

merged_ids = []
for part in PARTS:
    items = json.loads((ROOT / "tools" / f"{part}.json").read_text(encoding="utf-8"))
    for item in items:
        cid = item["id"]
        assert cid in by_id, f"批次中的 id 不在现有数据里: {cid}"
        assert cid not in merged_ids, f"重复覆盖: {cid}"
        merged_ids.append(cid)
        by_id[cid].update(item)

missing = [c["id"] for c in existing if c["id"] not in merged_ids]
assert not missing, f"这些概念缺少增强内容: {missing}"

result = []
for c in existing:
    result.append({k: c[k] for k in FIELD_ORDER})

out = ROOT / "concepts.json"
out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"合并完成: {len(result)} 个概念，全部字段齐备")
