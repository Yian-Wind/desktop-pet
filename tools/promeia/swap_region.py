# -*- coding: utf-8 -*-
"""把新素材图替换进 promeia_back 图集的指定区域，page.png 原文件改名备份。

page.png 是整张图集大图（所有部件平铺），sp.atlas 存各区域的矩形索引；
换某部件素材 = 把新图按 bounds 矩形贴回 page.png，atlas 与骨架不动。

用法（默认换 blade）：
  python tools/promeia/swap_region.py                    # 干跑
  python tools/promeia/swap_region.py --apply            # 写入
  python tools/promeia/swap_region.py --region head --src <png> --apply

规则：
  * 区域 bounds 按名字从 sp.atlas 查找；源图必须与区域同尺寸——
    尺寸不同应改 atlas/骨骼（越权）或拉伸（变形），都不做
  * 矩形整块替换：源图透明像素写入真透明（不用 mask paste，
    理由同 blade_orbit.py——mask 只分"替换/保留"会把半透明变不透明）
  * 区域内容已与源图一致时跳过（不产生备份文件垃圾）
  * 写入前把当前 page.png 复制为 page.backup-<时间戳>.png（同目录，不覆盖）
"""
import argparse
import os
import re
import shutil
import sys
from datetime import datetime
from PIL import Image

PACK = "D:/pet/packs/promeia_back"
DEFAULT_SRC = "D:/pet-promiya/pet_reference/promiya/gpt_generate/spine_parts/selected/blade.png"


def find_region(atlas_text, name):
    """按名字查区域 bounds。区域块 = 名字行 + 若干 key:value 属性行。"""
    lines = atlas_text.splitlines()
    for i, line in enumerate(lines):
        if line.strip() != name:
            continue
        for j in range(i + 1, len(lines)):
            m = re.match(r"^bounds:(\d+),(\d+),(\d+),(\d+)$", lines[j])
            if m:
                return tuple(int(v) for v in m.groups())
            if not re.match(r"^[A-Za-z_]+:", lines[j]):
                break  # 出了属性区（下一区域名/页头/空行）
    return None


def main():
    ap = argparse.ArgumentParser(description="替换图集区域素材（page.png 改名备份后写入）")
    ap.add_argument("--region", default="blade", help="sp.atlas 里的区域名（默认 blade）")
    ap.add_argument("--src", default=DEFAULT_SRC, help="新素材 PNG 路径")
    ap.add_argument("--apply", action="store_true", help="实际写入（默认干跑）")
    args = ap.parse_args()

    atlas_path = f"{PACK}/sp.atlas"
    page_path = f"{PACK}/page.png"
    atlas_text = open(atlas_path, encoding="utf-8").read()
    region = find_region(atlas_text, args.region)
    if not region:
        sys.exit(f"[swap] atlas 里找不到区域 {args.region!r}")
    rx, ry, rw, rh = region

    src = Image.open(args.src).convert("RGBA")
    if src.size != (rw, rh):
        sys.exit(f"[swap] 尺寸不符：区域 {args.region}={rw}x{rh}，源图={src.size[0]}x{src.size[1]}"
                 "（需同步改 sp.atlas bounds 与骨架附件，或重新导出同尺寸素材）")

    page = Image.open(page_path).convert("RGBA")
    cur = page.crop((rx, ry, rx + rw, ry + rh))
    print(f"[swap] region={args.region} bounds=({rx},{ry},{rw},{rh})")
    print(f"[swap] src={args.src}")

    if cur.tobytes() == src.tobytes():
        print("[swap] 区域内容已与源图一致，无需写入。")
        return
    if not args.apply:
        print("[dry-run] 有差异，未写入。加 --apply 写入（page.png 先改名备份）。")
        return

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = f"{os.path.splitext(page_path)[0]}.backup-{stamp}.png"
    shutil.copy2(page_path, backup)
    page.paste(src, (rx, ry))
    page.save(page_path)

    # 回读校验（PNG 无损，逐像素应完全一致）
    check = Image.open(page_path).crop((rx, ry, rx + rw, ry + rh))
    assert check.tobytes() == src.tobytes(), "回读校验失败"
    print(f"[swap] written: {page_path}（原文件备份: {os.path.basename(backup)}）")


if __name__ == "__main__":
    main()
