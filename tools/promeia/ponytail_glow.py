# -*- coding: utf-8 -*-
"""为 promeia_back 包加装马尾发光呼吸（ponytail_illuminate）。

干跑默认；--apply 才写文件（写前备份 .bak）：
  1. ponytail_illuminate.png 缩放后贴入 page.png 空白区
  2. sp.atlas 追加 ponytail_illuminate 区域
  3. promiya_back.json：ponytail 槽上方插入 ponytail_illuminate 叠加槽
     （setup 颜色 alpha=0 隐藏，随 ponytail 骨骼联动）+ 默认皮肤附件
     （与 ponytail 附件同 x/y/宽高/scale，像素级对位）+ "发光呼吸" 循环动画
     （槽位 alpha 0→峰值→0，ease-in-out-sine 贝塞尔）
"""
import json
import shutil
import sys
from PIL import Image

PACK = "D:/pet/packs/promeia_back"
SRC = "D:/pet-promiya/pet_reference/promiya/gpt_generate/spine_parts/selected"

# 呼吸参数（可调）
GLOW_PERIOD = 4.0     # 呼吸周期（秒）
GLOW_PEAK = 1.0       # 峰值 alpha（0→1→0 完整变化）
# ease-in-out-sine 归一化贝塞尔
SINE = (0.37, 0.0, 0.63, 1.0)

# 图集页内空白区（经区域占用核算：head_eye_eyeclosed 右边界 x≤881，下方 y≥465 全空）
GLOW_REGION = {"x": 884, "y": 476, "w": 94, "h": 240}


def sine_seg(t0, v0, t1, v1):
    px1, py1, px2, py2 = SINE
    return [
        round(t0 + (t1 - t0) * px1, 4), round(v0 + (v1 - v0) * py1, 4),
        round(t0 + (t1 - t0) * px2, 4), round(v0 + (v1 - v0) * py2, 4),
    ]


def alpha_keys():
    half = GLOW_PERIOD / 2
    return [
        {"time": 0, "value": 0, "curve": sine_seg(0, 0, half, GLOW_PEAK)},
        {"time": half, "value": GLOW_PEAK, "curve": sine_seg(half, GLOW_PEAK, GLOW_PERIOD, 0)},
        {"time": GLOW_PERIOD, "value": 0},
    ]


def build():
    atlas_path = f"{PACK}/sp.atlas"
    page_path = f"{PACK}/page.png"
    skel_path = f"{PACK}/promiya_back.json"

    atlas = open(atlas_path, encoding="utf-8").read()
    assert "ponytail_illuminate" not in atlas, "atlas 已有 ponytail_illuminate"

    # 核算 GLOW_REGION 不与既有区域重叠
    import re
    for m in re.finditer(r"bounds:(\d+),(\d+),(\d+),(\d+)", atlas):
        bx, by, bw, bh = map(int, m.groups())
        r = GLOW_REGION
        overlap = not (r["x"] + r["w"] <= bx or bx + bw <= r["x"] or
                       r["y"] + r["h"] <= by or by + bh <= r["y"])
        assert not overlap, f"GLOW_REGION 与区域 bounds:{bx},{by},{bw},{bh} 重叠"

    page = Image.open(page_path)
    assert GLOW_REGION["x"] + GLOW_REGION["w"] <= page.width
    assert GLOW_REGION["y"] + GLOW_REGION["h"] <= page.height

    glow = Image.open(f"{SRC}/ponytail_illuminate.png").convert("RGBA")
    glow_small = glow.resize((GLOW_REGION["w"], GLOW_REGION["h"]), Image.LANCZOS)
    page_out = page.convert("RGBA").copy()
    page_out.paste(glow_small, (GLOW_REGION["x"], GLOW_REGION["y"]))

    skel = json.load(open(skel_path, encoding="utf-8"))

    # 叠加槽：紧跟 ponytail 之后（绘制顺序在马尾之上、其余部件之下）
    slots = [s["name"] for s in skel["slots"]]
    assert "ponytail_illuminate" not in slots
    idx = slots.index("ponytail") + 1
    skel["slots"].insert(idx, {
        "name": "ponytail_illuminate",
        "bone": "ponytail",
        "attachment": "ponytail_illuminate",
        "color": "ffffff00",
    })

    base_att = skel["skins"][0]["attachments"]["ponytail"]["ponytail"]
    glow_att = dict(base_att)
    skel["skins"][0]["attachments"]["ponytail_illuminate"] = {
        "ponytail_illuminate": glow_att
    }

    assert "发光呼吸" not in skel["animations"]
    skel["animations"]["发光呼吸"] = {
        "slots": {
            "ponytail_illuminate": {"alpha": alpha_keys()}
        }
    }

    atlas_out = atlas.rstrip("\n") + "\n" + \
        f"ponytail_illuminate\nbounds:{GLOW_REGION['x']},{GLOW_REGION['y']},{GLOW_REGION['w']},{GLOW_REGION['h']}\n"

    summary = {
        "atlas region": atlas_out.strip().splitlines()[-2:],
        "slot insert index": idx,
        "glow attachment": glow_att,
        "animation keys": skel["animations"]["发光呼吸"],
    }
    return summary, {
        skel_path: json.dumps(skel, ensure_ascii=False, indent=2),
        atlas_path: atlas_out,
        page_path: page_out,
    }


if __name__ == "__main__":
    summary, outputs = build()
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if "--apply" not in sys.argv:
        print("\n[dry-run] 未写入。加 --apply 写入（自动 .bak 备份）。")
        sys.exit(0)
    for path, content in outputs.items():
        shutil.copy2(path, path + ".bak")
        if isinstance(content, Image.Image):
            content.save(path)
        else:
            open(path, "w", encoding="utf-8", newline="\n").write(content)
        print("written:", path)
