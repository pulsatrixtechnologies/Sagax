// How each Frog skin paints the frog (FrogMascot.tsx). Frog is drawn flat
// (frog-art.ts: a skin, a pale belly, one shade tone, one outline), so a skin
// is first a palette: every paint role of the drawing gets a color or a
// gradient. The everyday skins are the bot's color (Plain) and real frogs,
// loud ones: Leaf (a vivid tree green), Tree (the red-eyed tree frog: lime
// skin, red eyes, orange toes), Poison (the blue poison dart frog, black
// spots), Bullfrog (brown and mottled, a yellow throat) and Ghost (the glass
// frog, pale and see-through). The premium editions add the treatment the
// Shapes, Trombi and Shiba skins get, per part (the head, the body): Retro 98
// (rare: sixteen colors, a black outline, a dithered shade), Gold (rare),
// Neon, Chrome and Glitch (epic), Holographic and Molten (legendary). Same
// contract as the shapes: `full` adds the filters and the moving parts; still
// keeps the look with no filter and nothing moving. Keyframes in skin-fx.css.
import type { ReactNode } from "react";
import { FROG_SKIN_TIER, FROG_SKINS, type FrogSkin, type ShapeSkin, type SkinTier } from "../../../shared/mascot-look";
import { frogPalette, frogPaletteFor, frogSkin, type FrogPalette } from "../frog-art";
import { mix, type FxKind } from "./skin-fx";
import { shapeSkinLayers, tint, type ShapeSkinLayers } from "./shape-skins";
import { vgaColor } from "./shiba-skins";

/** A Frog skin id this build knows, else Plain. */
export function frogSkinId(skin: string | null | undefined): FrogSkin {
  return (FROG_SKINS as readonly string[]).includes(skin ?? "") ? (skin as FrogSkin) : "plain";
}

export interface FrogSkinPaint {
  /** Every paint role: a hex, or a url() into `defs`. */
  palette: FrogPalette;
  /** The gradients and patterns the palette points at (ids from `uid`). */
  defs: ReactNode;
  fx: FxKind;
  tier: SkinTier;
  /** A whole-drawing class (the glitch's slice jitter). */
  bodyClass?: string;
}

/** Spots on a skin color, as a tile (the poison frog's, the bullfrog's mottling). */
function Spots({ id, base, spot, size, dots, opacity = 1 }: { id: string; base: string; spot: string; size: number; dots: readonly (readonly [number, number, number])[]; opacity?: number }) {
  return (
    <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse">
      <rect width={size} height={size} fill={base} />
      {dots.map(([x, y, r], i) => (
        <ellipse key={i} cx={x} cy={y} rx={r} ry={r * 0.82} fill={spot} opacity={opacity} />
      ))}
    </pattern>
  );
}

/**
 * How a skin paints Frog: its palette, the defs the palette needs and its
 * effect family. `uid` keeps every drawing's ids apart.
 */
export function frogSkinPaint(skin: FrogSkin | string, hex: string, uid: string): FrogSkinPaint {
  const known = frogSkinId(skin);
  const tier = FROG_SKIN_TIER[known];
  const url = (name: string) => `url(#${uid}-${name})`;
  const id = (name: string) => `${uid}-${name}`;
  const plain = (palette: FrogPalette, fx: FxKind = "plain", defs: ReactNode = null): FrogSkinPaint => ({ palette, defs, fx, tier });
  switch (known) {
    case "leaf":
      // the brightest tree green, whatever the bot's color
      return plain({ ...frogPaletteFor("#3FB43A"), belly: "#EEF7C2", lip: "#B4472F", lipShade: "#7E2F1E" });
    case "tree": {
      // the red-eyed tree frog: lime, a cream belly, red eyes, orange toes, a blue flank
      const base = frogPaletteFor("#35C23A");
      return plain({ ...base, shade: "#1F8E2A", line: "#0B3A12", belly: "#FFF6D6", bellyShade: "#2F6FC4", white: "#E5231B", spec: "#FFD3CC", toe: "#FF8A1F", toeShade: "#D9580F", lip: "#2A9A35", lipShade: "#1B7A27", lipLine: "#0B3A12", throat: "#FFF6D6" });
    }
    case "poison": {
      // the blue poison dart frog: cobalt, black spots everywhere, a deep blue belly
      const defs = (
        <>
          <Spots id={id("spots")} base="#2E6FE0" spot="#0A0F1E" size={16} dots={[[3, 4, 2.4], [11, 3, 1.5], [8, 10, 2.8], [14.5, 13, 1.7], [2.5, 13.5, 1.3]]} />
          <Spots id={id("spotsDark")} base="#1A4AB0" spot="#0A0F1E" size={16} dots={[[3, 4, 2.4], [11, 3, 1.5], [8, 10, 2.8], [14.5, 13, 1.7], [2.5, 13.5, 1.3]]} />
        </>
      );
      return plain(
        { ...frogPaletteFor("#2E6FE0"), skin: url("spots"), lid: "#2E6FE0", shade: url("spotsDark"), line: "#07102A", belly: "#5E95F2", bellyShade: "#3C6FD0", toe: "#1A4AB0", toeShade: "#0F327E", lip: "#13328A", lipShade: "#0B2160", lipLine: "#07102A", throat: "#5E95F2", throatShade: "#3C6FD0" },
        "plain",
        defs,
      );
    }
    case "bullfrog": {
      // brown and mottled, the big yellow throat
      const defs = (
        <>
          <Spots id={id("mottle")} base="#8A6A36" spot="#5B4220" size={18} dots={[[4, 5, 3], [13, 4, 2.2], [9, 12, 3.4], [16, 15, 2]]} opacity={0.75} />
          <Spots id={id("mottleDark")} base="#644B24" spot="#433016" size={18} dots={[[4, 5, 3], [13, 4, 2.2], [9, 12, 3.4], [16, 15, 2]]} opacity={0.75} />
        </>
      );
      return plain(
        { ...frogPaletteFor("#8A6A36"), skin: url("mottle"), lid: "#8A6A36", shade: url("mottleDark"), line: "#2C1E0C", belly: "#F3DD86", bellyShade: "#D9BC5E", toe: "#8A6A36", toeShade: "#644B24", lip: "#6E3420", lipShade: "#4C2214", throat: "#F7D45C", throatShade: "#DDB43C", white: "#F6E7B0" },
        "plain",
        defs,
      );
    }
    case "ghost": {
      // the glass frog: pale mint, half see-through, with the heart showing as a faint blush
      const defs = (
        <>
          <linearGradient id={id("glass")} x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0" stopColor="#F2FFF8" stopOpacity={0.92} />
            <stop offset="0.55" stopColor="#CFF3E2" stopOpacity={0.72} />
            <stop offset="1" stopColor="#A9E6CF" stopOpacity={0.6} />
          </linearGradient>
          <linearGradient id={id("glassShade")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#9BDDC4" stopOpacity={0.75} />
            <stop offset="1" stopColor="#7CCBB0" stopOpacity={0.6} />
          </linearGradient>
        </>
      );
      return plain(
        { ...frogPaletteFor("#BFEFDC"), skin: url("glass"), shade: url("glassShade"), lid: "#D9F7EA", line: "#4F9C86", belly: "#F7FFFB", bellyShade: "#F4C9D2", toe: "#D9F7EA", toeShade: "#A9E6CF", lip: "#E79AA6", lipShade: "#C77B88", lipLine: "#7A3B48", throat: "#F7FFFB", throatShade: "#D9F7EA", ink: "#24453C", pupil: "#24453C" },
        "plain",
        defs,
      );
    }
    case "retro98": {
      const skin = vgaColor(frogSkin(hex));
      const defs = (
        <>
          <pattern id={id("dither")} width="2" height="2" patternUnits="userSpaceOnUse">
            <rect width="2" height="2" fill={skin} />
            <rect width="1" height="1" fill="#000000" />
            <rect x="1" y="1" width="1" height="1" fill="#000000" />
          </pattern>
          <pattern id={id("ditherBelly")} width="2" height="2" patternUnits="userSpaceOnUse">
            <rect width="2" height="2" fill="#ffffff" />
            <rect width="1" height="1" fill="#c0c0c0" />
            <rect x="1" y="1" width="1" height="1" fill="#c0c0c0" />
          </pattern>
        </>
      );
      return plain(
        { ...frogPaletteFor(skin), skin, lid: skin, toe: skin, toeShade: url("dither"), shade: url("dither"), line: "#000000", lidLine: "#000000", belly: "#ffffff", bellyShade: url("ditherBelly"), ink: "#000000", pupil: "#000000", lip: "#800000", lipShade: "#800000", lipLine: "#000000", mouth: "#000000", tongue: "#ff00ff", blush: "#ff00ff", sweat: "#00ffff", throat: "#ffffff", throatShade: "#c0c0c0" },
        "retro",
        defs,
      );
    }
    case "gold": {
      const defs = (
        <linearGradient id={id("gold")} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#fff4c2" />
          <stop offset="0.22" stopColor="#f2c94c" />
          <stop offset="0.55" stopColor="#c8901e" />
          <stop offset="0.8" stopColor="#8a5a0c" />
          <stop offset="1" stopColor="#e9b949" />
        </linearGradient>
      );
      return plain(
        { ...frogPaletteFor("#c8901e"), skin: url("gold"), lid: "#d9a333", shade: "#8a5a0c", line: "#5a3a06", lidLine: "#3a2404", belly: "#FFF1C4", bellyShade: "#E9CF8A", toe: "#e9b949", toeShade: "#8a5a0c", ink: "#3a2404", pupil: "#3a2404", lip: "#9a3b1a", lipShade: "#6e2610", lipLine: "#3a1606", throat: "#FFF1C4", throatShade: "#E9CF8A" },
        "gold",
        defs,
      );
    }
    case "neon": {
      const tube = tint(hex, 0.2);
      const glow = tint(hex, 0.45);
      return plain(
        { ...frogPalette(hex), skin: "#0d0f15", lid: "#0d0f15", shade: "#07080c", line: tube, lidLine: glow, belly: "#161a26", bellyShade: "#10131c", toe: "#0d0f15", toeShade: "#07080c", ink: glow, pupil: "#0d0f15", white: "#eafcff", lip: "#1a0b12", lipShade: "#10060b", lipLine: "#ff4fa8", mouth: "#07080c", spec: "#ffffff", throat: "#161a26", throatShade: "#10131c" },
        "neon",
      );
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
      return plain(
        { ...frogPaletteFor("#8c98a6"), skin: url("chrome"), lid: "#8c98a6", shade: "#4b5561", line: "#1f262d", lidLine: "#10151b", belly: "#EEF2F6", bellyShade: "#C9D2DB", toe: "#c9d2db", toeShade: "#4b5561", ink: "#10151b", pupil: "#10151b", lip: "#5b6673", lipShade: "#3a434e", lipLine: "#10151b", throat: "#EEF2F6", throatShade: "#C9D2DB" },
        "chrome",
        defs,
      );
    }
    case "glitch":
      return {
        ...plain(
          { ...frogPaletteFor("#2a3348"), skin: "#2a3348", lid: "#2a3348", shade: "#11151f", line: "#0b0f1a", lidLine: "#22e6ff", belly: "#CDEEDD", bellyShade: "#9FC9B4", toe: "#22e6ff", toeShade: "#1495a8", ink: "#0b0f1a", pupil: "#0b0f1a", lip: "#ff2bd6", lipShade: "#b0189a", lipLine: "#0b0f1a", mouth: "#0b0f1a", tongue: "#22e6ff", throat: "#CDEEDD", throatShade: "#9FC9B4" },
          "glitch",
        ),
        bodyClass: "fx-glitch-slice",
      };
    case "holo": {
      const defs = (
        <linearGradient id={id("pearl")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbf8ff" />
          <stop offset="0.6" stopColor="#e3e9ff" />
          <stop offset="1" stopColor="#d9d2f5" />
        </linearGradient>
      );
      return plain(
        { ...frogPaletteFor("#d9d2f5"), skin: url("pearl"), lid: "#e3e9ff", shade: "#c9bff0", line: "#6b5fa8", lidLine: "#2a2140", belly: "#FFFFFF", bellyShade: "#ECE6FF", toe: "#FFD6F4", toeShade: "#c9bff0", ink: "#2a2140", pupil: "#2a2140", lip: "#ff9ad5", lipShade: "#d77ab8", lipLine: "#6b5fa8", throat: "#FFFFFF", throatShade: "#ECE6FF" },
        "holo",
        defs,
      );
    }
    case "molten": {
      const defs = (
        <radialGradient id={id("rock")} cx="0.45" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#3d1d14" />
          <stop offset="1" stopColor="#170806" />
        </radialGradient>
      );
      return plain(
        { ...frogPaletteFor("#3d1d14"), skin: url("rock"), lid: "#2a120c", shade: "#170806", line: "#ff6a1a", lidLine: "#ff6a1a", belly: "#6B2F17", bellyShade: "#4A1E0E", toe: "#FF8A2A", toeShade: "#c2410c", ink: "#FFD36B", pupil: "#170806", white: "#FFF3C4", lip: "#ff6a1a", lipShade: "#c2410c", lipLine: "#FFD36B", mouth: "#170806", throat: "#FF8A2A", throatShade: "#c2410c" },
        "molten",
        defs,
      );
    }
    default:
      return plain(frogPalette(hex));
  }
}

/** A premium skin's layers on one of Frog's parts (`d`, the head or the body): the Shapes treatment, or Glitch's own. */
export function frogSkinLayers(skin: FrogSkin, d: string, hex: string, uid: string, full: boolean): ShapeSkinLayers | null {
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
