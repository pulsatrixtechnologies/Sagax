// How each Bunbu skin paints one of Bunbu's parts (BunbuMascot.tsx): the
// shared finishes come from the shapes' skins (shape-skins.tsx: Plain,
// Pastel, Night, Gold, Neon, Chrome, Crystal, Holographic, Galaxy, Molten,
// the holographic foil with the seamless back-and-forth shimmer of #94), and
// Bunbu adds two of its own: Plush (common: a fur texture and a fuzzy
// outline) and Velvet (rare: a deep crushed-velvet sheen with a soft rim
// light). Same contract as the shapes: `full` adds the filters and the
// moving parts; still keeps the look with no filter and nothing moving.
import type { BunbuSkin, ShapeSkin } from "../../../shared/mascot-look";
import { eyeInkOn } from "../../../shared/mascot-colors";
import { mix } from "./skin-fx";
import { Blur, shapeSkinBase, shapeSkinLayers, STAR4, Sweep, tint, type ShapeSkinBase, type ShapeSkinLayers } from "./shape-skins";

/** Fur strokes of the Plush skin: x, y, angle (deg). Fixed, so every drawing matches. */
const FUR: [number, number, number][] = [
  [30, 40, -30], [42, 34, -10], [58, 34, 10], [70, 40, 30], [24, 52, -40], [76, 52, 40],
  [22, 66, -20], [78, 66, 20], [26, 80, -10], [74, 80, 10], [36, 90, 0], [64, 90, 0],
  [33, 16, -15], [67, 16, 15], [31, 26, -8], [69, 26, 8], [44, 42, 0], [56, 42, 0],
];

/** Crushed velvet: soft light and dark pools. */
const VELVET_POOLS: [number, number, number, number, number][] = [
  [34, 44, 14, 9, -20], [66, 70, 16, 10, 25], [40, 80, 10, 6, 10], [70, 40, 9, 6, -30], [32, 14, 5, 10, -10], [68, 14, 5, 10, 10],
];

export function bunbuSkinBase(skin: BunbuSkin, hex: string): ShapeSkinBase {
  switch (skin) {
    case "plush":
      return { fill: hex, stroke: null, strokeWidth: 0, eyes: eyeInkOn(hex), glow: null, shine: false, fx: "plain" };
    case "velvet": {
      const deep = mix(hex, "#1a0b24", 0.55);
      return { fill: deep, stroke: mix(hex, "#ffffff", 0.35), strokeWidth: 1.2, eyes: "#fdf3ff", glow: null, shine: false, fx: "velvet" };
    }
    default:
      return shapeSkinBase(skin as ShapeSkin, hex);
  }
}

/**
 * The layers of a Bunbu skin on one part outline `d` (an ear, the body).
 * `uid` keeps every drawing's defs apart; `full` adds filters and motion.
 */
export function bunbuSkinLayers(skin: BunbuSkin, d: string, hex: string, uid: string, full: boolean): ShapeSkinLayers {
  const base = bunbuSkinBase(skin, hex);
  const none: ShapeSkinLayers = { defs: null, under: null, inner: null, edge: null, around: null, fill: base.fill, ownEdge: false };
  const id = (name: string) => `${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  switch (skin) {
    case "plush": {
      const dark = mix(hex, "#000000", 0.18);
      const light = tint(hex, 0.35);
      return {
        ...none,
        ownEdge: true,
        defs: (
          <radialGradient id={id("soft")} cx="0.4" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.22" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.1" />
          </radialGradient>
        ),
        inner: (
          <>
            <rect x={0} y={0} width={100} height={100} fill={url("soft")} />
            <g strokeWidth={1.1} strokeLinecap="round" fill="none">
              {FUR.map(([x, y, angle], i) => (
                <path key={`${x}-${y}`} d={`M${x} ${y}l0 -3.2`} stroke={i % 2 ? dark : light} opacity={0.55} transform={`rotate(${angle} ${x} ${y})`} />
              ))}
            </g>
          </>
        ),
        // a fuzzy outline: the fill's own color in short round tufts
        edge: <path d={d} fill="none" stroke={hex} strokeWidth={2.6} strokeLinecap="round" strokeDasharray="0.01 2.3" />,
      };
    }
    case "velvet": {
      const deep = mix(hex, "#1a0b24", 0.55);
      const sheen = mix(hex, "#ffffff", 0.35);
      return {
        ...none,
        ownEdge: true,
        fill: url("velvet"),
        defs: (
          <>
            <radialGradient id={id("velvet")} cx="0.42" cy="0.38" r="0.75">
              <stop offset="0" stopColor={mix(hex, "#1a0b24", 0.2)} />
              <stop offset="0.7" stopColor={deep} />
              <stop offset="1" stopColor={mix(hex, "#0b0410", 0.75)} />
            </radialGradient>
            {full && <Blur id={id("rim")} deviation={2.2} />}
          </>
        ),
        inner: (
          <>
            <g opacity={0.22}>
              {VELVET_POOLS.map(([x, y, rx, ry, angle], i) => (
                <ellipse key={`${x}-${y}`} cx={x} cy={y} rx={rx} ry={ry} fill={i % 2 ? "#000000" : sheen} transform={`rotate(${angle} ${x} ${y})`} />
              ))}
            </g>
            {/* the rim light velvet has where it turns away from you */}
            <path d={d} fill="none" stroke={sheen} strokeOpacity={0.55} strokeWidth={full ? 5 : 3} filter={full ? url("rim") : undefined} />
            {full && <Sweep id={id("sweep")} strength={0.32} className="fx-sweep fx-sweep-slow" />}
          </>
        ),
        edge: <path d={d} fill="none" stroke={sheen} strokeOpacity={0.7} strokeWidth={0.9} strokeLinejoin="round" />,
        around: full ? (
          <g fill={sheen}>
            {[[14, 30, 0.3], [88, 44, 1.5], [82, 88, 2.4]].map(([x, y, delay]) => (
              <path key={x} className="fx-twinkle" style={{ animationDelay: `${delay}s` }} d={STAR4} transform={`translate(${x} ${y}) scale(0.7)`} />
            ))}
          </g>
        ) : null,
      };
    }
    default:
      return shapeSkinLayers(skin as ShapeSkin, d, hex, uid, full);
  }
}
