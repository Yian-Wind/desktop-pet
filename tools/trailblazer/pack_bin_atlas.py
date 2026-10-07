#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把垃圾桶三片素材打包进第二图集页，并在 .atlas 末尾追加页块。

输入：packs/trailblazer/assets/bin-{back,front,lid}.png（全画布坐标）
输出：
  packs/trailblazer/trailblazer-2.png      第二图集页（scale:1，区域像素=骨架单位）
  packs/trailblazer/trailblazer.atlas      追加页块（幂等：已有 trailblazer-2 先移除旧块）
  tools/tmp/bin-pieces-meta.json           各片 bbox/页内 bounds 信息（骨架接入用）

说明：第二页 scale=1，区域像素尺寸即骨架单位；最终桶的世界尺寸由骨架里
`垃圾桶` 骨骼的 scale 控制（见 add_bin_to_skeleton.py）。
"""
import json
import os

import numpy as np
from PIL import Image

ASSETS = os.path.join('packs', 'trailblazer', 'assets')
ATLAS = os.path.join('packs', 'trailblazer', 'trailblazer.atlas')
PAGE = os.path.join('packs', 'trailblazer', 'trailblazer-2.png')
META = os.path.join('tools', 'tmp', 'bin-pieces-meta.json')
PAD = 2  # 页内区域间距

REGIONS = [('BIN-BACK', 'bin-back.png'), ('BIN-FRONT', 'bin-front.png'), ('BIN-LID', 'bin-lid.png')]


def bbox_of(img):
    a = np.asarray(img)
    ys, xs = np.where(a[..., 3] > 8)
    return int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)


def main():
    crops = {}
    for name, fn in REGIONS:
        im = Image.open(os.path.join(ASSETS, fn)).convert('RGBA')
        x0, y0, w, h = bbox_of(im)
        crops[name] = {'img': im.crop((x0, y0, x0 + w, y0 + h)), 'w': w, 'h': h}

    # 简单排布：FRONT 左侧，BACK 右上，LID 右下
    f, b, l = crops['BIN-FRONT'], crops['BIN-BACK'], crops['BIN-LID']
    col2_w = max(b['w'], l['w'])
    W = PAD + f['w'] + PAD + col2_w + PAD
    H = PAD + max(f['h'], PAD + b['h'] + PAD + l['h'] + PAD) + PAD
    page = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    bounds = {}
    x, y = PAD, PAD
    page.paste(f['img'], (x, y))
    bounds['BIN-FRONT'] = [x, y, f['w'], f['h']]
    x2, y2 = PAD + f['w'] + PAD, PAD
    page.paste(b['img'], (x2, y2))
    bounds['BIN-BACK'] = [x2, y2, b['w'], b['h']]
    y3 = y2 + b['h'] + PAD
    page.paste(l['img'], (x2, y3))
    bounds['BIN-LID'] = [x2, y3, l['w'], l['h']]
    page.save(PAGE)
    print('page %s %dx%d' % (PAGE, W, H))

    meta = {}
    for name, fn in REGIONS:
        meta[name] = {
            'source': fn,
            'page_bounds': bounds[name],
            'piece_size': [crops[name]['w'], crops[name]['h']],
        }
    os.makedirs('tools/tmp', exist_ok=True)
    with open(META, 'w', encoding='utf-8') as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=2)
    print('wrote', META)

    # .atlas 追加/替换页块（幂等）
    block = ['%s' % os.path.basename(PAGE), 'size:%d,%d' % (W, H),
             'filter:Linear,Linear', 'scale:1']
    for name, _ in REGIONS:
        bx, by, bw, bh = bounds[name]
        block += [name, 'bounds:%d,%d,%d,%d' % (bx, by, bw, bh)]
    with open(ATLAS, encoding='utf-8') as fp:
        text = fp.read()
    if 'trailblazer-2.png' in text:
        text = text.split('trailblazer-2.png')[0].rstrip('\n')
    with open(ATLAS, 'w', encoding='utf-8') as fp:
        fp.write(text + '\n\n' + '\n'.join(block) + '\n')
    print('atlas updated:', ATLAS)


if __name__ == '__main__':
    main()
