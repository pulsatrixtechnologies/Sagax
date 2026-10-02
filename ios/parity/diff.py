#!/usr/bin/env python3
"""Compare captured screens with the references.

    python3 ios/parity/diff.py                 report every screen
    python3 ios/parity/diff.py 02-chat         only these
    python3 ios/parity/diff.py --gate          exit 1 if any screen is under the threshold
    python3 ios/parity/diff.py --threshold 98 --delta-e 3

For each `out/NN-name.png` with a matching `../parity-refs/NN-name.png`:

- pixels inside the screen's masks (masks.json: status bar, mascot frames,
  regions whose text is placeholder) are ignored;
- every other pixel is converted to CIELAB (sRGB, D65) and compared with
  **CIEDE2000**; a pixel passes when dE00 <= --delta-e (default 3);
- the score is the share of unmasked pixels that pass;
- `out/diff/NN-name.png` is written: reference | capture | heatmap, with
  masks hatched grey and failing pixels from yellow (just over) to red.

Mask rectangles are in points (402x874 pt) and scaled to the image, so a
capture at another scale still lines up. Element-box checks (the spec's
"no box off by more than 1 pt") are not done here; they need the view tree.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
REFS = HERE.parent / "parity-refs"
OUT = HERE / "out"
DIFF = OUT / "diff"
SCREEN_PT = (402.0, 874.0)


# ── colour ────────────────────────────────────────────────────────────────
def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """uint8 HxWx3 sRGB -> float HxWx3 CIELAB (D65)."""
    c = rgb.astype(np.float64) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ])
    xyz = c @ m.T
    xyz /= np.array([0.95047, 1.0, 1.08883])
    eps, kappa = 216 / 24389, 24389 / 27
    f = np.where(xyz > eps, np.cbrt(xyz), (kappa * xyz + 16) / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1)


def ciede2000(lab1: np.ndarray, lab2: np.ndarray) -> np.ndarray:
    L1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    L2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]
    C1 = np.hypot(a1, b1)
    C2 = np.hypot(a2, b2)
    Cbar = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360
    dLp = L2 - L1
    dCp = C2p - C1p
    dh = h2p - h1p
    dh = np.where(dh > 180, dh - 360, dh)
    dh = np.where(dh < -180, dh + 360, dh)
    dh = np.where(C1p * C2p == 0, 0, dh)
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dh / 2))
    Lbp = (L1 + L2) / 2
    Cbp = (C1p + C2p) / 2
    hsum = h1p + h2p
    hbp = np.where(np.abs(h1p - h2p) > 180, np.where(hsum < 360, (hsum + 360) / 2, (hsum - 360) / 2), hsum / 2)
    hbp = np.where(C1p * C2p == 0, hsum, hbp)
    T = (1 - 0.17 * np.cos(np.radians(hbp - 30)) + 0.24 * np.cos(np.radians(2 * hbp))
         + 0.32 * np.cos(np.radians(3 * hbp + 6)) - 0.20 * np.cos(np.radians(4 * hbp - 63)))
    dtheta = 30 * np.exp(-(((hbp - 275) / 25) ** 2))
    Rc = 2 * np.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
    Sl = 1 + (0.015 * (Lbp - 50) ** 2) / np.sqrt(20 + (Lbp - 50) ** 2)
    Sc = 1 + 0.045 * Cbp
    Sh = 1 + 0.015 * Cbp * T
    Rt = -np.sin(np.radians(2 * dtheta)) * Rc
    return np.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))


# ── masks ─────────────────────────────────────────────────────────────────
def load_masks() -> dict:
    return json.loads((HERE / "masks.json").read_text())


def mask_for(screen: str, size: tuple[int, int], masks: dict) -> np.ndarray:
    w, h = size
    sx, sy = w / SCREEN_PT[0], h / SCREEN_PT[1]
    out = np.zeros((h, w), dtype=bool)
    rects = list(masks.get("_all", {}).get("rects", [])) + list(masks.get(screen, {}).get("rects", []))
    for rect in rects:
        x, y, rw, rh = rect["rect"]
        x0, y0 = max(0, int(np.floor(x * sx))), max(0, int(np.floor(y * sy)))
        x1, y1 = min(w, int(np.ceil((x + rw) * sx))), min(h, int(np.ceil((y + rh) * sy)))
        if x1 > x0 and y1 > y0:
            out[y0:y1, x0:x1] = True
    return out


# ── report ────────────────────────────────────────────────────────────────
def heatmap(de: np.ndarray, mask: np.ndarray, limit: float) -> Image.Image:
    h, w = de.shape
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[...] = (24, 24, 24)
    ok = (de <= limit) & ~mask
    img[ok] = (20, 70, 30)
    bad = (de > limit) & ~mask
    t = np.clip((de - limit) / 20.0, 0, 1)
    img[bad, 0] = 255
    img[bad, 1] = (220 * (1 - t[bad])).astype(np.uint8)
    img[bad, 2] = 0
    stripes = ((np.add.outer(np.arange(h), np.arange(w)) // 12) % 2 == 0)
    img[mask & stripes] = (90, 90, 90)
    img[mask & ~stripes] = (60, 60, 60)
    return Image.fromarray(img)


def compare(screen: str, masks: dict, limit: float) -> dict | None:
    ref_path, out_path = REFS / f"{screen}.png", OUT / f"{screen}.png"
    if not ref_path.exists() or not out_path.exists():
        return None
    ref = Image.open(ref_path).convert("RGB")
    cap = Image.open(out_path).convert("RGB")
    if cap.size != ref.size:
        cap = cap.resize(ref.size, Image.LANCZOS)
    a, b = np.asarray(ref), np.asarray(cap)
    de = ciede2000(srgb_to_lab(a), srgb_to_lab(b))
    mask = mask_for(screen, ref.size, masks)
    considered = int((~mask).sum())
    passing = int(((de <= limit) & ~mask).sum())
    score = 100.0 * passing / considered if considered else 100.0

    DIFF.mkdir(parents=True, exist_ok=True)
    heat = heatmap(de, mask, limit)
    w, h = ref.size
    sheet = Image.new("RGB", (w * 3, h), (0, 0, 0))
    sheet.paste(ref, (0, 0))
    sheet.paste(cap, (w, 0))
    sheet.paste(heat, (2 * w, 0))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.load_default(size=44)
    except TypeError:  # Pillow < 10.1
        font = ImageFont.load_default()
    for i, label in enumerate(("reference", "capture", f"dE00>{limit:g}  {score:.2f}%")):
        draw.rectangle([i * w, h - 70, i * w + 560, h], fill=(0, 0, 0))
        draw.text((i * w + 20, h - 60), label, fill=(255, 255, 255), font=font)
    sheet.thumbnail((w * 3 // 2, h // 2))
    sheet.save(DIFF / f"{screen}.png")
    return {
        "screen": screen,
        "score": round(score, 2),
        "masked_pct": round(100.0 * mask.mean(), 1),
        "mean_de": round(float(de[~mask].mean()) if considered else 0.0, 2),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("screens", nargs="*")
    parser.add_argument("--gate", action="store_true", help="exit 1 when a screen is below the threshold")
    parser.add_argument("--threshold", type=float, default=98.0, help="minimum %% of unmasked pixels within dE (default 98)")
    parser.add_argument("--delta-e", type=float, default=3.0, help="CIEDE2000 tolerance per pixel (default 3)")
    parser.add_argument("--json", action="store_true", help="print the results as JSON")
    args = parser.parse_args()

    masks = load_masks()
    screens = args.screens or sorted(p.stem for p in REFS.glob("*.png"))
    results, missing = [], []
    for screen in screens:
        result = compare(screen, masks, args.delta_e)
        if result is None:
            missing.append(screen)
        else:
            results.append(result)

    if args.json:
        print(json.dumps({"results": results, "missing": missing}, indent=2))
    else:
        print(f"{'screen':32} {'score':>8} {'masked':>7} {'mean dE':>8}")
        for r in results:
            flag = "" if r["score"] >= args.threshold else "  < gate"
            print(f"{r['screen']:32} {r['score']:7.2f}% {r['masked_pct']:6.1f}% {r['mean_de']:8.2f}{flag}")
        if missing:
            print(f"missing capture or reference: {', '.join(missing)}")
        if results:
            print(f"metric: CIEDE2000, pass <= {args.delta_e:g}; gate {args.threshold:g}%; sheets in {DIFF}")

    if args.gate and (missing or any(r["score"] < args.threshold for r in results)):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
