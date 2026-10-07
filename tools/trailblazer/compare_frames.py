#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""渲染帧数值对比：轮廓包围盒 / 掩码 IoU / 非背景平均差。

用法：python tools/trailblazer/compare_frames.py A.png B.png [...]
输出每对帧的指标；IoU 高+均值差小 = 画面一致。
"""
import sys

import numpy as np
from PIL import Image

BG = np.array([219, 232, 242])  # 运行时 clearColor 0.86,0.91,0.95


def load(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(int)
    mask = np.abs(a - BG).sum(axis=2) > 30
    return a, mask


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        return
    a_img, a_mask = load(args[0])
    for other in args[1:]:
        b_img, b_mask = load(other)
        if a_img.shape != b_img.shape:
            b_img = np.asarray(Image.fromarray(b_img.astype(np.uint8)).resize(
                (a_img.shape[1], a_img.shape[0]))).astype(int)
            b_mask = np.abs(b_img - BG).sum(axis=2) > 30
        inter = (a_mask & b_mask).sum()
        union = (a_mask | b_mask).sum()
        iou = inter / union if union else 1.0
        both = a_mask | b_mask
        diff = np.abs(a_img - b_img).sum(axis=2)
        mean_diff = diff[both].mean() if both.any() else 0.0

        def bbox(m):
            ys, xs = np.where(m)
            return (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())) if len(ys) else None

        print('%s\n  vs %s\n    IoU=%.3f  meanDiff=%.1f  bboxA=%s  bboxB=%s'
              % (args[0], other, iou, mean_diff, bbox(a_mask), bbox(b_mask)))


if __name__ == '__main__':
    main()
