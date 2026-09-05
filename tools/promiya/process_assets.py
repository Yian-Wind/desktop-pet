# -*- coding: utf-8 -*-
"""Promiya asset pipeline.

1. AI-cutout (rembg) the white/black background front images, keeping the
   1254x1254 canvas intact.
2. Blind-register coat.png (garment-only, 1046x1504 transparent) onto the
   1254x1254 canvas by grid-searching scale/offset to maximize IoU with the
   coat region extracted from front_coat_donotuse!.png.
3. Emit nocoat.png / nocoat_eyeclosed.png / coat_overlay.png plus a composite
   preview for manual inspection.

Usage: python tools/promiya/process_assets.py
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image
from rembg import remove, new_session

SRC = Path(r"D:\pet-promiya\pet_reference\promiya")
GEN = SRC / "gpt_generate"
OUT = Path(r"D:\pet\packs\promiya\assets")
CANVAS = 1254


def cutout(src: Path, dst: Path, session) -> None:
    image = Image.open(src).convert("RGB")
    result = remove(image, session=session, post_process_mask=True)
    result = result.resize((CANVAS, CANVAS)) if result.size != (CANVAS, CANVAS) else result
    alpha = np.asarray(result)[:, :, 3]
    print(f"{dst.name}: opaque={np.mean(alpha > 200):.2%} "
          f"bbox={_alpha_bbox(alpha)}")
    result.save(dst)


def _alpha_bbox(alpha: np.ndarray):
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        return None
    return f"x[{xs.min()}..{xs.max()}] y[{ys.min()}..{ys.max()}]"


def silhouette_from_solid(src: Path) -> np.ndarray:
    """Character silhouette from a solid-background image via border flood fill.

    The backgrounds are near-uniform (white ~254 / black ~1), so seed the flood
    from the border and absorb pixels close to the border color; everything
    left is the character.
    """
    rgb = np.asarray(Image.open(src).convert("RGB")).astype(np.int16)
    h, w, _ = rgb.shape
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = border.mean(axis=0)
    dist = np.abs(rgb - bg).max(axis=2)
    bgish = dist < 60
    visited = np.zeros((h, w), dtype=bool)
    stack: list[tuple[int, int]] = []
    for x in range(w):
        if bgish[0, x]:
            stack.append((0, x))
        if bgish[h - 1, x]:
            stack.append((h - 1, x))
    for y in range(h):
        if bgish[y, 0] and not visited[y, 0]:
            stack.append((y, 0))
        if bgish[y, w - 1] and not visited[y, w - 1]:
            stack.append((y, w - 1))
    while stack:
        y, x = stack.pop()
        if y < 0 or y >= h or x < 0 or x >= w or visited[y, x] or not bgish[y, x]:
            continue
        visited[y, x] = True
        stack.extend(((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)))
    return ~visited  # True = character


def register_coat() -> tuple[float, float, int, int]:
    """Place coat.png (garment-only, 1046x1504) onto the 1254 canvas.

    The reference coat in front_coat_donotuse!.png marks where a coat sits on
    this character: shoulder line right below the neck (~y560), hem at the
    feet (~y1130). coat.png is a different (fuller) garment, so we grid-search
    scale + offset maximizing coverage of the reference coat region while
    penalizing any spill outside the with-coat silhouette.

    Returns (coverage, scale_x, scale_y, dx, dy): dx/dy are the top-left of
    the cropped coat silhouette on the 1254 canvas.
    """
    full_sil = silhouette_from_solid(GEN / "front_coat_donotuse!.png")
    nocoat_sil = np.asarray(Image.open(OUT / "nocoat.png"))[:, :, 3] > 128
    target = full_sil & ~_dilate(nocoat_sil, 6)
    full_room = _dilate(full_sil, 8)  # garment may not poke beyond the figure
    area = int(target.sum())

    # Crop the coat to its own alpha bbox so scale/offset are well-defined.
    coat = Image.open(GEN / "coat.png")
    alpha = np.asarray(coat.split()[3])
    cys, cxs = np.where(alpha > 128)
    crop_box = (cxs.min(), cys.min(), cxs.max() + 1, cys.max() + 1)
    coat_crop = coat.crop(crop_box)
    crop_w, crop_h = coat_crop.size

    # Collar center in crop coordinates: average extent over the top 8% rows.
    top_rows = alpha[cys.min():cys.min() + (cys.max() - cys.min()) // 12, :]
    t_ys, t_xs = np.where(top_rows > 128)
    collar_cx = (t_xs.min() + t_xs.max()) / 2 - cxs.min()

    # Alignment anchors suggested by the image-generating model:
    #   collar center -> X=627, collar top -> Y=488, widest -> X 355..907
    #   (content width ~552), hem -> Y ~1095..1130 (content height ~624).
    ANCHOR_CX, ANCHOR_TOP = 627, 488
    gpt_sx = 552 / crop_w
    gpt_sy = 624 / crop_h

    def evaluate(sx: float, sy: float, dx: int, dy: int,
                 t: np.ndarray, room: np.ndarray, div: int) -> tuple[float, float, float]:
        sw = max(1, round(crop_w * sx))
        sh = max(1, round(crop_h * sy))
        a = np.asarray(
            coat_crop.split()[3].resize((max(1, sw // div), max(1, sh // div)))
        ) > 128
        ch, cw = a.shape
        th, tw = t.shape
        placed = np.zeros_like(t)
        y0, y1 = max(0, dy // div), min(th, dy // div + ch)
        x0, x1 = max(0, dx // div), min(tw, dx // div + cw)
        if y0 >= y1 or x0 >= x1:
            return (-1e18, 0.0, 0.0)
        placed[y0:y1, x0:x1] = a[: y1 - y0, : x1 - x0]
        covered = float(np.logical_and(placed, t).sum())
        spill = float(np.logical_and(placed, ~room).sum())
        # On a downsampled grid each hit stands for div^2 real pixels.
        return (covered - 2.0 * spill, covered * div * div / area, spill * div * div / area)

    t_small = target[::4, ::4]
    room_small = full_room[::4, ::4]

    # Baseline: GPT's exact suggested placement, no search.
    gpt_dx = round(ANCHOR_CX - collar_cx * gpt_sx)
    gpt_score, gpt_cov, gpt_spill = evaluate(
        gpt_sx, gpt_sy, gpt_dx, ANCHOR_TOP, t_small, room_small, 4)
    print(f"GPT anchor placement: coverage={gpt_cov:.1%} spill={gpt_spill:.1%} "
          f"scale=({gpt_sx:.3f},{gpt_sy:.3f}) top-left=({gpt_dx},{ANCHOR_TOP})")

    # Refine around the GPT anchors: independent x/y scales, small offsets.
    best = (gpt_score, gpt_sx, gpt_sy, gpt_dx, ANCHOR_TOP)
    for sx in np.arange(gpt_sx - 0.03, gpt_sx + 0.031, 0.005):
        for sy in np.arange(gpt_sy - 0.03, gpt_sy + 0.031, 0.005):
            for oy in range(-16, 17, 4):
                for ox in range(-16, 17, 4):
                    score = evaluate(sx, sy, gpt_dx + ox, ANCHOR_TOP + oy,
                                     t_small, room_small, 4)[0]
                    if score > best[0]:
                        best = (score, sx, sy, gpt_dx + ox, ANCHOR_TOP + oy)
    _, sx, sy, dx, dy = best
    # Fine pass at full resolution.
    for s_x in np.arange(sx - 0.01, sx + 0.0101, 0.0025):
        for s_y in np.arange(sy - 0.01, sy + 0.0101, 0.0025):
            for oy in range(-8, 9, 2):
                for ox in range(-8, 9, 2):
                    score = evaluate(s_x, s_y, dx + ox, dy + oy,
                                     target, full_room, 1)[0]
                    if score > best[0]:
                        best = (score, s_x, s_y, dx + ox, dy + oy)
    score, sx, sy, dx, dy = best
    _, cov, spill = evaluate(sx, sy, dx, dy, target, full_room, 1)
    print(f"refined placement: coverage={cov:.1%} spill={spill:.1%} "
          f"scale=({sx:.4f},{sy:.4f}) top-left=({dx},{dy})")
    return cov, sx, sy, dx, dy


def _dilate(mask: np.ndarray, px: int) -> np.ndarray:
    out = mask.copy()
    for _ in range(px):
        out = out | np.roll(out, 1, 0) | np.roll(out, -1, 0) \
              | np.roll(out, 1, 1) | np.roll(out, -1, 1)
    return out


def place_coat(sx: float, sy: float, dx: int, dy: int, dst: Path) -> None:
    """Paste the cropped coat, scaled non-uniformly by (sx, sy), at (dx, dy)."""
    coat = Image.open(GEN / "coat.png")
    alpha = np.asarray(coat.split()[3])
    cys, cxs = np.where(alpha > 128)
    coat_crop = coat.crop((cxs.min(), cys.min(), cxs.max() + 1, cys.max() + 1))
    size = (max(1, round(coat_crop.width * sx)), max(1, round(coat_crop.height * sy)))
    resized = coat_crop.resize(size, Image.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(resized, (dx, dy), resized)
    canvas.save(dst)


def place_coat_from_align(dst: Path) -> None:
    """Place the coat using the hand-tuned alignment from align.html."""
    import json
    align_path = Path(__file__).parent / "align" / "align_result.json"
    align = json.loads(align_path.read_text(encoding="utf-8"))
    coat = Image.open(GEN / "coat_front.png")
    alpha = np.asarray(coat.split()[3])
    cys, cxs = np.where(alpha > 128)
    coat_crop = coat.crop((cxs.min(), cys.min(), cxs.max() + 1, cys.max() + 1))
    size = (
        max(1, round(coat_crop.width * align["scale_x"])),
        max(1, round(coat_crop.height * align["scale_y"]))
    )
    resized = coat_crop.resize(size, Image.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(resized, (align["left"], align["top"]), resized)
    canvas.save(dst)
    print(f"coat placed from align_result.json: scale=({align['scale_x']},{align['scale_y']}) "
          f"top-left=({align['left']},{align['top']}) size={size}")


def _save_locked_safe(image: Image.Image, dst: Path) -> None:
    """Photos viewer holds the output open; write to a temp file and replace."""
    tmp = dst.with_suffix('.tmp.png')
    image.save(tmp, format='PNG')
    import os
    try:
        os.replace(tmp, dst)
    except OSError:
        print(f"WARNING: {dst.name} is locked by another program; kept as {tmp.name}")
        return
    print(f"saved {dst.name}")


def preview(dst: Path) -> None:
    base = Image.open(OUT / "nocoat.png")
    coat = Image.open(OUT / "coat_overlay.png")
    base.alpha_composite(coat)
    _save_locked_safe(base, dst)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    if not (OUT / "nocoat.png").exists() or not (OUT / "nocoat_eyeclosed.png").exists():
        session = new_session("isnet-general-use")
        cutout(GEN / "front_nocoat.png", OUT / "nocoat.png", session)
        cutout(GEN / "front_nocoat_eyeclosed.png", OUT / "nocoat_eyeclosed.png", session)
    align_path = Path(__file__).parent / "align" / "align_result.json"
    import json as _json
    if align_path.exists():
        place_coat_from_align(OUT / "coat_overlay.png")
    else:
        cov, sx, sy, dx, dy = register_coat()
        place_coat(sx, sy, dx, dy, OUT / "coat_overlay.png")
    preview(OUT / "preview_composite.png")


if __name__ == "__main__":
    sys.exit(main())
