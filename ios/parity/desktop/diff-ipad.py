#!/usr/bin/env python3
"""Compare the iPad captures with the desktop references.

    python3 ios/parity/desktop/diff-ipad.py                    every capture with a reference
    python3 ios/parity/desktop/diff-ipad.py main chat-approval only these surfaces
    python3 ios/parity/desktop/diff-ipad.py --viewport 1366x1024
    python3 ios/parity/desktop/diff-ipad.py --gate             exit 1 if one is under the threshold
    python3 ios/parity/desktop/diff-ipad.py --threshold 98 --delta-e 3 --json

Pairs `out/ipad-<W>x<H>-<NN>-<surface>.png` (capture-ipad.sh) with
`refs/desktop-<W>x<H>-<NN>-<surface>.png` (capture-desktop.mjs). The metric is
the phone harness's (../diff.py, imported, not copied): every unmasked pixel
is converted to CIELAB and compared with CIEDE2000; a pixel passes at
dE00 <= --delta-e; the score is the share that pass. Sheets go to
`out/diff-ipad/` (reference | capture | heatmap, masks hatched).

Masks (rects in points, scaled to the image):
- masks.json `_all`: the top 36 pt band. On the desktop it is the macOS title
  bar strip (hiddenInset traffic lights, drawn by macOS, not the renderer);
  on the iPad it holds the iPadOS status bar. The iPad does NOT draw a fake
  title bar or traffic lights: it keeps the band's height as its top inset.
- masks.json per surface (key: the surface id, e.g. "team-map"), for regions
  whose content differs by design.
- derived from the reference's DOM dump (refs/*.json), per capture:
  every mascot frame (data-shape, data-owl*, .trombi-avatar: the characters
  animate; frames are checked by position in the element-box pass, not by
  pixels) and the focused text field's caret column (the desktop hides its
  caret; the iPad's blinks).

A capture whose size differs from its reference (another device) is not
resized: the score is reported as a size mismatch, since layout at another
width is a different layout. Make references at that size instead
(capture-desktop.mjs --viewport WxH).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import diff as base  # noqa: E402  (ios/parity/diff.py: srgb_to_lab, ciede2000, heatmap)

REFS = HERE / "refs"
OUT = HERE / "out"
DIFF = OUT / "diff-ipad"
NAME = re.compile(r"^(?:desktop|ipad)-(\d+)x(\d+)-(\d+)-(.+)$")
MASCOT_DATA = ("data-shape=", "data-owl=", "data-owl-skin=", "data-trombi")


def surface_of(rest: str) -> str:
    return rest.split("-skin-")[0]


def masks_for(stem: str, size: tuple[int, int], viewport: tuple[int, int], masks: dict, dom: dict | None) -> tuple[np.ndarray, int]:
    w, h = size
    sx, sy = w / viewport[0], h / viewport[1]
    out = np.zeros((h, w), dtype=bool)
    m = NAME.match(stem)
    surface = surface_of(m.group(4)) if m else stem
    rects = []
    for rect in masks.get("_all", {}).get("rects", []):
        x, y, rw, rh = rect["rect"]
        rects.append((x, y, viewport[0] if rw == "100%" else rw, rh))
    rects += [tuple(r["rect"]) for r in masks.get(surface, {}).get("rects", [])]
    derived = 0
    if dom:
        for box in dom.get("boxes", []):
            data = " ".join(box.get("data", []))
            if any(key in data for key in MASCOT_DATA) or "trombi-avatar" in box.get("cls", ""):
                x, y, bw, bh = box["rect"]
                rects.append((x - 2, y - 2, bw + 4, bh + 4))
                derived += 1
        field = dom.get("focusedField")
        if field:
            x, y, fw, fh = field
            rects.append((x, y, fw, fh))
            derived += 1
    for x, y, rw, rh in rects:
        x0, y0 = max(0, int(np.floor(x * sx))), max(0, int(np.floor(y * sy)))
        x1, y1 = min(w, int(np.ceil((x + rw) * sx))), min(h, int(np.ceil((y + rh) * sy)))
        if x1 > x0 and y1 > y0:
            out[y0:y1, x0:x1] = True
    return out, derived


def orient(cap: Image.Image, ref: Image.Image) -> Image.Image:
    """simctl may return the framebuffer in the device's portrait orientation."""
    if cap.size == ref.size:
        return cap
    if cap.size == (ref.size[1], ref.size[0]):
        return cap.rotate(90, expand=True)  # landscapeRight: home side on the right
    return cap


def compare(ref_path: Path, cap_path: Path, masks: dict, limit: float) -> dict:
    stem = ref_path.stem
    m = NAME.match(stem)
    viewport = (int(m.group(1)), int(m.group(2)))
    ref = Image.open(ref_path).convert("RGB")
    cap = orient(Image.open(cap_path).convert("RGB"), ref)
    surface = m.group(4)
    result = {"surface": f"{m.group(3)}-{surface}", "viewport": f"{viewport[0]}x{viewport[1]}"}
    if cap.size != ref.size:
        return {**result, "score": 0.0, "error": f"size {cap.size[0]}x{cap.size[1]} px vs reference {ref.size[0]}x{ref.size[1]} px"}
    dom_path = ref_path.with_suffix(".json")
    dom = json.loads(dom_path.read_text()) if dom_path.exists() else None
    a, b = np.asarray(ref), np.asarray(cap)
    de = base.ciede2000(base.srgb_to_lab(a), base.srgb_to_lab(b))
    mask, derived = masks_for(stem, ref.size, viewport, masks, dom)
    considered = int((~mask).sum())
    passing = int(((de <= limit) & ~mask).sum())
    score = 100.0 * passing / considered if considered else 100.0

    DIFF.mkdir(parents=True, exist_ok=True)
    heat = base.heatmap(de, mask, limit)
    w, h = ref.size
    sheet = Image.new("RGB", (w * 3, h), (0, 0, 0))
    sheet.paste(ref, (0, 0))
    sheet.paste(cap, (w, 0))
    sheet.paste(heat, (2 * w, 0))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.load_default(size=40)
    except TypeError:
        font = ImageFont.load_default()
    for i, label in enumerate(("desktop", "iPad", f"dE00>{limit:g}  {score:.2f}%")):
        draw.rectangle([i * w, h - 64, i * w + 620, h], fill=(0, 0, 0))
        draw.text((i * w + 20, h - 56), label, fill=(255, 255, 255), font=font)
    sheet.thumbnail((w * 3 // 2, h // 2))
    sheet.save(DIFF / f"{stem[len('desktop-'):]}.png")
    return {
        **result,
        "score": round(score, 2),
        "masked_pct": round(100.0 * mask.mean(), 1),
        "mean_de": round(float(de[~mask].mean()) if considered else 0.0, 2),
        "derived_masks": derived,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("surfaces", nargs="*", help="surface ids (main, chat-approval) or NN-id")
    parser.add_argument("--viewport", action="append", help="WxH, repeatable")
    parser.add_argument("--gate", action="store_true")
    parser.add_argument("--threshold", type=float, default=98.0)
    parser.add_argument("--delta-e", type=float, default=3.0)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    masks = json.loads((HERE / "masks.json").read_text())
    results, missing = [], []
    for cap_path in sorted(OUT.glob("ipad-*.png")):
        stem = "desktop-" + cap_path.stem[len("ipad-"):]
        m = NAME.match(stem)
        if not m:
            continue
        if args.viewport and f"{m.group(1)}x{m.group(2)}" not in args.viewport:
            continue
        if args.surfaces and not any(m.group(4) == s or f"{m.group(3)}-{m.group(4)}" == s for s in args.surfaces):
            continue
        ref_path = REFS / f"{stem}.png"
        if not ref_path.exists():
            missing.append(cap_path.name)
            continue
        results.append(compare(ref_path, cap_path, masks, args.delta_e))

    if args.json:
        print(json.dumps({"results": results, "missing_reference": missing}, indent=2))
    else:
        print(f"{'viewport':10} {'surface':40} {'score':>8} {'masked':>7} {'mean dE':>8}")
        for r in results:
            if "error" in r:
                print(f"{r['viewport']:10} {r['surface']:40} {'--':>8}   {r['error']}")
                continue
            flag = "" if r["score"] >= args.threshold else "  < gate"
            print(f"{r['viewport']:10} {r['surface']:40} {r['score']:7.2f}% {r['masked_pct']:6.1f}% {r['mean_de']:8.2f}{flag}")
        if missing:
            print(f"no reference for: {', '.join(missing)} (run capture-desktop.mjs)")
        if results:
            ok = sum(1 for r in results if r["score"] >= args.threshold and "error" not in r)
            print(f"{ok}/{len(results)} at or above {args.threshold:g}% (CIEDE2000 <= {args.delta_e:g}); sheets in {DIFF}")
        else:
            print("nothing to compare: run capture-ipad.sh first")
    if args.gate and (missing or not results or any(r["score"] < args.threshold or "error" in r for r in results)):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
