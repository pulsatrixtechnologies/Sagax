// How each Grump skin paints the cat (GrumpMascot.tsx). Grump is drawn flat
// (grump-art.ts: cream fur, dark point markings, a white muzzle, one shade
// tone, one outline), so a skin is first a palette: every paint role of the
// drawing gets a color or a gradient. The everyday skins are the bot's color
// (Plain) and the cat coats (Tuxedo, black with a white bib and green eyes;
// Calico, the face split orange and black over white fur; Tabby, striped all
// over; Siamese, seal points on pale fur and deep blue eyes). Then the
// premium editions, consistent with the Trombi, Shapes and Shiba sets:
// Retro 98 and Gold (rare); Void (all black, eyes glowing in the bot's
// color), Neon, Chrome and Glitch (epic); Holographic and Molten
// (legendary), with the treatment the Shapes skins get on the head and the
// body (gradients, edges, auras, particles). Same contract as the Shiba:
// `full` adds the filters and the moving parts; still keeps the look with no
// filter and nothing moving. Keyframes are in skin-fx.css.
import type { ReactNode } from "react";
import { GRUMP_SKIN_TIER, GRUMP_SKINS, type GrumpSkin, type ShapeSkin, type SkinTier } from "../../../shared/mascot-look";
import { GRUMP_ART, grumpPalette, type GrumpPalette } from "../grump-art";
import { relativeLuminance } from "../../../shared/mascot-colors";
import { mix, type FxKind } from "./skin-fx";
import { shapeSkinLayers, tint, type ShapeSkinLayers } from "./shape-skins";
import { vgaColor } from "./shiba-skins";

/** A Grump skin id this build knows, else Plain. */
export function grumpSkinId(skin: string | null | undefined): GrumpSkin {
  return (GRUMP_SKINS as readonly string[]).includes(skin ?? "") ? (skin as GrumpSkin) : "plain";
}

export interface GrumpSkinPaint {
  /** Every paint role: a hex, or a url() into `defs`. */
  palette: GrumpPalette;
  /** The gradients and patterns the palette points at (ids from `uid`). */
  defs: ReactNode;
  fx: FxKind;
  tier: SkinTier;
  /** A whole-drawing class (the glitch's slice jitter). */
  bodyClass?: string;
}

/** The glow of Void's eyes for a bot color: the color lifted toward white; a dark or dull one glows the classic cat's yellow green instead. */
export function voidGlow(hex: string): string {
  const glow = mix(hex, "#ffffff", 0.25);
  return relativeLuminance(glow) < 0.3 ? "#D8FF4A" : glow;
}

/** Tabby stripes: a pattern of bars of `stripe` over `base`, tilted. */
function stripes(id: string, base: string, stripe: string, angle: number): ReactNode {
  return (
    <pattern id={id} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform={`rotate(${angle})`}>
      <rect width="7" height="7" fill={base} />
      <rect width="2.6" height="7" fill={stripe} />
    </pattern>
  );
}

/**
 * How a skin paints Grump: its palette, the defs the palette needs and its
 * effect family. `uid` keeps every drawing's ids apart.
 */
export function grumpSkinPaint(skin: GrumpSkin | string, hex: string, uid: string): GrumpSkinPaint {
  const known = grumpSkinId(skin);
  const tier = GRUMP_SKIN_TIER[known];
  const url = (name: string) => `url(#${uid}-${name})`;
  const id = (name: string) => `${uid}-${name}`;
  const plain = (palette: GrumpPalette, fx: FxKind = "plain", defs: ReactNode = null): GrumpSkinPaint => ({ palette, defs, fx, tier });
  switch (known) {
    case "tuxedo": {
      // black all over, the white bib, muzzle, blaze and socks, green eyes
      const base = grumpPalette("#1f2026");
      return plain({ ...base, coat: "#1f2026", shade: "#111216", line: "#07070a", cream: "#272830", creamShade: "#17181d", muzzle: "#FFFFFF", muzzleShade: "#E2E0DC", blaze: "#FFFFFF", earIn: "#5a4a50", brow: "#4a4b57", lid: "#1f2026", iris: "#B7D24A", nose: "#E59AA3" });
    }
    case "calico": {
      // the mask split down the blaze, orange on the left and black on the right, over white fur
      const defs = (
        <linearGradient id={id("calico")} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0">
          <stop offset="0.5" stopColor="#E08A3A" />
          <stop offset="0.5" stopColor="#2B2522" />
        </linearGradient>
      );
      const base = grumpPalette("#E08A3A");
      return plain({ ...base, coat: url("calico"), shade: "#5a3a22", lid: url("calico"), line: "#22160e", cream: "#FFFBF4", creamShade: "#EFE3D3", blaze: "#FFFBF4", earIn: "#F2C9A6", brow: "#F2C9A6", iris: "#E7B43C" }, "plain", defs);
    }
    case "tabby": {
      const defs = (
        <>
          {stripes(id("tabby"), "#8E6B49", "#4A3322", 8)}
          {stripes(id("tabbyFur"), "#CFAE84", "#9A7652", -14)}
        </>
      );
      const base = grumpPalette("#8E6B49");
      return plain({ ...base, coat: url("tabby"), shade: "#4A3322", lid: "#8E6B49", line: "#2a1a10", cream: url("tabbyFur"), creamShade: "#A9875F", blaze: "#E9D4B4", earIn: "#E9C4A8", brow: "#E9D4B4", iris: "#9BC53D" }, "plain", defs);
    }
    case "siamese":
      // seal points on pale fur, deep blue eyes
      return plain({ ...grumpPalette("#3b2a22"), coat: "#3b2a22", shade: "#22170f", line: "#140c07", lid: "#3b2a22", cream: "#F8F1E4", creamShade: "#E7D8C0", blaze: "#F8F1E4", earIn: "#8a6f62", brow: "#8a6f62", iris: "#3C86DE" });
    case "void": {
      // all black, a rim of the glow for the outline, the eyes lit
      const glow = voidGlow(hex);
      const rim = mix(glow, "#121217", 0.62);
      return plain({ ...grumpPalette("#121217"), coat: "#121217", shade: "#060608", line: rim, cream: "#16161c", creamShade: "#0b0b0f", muzzle: "#1d1d25", muzzleShade: "#121218", blaze: "#16161c", earIn: "#2a2a34", brow: "#2a2a34", lid: "#121217", white: glow, iris: mix(glow, "#ffffff", 0.45), pupil: "#060608", ink: rim, spec: "#ffffff", mouth: "#060608", tongue: mix(glow, "#ff5fa2", 0.5), tongueLine: "#060608", fang: glow, nose: "#2a2a34" }, "neon");
    }
    case "retro98": {
      const coat = vgaColor(hex);
      const defs = (
        <>
          <pattern id={id("dither")} width="2" height="2" patternUnits="userSpaceOnUse">
            <rect width="2" height="2" fill={coat} />
            <rect width="1" height="1" fill="#000000" />
            <rect x="1" y="1" width="1" height="1" fill="#000000" />
          </pattern>
          <pattern id={id("ditherFur")} width="2" height="2" patternUnits="userSpaceOnUse">
            <rect width="2" height="2" fill="#ffffff" />
            <rect width="1" height="1" fill="#c0c0c0" />
            <rect x="1" y="1" width="1" height="1" fill="#c0c0c0" />
          </pattern>
        </>
      );
      return plain(
        { ...grumpPalette(coat), coat, lid: coat, shade: url("dither"), line: "#000000", cream: "#c0c0c0", creamShade: url("ditherFur"), muzzle: "#ffffff", muzzleShade: url("ditherFur"), blaze: "#ffffff", earIn: "#ffffff", brow: "#ffffff", iris: "#00ffff", pupil: "#000000", ink: "#000000", mouth: "#800000", tongue: "#ff00ff", tongueLine: "#800080", blush: "#ff00ff", sweat: "#00ffff", nose: "#ff00ff" },
        "retro",
        defs,
      );
    }
    case "gold": {
      // a lucky gold figurine: deep gold points, pale gold fur, emerald eyes
      const defs = (
        <linearGradient id={id("gold")} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#fff4c2" />
          <stop offset="0.22" stopColor="#f2c94c" />
          <stop offset="0.55" stopColor="#c8901e" />
          <stop offset="0.8" stopColor="#8a5a0c" />
          <stop offset="1" stopColor="#e9b949" />
        </linearGradient>
      );
      return plain({ ...grumpPalette("#c8901e"), coat: url("gold"), lid: "#c8901e", shade: "#8a5a0c", line: "#5a3a06", cream: "#F4DB8E", creamShade: "#D9B45A", muzzle: "#FFF6D6", muzzleShade: "#EBD7A0", blaze: "#FFF1C4", earIn: "#FFE9A8", brow: "#FFF1C4", iris: "#3FD08A", ink: "#3a2404", pupil: "#3a2404" }, "gold", defs);
    }
    case "neon": {
      const tube = tint(hex, 0.2);
      const glow = tint(hex, 0.45);
      return plain({ ...grumpPalette(hex), coat: "#07080c", lid: "#07080c", shade: "#030305", line: tube, cream: "#0d0f15", creamShade: "#08090d", muzzle: "#161a26", muzzleShade: "#10131c", blaze: glow, earIn: mix(hex, "#0d0f15", 0.6), brow: glow, ink: glow, iris: glow, pupil: "#0d0f15", white: "#eafcff", mouth: "#07080c", fang: "#eafcff", nose: glow, spec: "#ffffff" }, "neon");
    }
    case "chrome": {
      const horizon = mix(hex, "#4b5561", 0.7);
      const defs = (
        <linearGradient id={id("chrome")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fdfdfe" />
          <stop offset="0.3" stopColor="#c9d2db" />
          <stop offset="0.49" stopColor={horizon} />
          <stop offset="0.53" stopColor="#262d35" />
          <stop offset="0.76" stopColor="#8c98a6" />
          <stop offset="1" stopColor="#e6ebf0" />
        </linearGradient>
      );
      return plain({ ...grumpPalette("#4b5561"), coat: url("chrome"), lid: "#4b5561", shade: "#262d35", line: "#1f262d", cream: "#C9D2DB", creamShade: "#8C98A6", muzzle: "#EEF2F6", muzzleShade: "#C9D2DB", blaze: "#EEF2F6", earIn: "#DFE5EB", brow: "#EEF2F6", iris: "#FF5A4E", ink: "#10151b", pupil: "#10151b" }, "chrome", defs);
    }
    case "glitch":
      return {
        ...plain({ ...grumpPalette("#2a3348"), coat: "#2a3348", lid: "#2a3348", shade: "#11151f", line: "#0b0f1a", cream: "#3a4560", creamShade: "#252d40", muzzle: "#CDEEDD", muzzleShade: "#9FC9B4", blaze: "#22e6ff", earIn: "#ff2bd6", brow: "#22e6ff", iris: "#22e6ff", ink: "#0b0f1a", pupil: "#0b0f1a", mouth: "#0b0f1a", tongue: "#ff2bd6", nose: "#ff2bd6" }, "glitch"),
        bodyClass: "fx-glitch-slice",
      };
    case "holo": {
      const defs = (
        <>
          <linearGradient id={id("pearl")} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fbf8ff" />
            <stop offset="0.6" stopColor="#e3e9ff" />
            <stop offset="1" stopColor="#d9d2f5" />
          </linearGradient>
          <linearGradient id={id("iris")} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff8be6" />
            <stop offset="0.5" stopColor="#7df4ff" />
            <stop offset="1" stopColor="#b49bff" />
          </linearGradient>
        </>
      );
      return plain({ ...grumpPalette("#b49bff"), coat: url("pearl"), lid: "#e3e9ff", shade: "#c9bff0", line: "#6b5fa8", cream: "#FBF8FF", creamShade: "#E6E0FA", muzzle: "#FFFFFF", muzzleShade: "#ECE6FF", blaze: "#FFFFFF", earIn: "#FFD6F4", brow: "#FFFFFF", iris: url("iris"), ink: "#2a2140", pupil: "#2a2140" }, "holo", defs);
    }
    case "molten": {
      const defs = (
        <radialGradient id={id("rock")} cx="0.45" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#3d1d14" />
          <stop offset="1" stopColor="#170806" />
        </radialGradient>
      );
      return plain({ ...grumpPalette("#3d1d14"), coat: url("rock"), lid: "#2a120c", shade: "#170806", line: "#ff6a1a", cream: "#2a120c", creamShade: "#170806", muzzle: "#6B2F17", muzzleShade: "#4A1E0E", blaze: "#FF8A2A", earIn: "#FF8A2A", brow: "#FFD36B", ink: "#FFD36B", iris: "#FFD36B", pupil: "#170806", white: "#FFF3C4", mouth: "#170806", fang: "#FFF3C4", nose: "#170806" }, "molten", defs);
    }
    default:
      return plain(grumpPalette(hex));
  }
}

/**
 * A premium skin's layers on one of Grump's parts (`d`, the head or the
 * body): the Shapes treatment, Glitch's own, or Void's lit eyes (on the
 * head, under the face, so they follow it).
 */
export function grumpSkinLayers(skin: GrumpSkin, d: string, hex: string, uid: string, full: boolean, part: "head" | "body" = "head"): ShapeSkinLayers | null {
  switch (skin) {
    case "gold":
    case "neon":
    case "chrome":
    case "holo":
    case "molten": {
      const layers = shapeSkinLayers(skin as ShapeSkin, d, hex, uid, full);
      // the palette paints the parts; only the treatment comes from the shapes
      return { ...layers, fill: "none" };
    }
    case "void": {
      if (part !== "head") return null;
      const glow = voidGlow(hex);
      const { eye } = GRUMP_ART;
      const halo = (cx: number) => <ellipse key={cx} cx={cx} cy={eye.y} rx={eye.w + 4} ry={eye.h + 3.4} fill={glow} opacity={full ? 0.85 : 0.4} filter={full ? `url(#${uid}-haze)` : undefined} />;
      return {
        defs: full ? (
          <filter id={`${uid}-haze`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation={2.6} />
          </filter>
        ) : null,
        fill: "none",
        ownEdge: false,
        under: null,
        inner: <g className={full ? "fx-void-glow" : undefined}>{[50 - eye.dx, 50 + eye.dx].map(halo)}</g>,
        edge: null,
        around: null,
      };
    }
    case "glitch":
      return {
        defs: (
          <pattern id={`${uid}-scan`} width="4" height="3" patternUnits="userSpaceOnUse">
            <rect width="4" height="1" fill="#22e6ff" opacity="0.14" />
          </pattern>
        ),
        fill: "none",
        ownEdge: false,
        under: (
          <>
            <path className={full ? "fx-glitch-r" : undefined} d={d} fill="none" stroke="#ff2bd6" strokeWidth={4} opacity={0.65} strokeLinejoin="round" transform={full ? undefined : "translate(-1.6 0)"} />
            <path className={full ? "fx-glitch-b" : undefined} d={d} fill="none" stroke="#22e6ff" strokeWidth={4} opacity={0.65} strokeLinejoin="round" transform={full ? undefined : "translate(1.6 0)"} />
          </>
        ),
        inner: (
          <g className={full ? "fx-scan" : undefined}>
            <rect x={-10} y={-10} width={120} height={130} fill={`url(#${uid}-scan)`} />
          </g>
        ),
        edge: full ? <path className="fx-current" d={d} pathLength={100} fill="none" stroke="#22e6ff" strokeWidth={1.4} strokeLinecap="round" strokeDasharray="4 30" /> : null,
        around: null,
      };
    default:
      return null;
  }
}
