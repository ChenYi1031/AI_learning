# -*- coding: utf-8 -*-
"""一次性优化：images/ 内全部 PNG 转 WebP（q82），删除原 PNG，
并同步更新 concepts.json 的 image 路径。幂等：无 PNG 时直接跳过。"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "images"

converted, saved_before, saved_after = 0, 0, 0
for png in sorted(IMG.glob("*.png")):
    raw = png.read_bytes()
    saved_before += len(raw)
    with Image.open(png) as im:
        im.convert("RGB").save(
            png.with_suffix(".webp"), "WEBP", quality=82, method=6)
    webp = png.with_suffix(".webp")
    saved_after += webp.stat().st_size
    png.unlink()
    converted += 1

if converted:
    cs_path = ROOT / "concepts.json"
    cs = json.loads(cs_path.read_text(encoding="utf-8"))
    n = 0
    for c in cs:
        if c.get("image", "").endswith(".png"):
            c["image"] = c["image"][:-4] + ".webp"
            n += 1
    cs_path.write_text(json.dumps(cs, ensure_ascii=False, indent=2),
                       encoding="utf-8")
    print(f"转换 {converted} 张 PNG -> WebP，同步更新 {n} 个 image 路径")
    print(f"体积: {saved_before/1024/1024:.1f}MB -> {saved_after/1024/1024:.1f}MB "
          f"(约 {saved_before/max(saved_after,1):.1f} 倍瘦身)")
else:
    print("没有需要转换的 PNG")
