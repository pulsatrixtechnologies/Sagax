// How each Shiba skin paints the dog (ShibaMascot.tsx). Shiba is drawn flat
// (shiba-art.ts: a coat, a cream mask, one shade tone, one outline), so a
// skin is first a palette: every paint role of the drawing gets a color or a
// gradient. The everyday skins are the bot's color (Plain) and the breed's
// own coats (Cream, Black and tan with its tan brow points, Red, Sesame with
// its dark saddle, White). The premium editions add the treatment the Shapes
// and Trombi skins get, per part (the head, the body): Retro 98 (rare: the
// classic sixteen-color look, a black outline and a dithered shade), Gold
// (rare), Neon, Chrome and Glitch (epic), Holographic and Molten (legendary),
// with their gradients, edges, auras and particles. Same contract as the
// shapes: `full` adds the filters and the moving parts; still keeps the look
// with no filter and nothing moving. Keyframes are in skin-fx.css.
import type { ReactNode } from "react";
import { SHIBA_SKIN_TIER, SHIBA_SKINS, type ShapeSkin, type ShibaSkin, type SkinTier } from "../../../shared/mascot-look";
import { shibaPalette, type ShibaPalette } from "../shiba-art";
import { mix, type FxKind } from "./skin-fx";
import { shapeSkinLayers, tint, type ShapeSkinLayers } from "./shape-skins";

/** A Shiba skin id this build knows, else Plain. */
export function shibaSkinId(skin: string | null | undefined): ShibaSkin {
  return (SHIBA_SKINS as readonly string[]).includes(skin ?? "") ? (skin as ShibaSkin) : "plain";
}

export interface ShibaSkinPaint {
  /** Every paint role: a hex, or a url() into `defs`. */
  palette: ShibaPalette;
  /** The gradients and patterns the palette points at (ids from `uid`). */
  defs: ReactNode;
  fx: FxKind;
  tier: SkinTier;
  /** A whole-drawing class (the glitch's slice jitter). */
  bodyClass?: string;
}

/**
 * The coat of Retro 98: the bot's color on a 98-era display's 64-color grid
 * (four levels a channel), never pure black or white (the face would go).
 */
export function vgaColor(hex: string): string {
  const level = (v: number) => Math.min(3, Math.round(v / 85)) * 85;
  const [r, g, b] = [1, 3, 5].map((i) => level(Number.parseInt(hex.slice(i, i + 2), 16)));
  const out = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  return out === "#000000" ? "#555555" : out === "#ffffff" ? "#aaaaaa" : out;
}

/**
 * How a skin paints Shiba: its palette, the defs the palette needs and its
 * effect family. `uid` keeps every drawing's ids apart.
 */
export function shibaSkinPaint(skin: ShibaSkin | string, hex: string, uid: string): ShibaSkinPaint {
  const known = shibaSkinId(skin);
  const tier = SHIBA_SKIN_TIER[known];
  const url = (name: string) => `url(#${uid}-${name})`;
  const id = (name: string) => `${uid}-${name}`;
  const plain = (palette: ShibaPalette, fx: FxKind = "plain", defs: ReactNode = null): ShibaSkinPaint => ({ palette, defs, fx, tier });
  switch (known) {
    case "cream":
      return plain({ ...shibaPalette("#E2BC86"), cream: "#FFF9EF", brow: "#FFF9EF", earIn: "#FFF9EF" });
    case "blacktan": {
      const base = shibaPalette("#2B2420");
      // the breed's tan points: above the eyes, inside the ears, under the tail
      return plain({ ...base, shade: "#171210", line: "#0d0907", cream: "#F7E9D6", creamShade: "#E3CDB0", brow: "#D98B47", earIn: "#E9B98A" });
    }
    case "red":
      return plain(shibaPalette("#D2692A"));
    case "sesame": {
      const base = shibaPalette("#C97A3C");
      // a dark saddle on the back and the top of the head, fading into red
      const defs = (
        <linearGradient id={id("sesame")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a2c1a" />
          <stop offset="0.42" stopColor="#8a5530" />
          <stop offset="0.7" stopColor="#C97A3C" />
        </linearGradient>
      );
      return plain({ ...base, coat: url("sesame"), shade: "#6e4224", lid: "#7a4a2a", line: "#2a160b" }, "plain", defs);
    }
    case "white":
      return plain({ ...shibaPalette("#F4EEE4"), coat: "#F4EEE4", lid: "#EDE4D6", shade: "#DCCFBE", line: "#7d6a58", cream: "#FFFFFF", creamShade: "#EEE6DA", brow: "#FFFFFF", earIn: "#FBE9E2" });
    case "retro98": {
      const coat = vgaColor(hex);
      const defs = (
        <>
          <pattern id={id("dither")} width="2" height="2" patternUnits="userSpaceOnUse">
            <rect width="2" height="2" fill={coat} />
            <rect width="1" height="1" fill="#000000" />
            <rect x="1" y="1" width="1" height="1" fill="#000000" />
          </pattern>
          <pattern id={id("ditherCream")} width="2" height="2" patternUnits="userSpaceOnUse">
            <rect width="2" height="2" fill="#ffffff" />
            <rect width="1" height="1" fill="#c0c0c0" />
            <rect x="1" y="1" width="1" height="1" fill="#c0c0c0" />
          </pattern>
        </>
      );
      return plain(
        { ...shibaPalette(coat), coat, lid: coat, shade: url("dither"), line: "#000000", cream: "#ffffff", creamShade: url("ditherCream"), brow: "#ffffff", earIn: "#ffffff", ink: "#000000", pupil: "#000000", mouth: "#800000", tongue: "#ff00ff", tongueLine: "#800080", blush: "#ff00ff", sweat: "#00ffff", nose: "#000000" },
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
      return plain({ ...shibaPalette("#c8901e"), coat: url("gold"), lid: "#d9a333", shade: "#8a5a0c", line: "#5a3a06", cream: "#FFF1C4", creamShade: "#E9CF8A", brow: "#FFF1C4", earIn: "#FFE9A8", ink: "#3a2404", pupil: "#3a2404" }, "gold", defs);
    }
    case "neon": {
      const tube = tint(hex, 0.2);
      const glow = tint(hex, 0.45);
      return plain({ ...shibaPalette(hex), coat: "#0d0f15", lid: "#0d0f15", shade: "#07080c", line: tube, cream: mix(hex, "#0d0f15", 0.8), creamShade: mix(hex, "#0d0f15", 0.88), brow: glow, earIn: mix(hex, "#0d0f15", 0.6), ink: glow, pupil: "#0d0f15", white: "#eafcff", mouth: "#07080c", nose: glow, spec: "#ffffff" }, "neon");
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
      return plain({ ...shibaPalette("#8c98a6"), coat: url("chrome"), lid: "#8c98a6", shade: "#4b5561", line: "#1f262d", cream: "#EEF2F6", creamShade: "#C9D2DB", brow: "#EEF2F6", earIn: "#DFE5EB", ink: "#10151b", pupil: "#10151b" }, "chrome", defs);
    }
    case "glitch":
      return { ...plain({ ...shibaPalette("#2a3348"), coat: "#2a3348", lid: "#2a3348", shade: "#11151f", line: "#0b0f1a", cream: "#CDEEDD", creamShade: "#9FC9B4", brow: "#22e6ff", earIn: "#ff2bd6", ink: "#0b0f1a", pupil: "#0b0f1a", mouth: "#0b0f1a", tongue: "#ff2bd6", nose: "#0b0f1a" }, "glitch"), bodyClass: "fx-glitch-slice" };
    case "holo": {
      const defs = (
        <linearGradient id={id("pearl")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbf8ff" />
          <stop offset="0.6" stopColor="#e3e9ff" />
          <stop offset="1" stopColor="#d9d2f5" />
        </linearGradient>
      );
      return plain({ ...shibaPalette("#d9d2f5"), coat: url("pearl"), lid: "#e3e9ff", shade: "#c9bff0", line: "#6b5fa8", cream: "#FFFFFF", creamShade: "#ECE6FF", brow: "#FFFFFF", earIn: "#FFD6F4", ink: "#2a2140", pupil: "#2a2140" }, "holo", defs);
    }
    case "molten": {
      const defs = (
        <radialGradient id={id("rock")} cx="0.45" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#3d1d14" />
          <stop offset="1" stopColor="#170806" />
        </radialGradient>
      );
      return plain({ ...shibaPalette("#3d1d14"), coat: url("rock"), lid: "#2a120c", shade: "#170806", line: "#ff6a1a", cream: "#6B2F17", creamShade: "#4A1E0E", brow: "#FFD36B", earIn: "#FF8A2A", ink: "#FFD36B", pupil: "#170806", white: "#FFF3C4", mouth: "#170806", nose: "#170806" }, "molten", defs);
    }
    default:
      return plain(shibaPalette(hex));
  }
}

/**
 * A premium skin's layers on one of Shiba's parts (`d`, the head or the
 * body): the Shapes treatment, or Glitch's own. Molten's cracks stay on the
 * body: across the face they hid it.
 */
export function shibaSkinLayers(skin: ShibaSkin, d: string, hex: string, uid: string, full: boolean, part: "head" | "body" = "body"): ShapeSkinLayers | null {
  if (skin === "molten" && part === "head") {
    const layers = shapeSkinLayers("molten", d, hex, uid, full);
    return { ...layers, fill: "none", inner: <rect x={0} y={0} width={100} height={100} fill={`url(#${uid}-heat)`} /> };
  }
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
