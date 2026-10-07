#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""切分用户绘制的垃圾桶为 Spine 三层素材：盖 / 桶前面 / 桶后面。

输入：pet_reference/开拓者/垃圾桶-桶和盖子分离.png（桶与盖分离绘制）
输出：packs/trailblazer/assets/bin-{lid,front,back}.png（全画布坐标，三层
      叠放即可完整还原原图；宠物夹在 back 与 front 之间实现"躲在桶里"）

切分规则（用户指定）：
- 盖子：独立连通域，直接分离；再按盖沿底边斜率旋转为横向（提手朝上），
  供 Spine 里作为"合盖"姿态摆放与动画。
- 前面/后面：以"桶内前沿浅色 vs 深色内壁"的弧形分界线为切线——程序检测该
  边界点并拟合椭圆弧（下半段），从桶口左右水平极点沿环带切线（水平）延伸
  穿出桶轮廓；弧线以上（含深色内壁与远侧沿条）= 后面，以下 = 前面。

验证：重组差异应为 0；tools/tmp/bin-layering-test.png 可目视遮挡关系。
用法：python tools/trailblazer/cut_bin_assets.py
"""
import os
import time

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.optimize import least_squares


def save_png(img, path, attempts=5):
    """Windows 下刚写入的 PNG 可能被杀软短暂锁定，写临时文件+重试。"""
    tmp = path + '.tmp'
    for i in range(attempts):
        try:
            img.save(tmp, 'PNG')
            os.replace(tmp, path)
            return
        except PermissionError:
            if i == attempts - 1:
                raise
            time.sleep(0.6)
        except OSError:
            if i == attempts - 1:
                raise
            time.sleep(0.6)

SRC = os.path.join('pet_reference', '开拓者', '垃圾桶-桶和盖子分离.png')
OUT_DIR = os.path.join('packs', 'trailblazer', 'assets')
DARK_LUM = 105          # 深色内壁亮度上限
OPEN_STROKE = 9         # 形态学开运算核（去除描边线，保留内部大块）


def main():
    im = Image.open(SRC).convert('RGBA')
    a = np.asarray(im)
    H, W = a.shape[:2]
    alpha = a[..., 3] > 128

    # -- 连通域：桶（左）与盖（右）--
    lbl, _ = ndimage.label(alpha)
    sizes = np.bincount(lbl.ravel())
    sizes[0] = 0
    ids = np.argsort(sizes)[::-1][:2]
    com = {i: ndimage.center_of_mass(alpha, lbl, i)[1] for i in ids}
    bin_id, lid_id = (ids[0], ids[1]) if com[ids[0]] < com[ids[1]] else (ids[1], ids[0])
    bin_mask = lbl == bin_id
    lid_mask = lbl == lid_id
    os.makedirs(OUT_DIR, exist_ok=True)

    # -- 盖子旋转为横向：盖沿底边（中段 60% 列）拟合直线 → 旋转至水平；
    #    旋转后若窄突起（提手）在底部则再转 180°--
    lys, lxs = np.where(lid_mask)
    x0, x1 = lxs.min(), lxs.max()
    span = x1 - x0
    sel = (lxs >= x0 + span * 0.2) & (lxs <= x1 - span * 0.2)
    bottom = {}
    for x, y in zip(lxs[sel], lys[sel]):
        if x not in bottom or y > bottom[x]:
            bottom[x] = y
    bx = np.array(sorted(bottom))
    by = np.array([bottom[x] for x in bx])
    slope = np.polyfit(bx, by, 1)[0]
    import math
    angle = math.degrees(math.atan(slope))
    lid_im = Image.fromarray(a.copy(), 'RGBA')
    lid_im.putalpha(Image.fromarray((lid_mask * 255).astype(np.uint8), 'L'))
    lid_rot = lid_im.rotate(angle, resample=Image.BICUBIC, expand=True,
                            fillcolor=(0, 0, 0, 0))
    ra = np.asarray(lid_rot).copy()
    rmask = ra[..., 3] > 128
    rows = np.where(rmask.any(axis=1))[0]
    def row_frac_width(y):
        return rmask[y].sum() / max(1, rmask.sum(axis=1).max())
    top_narrow = row_frac_width(rows[0] + (rows[-1] - rows[0]) // 12) < 0.45
    bot_narrow = row_frac_width(rows[-1] - (rows[-1] - rows[0]) // 12) < 0.45
    if bot_narrow and not top_narrow:
        lid_rot = lid_rot.rotate(180)
    # 裁到 alpha 包围盒
    ra = np.asarray(lid_rot).copy()
    rys, rxs = np.where(ra[..., 3] > 8)
    lid_rot = lid_rot.crop((rxs.min(), rys.min(), rxs.max() + 1, rys.max() + 1))
    print('lid rotate: %.2f° (slope %.4f) -> %s' % (angle, slope, lid_rot.size))
    save_png(lid_rot, os.path.join(OUT_DIR, 'bin-lid.png'))
    print('wrote', os.path.join(OUT_DIR, 'bin-lid.png'))

    # -- 深色内壁区域（开运算去描边后取最大连通域再并回暗像素）--
    lum = a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114
    dark = (lum < DARK_LUM) & bin_mask
    core = ndimage.binary_opening(dark, structure=np.ones((OPEN_STROKE,) * 2))
    dlbl, dn = ndimage.label(core)
    if not dn:
        raise SystemExit('未找到深色内壁区域')
    dsizes = np.bincount(dlbl.ravel())
    dsizes[0] = 0
    interior = ndimage.binary_dilation(dlbl == dsizes.argmax(),
                                       structure=np.ones((OPEN_STROKE,) * 2)) & dark & bin_mask

    # -- 分界点：内部区域底边界，且边界下方紧邻浅色（确属前沿弧线）--
    ys, xs_ = np.where(interior)
    pts = []
    for x in np.unique(xs_):
        ybot = ys[xs_ == x].max()
        below = lum[ybot + 3: ybot + 9, x]
        if len(below) >= 3 and (below > 110).mean() > 0.6:
            pts.append((x, ybot))
    pts = np.array(pts)

    # -- 拟合椭圆弧下半段 y = cy + ry*sqrt(1-((x-cx)/rx)^2) --
    def resid(p):
        cx, cy, rx, ry = p
        t = np.clip((pts[:, 0] - cx) / rx, -0.999, 0.999)
        return cy + ry * np.sqrt(1 - t * t) - pts[:, 1]

    fit = least_squares(resid, [pts[:, 0].mean(), pts[:, 1].min() - 40,
                                np.ptp(pts[:, 0]), 80], max_nfev=20000)
    cx, cy, rx, ry = fit.x
    rms = float(np.sqrt((fit.fun ** 2).mean()))
    print('arc fit: cx=%.1f cy=%.1f rx=%.1f ry=%.1f rms=%.2fpx (n=%d)'
          % (cx, cy, rx, ry, rms, len(pts)))

    # -- 切分：弧线（两端水平延伸）以上=后面，以下=前面 --
    xs_full = np.arange(W, dtype=np.float32)
    t = np.clip((xs_full - cx) / rx, -1, 1)
    arc_y = cy + ry * np.sqrt(1 - t * t)
    above = np.arange(H, dtype=np.float32)[:, None] <= arc_y[None, :]
    back_mask = bin_mask & above
    front_mask = bin_mask & ~above

    os.makedirs(OUT_DIR, exist_ok=True)
    for mask, name in ((back_mask, 'bin-back.png'), (front_mask, 'bin-front.png')):
        out = a.copy()
        out[~mask] = 0
        save_png(Image.fromarray(out, 'RGBA'), os.path.join(OUT_DIR, name))
        print('wrote', os.path.join(OUT_DIR, name), int(mask.sum()), 'px')
    # 盖子（已旋转）在上文单独保存

    # -- 验证1：重组一致性（桶前+桶后 应完整还原桶，盖已旋转不参与）--
    reasm = np.zeros_like(a)
    for m in (back_mask, front_mask):
        reasm[m] = a[m]
    diff = np.abs(reasm[..., :3].astype(int) - a[..., :3].astype(int)).sum(axis=2)
    n_diff = int(((diff > 24) & bin_mask).sum())
    print('reassembly diff>24: %d px (应为 0)' % n_diff)

    # -- 验证2：遮挡分层测试图（盖子取旋转版悬于桶侧）--
    test = Image.new('RGBA', (W, H), (255, 240, 240, 255))
    pet = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    pd = ImageDraw.Draw(pet)
    pd.ellipse([620, 40, 800, 200], fill=(60, 220, 90, 255))
    pd.rectangle([648, 140, 772, 300], fill=(60, 220, 90, 255))
    for mask in (back_mask,):
        layer = a.copy()
        layer[~mask] = 0
        test.alpha_composite(Image.fromarray(layer, 'RGBA'))
    test.alpha_composite(pet)
    for mask in (front_mask,):
        layer = a.copy()
        layer[~mask] = 0
        test.alpha_composite(Image.fromarray(layer, 'RGBA'))
    test.alpha_composite(lid_rot, (int(W * 0.55), int(H * 0.02)))
    os.makedirs('tools/tmp', exist_ok=True)
    test.convert('RGB').save(os.path.join('tools', 'tmp', 'bin-layering-test.png'))
    print('wrote tools/tmp/bin-layering-test.png（目视确认遮挡关系）')


if __name__ == '__main__':
    main()
