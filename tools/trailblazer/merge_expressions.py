#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""R0+R1 表情动画合并：开拓者 packs/trailblazer/trailblazer.json 数据层编辑。

R0：把 emoji_0 的眨眼 deform（FACE-1 网格闭眼，t≈1.33–1.67s）整块并入 idel
    ——idel 与 emoji_0 同为 3.33s，眨眼键远离循环首尾，loop 安全；每循环眨一次。
R1：新建 idel_emoji1 复合表情 = idel 全量骨骼/IK 轨道（含 R0 眨眼）
    + emoji_1 的槽位贴图切换（FACE-2 / YAN-XX / ZUI-5，隐藏腮红睫毛）与其 MEI
    deform。切换键都在 t=0 且无回位键，循环内恒定保持，loop 安全。
    供快捷按钮（备忘提醒/待办推荐/定时提醒）的 cheer/alarm 动作触发。

惯例：默认 dry-run 只打印摘要；--apply 才写文件；写前生成 .bak（不覆盖已有）。
用法：
  python tools/trailblazer/merge_expressions.py           # dry-run
  python tools/trailblazer/merge_expressions.py --apply
"""
import argparse
import copy
import json
import os
import shutil
import sys

TARGET = os.path.join('packs', 'trailblazer', 'trailblazer.json')
BACKUP = TARGET + '.pre-r0-r1.bak'


def timeline_duration(anim):
    best = 0.0

    def walk(node):
        nonlocal best
        if isinstance(node, dict):
            if 'time' in node and isinstance(node.get('time'), (int, float)):
                best = max(best, node['time'])
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(anim)
    return best


def merge_attachments(base, extra):
    """按 slot→attachment 合并 deform 块，冲突时报错（当前数据不相交）。"""
    for slot, attachments in extra.items():
        dst = base.setdefault(slot, {})
        for att, timelines in attachments.items():
            if att in dst:
                sys.exit(f'冲突：attachment {att!r} 同时存在于两侧，需人工裁决')
            dst[att] = timelines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true', help='写回文件（先备份）')
    args = ap.parse_args()

    with open(TARGET, encoding='utf-8') as f:
        data = json.load(f)
    anims = data['animations']

    for required in ('idel', 'emoji_0', 'emoji_1'):
        if required not in anims:
            sys.exit(f'骨架缺少动画 {required!r}')

    if 'attachments' in anims['idel']:
        sys.exit('idel 已含 attachments 轨道，合并逻辑需人工复核')

    blink_block = copy.deepcopy(anims['emoji_0']['attachments'])
    composite = copy.deepcopy(anims['idel'])
    composite['attachments'] = copy.deepcopy(blink_block)
    merge_attachments(composite['attachments'],
                      copy.deepcopy(anims['emoji_1'].get('attachments', {})))
    if 'slots' in anims['emoji_1']:
        composite['slots'] = copy.deepcopy(anims['emoji_1']['slots'])

    print('== R0 ==')
    print('  emoji_0 attachments 键:', sorted(blink_block.keys()))
    print('  并入 idel（时长 %.2fs 不变）' % timeline_duration(anims['idel']))
    print('== R1 ==')
    print('  新动画 idel_emoji1：轨道 kinds =', sorted(composite.keys()))
    print('  时长 %.2fs（=idel，附加轨道为恒定保持，loop 安全）'
          % timeline_duration(composite))

    if not args.apply:
        print('\n(dry-run，未写文件；--apply 生效)')
        return

    if not os.path.exists(BACKUP):
        shutil.copy(TARGET, BACKUP)
        print('backup ->', BACKUP)
    # 点击交互：表情在 HOLD_END 前保持，之后回 setup（FACE-1/YAN-OO/ZUI-1/腮红睫毛），
    # 动画末尾归位 → 播完即"回到常态"；表情 MEI deform 同步回位
    HOLD_END = 2.3
    comp = anims['idel_emoji1'] if 'idel_emoji1' in anims else composite
    for slot, timelines in comp.get('slots', {}).items():
        att = timelines.get('attachment')
        if not att:
            continue
        first = att[0]
        on_name = first.get('name')
        setup_name = next((s.get('attachment') for s in data['slots'] if s['name'] == slot), None)
        att.append({'time': HOLD_END, **({'name': setup_name} if setup_name else {})})
    for slot in comp.get('attachments', {}).get('default', {}):
        for att_name, att in comp['attachments']['default'][slot].items():
            deform = att.get('deform')
            if deform and len(deform) == 1:
                deform.append({'time': HOLD_END})
    anims['idel_emoji1'] = comp
    print('  idel_emoji1：表情保持到 %.1fs 后回常态' % HOLD_END)
    anims['idel']['attachments'] = blink_block
    with open(TARGET, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print('wrote', TARGET)


if __name__ == '__main__':
    main()
