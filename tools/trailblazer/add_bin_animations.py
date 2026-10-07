#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成垃圾桶四支动画 + 校准动画（数据层，Spine 4.2 JSON 线格式）。

⚠️ 安全约束：不新增/不插入/不重排骨骼（加权网格按骨骼下标绑定，重排=乱码）。
收缩完全由既有骨骼承载：
  - `身体`（角色子树根，root 无旋转缩放，局部偏移=世界偏移）：
      scale = S，translate = (1-S)·(G - B0)  ← 关于地面锚点 G 的精确相似变换
    （B0 = 身体 setup 世界位置，G = (B0.x, 桶底 y)）
  - 每个 noScale 骨骼（承载部件的）：只需 scale = S。
    运行时 worldX = pa*x + pb*y + parent.worldX 在 inherit 判断之前执行，
    noScale 骨骼的位置照样吃父级缩放，只有自身尺寸矩阵不吃 → 补 scale 即可。

4.2 线格式三规则（违者产出 NaN）：
  1. rotate 键用 "value"；2. 单属性 curve 4 数 / 双属性 8 数；3. 控制点绝对坐标。

另含：18 个 transform + 2 个 IK 约束在桶状态下 mix 全 0（约束数学与收缩帧
混合会在逐帧 apply 中向无时间线骨骼写入 NaN 并持续）；SHEN-WT-2（外套下摆）
在完全隐藏态淡出（其链混合落点会露出桶底）。

惯例：默认 dry-run；--apply 写回；.bak 不覆盖。
"""
import argparse
import copy
import json
import os
import shutil

TARGET = os.path.join('packs', 'trailblazer', 'trailblazer.json')
BACKUP = TARGET + '.pre-bin-anims.bak'

EASE_IN = [0.55, 0.0, 0.9, 0.6]
EASE_OUT = [0.10, 0.4, 0.45, 1.0]
EASE_IO = [0.40, 0.0, 0.60, 1.0]

SUNK = 0.62          # 隐藏态收缩比（关于地面锚点的相似变换）
GROUND_Y = -256.0    # 桶底世界 y = 角色落脚地
PEEK_RISE = 535.0    # 张望时抬升量（配合放大的头部，只露头）
HEAD_SCALE_PEEK = 1.25
PEEK_SHIFT_X = 130.0  # 张望时整体右偏（左侧头发藏进桶口沿带）
JUMP_RISE = 205.0    # 跳出炸开的跳跃顶点（独立于张望抬升，防飞出取景框）  # 张望时头部（身体12 子树：头+发）放大
LID_LIFT = 313.0     # 张望时盖子举升（骨骼局部，父级 ×2）
LID_SHIFT_X = 33.0   # 张望时盖子右移（骨骼局部，父级 ×2 → 世界 +50，对齐头顶冠部中心）     # 张望时盖子举升高度（到头顶之上）


def seg(t1, v1, t2, v2, p):
    return [t1 + (t2 - t1) * p[0], v1 + (v2 - v1) * p[1],
            t1 + (t2 - t1) * p[2], v1 + (v2 - v1) * p[3]]


def k1(times, values, presets=None):
    out = []
    for i, (t, v) in enumerate(zip(times, values)):
        kk = {'time': round(t, 4), 'value': v}
        if presets and i < len(times) - 1 and presets[i]:
            kk['curve'] = seg(t, v, times[i + 1], values[i + 1], presets[i])
        out.append(kk)
    return out


def k2(times, xs, ys, presets=None):
    out = []
    for i, t in enumerate(times):
        kk = {'time': round(t, 4), 'x': xs[i], 'y': ys[i]}
        if presets and i < len(times) - 1 and presets[i]:
            kk['curve'] = seg(t, xs[i], times[i + 1], xs[i + 1], presets[i]) + \
                          seg(t, ys[i], times[i + 1], ys[i + 1], presets[i])
        out.append(kk)
    return out


def kk(t, **kw):
    d = {'time': round(t, 4)}
    d.update(kw)
    return d


def set_pose_bones(data):
    """返回 (身体 B0 世界坐标, noScale 骨骼名单)。"""
    bones = {b['name']: b for b in data['bones']}
    parent = {b['name']: b.get('parent') for b in data['bones']}
    root = bones['root']
    body = bones['身体']
    b0 = (root.get('x', 0) + body.get('x', 0), root.get('y', 0) + body.get('y', 0))
    # 只有 inherit∈{noScale, noScaleOrReflection, onlyTranslation} 的骨骼不吃
    # 父级缩放，需要补 scale=S；noRotationOrReflection **会继承父级缩放**
    # （运行时 case 2 只剔除父级旋转、保留父级矩阵模长），补 S 会双重缩小
    NO_SCALE_INHERITS = {'noScale', 'noScaleOrReflection', 'onlyTranslation'}
    # 所有不吃父级缩放的骨骼（含无槽位的辅助骨，如外套权重里的 yibai/bone15/
    # bone16 与头发链）统一补 scale=S：位置由父级矩阵自动带对，只补自身尺寸；
    # inherit=noRotationOrReflection 会继承父级缩放，不能补（否则双重缩小）。
    need = {b['name'] for b in data['bones']
            if b.get('inherit') in NO_SCALE_INHERITS and b['name'] != '垃圾桶'}
    return b0, sorted(need)


def body_tracks(b0, times, scales, extra_y, presets=None, extra_x=None):
    """身体 scale + translate（关于地面锚点 G 的精确相似变换 + 附加纵向偏移）。

    瞬时解：T(p) = G + s·(p−G)，translate = (1−s)·(G−B0)。
    G 取 (B0.x, GROUND_Y) → x 分量恒 0；**逐键按该键的缩放值计算**，
    保证缩放过渡期间脚始终贴地（两边同缓动时中间帧也精确贴地）。
    """
    dy = GROUND_Y - b0[1]
    ys = [(1 - s) * dy + ey for s, ey in zip(scales, extra_y)]
    xs = list(extra_x) if extra_x else [0.0] * len(times)
    return {'bones': {'身体': {'scale': k2(times, scales, scales, presets),
                               'translate': k2(times, xs, ys, presets)}}}


def no_scale_tracks(data, times, scales, presets=None):
    """所有承载部件的 noScale 骨骼：只补 scale（位置自动随父级缩放）。"""
    _, need = set_pose_bones(data)
    tracks = {}
    for name in need:
        tracks[name] = {'scale': k2(times, scales, scales, presets)}
    return {'bones': tracks}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    with open(TARGET, encoding='utf-8') as f:
        data = json.load(f)
    anims = data['animations']
    have = [n for n in ('入桶', '桶内待机', '顶盖张望', '跳出炸开') if n in anims]
    if have:
        raise SystemExit('已存在桶动画 ' + ','.join(have) + '；先还原 .bak 再生成')

    b0, need = set_pose_bones(data)
    print('身体 B0 世界 = (%.1f, %.1f)；地面 y=%.0f；noScale 骨骼 %d 根'
          % (b0[0], b0[1], GROUND_Y, len(need)))

    emoji1 = anims['emoji_1']
    mei_deform = copy.deepcopy(emoji1['attachments']['default']['MEI']['MEI']['deform'][0])
    mei_deform.pop('time', None)
    face_slots = emoji1['slots']

    def face_swap(t_on, t_off):
        slots = {}
        for slot, tl in face_slots.items():
            att = tl.get('attachment')
            if att is None:
                continue
            on = att[0]
            setup_name = next((s.get('attachment') for s in data['slots']
                               if s['name'] == slot), None)
            keys = [kk(t_on, **({'name': on['name']} if on.get('name') else {}))]
            keys.append(kk(t_off, **({'name': setup_name} if setup_name else {})))
            slots[slot] = {'attachment': keys}
        return slots

    def mei_deform_tl(t_on, t_off):
        a = copy.deepcopy(mei_deform)
        a['time'] = t_on
        return {'attachments': {'default': {'MEI': {'MEI': {'deform': [a, {'time': t_off}]}}}}}

    def merge(*parts):
        out = {}
        for p in parts:
            for k2n, vv in p.items():
                if isinstance(vv, dict) and isinstance(out.get(k2n), dict):
                    for k3, v3 in vv.items():
                        out[k2n].setdefault(k3, {}).update(v3)
                else:
                    out[k2n] = vv
        return out

    def bin_alphas(vals, t_end):
        return {'slots': {s: {'alpha': [kk(t, value=a) for t, a in vals] +
                                      ([kk(t_end, value=vals[-1][1])]
                                       if vals[-1][0] != t_end else [])}
                          for s in ('BIN-BACK', 'BIN-FRONT', 'BIN-LID')}}

    def slot_a(name, vals, t_end=None):
        keys = [kk(t, value=a) for t, a in vals]
        if t_end is not None and keys[-1]['time'] != t_end:
            keys.append(kk(t_end, value=keys[-1]['value']))
        return {'slots': {name: {'alpha': keys}}}

    def constraints_off(t_end):
        tl = {}
        for c in data.get('transform', []):
            z = dict(mixRotate=0, mixX=0, mixY=0, mixScaleX=0, mixScaleY=0, mixShearY=0)
            tl[c['name']] = [kk(0, **z), kk(t_end, **dict(z))]
        ik = {}
        for c in data.get('ik', []):
            ik[c['name']] = [kk(0, mix=0), kk(t_end, mix=0)]
        out = {}
        if tl:
            out['transform'] = tl
        if ik:
            out['ik'] = ik
        return out

    def lid_tracks(times, ys, rots, trans_presets=None, rot_presets=None, xs=None):
        return {'bones': {'垃圾桶-盖': {'translate': k2(times, xs or [0.0] * len(times), ys, trans_presets),
                                        'rotate': k1(times, rots, rot_presets)}}}

    # ---------- 入桶 1.9s ----------
    ru = 1.9
    rudong = merge(
        {'slots': {
            'BIN-BACK': {'alpha': [kk(0.05, value=0), kk(0.35, value=1), kk(ru, value=1)]},
            'BIN-FRONT': {'alpha': [kk(0.05, value=0), kk(0.35, value=1), kk(ru, value=1)]},
            'BIN-LID': {'alpha': [kk(1.0, value=0), kk(1.2, value=1), kk(ru, value=1)]},
        }},
        body_tracks(b0, [0, 0.35, 1.2, ru], [1, 1, SUNK, SUNK], [0, 0, 0, 0], [None, EASE_IO, None]),
        no_scale_tracks(data, [0, 0.35, 1.2, ru], [1, 1, SUNK, SUNK], [None, EASE_IO, None]),
        slot_a('SHEN-WT-2', [(1.5, 1), (1.9, 0)]),
        lid_tracks([1.05, 1.35, 1.5, 1.62, 1.74, 1.85], [700, 0, 90, 0, 18, 0],
                   [0, 0, 6, -4, 2, 0], [EASE_IN, None, None, None, None]),
    )

    # ---------- 桶内待机 3.3333s ----------
    dx = 3.3333
    daiji = merge(
        bin_alphas([(0, 1)], dx),
        body_tracks(b0, [0, dx], [SUNK, SUNK], [0, 0]),
        no_scale_tracks(data, [0, dx], [SUNK, SUNK]),
        slot_a('SHEN-WT-2', [(0, 0)], dx),
        {'bones': {'垃圾桶': {'scaleY': k1([0, 1.66, dx], [1, 1.012, 1], [EASE_IO, None])}}},
        lid_tracks([0, dx], [0, 0], [0, 0]),
    )

    # ---------- 顶盖张望 3.4s ----------
    zhang = 3.4
    zt = [0, 0.12, 0.5, 0.66, 2.3, 2.78, 2.88, 3.0, zhang]
    zhangwang = merge(
        bin_alphas([(0, 1)], zhang),
        body_tracks(b0, zt, [SUNK] * 9,
                    [0, -30, PEEK_RISE, PEEK_RISE - 32, PEEK_RISE - 32, 0, 12, 0, 0],
                    [EASE_IO, EASE_OUT, None, None, EASE_IN, None, None, None],
                    [0, 0, PEEK_SHIFT_X, PEEK_SHIFT_X, PEEK_SHIFT_X, 0, 4, 0, 0]),
        no_scale_tracks(data, [0, zhang], [SUNK, SUNK]),
        {'bones': {'身体12': {'scale': k2([0, 0.5, 0.66, 2.3, 2.78, 3.0, zhang],
                                          [SUNK, SUNK * HEAD_SCALE_PEEK, SUNK * HEAD_SCALE_PEEK,
                                           SUNK * HEAD_SCALE_PEEK, SUNK, SUNK, SUNK],
                                          [SUNK, SUNK * HEAD_SCALE_PEEK, SUNK * HEAD_SCALE_PEEK,
                                           SUNK * HEAD_SCALE_PEEK, SUNK, SUNK, SUNK],
                                          [EASE_OUT, None, None, EASE_IN, None, None])}}},
        slot_a('SHEN-WT-2', [(0, 0), (0.35, 1), (3.05, 1), (3.4, 0)]),
        lid_tracks([0, 0.12, 0.45, 0.58, 0.72, 0.86, 2.3, 2.6, 2.68, 2.78, 2.88, 2.98],
                   [0, 0, LID_LIFT, LID_LIFT, LID_LIFT, LID_LIFT, LID_LIFT,
                    0, 10, -6, 4, 0],
                   [0, 0, 9, -4, 6, 4, 3, 0, -5, 3, -2, 0],
                   [None, EASE_OUT, None, None, None, None, EASE_IN, None, None, None, None],
                   xs=[0, 0, LID_SHIFT_X, LID_SHIFT_X, LID_SHIFT_X, LID_SHIFT_X, LID_SHIFT_X,
                       0, 0, 0, 0, 0]),
        {'slots': face_swap(0.55, 2.1)},
        mei_deform_tl(0.55, 2.1),
    )

    # ---------- 跳出炸开 2.4s ----------
    tk = 2.4
    tiaochu = merge(
        {'slots': {
            # 脱离时桶立即开始淡出（0.15→0.85s），而非等角色恢复完
            'BIN-BACK': {'alpha': [kk(0, value=1), kk(0.15, value=1), kk(0.85, value=0), kk(tk, value=0)]},
            'BIN-FRONT': {'alpha': [kk(0, value=1), kk(0.15, value=1), kk(0.85, value=0), kk(tk, value=0)]},
            'BIN-LID': {'alpha': [kk(0, value=1), kk(0.3, value=1), kk(0.75, value=0), kk(tk, value=0)]},
        }},
        body_tracks(b0, [0, 0.12, 0.38, 0.58, 0.66, 0.8, tk],
                    [SUNK, 0.56, 0.9, 1, 0.95, 1, 1],
                    [0, 0, JUMP_RISE, 0, 30, 0, 0],
                    [None, EASE_OUT, None, None, None, None]),
        no_scale_tracks(data, [0, 0.12, 0.38, 0.58, 0.66, 0.8, tk],
                        [SUNK, 0.56, 0.9, 1, 0.95, 1, 1],
                        [None, EASE_OUT, None, None, None, None]),
        slot_a('SHEN-WT-2', [(0, 0), (0.4, 1)]),
        lid_tracks([0.12, 0.34, 0.6], [0, 820, 1180], [0, -170, -300], [EASE_OUT, None]),
        {'slots': face_swap(0.35, 1.7)},
        mei_deform_tl(0.35, 1.7),
    )

    # ---------- BIN校准 0.2s ----------
    calib = merge(
        bin_alphas([(0, 1)], 0.2),
        body_tracks(b0, [0, 0.2], [SUNK, SUNK], [0, 0]),
        no_scale_tracks(data, [0, 0.2], [SUNK, SUNK]),
        slot_a('SHEN-WT-2', [(0, 0)], 0.2),
        lid_tracks([0, 0.2], [0, 0], [0, 0]),
    )

    for name, anim in (('入桶', rudong), ('桶内待机', daiji), ('顶盖张望', zhangwang),
                       ('跳出炸开', tiaochu), ('BIN校准', calib)):
        anims[name] = anim
        print('生成', name, '轨道:', sorted(anim.keys()))

    if not args.apply:
        print('\n(dry-run；--apply 写回)')
        return
    if not os.path.exists(BACKUP):
        shutil.copy(TARGET, BACKUP)
        print('backup ->', BACKUP)
    with open(TARGET, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print('wrote', TARGET)


if __name__ == '__main__':
    main()
