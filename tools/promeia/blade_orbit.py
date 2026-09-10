# -*- coding: utf-8 -*-
"""为 promeia_back 包加装「刃舞」双刃环绕动画。

干跑默认；--apply 才写文件（.bak 备份，已有 .bak 不覆盖）：
  1. blade.png 原尺寸贴入 page.png 右下空闲区
  2. sp.atlas 追加单一 blade 区域（两个附件共用，经 path 引用）
  3. promiya_back.json：追加 blade_a / blade_b 槽位（setup 隐藏）+ 7 根骨骼 +
     默认皮肤附件 + 「刃舞」动画

骨骼结构（伪 3D 椭圆公转，全部挂在小臂下，随手部摆动联动）：
  forearm_r_round（举臂 + 小幅摆动）
  └─ blade_plane    轨道中心（手心）；rotation=180+倾角，scaleY=压扁 K
     └─ blade_revolve  匀速 +720°（压扁系内匀速圆周 = 屏幕椭圆，逆时针）
        ├─ blade_center_a(x=R) → blade_spin_a（自转 + 透视缩放）→ 槽位 blade_a
        └─ blade_offset_b(+180°) → blade_center_b(x=R) → blade_spin_b → 槽位 blade_b

原理：
  * scaleY=K 把圆周压成椭圆：短轴沿小臂方向 ±倾角，长轴垂直小臂；
    同一压扁也作用于叶片剪影 = 盘面透视（自转面出屏）；
  * 屏幕自转 = 公转 +720° + 相对 -1440° = 顺时针 2 圈；
  * 深度沿短轴变化、在长轴两端（φ=0°/180°）过零 —— 分层切换与透视缩放
    都按公转相位每半圈触发：指尖侧（φ∈0..180）= 远 = 小臂下层 + 缩小，
    肘侧（φ∈180..360）= 近 = 小臂上层 + 放大（LAYER_FLIP 可整体翻转）；
  * 层级：举臂期间 forearm_r_round 临时提到 coat 之上（draworder 时间线），
    "小臂下层"的刃只被小臂遮挡、不会被身体/头/大衣遮挡；动画末帧恢复
    setup 顺序，打断由渲染端守卫 setToSetupPose 复位。
"""
import json
import math
import os
import re
import shutil
import sys
from PIL import Image

PACK = "D:/pet/packs/promeia_back"
SRC = "D:/pet-promiya/pet_reference/promiya/gpt_generate/spine_parts/selected"

# ============================ 参数区 ============================
DURATION = 10.0          # 总时长（秒）；behavior-engine 的 IDLE_SHOW_DURATION_SECONDS 与此同步
RAISE_T = 0.4            # 抬臂时长
HOLD_END = 9.4           # 公转窗口结束（之后落臂）
UPARM_ABDUCT_DEG = 4.0    # 大臂外展（正=屏幕逆时针，很小的防僵硬角度，基础位置大臂不动）
FOREARM_RAISE_DEG = 116.0  # 小臂相对大臂 60°（世界角 4+116=120°，小臂局部-y 指向右上）
SWAY_UPARM_DEG = 1.0     # 大臂摆动幅度
SWAY_FOREARM_DEG = 2.5   # 小臂摆动幅度
SWAY_PERIOD = 2.0        # 手臂摆动周期（秒），(HOLD_END-RAISE_T) 需为半周期整数倍

ORBIT_TURNS = 2.0        # 公转圈数（屏幕逆时针）
SPIN_TURNS = 2.0         # 屏幕可见自转圈数（顺时针）
ORBIT_RADIUS = 60.0      # 轨道长半轴（spine 单位，长轴 ⊥ 小臂）
FLATTEN_K = 0.5          # 压扁系数（短轴 = R×K，沿小臂方向）
ORBIT_TILT_DEG = 10.0    # 黄道倾角（短轴与小臂的夹角；正值=整体平面向上倾）
ORBIT_CENTER_LOCAL = (48.0, -118.0)  # 轨道中心（小臂骨骼局部坐标，掌心中心线；图像列99→骨骼x=48.5）
NEAR_SCALE = 1.15        # 近端放大
FAR_SCALE = 0.85         # 远端缩小
LAYER_FLIP = False       # True = 远近/层级翻转（预览后如上下层反了改这里）

BLADE_SCALE = 0.28        # blade 贴图渲染缩放（半径加大后为守住右缘可视域相应缩小）
BLADE_ART_ROT = 0.0      # 贴图在自转骨骼上的初始朝向（预览后调）
FADE_IN_T = 0.35         # 刃淡入时长（自 RAISE_T 起）
FADE_OUT_T = 0.35        # 刃淡出时长（止于 HOLD_END）

BLADE_REGION = (1000, 480)  # page.png 粘贴左上角（253×247 右下空闲带）
# ================================================================

SINE = (0.37, 0.0, 0.63, 1.0)      # ease-in-out-sine
LINEAR = (0.0, 0.0, 1.0, 1.0)


def abs_curve(t0, v0, t1, v1, preset):
    px1, py1, px2, py2 = preset
    return [
        round(t0 + (t1 - t0) * px1, 4), round(v0 + (v1 - v0) * py1, 4),
        round(t0 + (t1 - t0) * px2, 4), round(v0 + (v1 - v0) * py2, 4),
    ]


def rot_key(t, value, curve=None):
    k = {"value": round(value, 3)}
    if t is not None:
        k["time"] = round(t, 4)
    if curve is not None:
        k["curve"] = curve
    return k


def alpha_key(t, value, curve=None):
    k = {"value": round(value, 4)}
    if t is not None:
        k["time"] = round(t, 4)
    if curve is not None:
        k["curve"] = curve
    return k


def scale_key(t, v, curve=None):
    k = {"time": round(t, 4), "x": round(v, 4), "y": round(v, 4)}
    if curve is not None:
        k["curve"] = curve + curve  # 双值时间线：x/y 各 4 数
    return k


def offsets_result(slot_names, offsets):
    """单帧 offsets 的 SkeletonJson 解析模拟（照抄 spine-core SkeletonJson.js:1000-1029）。"""
    n = len(slot_names)
    index_of = {name: i for i, name in enumerate(slot_names)}
    draw_order = [-1] * n
    unchanged = []
    original_index = 0
    for om in offsets:
        slot_index = index_of[om["slot"]]
        while original_index != slot_index:
            unchanged.append(original_index)
            original_index += 1
        draw_order[original_index + om["offset"]] = original_index
        original_index += 1
    while original_index < n:
        unchanged.append(original_index)
        original_index += 1
    ui = 0
    for i in range(n - 1, -1, -1):
        if draw_order[i] == -1:
            draw_order[i] = unchanged[len(unchanged) - 1 - ui]
            ui += 1
    assert -1 not in draw_order and sorted(draw_order) == list(range(n))
    return [slot_names[i] for i in draw_order]


def assert_free_region(atlas_text, region, page_w, page_h, self_ok=False):
    rx, ry, rw, rh = region
    assert 0 <= rx and rx + rw <= page_w, f"region x 越页: {region}"
    assert 0 <= ry and ry + rh <= page_h, f"region y 越页: {region}"
    for m in re.finditer(r"bounds:(\d+),(\d+),(\d+),(\d+)", atlas_text):
        bx, by, bw, bh = map(int, m.groups())
        same = (bx, by, bw, bh) == (rx, ry, rw, rh)
        if self_ok and same:
            continue  # 幂等重跑：blade 区域已注册且与粘贴区一致
        overlap = not (rx + rw <= bx or bx + bw <= rx or
                       ry + rh <= by or by + bh <= ry)
        assert not overlap, f"region {region} 与 bounds:{bx},{by},{bw},{bh} 重叠"


def build():
    atlas_path = f"{PACK}/sp.atlas"
    page_path = f"{PACK}/page.png"
    skel_path = f"{PACK}/promiya_back.json"

    atlas_text = open(atlas_path, encoding="utf-8").read()
    skel = json.load(open(skel_path, encoding="utf-8"))
    slot_names = [s["name"] for s in skel["slots"]]
    bone_names = [b["name"] for b in skel["bones"]]
    already = "blade_plane" in bone_names  # 幂等重跑：结构已存在则只更新
    if not already:
        assert "blade_a" not in slot_names, "skeleton 已有 blade_a 槽位但无 blade_plane 骨骼，状态异常"
        assert "刃舞" not in skel["animations"], "skeleton 已有 刃舞 动画"

    # ---------------- 图集 ----------------
    page = Image.open(page_path)
    blade = Image.open(f"{SRC}/blade.png").convert("RGBA")
    bw, bh = blade.size
    assert_free_region(atlas_text, BLADE_REGION + (bw, bh), page.width, page.height,
                       self_ok="\nblade\n" in atlas_text)
    page_out = page.convert("RGBA").copy()
    page_out.paste(blade, BLADE_REGION, blade)  # 幂等：同区域重复贴无副作用
    if "\nblade\n" in atlas_text:
        atlas_out = atlas_text
    else:
        atlas_out = atlas_text.rstrip("\n") + "\n" + \
            f"blade\nbounds:{BLADE_REGION[0]},{BLADE_REGION[1]},{bw},{bh}\n"

    # ---------------- 骨骼 ----------------
    def add_bone(name, parent, x=0, y=0, rotation=0, sy=1):
        setup = {"name": name, "parent": parent, "x": round(x, 2), "y": round(y, 2)}
        if rotation:
            setup["rotation"] = round(rotation, 2)
        if sy != 1:
            setup["scaleY"] = round(sy, 4)
        existing = next((b for b in skel["bones"] if b["name"] == name), None)
        if existing:
            parent_prev = existing.pop("parent", None)
            existing.update(setup)
            existing["parent"] = parent if already else parent_prev
        else:
            skel["bones"].append(setup)
            bone_names.append(name)

    # blade_plane 局部 +x = 轨道长轴；+y = 短轴（被 scaleY 压扁）。
    # 小臂局部 +y 沿手臂方向（肘→手为 -y），+x 与手臂垂直；长轴须⊥小臂，
    # 故 plane 相对 forearm 旋转 180°（+x 对到 -x，仍⊥手臂）+ 倾角，短轴沿手臂 ±倾角。
    cx, cy = ORBIT_CENTER_LOCAL
    add_bone("blade_plane", "forearm_r_round", cx, cy,
             rotation=180.0 + ORBIT_TILT_DEG, sy=FLATTEN_K)
    add_bone("blade_revolve", "blade_plane")
    add_bone("blade_center_a", "blade_revolve", ORBIT_RADIUS, 0)
    add_bone("blade_spin_a", "blade_center_a")
    add_bone("blade_offset_b", "blade_revolve", rotation=180)
    add_bone("blade_center_b", "blade_offset_b", ORBIT_RADIUS, 0)
    add_bone("blade_spin_b", "blade_center_b")

    # ---------------- 槽位（末尾追加，setup 最顶但 alpha=0 隐藏） ----------------
    for name, bone in (("blade_a", "blade_spin_a"), ("blade_b", "blade_spin_b")):
        existing = next((s for s in skel["slots"] if s["name"] == name), None)
        if existing:
            assert existing["bone"] == bone, f"槽位 {name} 绑定异常"
        else:
            skel["slots"].append({"name": name, "bone": bone,
                                  "attachment": name, "color": "ffffff00"})
    slot_names = [s["name"] for s in skel["slots"]]

    # ---------------- 附件（同一 blade 区域，path 引用） ----------------
    atts = skel["skins"][0]["attachments"]
    for slot in ("blade_a", "blade_b"):
        atts[slot] = {slot: {
            "type": "region", "path": "blade",
            "x": 0, "y": 0, "rotation": BLADE_ART_ROT,
            "width": round(bw * BLADE_SCALE, 2), "height": round(bh * BLADE_SCALE, 2),
        }}

    # ---------------- 动画：刃舞 ----------------
    orbit_t = HOLD_END - RAISE_T
    spin_deg = -(ORBIT_TURNS + SPIN_TURNS) * 360.0  # 屏幕自转 = 公转+相对 = 顺时针 SPIN_TURNS 圈
    rev_deg = ORBIT_TURNS * 360.0

    def arm_timeline(raise_deg, sway_deg, period=SWAY_PERIOD):
        """抬臂 → 举臂姿态上正弦摆动 → 收势落臂。

        正弦摆动只在极值处设键（±amp 交替，每半周期一个），相邻极值之间
        用 ease-in-out-sine 贝塞尔：过零点由插值自然穿过（速度最大），
        极值点速度归零——真实的钟摆式速度分布，无中途停顿。
        曲线挂在每段的"起点键"上（Spine 的 curve 管辖本键→下一键），
        全程位置与速度连续。"""
        first_ext = RAISE_T + period / 4  # 摆动从基线出发，P/4 后到达第一极值
        exts = []
        k = 0
        while True:
            t_ext = first_ext + k * period / 2
            if t_ext > HOLD_END - 1e-6:
                break
            exts.append((t_ext, raise_deg + (sway_deg if k % 2 == 0 else -sway_deg)))
            k += 1
        keys = [
            rot_key(None, 0, abs_curve(0, 0, RAISE_T, raise_deg, SINE)),            # 抬臂
            rot_key(RAISE_T, raise_deg,
                    abs_curve(RAISE_T, raise_deg, exts[0][0], exts[0][1], SINE)),   # 摆起
        ]
        for i, (t_ext, v_ext) in enumerate(exts):                                   # 正弦摆动
            t_next, v_next = exts[i + 1] if i + 1 < len(exts) else (HOLD_END, raise_deg)
            keys.append(rot_key(t_ext, v_ext, abs_curve(t_ext, v_ext, t_next, v_next, SINE)))
        keys.append(rot_key(HOLD_END, raise_deg,                                       # 落臂
                            abs_curve(HOLD_END, raise_deg, DURATION, 0, SINE)))
        keys.append(rot_key(DURATION, 0))
        return keys

    def depth_scale_keys(sign):
        """透视缩放（双值同幅）：远(指尖侧 φ∈0..180, sinφ>0)=FAR，近(肘侧)=NEAR。
        sign=+1 → blade_a（s=mid−amp·sinφ），sign=-1 → blade_b（反相）。"""
        n_seg = int(ORBIT_TURNS * 4)  # 每圈 4 段（90° 采样）
        mid = (NEAR_SCALE + FAR_SCALE) / 2
        amp = (NEAR_SCALE - FAR_SCALE) / 2

        def val(i):
            phi = math.radians(360.0 * ORBIT_TURNS * i / n_seg)
            return mid - amp * sign * math.sin(phi)

        keys = []
        for i in range(n_seg + 1):
            t = RAISE_T + orbit_t * i / n_seg
            if i < n_seg:
                t1 = RAISE_T + orbit_t * (i + 1) / n_seg
                seg = abs_curve(t, val(i), t1, val(i + 1), SINE)
                keys.append(scale_key(t, val(i), seg + seg))
            else:
                keys.append(scale_key(t, val(i)))
        return keys

    fade_keys = [
        alpha_key(None, 0),
        alpha_key(RAISE_T, 0, abs_curve(RAISE_T, 0, RAISE_T + FADE_IN_T, 1, SINE)),
        alpha_key(RAISE_T + FADE_IN_T, 1,
                  abs_curve(RAISE_T + FADE_IN_T, 1, HOLD_END - FADE_OUT_T, 1, SINE)),
        alpha_key(HOLD_END - FADE_OUT_T, 1,
                  abs_curve(HOLD_END - FADE_OUT_T, 1, HOLD_END, 0, SINE)),
        alpha_key(HOLD_END, 0),
    ]

    skel["animations"]["刃舞"] = {
        "bones": {
            "uparm_r_round": {"rotate": arm_timeline(UPARM_ABDUCT_DEG, SWAY_UPARM_DEG)},
            "forearm_r_round": {"rotate": arm_timeline(FOREARM_RAISE_DEG, SWAY_FOREARM_DEG)},
            "blade_revolve": {"rotate": [
                rot_key(None, 0),
                rot_key(RAISE_T, 0, abs_curve(0, 0, RAISE_T, 0, LINEAR)),
                rot_key(HOLD_END, rev_deg, abs_curve(RAISE_T, 0, HOLD_END, rev_deg, LINEAR)),
                rot_key(DURATION, rev_deg),
            ]},
            "blade_spin_a": {"rotate": [
                rot_key(None, 0),
                rot_key(RAISE_T, 0, abs_curve(0, 0, RAISE_T, 0, LINEAR)),
                rot_key(HOLD_END, spin_deg, abs_curve(RAISE_T, 0, HOLD_END, spin_deg, LINEAR)),
                rot_key(DURATION, spin_deg),
            ], "scale": depth_scale_keys(+1)},
            "blade_spin_b": {"rotate": [
                rot_key(None, 0),
                rot_key(RAISE_T, 0, abs_curve(0, 0, RAISE_T, 0, LINEAR)),
                rot_key(HOLD_END, spin_deg, abs_curve(RAISE_T, 0, HOLD_END, spin_deg, LINEAR)),
                rot_key(DURATION, spin_deg),
            ], "scale": depth_scale_keys(-1)},
        },
        "slots": {
            "blade_a": {"alpha": list(fade_keys)},
            "blade_b": {"alpha": list(fade_keys)},
        },
    }

    # ---------------- draworder：举臂抬层 + 两刃前后交换 ----------------
    # setup 序：…, coat(12), blade_a(13), blade_b(14)。
    # 状态A（远/指尖侧，刃在小臂下）：仅把 forearm_r 提到 coat 之上；
    #   blade_a 因 forearm 占位自动滑到其下一位（被小臂遮挡、但在 coat/head 之上），
    #   blade_b 保持最顶。
    # 状态B（近/肘侧，刃在小臂上）：a 提到最顶，b 滑到 forearm 之下。
    i_fa = slot_names.index("forearm_r_round")
    i_a = slot_names.index("blade_a")
    i_b = slot_names.index("blade_b")
    top = len(slot_names) - 1                    # 14
    above_coat = slot_names.index("coat") + 1    # 13
    off_lift = [{"slot": "forearm_r_round", "offset": above_coat - i_fa}]
    off_a = list(off_lift)
    off_b = off_lift + [{"slot": "blade_a", "offset": top - i_a},
                        {"slot": "blade_b", "offset": above_coat - 1 - i_b}]
    seq_a = offsets_result(slot_names, off_a)
    seq_b = offsets_result(slot_names, off_b)
    # 断言：状态下刃紧邻 forearm 之前一位（被小臂遮挡）且在 coat 之后（不被身体/头遮挡）
    assert seq_a.index("blade_a") == seq_a.index("forearm_r_round") - 1, seq_a
    assert seq_a.index("blade_a") > seq_a.index("coat"), seq_a
    assert seq_a[-1] == "blade_b", seq_a
    assert seq_b.index("blade_b") == seq_b.index("forearm_r_round") - 1, seq_b
    assert seq_b.index("blade_b") > seq_b.index("coat"), seq_b
    assert seq_b[-1] == "blade_a", seq_b

    # 切换时刻：长轴穿越（φ=0°/180°…）每半圈一次；指尖侧=A（刃在下），肘侧=B（刃在上）。
    # 抬层从 RAISE_T（手臂举到位、刃开始淡入）才生效——0~RAISE_T 手臂还垂在
    # 身后，提前抬层会让小臂突然画到身体前面；HOLD_END 复位 setup（刃已淡出，
    # 手臂下摆时回到身后遮挡关系）。
    if not LAYER_FLIP:
        state_first, state_second = off_a, off_b
    else:
        state_first, state_second = off_b, off_a
    n_sw = int(ORBIT_TURNS * 2)
    do_frames = [{"time": RAISE_T, "offsets": state_first}]
    for k in range(1, n_sw + 1):
        t = RAISE_T + orbit_t * k / n_sw
        if t >= HOLD_END - 1e-6:
            break
        do_frames.append({"time": round(t, 4),
                          "offsets": state_second if k % 2 == 1 else state_first})
    do_frames.append({"time": DURATION})  # 落臂到位后恢复 setup 绘制顺序（举着臂复位会瞬间翻转遮挡）
    skel["animations"]["刃舞"]["drawOrder"] = do_frames  # 4.2 运行时读驼峰键名 drawOrder，小写会被静默忽略

    # ---------------- 几何摘要（干跑检查用） ----------------
    bones = {b["name"]: b for b in skel["bones"]}

    def bone_world(name, overrides=None):
        b = dict(bones[name])
        if overrides and name in overrides:
            b.update(overrides[name])
        if b.get("parent"):
            px, py, prot, psx, psy = bone_world(b["parent"], overrides)
        else:
            px, py, prot, psx, psy = 0, 0, 0, 1, 1
        lx, ly = b.get("x", 0), b.get("y", 0)
        r = math.radians(prot)
        c, s = math.cos(r), math.sin(r)
        return (px + lx * psx * c - ly * s, py + lx * psx * s + ly * c,
                prot + b.get("rotation", 0), psx * b.get("scaleX", 1), psy * b.get("scaleY", 1))

    raised = bone_world("forearm_r_round", {
        "uparm_r_round": {"rotation": UPARM_ABDUCT_DEG},
        "forearm_r_round": {"rotation": FOREARM_RAISE_DEG},
    })
    fx, fy, fr = raised[0], raised[1], raised[2]
    r = math.radians(fr)
    hand = (fx + cx * math.cos(r) - cy * math.sin(r), fy + cx * math.sin(r) + cy * math.cos(r))
    plane_dir = math.radians(fr + 180.0 + ORBIT_TILT_DEG)  # 长轴方向（世界角）
    ex, ey = math.cos(plane_dir), math.sin(plane_dir)
    blade_half = 0.5 * math.hypot(bw * BLADE_SCALE, bh * BLADE_SCALE)
    r_short = ORBIT_RADIUS * FLATTEN_K
    max_x = math.hypot(ORBIT_RADIUS * ex, r_short * ey)
    max_y = math.hypot(ORBIT_RADIUS * ey, r_short * ex)
    summary = {
        "blade_region": [BLADE_REGION[0], BLADE_REGION[1], bw, bh],
        "forearm_world_rot": round(fr, 1),
        "orbit_center_world": [round(hand[0], 1), round(hand[1], 1)],
        "orbit_right_edge": round(hand[0] + max_x + blade_half, 1),
        "orbit_left_edge": round(hand[0] - max_x - blade_half, 1),
        "orbit_top_edge": round(hand[1] + max_y + blade_half, 1),
        "orbit_bottom_edge": round(hand[1] - max_y - blade_half, 1),
        "visible_x_range": [174.5, 717.5],
        "draworder_stateA": seq_a,
        "draworder_stateB": seq_b,
        "draworder_times": [f["time"] for f in do_frames],
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
        print("\n[dry-run] 未写入。加 --apply 写入（.bak 备份，不覆盖已有 .bak）。")
        sys.exit(0)
    for path, content in outputs.items():
        if not os.path.exists(path + ".bak"):
            shutil.copy2(path, path + ".bak")
        if isinstance(content, Image.Image):
            content.save(path)
        else:
            open(path, "w", encoding="utf-8", newline="\n").write(content)
        print("written:", path)
