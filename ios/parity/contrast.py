#!/usr/bin/env python3
"""Find text that is hard to read on captured screens.

    python3 ios/parity/contrast.py DIR [DIR ...]        report every PNG
    python3 ios/parity/contrast.py --gate DIR            exit 1 when a tile fails
    python3 ios/parity/contrast.py --min 3 --annotate DIR
    python3 ios/parity/contrast.py --baseline ios/parity-refs DIR   ignore what the
                                                  references themselves draw (Black's
                                                  measured tertiary labels, 2.5:1)

The token pairs are checked exactly by the unit test
(ios/Tests/CompanionCoreTests/SkinsTests.swift); this script checks what was
actually drawn, where a view may use the wrong token (JC's light-bubble bug).

Each screen is cut into tiles of about 24x16 pt. In a tile, the ground is the
most common colour; "ink" is the pixels far from it (CIE dE > 12). A tile with
enough ink to be glyphs is scored with the WCAG contrast between the ground
and the strongest ink (the 90th percentile by contrast, so anti-aliased edges
do not count against a sharp glyph). Tiles under --min (default 3.0: the
large/secondary threshold; body text is held to 4.5 by the unit test) are
reported, and with --annotate drawn in red on DIR/contrast/NAME.png.

Masked areas: the status bar (top 54 pt), mascots and photos are pictures, not
text; tiles whose ink is mostly saturated colour (chroma) are skipped, which
keeps avatars and bot colours out of the report.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SCREEN_PT = (402.0, 874.0)
TILE_PT = (24.0, 16.0)
STATUS_BAR_PT = 54.0


def luminance(rgb: np.ndarray) -> np.ndarray:
    c = rgb.astype(np.float64) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722


def contrast(l1: np.ndarray, l2: float) -> np.ndarray:
    hi = np.maximum(l1, l2)
    lo = np.minimum(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def components(mask: np.ndarray, smallest: int = 4) -> int:
    """Connected marks (8-neighbour) of at least `smallest` pixels."""
    seen = np.zeros_like(mask, dtype=bool)
    h, w = mask.shape
    count = 0
    for y0, x0 in zip(*np.nonzero(mask)):
        if seen[y0, x0]:
            continue
        stack = [(y0, x0)]
        seen[y0, x0] = True
        size = 0
        while stack:
            y, x = stack.pop()
            size += 1
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        if size >= smallest:
            count += 1
    return count


def score_tile(tile: np.ndarray) -> float | None:
    flat = tile.reshape(-1, 3)
    # ground: the most common colour (quantized to 4 bits per channel)
    q = (flat >> 3).astype(np.int32)
    keys = q[:, 0] * 1024 + q[:, 1] * 32 + q[:, 2]
    values, counts = np.unique(keys, return_counts=True)
    ground_key = values[np.argmax(counts)]
    ground = flat[keys == ground_key].mean(axis=0)
    if counts.max() < 0.45 * len(flat):
        return None  # a picture or a gradient, not text on a ground
    diff = np.abs(flat.astype(np.int32) - ground.astype(np.int32)).sum(axis=1)
    mask = diff > 40
    ink = flat[mask]
    if len(ink) < 0.03 * len(flat) or len(ink) > 0.5 * len(flat):
        return None
    # a hairline, a card edge or a control's rim fills whole rows or columns
    # of the tile; glyphs never do
    grid = mask.reshape(tile.shape[:2])
    if (grid.mean(axis=1) > 0.8).any() or (grid.mean(axis=0) > 0.8).any():
        return None
    # glyphs are small: a tile whose ink is one flat colour in a block is a
    # shape (a toggle knob, a chip, a dot), not text
    iq = (ink >> 3).astype(np.int32)
    ikeys = iq[:, 0] * 1024 + iq[:, 1] * 32 + iq[:, 2]
    _, icounts = np.unique(ikeys, return_counts=True)
    if icounts.max() > 0.7 * len(ink):
        return None
    # saturated ink is an icon, an avatar or a bot colour, not body text
    chroma = ink.max(axis=1).astype(np.int32) - ink.min(axis=1).astype(np.int32)
    if np.median(chroma) > 70:
        return None
    # text is several glyphs: at least three separate marks
    if components(grid) < 3:
        return None
    lg = float(luminance(ground[None, :])[0])
    ratios = contrast(luminance(ink), lg)
    return float(np.percentile(ratios, 90))


def check(path: Path, minimum: float, annotate: bool, top_pt: float = STATUS_BAR_PT) -> list[tuple[float, tuple[int, int, int, int]]]:
    image = Image.open(path).convert("RGB")
    rgb = np.asarray(image)
    h, w = rgb.shape[:2]
    sx, sy = w / SCREEN_PT[0], h / SCREEN_PT[1]
    tw, th = int(TILE_PT[0] * sx), int(TILE_PT[1] * sy)
    top = int(top_pt * sy)
    failures = []
    for y in range(top, h - th + 1, th):
        for x in range(0, w - tw + 1, tw):
            score = score_tile(rgb[y:y + th, x:x + tw])
            if score is not None and score < minimum:
                failures.append((score, (x, y, x + tw, y + th)))
    if annotate and failures:
        out = path.parent / "contrast"
        out.mkdir(exist_ok=True)
        draw = ImageDraw.Draw(image)
        for score, box in failures:
            draw.rectangle(box, outline=(255, 0, 0), width=3)
            draw.text((box[0] + 3, box[1] + 2), f"{score:.1f}", fill=(255, 0, 0))
        image.save(out / path.name)
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("dirs", nargs="+", type=Path)
    parser.add_argument("--min", type=float, default=3.0)
    parser.add_argument("--gate", action="store_true")
    parser.add_argument("--annotate", action="store_true")
    parser.add_argument("--allow", type=int, default=0, help="failing tiles tolerated per screen")
    parser.add_argument("--top", type=float, default=STATUS_BAR_PT, help="points skipped at the top (54: the status bar; 130 also skips the header's scroll-edge fade, which fades text on purpose)")
    parser.add_argument("--baseline", type=Path, help="a folder of reference PNGs: tiles that already fail there are by design")
    args = parser.parse_args()
    bad = 0
    for directory in args.dirs:
        for png in sorted(directory.glob("*.png")):
            failures = check(png, args.min, args.annotate, args.top)
            if args.baseline and (args.baseline / png.name).exists():
                known = {box for _, box in check(args.baseline / png.name, args.min, False, args.top)}
                failures = [f for f in failures if f[1] not in known]
            worst = min((f[0] for f in failures), default=None)
            status = "ok" if len(failures) <= args.allow else "LOW"
            if status == "LOW":
                bad += 1
            detail = f"{len(failures)} tiles, worst {worst:.2f}" if failures else "clean"
            print(f"{status:4} {directory.name}/{png.name}: {detail}")
    print(f"{bad} screen(s) with low-contrast text (min {args.min})")
    return 1 if args.gate and bad else 0


if __name__ == "__main__":
    sys.exit(main())
