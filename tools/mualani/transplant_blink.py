# -*- coding: utf-8 -*-
"""把 eye 眨眼的完整机制（7 条眼槽 rgba + 双眼皮2 deform + 5 条位置类眼骨 translate）
按相位拉伸移植进 拍手x 的闭眼窗口。

用法:
  python tools/mualani/transplant_blink.py            # 干跑：打印时序窗口，不写文件
  python tools/mualani/transplant_blink.py --apply    # 写入（先把 mualani.json 备份为 .bak）

可调参数见下方 PARAMS：闭眼开始时刻 / 闭眼时长 / 闭眼维持 / 睁眼时长。
拉伸教训（详见 docs/ROADMAP.md 拍手x 条目）：eye 眨眼的 rotate/scale 挤压微旋转
（上睫毛×5、双眼皮2-6，±3.5~12.7°）只适合 0.2s 原节奏，拉长后会读成"睫毛上漂→
睁眼掉回"，一律剔除；只移植位置类时间线（translate/deform/rgba）。
"""
import json
import shutil
import sys
from pathlib import Path

# ===== 可调参数 =====
PARAMS = {
    'CLOSE_START': 1.1667,  # 闭眼开始时刻
    'CLOSE_DUR': 0.3,       # 闭眼时长（眼皮合上速度）
    'HOLD_DUR': 0.6,        # 闭眼维持时长
    'OPEN_DUR': 0.3,        # 睁眼时长
}
# ====================

SRC_CLOSE_END, SRC_OPEN_END = 0.1333, 0.2703
EYE_BONES = {'双眼皮', 'biyan', '下睫毛', '高光', '下弯闭目睫毛'}
MICRO = {'上睫毛', '上睫毛2', '上睫毛3', '上睫毛4', '上睫毛5',
         '双眼皮2', '双眼皮3', '双眼皮4', '双眼皮5', '双眼皮6'}
PACK = Path(__file__).resolve().parents[1] / 'packs' / 'mualani' / 'mualani.json'

apply_flag = '--apply' in sys.argv


def make_map_t(p, tail_scale, anim_end=2.8):
    def map_t(t):
        if t <= SRC_CLOSE_END + 1e-9:
            return p['CLOSE_START'] + t * (p['CLOSE_DUR'] / SRC_CLOSE_END)
        if t <= SRC_OPEN_END + 1e-9:
            return (p['CLOSE_START'] + p['CLOSE_DUR'] + p['HOLD_DUR']
                    + (t - SRC_CLOSE_END) * (p['OPEN_DUR'] / (SRC_OPEN_END - SRC_CLOSE_END)))
        # 开眼后的收尾尾巴：按剩余空间压缩，保证收尾键不超出动画总长
        return min(p['CLOSE_START'] + p['CLOSE_DUR'] + p['HOLD_DUR'] + p['OPEN_DUR']
                   + (t - SRC_OPEN_END) * tail_scale, anim_end)
    return map_t


def stretch(keys, make_key, map_t, tail_scale, open_start, anim_end=2.8):
    out = []
    for k in keys:
        t = k.get('time', 0)
        nk = make_key(k)
        nk['time'] = round(min(map_t(t), anim_end), 4)
        if 'curve' in k:
            c = k['curve']
            if c == 'stepped':
                nk['curve'] = 'stepped'
            elif isinstance(c, list):
                nk['curve'] = [round(min(map_t(v), anim_end), 4) if i % 2 == 0 else v
                               for i, v in enumerate(c)]
        out.append(nk)
    # 闭眼完成点的边界键在开眼起点补保持锚（同值键，维持段不漂移）
    for k in keys:
        if abs(k.get('time', 0) - SRC_CLOSE_END) < 1e-6:
            nk = make_key(k)
            nk['time'] = round(open_start, 4)
            if 'curve' in k:
                c = k['curve']
                nk['curve'] = 'stepped' if c == 'stepped' else (
                    [round(min(map_t(v), anim_end), 4) if i % 2 == 0 else v
                     for i, v in enumerate(c)] if isinstance(c, list) else c)
            out.append(nk)
    return sorted(out, key=lambda x: x['time'])


def main():
    d = json.loads(PACK.read_text(encoding='utf-8'))
    eye = d['animations']['eye']
    anim = d['animations']['拍手x']
    tail_end = max(k.get('time', 0) for tl in eye['bones'].values()
                   for ks in tl.values() for k in ks)
    tail_scale = min((2.8 - (PARAMS['CLOSE_START'] + PARAMS['CLOSE_DUR'] + PARAMS['HOLD_DUR']
                             + PARAMS['OPEN_DUR'])) / (tail_end - SRC_OPEN_END), 1.0) \
        if tail_end > SRC_OPEN_END else 1.0
    mt = make_map_t(PARAMS, tail_scale)
    close_end = PARAMS['CLOSE_START'] + PARAMS['CLOSE_DUR']
    open_start = close_end + PARAMS['HOLD_DUR']
    open_end = open_start + PARAMS['OPEN_DUR']

    print(f"窗口: 闭眼 {PARAMS['CLOSE_START']}~{close_end:.4f} / 维持至 {open_start:.4f} / 开眼至 {open_end:.4f}")

    for slot, tl in eye['slots'].items():
        anim['slots'][slot] = {'rgba': stretch(tl['rgba'], lambda k: {'color': k['color']},
                                               mt, tail_scale, open_start)}
    anim['attachments'] = {'default': {'双眼皮2': {'双眼皮2': {'deform': stretch(
        eye['attachments']['default']['双眼皮2']['双眼皮2']['deform'],
        lambda k: ({} if 'vertices' not in k else {'vertices': k['vertices']}),
        mt, tail_scale, open_start)}}}}
    for bone, tl in eye['bones'].items():
        if bone not in EYE_BONES:
            continue
        anim['bones'][bone] = {p: stretch(ks, lambda k: {f: k[f] for f in k if f not in ('time', 'curve')},
                                          mt, tail_scale, open_start)
                               for p, ks in tl.items()}
    for bone in MICRO:
        anim['bones'].pop(bone, None)

    if not apply_flag:
        print('dry run: nothing written. Re-run with --apply (creates .bak first).')
        return
    shutil.copy(PACK, PACK.with_suffix('.json.bak'))
    PACK.write_text(json.dumps(d, ensure_ascii=False), encoding='utf-8')
    print(f"written; backup at {PACK.with_suffix('.json.bak')}")


if __name__ == '__main__':
    main()
