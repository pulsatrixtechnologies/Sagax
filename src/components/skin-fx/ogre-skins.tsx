// How each Ogre skin paints the ogre (OgreMascot.tsx). Ogre is drawn flat
// (ogre-art.ts: a skin, a tunic, a vest, one shade tone per part, one
// outline), so a skin is first a palette: every paint role of the drawing
// gets a color or a gradient. The everyday skins are the bot's color (Plain:
// the green a quarter toward it, the vest in it) and the ogre's own hides
// (Swamp, deep and murky; Moss, bright with a moss vest; Stone, a grey
// granite ogre). Then the intense ones: Lava (rare: a basalt ogre whose
// cracks glow, embers in the eyes) and Armor (rare: plate steel for a vest,
// riveted), and the premium editions with the Trombi, Shapes and Shiba
// treatments per part (the head, the body): Retro 98 (rare), Gold (rare),
// Neon, Chrome and Glitch (epic), Holographic and Molten (legendary). Same
// contract as the shapes: `full` adds the filters and the moving parts;
// still keeps the look with no filter and nothing moving. Keyframes are in
// skin-fx.css.
import type { ReactNode } from "react";
import { OGRE_SKIN_TIER, OGRE_SKINS, type OgreSkin, type ShapeSkin, type SkinTier } from "../../../shared/mascot-look";
import { ogrePalette, type OgreMarks, type OgrePalette } from "../ogre-art";
import { mix, type FxKind } from "./skin-fx";
import { shapeSkinLayers, tint, type ShapeSkinLayers } from "./shape-skins";
import { vgaColor } from "./shiba-skins";

/** An Ogre skin id this build knows, else Plain. */
export function ogreSkinId(skin: string | null | undefined): OgreSkin {
  return (OGRE_SKINS as readonly string[]).includes(skin ?? "") ? (skin as OgreSkin) : "plain";
}

export interface OgreSkinPaint {
  /** Every paint role: a hex, or a url() into `defs`. */
  palette: OgrePalette;
  /** The gradients and patterns the palette points at (ids from `uid`). */
  defs: ReactNode;
  fx: FxKind;
  tier: SkinTier;
  /** The marks the drawing adds for this skin (Lava's cracks, Armor's rivets). */
  marks: OgreMarks | null;
}

/**
 * How a skin paints Ogre: its palette, the defs the palette needs, its effect
 * family and its marks. `uid` keeps every drawing's ids apart.
 */
export function ogreSkinPaint(skin: OgreSkin | string, hex: string, uid: string): OgreSkinPaint {
  const known = ogreSkinId(skin);
  const tier = OGRE_SKIN_TIER[known];
  const url = (name: string) => `url(#${uid}-${name})`;
  const id = (name: string) => `${uid}-${name}`;
  const paint = (palette: OgrePalette, fx: FxKind = "plain", defs: ReactNode = null, marks: OgreMarks | null = null): OgreSkinPaint => ({ palette, defs, fx, tier, marks });
  switch (known) {
    case "swamp":
      // deep bog green, a mud vest, a dirtier tunic
      return paint({ ...ogrePalette(null, { skin: "#6E8F3A", vest: "#5A3E22" }), tunic: "#E4D6B4", tunicShade: "#C9B48A", pants: "#3A2C1E" });
    case "moss":
      // bright spring green, a moss vest
      return paint({ ...ogrePalette(null, { skin: "#A9CC4E", vest: "#3E6B2E" }), tunic: "#F4EBD2" });
    case "stone": {
      // a granite ogre: grey skin, a slate vest, darker stone brows
      const base = ogrePalette(null, { skin: "#9A9C98", vest: "#3F4752" });
      return paint({ ...base, skinShade: "#767873", line: "#2E302D", brow: "#5D5F5B", earIn: "#5D5F5B", mark: "#6A6C68", tunic: "#E8E4DA", tunicShade: "#CFC9BB" });
    }
    case "lava": {
      // basalt skin, the cracks glowing through, embers for eyes
      const defs = (
        <linearGradient id={id("crack")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE38A" />
          <stop offset="0.5" stopColor="#FF8A1F" />
          <stop offset="1" stopColor="#E0401A" />
        </linearGradient>
      );
      const base = ogrePalette(null, { skin: "#3B3431", vest: "#24201E" });
      return paint(
        { ...base, skinShade: "#262120", line: "#140F0D", brow: "#1A1513", earIn: "#FF7A1A", lid: "#3B3431", white: "#FFE7A3", pupil: "#B4260E", spec: "#FFF6D8", mark: url("crack"), tunic: "#5A4A40", tunicShade: "#3E322B", vestShade: "#140F0D", pants: "#1E1916", boot: "#0E0B0A", buckle: "#FF8A1F", mouth: "#2A0E08", tongue: "#FF6A2A", teeth: "#FFE7A3", nostril: "#FF6A1A" },
        "molten",
        defs,
        "cracks",
      );
    }
    case "armor": {
      // plate steel for a vest, riveted, a steel belt buckle
      const defs = (
        <linearGradient id={id("plate")} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#E6EBF0" />
          <stop offset="0.35" stopColor="#A9B4BF" />
          <stop offset="0.52" stopColor="#5E6975" />
          <stop offset="0.7" stopColor="#97A3AF" />
          <stop offset="1" stopColor="#C9D2DB" />
        </linearGradient>
      );
      const base = ogrePalette(hex);
      return paint({ ...base, vest: url("plate"), vestShade: "#4B5561", tunic: mix(hex, "#F1E6CB", 0.82), buckle: "#C9D2DB", pants: "#3A3F46", boot: "#22262B" }, "chrome", defs, "rivets");
    }
    case "retro98": {
      // the classic sixteen colors: a VGA green ogre, the vest the nearest of the sixteen, a dithered shade
      const vest = vgaColor(hex);
      const defs = (
        <>
          <pattern id={id("dither")} width="2" height="2" patternUnits="userSpaceOnUse">
            <rect width="2" height="2" fill="#808000" />
            <rect width="1" height="1" fill="#008000" />
            <rect x="1" y="1" width="1" height="1" fill="#008000" />
          </pattern>
          <pattern id={id("ditherVest")} width="2" height="2" patternUnits="userSpaceOnUse">
            <rect width="2" height="2" fill={vest} />
            <rect width="1" height="1" fill="#000000" />
            <rect x="1" y="1" width="1" height="1" fill="#000000" />
          </pattern>
        </>
      );
      return paint(
        { ...ogrePalette(hex, { skin: "#00ff00", vest }), skin: "#00c000", lid: "#00c000", skinShade: url("dither"), brow: "#008000", earIn: "#008000", line: "#000000", vestShade: url("ditherVest"), tunic: "#ffffff", tunicShade: "#c0c0c0", ink: "#000000", pupil: "#000000", nostril: "#000000", mouth: "#800000", tongue: "#ff00ff", teeth: "#ffffff", blush: "#ff00ff", sweat: "#00ffff", buckle: "#ffff00", pants: "#808080", boot: "#000000", mark: "#008000" },
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
      // a solid gold ogre in a royal vest
      return paint({ ...ogrePalette(hex, { skin: "#d9a333" }), skin: url("gold"), lid: "#d9a333", skinShade: "#8a5a0c", line: "#5a3a06", brow: "#8a5a0c", earIn: "#8a5a0c", vest: "#6B1E2A", vestShade: "#4A1219", tunic: "#FFF1C4", tunicShade: "#E9CF8A", ink: "#3a2404", pupil: "#3a2404", buckle: "#FFF1C4", mark: "#8a5a0c" }, "gold", defs);
    }
    case "neon": {
      const tube = tint(hex, 0.2);
      const glow = tint(hex, 0.45);
      return paint({ ...ogrePalette(hex), skin: "#0d0f15", lid: "#0d0f15", skinShade: "#07080c", line: tube, brow: glow, earIn: mix(hex, "#0d0f15", 0.6), vest: "#161a26", vestShade: "#10131c", tunic: "#1c2130", tunicShade: "#141824", ink: glow, pupil: "#0d0f15", white: "#eafcff", mouth: "#07080c", nostril: glow, teeth: "#eafcff", spec: "#ffffff", pants: "#10131c", boot: "#07080c", buckle: glow, mark: glow }, "neon");
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
      return paint({ ...ogrePalette(hex), skin: url("chrome"), lid: "#8c98a6", skinShade: "#4b5561", line: "#1f262d", brow: "#4b5561", earIn: "#4b5561", vest: "#262d35", vestShade: "#161b21", tunic: "#EEF2F6", tunicShade: "#C9D2DB", ink: "#10151b", pupil: "#10151b", buckle: "#EEF2F6", mark: "#4b5561" }, "chrome", defs);
    }
    case "glitch": {
      return paint({ ...ogrePalette(hex), skin: "#2a3348", lid: "#2a3348", skinShade: "#11151f", line: "#0b0f1a", brow: "#22e6ff", earIn: "#ff2bd6", vest: "#11151f", vestShade: "#0b0f1a", tunic: "#CDEEDD", tunicShade: "#9FC9B4", ink: "#0b0f1a", pupil: "#0b0f1a", mouth: "#0b0f1a", tongue: "#ff2bd6", nostril: "#22e6ff", buckle: "#22e6ff", mark: "#22e6ff" }, "glitch");
    }
    case "holo": {
      const defs = (
        <linearGradient id={id("pearl")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbf8ff" />
          <stop offset="0.6" stopColor="#e3e9ff" />
          <stop offset="1" stopColor="#d9d2f5" />
        </linearGradient>
      );
      return paint({ ...ogrePalette(hex), skin: url("pearl"), lid: "#e3e9ff", skinShade: "#c9bff0", line: "#6b5fa8", brow: "#b4a8e8", earIn: "#FFD6F4", vest: "#8E7FD6", vestShade: "#6b5fa8", tunic: "#FFFFFF", tunicShade: "#ECE6FF", ink: "#2a2140", pupil: "#2a2140", buckle: "#FFD6F4", mark: "#b4a8e8" }, "holo", defs);
    }
    case "molten": {
      const defs = (
        <radialGradient id={id("rock")} cx="0.45" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#3d1d14" />
          <stop offset="1" stopColor="#170806" />
        </radialGradient>
      );
      return paint(
        { ...ogrePalette(hex), skin: url("rock"), lid: "#2a120c", skinShade: "#170806", line: "#ff6a1a", brow: "#FFD36B", earIn: "#FF8A2A", vest: "#2a120c", vestShade: "#170806", tunic: "#6B2F17", tunicShade: "#4A1E0E", ink: "#FFD36B", pupil: "#170806", white: "#FFF3C4", mouth: "#170806", nostril: "#FF8A2A", pants: "#170806", boot: "#0c0403", buckle: "#FFD36B", mark: "#FF8A2A" },
        "molten",
        defs,
      );
    }
    default:
      return paint(ogrePalette(hex));
  }
}

/** A premium skin's layers on one of Ogre's parts (`d`, the head or the body): the Shapes treatment, or Glitch's own. */
export function ogreSkinLayers(skin: OgreSkin, d: string, hex: string, uid: string, full: boolean, part: "head" | "body" = "body"): ShapeSkinLayers | null {
  if (skin === "lava") {
    // no molten glow around a basalt ogre: only its embers and the heat over the head; the cracks glow from the drawing
    const layers = shapeSkinLayers("molten", d, hex, uid, full);
    return { ...layers, fill: "none", inner: null, under: null, edge: null, around: part === "head" ? layers.around : null, ownEdge: false };
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
    case "armor":
      // the chrome sweep over the plates (the vest); the head stays bare skin
      return part === "body" ? { ...shapeSkinLayers("chrome", d, hex, uid, full), fill: "none", under: null, around: null, ownEdge: false } : null;
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

/** The color a skin shows where a single color stands for it (a swatch, the gallery). */
export function ogreSkinSwatch(skin: OgreSkin, hex: string): string {
  switch (skin) {
    case "swamp":
      return "#6E8F3A";
    case "moss":
      return "#A9CC4E";
    case "stone":
      return "#9A9C98";
    case "lava":
      return "#FF7A1A";
    case "armor":
      return "#A9B4BF";
    case "retro98":
      return "#00c000";
    case "gold":
      return "#e2ae34";
    case "neon":
      return "#0d0f15";
    case "chrome":
      return "#8c98a6";
    case "glitch":
      return "#2a3348";
    case "holo":
      return "#ece9fb";
    case "molten":
      return "#2a120c";
    default:
      return ogrePalette(hex).skin;
  }
}
