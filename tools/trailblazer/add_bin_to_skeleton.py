#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把垃圾桶三层素材接入开拓者骨架（数据层）——安全版：只追加，不插入不重排。

⚠️ 关键约束（血的教训）：Spine 的加权网格用「骨骼数组下标」绑定骨骼
（JSON 顶点数据里 "bones":[索引...]）。任何在数组中间插入骨骼/重排都会让
所有网格绑错骨骼 → 角色渲染成乱码。因此本脚本：
  - 只在 bones/slots 数组**末尾**追加桶骨骼/桶槽位（不移动任何既有元素）；
  - 不重父级、不改既有骨骼参数。

新增：
- 骨骼 `垃圾桶`（root 子级，scale=BIN_SCALE）与 `垃圾桶-盖`（合盖锚点=盖沿底边中心）
- 槽位 BIN-BACK（数组首，垫底）/ BIN-FRONT / BIN-LID（数组尾，最上层）
- default 皮肤三个 region attachment（第二图集页，scale=1，像素=单位）

收缩方案（见 add_bin_animations.py）：不开新骨骼——直接对既有骨骼键控。
运行时 `worldX = pa*x + pb*y + parent.worldX`（第 5450 行）在 inherit 判断
之前执行，所以 noScale 骨骼的位置照样吃父级缩放，只有自身尺寸矩阵不吃：
  - `身体`（角色子树根）：scale=S + translate=(1-S)*(G-B0)（关于地面锚点 G 的
    精确相似变换；root 无旋转/缩放，局部偏移=世界偏移）
  - 每个 noScale 骨骼：只需 scale=S（位置自动落对，translate 保持 0）

惯例：默认 dry-run；--apply 写回；.bak 不覆盖。
"""
import argparse
import json
import os
import shutil

import numpy as np
from PIL import Image

TARGET = os.path.join('packs', 'trailblazer', 'trailblazer.json')
BACKUP = TARGET + '.pre-bin-skeleton.bak'
ASSETS = os.path.join('packs', 'trailblazer', 'assets')

# ---- 标定参数 ----
BIN_SCALE = 2.0      # 桶骨骼缩放（第二图集页 scale:1，像素即单位）
BIN_WORLD_X = 44.3   # 桶底中心的世界 x（≈角色中轴）
BIN_WORLD_Y = -256   # 桶底中心的世界 y（地面）
LID_SINK = 50        # 合盖时盖沿下沉进沿条内的像素数
LID_SCALE = 1.19     # 盖子放大系数（桶口沿条宽 575px / 盖 514px + 6% 外沿余量）
LID_PIVOT_RISE = 29  # 盖骨骼原点（旋转轴）相对盖底上移量（局部单位；
                     # 世界 ×2=58 → 顶起后旋转轴落在头顶接触点，摇摆绕头顶中心）


def bbox_of(path):
    a = np.asarray(Image.open(path).convert('RGBA'))
    ys, xs = np.where(a[..., 3] > 8)
    return int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    with open(TARGET, encoding='utf-8') as f:
        data = json.load(f)
    if any(b['name'] == '垃圾桶' for b in data['bones']):
        print('骨架已含垃圾桶骨骼，跳过（重接需先还原 .bak）')
        return

    root = next(b for b in data['bones'] if b['name'] == 'root')
    body = next(b for b in data['bones'] if b['name'] == '身体')
    bone_names = [b['name'] for b in data['bones']]

    fx0, fy0, fw, fh = bbox_of(os.path.join(ASSETS, 'bin-front.png'))
    bx0, by0, bw, bh = bbox_of(os.path.join(ASSETS, 'bin-back.png'))
    lid_w, lid_h = 514, 204  # 旋转后盖子尺寸

    root_wx, root_wy = root.get('x', 0), root.get('y', 0)
    anchor_img_y = fy0 + fh
    body_world_x = root_wx + body.get('x', 0)
    body_world_y = root_wy + body.get('y', 0)
    ground_local_y = BIN_WORLD_Y - root_wy

    # 桶口顶沿（前面片在桶中轴处的最高不透明像素）→ 合盖锚点
    fa = np.asarray(Image.open(os.path.join(ASSETS, 'bin-front.png')).convert('RGBA'))
    fcx = fx0 + fw // 2
    rim_top = int(np.where(fa[:, fcx, 3] > 8)[0].min())
    lid_anchor_img = (fcx, rim_top + LID_SINK)

    front_x, front_y = 0.0, fh / 2.0            # 前片中心相对桶原点（桶底中心）
    back_x = (bx0 + bw / 2.0) - (fx0 + fw / 2.0)
    back_y = -((by0 + bh / 2.0) - anchor_img_y)
    lid_bone_local = (lid_anchor_img[0] - (fx0 + fw / 2.0),
                      -(lid_anchor_img[1] - anchor_img_y) + LID_PIVOT_RISE)

    bones_new = [
        {'name': '垃圾桶', 'parent': 'root', 'x': BIN_WORLD_X - root_wx,
         'y': ground_local_y, 'scaleX': BIN_SCALE, 'scaleY': BIN_SCALE},
        {'name': '垃圾桶-盖', 'parent': '垃圾桶', 'x': lid_bone_local[0], 'y': lid_bone_local[1]},
    ]
    slots_new_head = [
        {'name': 'BIN-BACK', 'bone': '垃圾桶', 'attachment': 'BIN-BACK', 'color': 'ffffff00'},
    ]
    slots_new_tail = [
        {'name': 'BIN-FRONT', 'bone': '垃圾桶', 'attachment': 'BIN-FRONT', 'color': 'ffffff00'},
        {'name': 'BIN-LID', 'bone': '垃圾桶-盖', 'attachment': 'BIN-LID', 'color': 'ffffff00'},
    ]
    atts_new = {
        'BIN-BACK': {'BIN-BACK': {'path': 'BIN-BACK', 'x': back_x, 'y': back_y,
                                  'width': bw, 'height': bh}},
        'BIN-FRONT': {'BIN-FRONT': {'path': 'BIN-FRONT', 'x': front_x, 'y': front_y,
                                    'width': fw, 'height': fh}},
        'BIN-LID': {'BIN-LID': {'path': 'BIN-LID', 'x': 0,
                                'y': lid_h * LID_SCALE / 2.0 - LID_PIVOT_RISE,
                                'width': lid_w * LID_SCALE, 'height': lid_h * LID_SCALE}},
    }

    print('front bbox', (fx0, fy0, fw, fh), '| back bbox', (bx0, by0, bw, bh))
    print('桶骨骼 local (%.1f, %.1f) scale %.2f' % (BIN_WORLD_X - root_wx, ground_local_y, BIN_SCALE))
    print('盖骨骼 local (%.1f, %.1f)' % lid_bone_local)
    print('身体 setup 世界 (%.1f, %.1f)；地面 y=%.1f' % (body_world_x, body_world_y, BIN_WORLD_Y))
    print('骨骼下标安全：仅末尾追加（现有 %d 根 → %d 根），槽位仅首/尾插入'
          % (len(data['bones']), len(data['bones']) + 2))

    if not args.apply:
        print('\n(dry-run；--apply 写回)')
        return
    if not os.path.exists(BACKUP):
        shutil.copy(TARGET, BACKUP)
        print('backup ->', BACKUP)
    data['bones'].extend(bones_new)
    data['slots'] = slots_new_head + data['slots'] + slots_new_tail
    data['skins'][0].setdefault('attachments', {}).update(atts_new)
    with open(TARGET, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print('wrote', TARGET)


if __name__ == '__main__':
    main()
