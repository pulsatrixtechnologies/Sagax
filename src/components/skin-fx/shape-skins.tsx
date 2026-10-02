// How each shape skin paints a shape (ShapeMascot.tsx): a base finish every
// size draws, and for the premium skins the layers that make them premium:
// light, texture and an idle effect clipped to the body, an edge, an aura
// behind it and a few particles around it. Everything sits in the shape's
// 0..100 box and works on any of the thirteen outlines. `full` adds the
// filters and the animated layers; still (small avatars, thumbnails, reduced
// motion) keeps the skin's look with no filter and nothing moving.
//
// The keyframes are in skin-fx.css and run only under .skin-fx-live.
import type { ReactNode } from "react";
import type { ShapeSkin } from "../../../shared/mascot-look";
import { EYE_INK, eyeInkOn } from "../../../shared/mascot-colors";
import { mix, type FxKind } from "./skin-fx";

export interface ShapeSkinBase {
  /** The body's base fill (a hex; premium skins paint over it). */
  fill: string;
  stroke: string | null;
  strokeWidth: number;
  /** The eyes' color: dark on a light skin, light on a dark one. Their shape never changes. */
  eyes: string;
  /** The older soft glow (kept for the still neon). */
  glow: string | null;
  shine: boolean;
  /** The family of its move and equip effects. */
  fx: FxKind;
}

/** Mixes a hex color toward white (amount 0..1). */
export const tint = (hex: string, amount: number) => mix(hex, "#ffffff", amount);

export function shapeSkinBase(skin: ShapeSkin, hex: string): ShapeSkinBase {
  switch (skin) {
    case "glossy":
      return { fill: hex, stroke: null, strokeWidth: 0, eyes: eyeInkOn(hex), glow: null, shine: true, fx: "plain" };
    case "pastel":
      return { fill: tint(hex, 0.55), stroke: null, strokeWidth: 0, eyes: eyeInkOn(tint(hex, 0.55)) === EYE_INK.dark ? "#3a3f4b" : EYE_INK.light, glow: null, shine: false, fx: "plain" };
    case "night":
      return { fill: "#1c2236", stroke: hex, strokeWidth: 2.5, eyes: "#f6f1e8", glow: null, shine: false, fx: "plain" };
    case "outline":
      return { fill: tint(hex, 0.93), stroke: "#1b1f27", strokeWidth: 4.4, eyes: "#1b1f27", glow: null, shine: false, fx: "ink" };
    case "gold":
      return { fill: "#e2ae34", stroke: "#7a4e08", strokeWidth: 1.4, eyes: "#3a2404", glow: null, shine: false, fx: "gold" };
    case "neon":
      return { fill: "#0d0f15", stroke: tint(hex, 0.2), strokeWidth: 3.6, eyes: tint(hex, 0.45), glow: tint(hex, 0.1), shine: false, fx: "neon" };
    case "chrome":
      return { fill: "#8c98a6", stroke: "#1f262d", strokeWidth: 1.4, eyes: "#10151b", glow: null, shine: false, fx: "chrome" };
    case "crystal":
      return { fill: tint(hex, 0.55), stroke: "#ffffff", strokeWidth: 1.5, eyes: "#1b1f27", glow: null, shine: false, fx: "crystal" };
    case "circuit":
      return { fill: "#08161b", stroke: mix(hex, "#7dffea", 0.45), strokeWidth: 2, eyes: mix(hex, "#ffffff", 0.6), glow: null, shine: false, fx: "circuit" };
    case "holo":
      return { fill: "#ece9fb", stroke: "#ffffff", strokeWidth: 1.2, eyes: "#2a2140", glow: null, shine: false, fx: "holo" };
    case "molten":
      return { fill: "#2a120c", stroke: "#ff6a1a", strokeWidth: 1.4, eyes: "#ffd36b", glow: null, shine: false, fx: "molten" };
    case "galaxy":
      return { fill: "#120a2e", stroke: tint(hex, 0.5), strokeWidth: 1.2, eyes: "#f3efff", glow: null, shine: false, fx: "galaxy" };
    default:
      // dark eyes, or light ones on a dark body (black, the deep palette): always readable
      return { fill: hex, stroke: null, strokeWidth: 0, eyes: eyeInkOn(hex), glow: null, shine: false, fx: "plain" };
  }
}

/* ------------------------------------------------ fixed art in 0..100 */

/** Stars of the galaxy skin: x, y, radius, twinkle delay (s, or -1 for still). */
const STARS: [number, number, number, number][] = [
  [22, 34, 0.9, 0], [36, 22, 0.6, -1], [58, 18, 1.1, 1.2], [74, 30, 0.7, -1], [82, 48, 1, 0.6],
  [66, 44, 0.5, -1], [44, 40, 0.7, 2.1], [28, 58, 1.2, 1.7], [18, 74, 0.6, -1], [40, 72, 0.9, 0.3],
  [56, 64, 0.6, -1], [70, 70, 1.1, 2.6], [84, 66, 0.6, -1], [50, 86, 0.8, 1], [32, 88, 0.5, -1], [64, 88, 0.7, 2.3],
];
const STAR4 = "M0 -3.4L0.8 -0.8L3.4 0L0.8 0.8L0 3.4L-0.8 0.8L-3.4 0L-0.8 -0.8Z";

/** Circuit traces (orthogonal, with a pad at the end). */
const TRACES = [
  "M4 30H24V42H40",
  "M96 26H78V38H64",
  "M8 62H30V54H44",
  "M96 70H74V58H60",
  "M30 98V84H46V74",
  "M70 98V82H56",
  "M50 2V14H38V24",
  "M62 4V20H76",
];
const PADS: [number, number][] = [[40, 42], [64, 38], [44, 54], [60, 58], [46, 74], [56, 82], [38, 24], [76, 20]];

/** Molten cracks: jagged lines across the body. */
const CRACKS = [
  "M8 40L22 46L30 40L42 50L50 46L60 56L74 50L84 58L96 54",
  "M30 40L34 28L44 22",
  "M60 56L58 70L66 80L64 94",
  "M42 50L36 66L24 72L14 86",
  "M74 50L80 36L92 30",
  "M58 70L46 82",
];

/** Crystal facets: lines from a few hubs. */
const FACETS = [
  "M50 52L20 18M50 52L82 20M50 52L4 60M50 52L96 56M50 52L30 98M50 52L72 98M50 52L50 0",
  "M20 18L4 60L30 98L72 98L96 56L82 20L50 0Z",
];
const FACET_LIGHT = ["M50 52L20 18L50 0Z", "M50 52L96 56L72 98Z", "M50 52L4 60L20 18Z"];

const RAINBOW = ["#ff8be6", "#ffe98a", "#8dffc8", "#7df4ff", "#b49bff", "#ff8be6"];

function Rainbow({ id, period = 50, angle = 45 }: { id: string; period?: number; angle?: number }) {
  const rad = (angle * Math.PI) / 180;
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={(Math.cos(rad) * period).toFixed(2)} y2={(Math.sin(rad) * period).toFixed(2)} spreadMethod="repeat">
      {RAINBOW.map((color, i) => (
        <stop key={i} offset={i / (RAINBOW.length - 1)} stopColor={color} />
      ))}
    </linearGradient>
  );
}

/** A soft light band that sweeps across the body (gold glints, chrome specular, holo sheen). */
function Sweep({ id, strength, className = "fx-sweep" }: { id: string; strength: number; className?: string }) {
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity={strength} />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className={className}>
        {/* tall enough that its tilted ends never cross the body (a cut corner flickered at the bottom) */}
        <rect x={-40} y={-60} width={26} height={220} fill={`url(#${id})`} transform="rotate(18 50 50)" />
      </g>
    </>
  );
}

function Blur({ id, deviation }: { id: string; deviation: number }) {
  return (
    <filter id={id} x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation={deviation} />
    </filter>
  );
}

export interface ShapeSkinLayers {
  defs: ReactNode;
  /** Behind the body: auras and bloom. */
  under: ReactNode;
  /** Inside the body (already clipped to it). */
  inner: ReactNode;
  /** The edge, over the inner layers. */
  edge: ReactNode;
  /** Around the body, over everything: ambient particles. */
  around: ReactNode;
  /** The body's own fill (a gradient for some skins). */
  fill: string;
  /** Skip the base stroke (the edge layer draws its own). */
  ownEdge: boolean;
}

/**
 * The layers of a skin on one shape outline `d`. `uid` keeps the defs of
 * every avatar on a page apart; `full` adds the filters and the moving parts.
 */
export function shapeSkinLayers(skin: ShapeSkin, d: string, hex: string, uid: string, full: boolean): ShapeSkinLayers {
  const base = shapeSkinBase(skin, hex);
  const none: ShapeSkinLayers = { defs: null, under: null, inner: null, edge: null, around: null, fill: base.fill, ownEdge: false };
  const id = (name: string) => `${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  switch (skin) {
    case "outline": {
      // ink: a crisp line that boils (three hand-drawn takes swapped four times a second) over a holographic halo
      const foil = (
        <g mask={url("inkmask")}>
          <g className="fx-foil">
            <rect x={-60} y={-10} width={220} height={120} fill={url("rainbow")} />
          </g>
        </g>
      );
      return {
        ...none,
        ownEdge: full,
        defs: (
          <>
            <Rainbow id={id("rainbow")} period={60} angle={0} />
            <mask id={id("inkmask")} maskUnits="userSpaceOnUse" x={-10} y={-10} width={120} height={120}>
              <path d={d} fill="none" stroke="#fff" strokeWidth={8.4} strokeLinejoin="round" />
            </mask>
            {full &&
              [1, 2, 3].map((seed) => (
                <filter key={seed} id={id(`boil${seed}`)} x="-10%" y="-10%" width="120%" height="120%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves={1} seed={seed * 7} result="n" />
                  <feDisplacementMap in="SourceGraphic" in2="n" scale={2.4} xChannelSelector="R" yChannelSelector="G" />
                </filter>
              ))}
          </>
        ),
        inner: (
          <g stroke="#1b1f27" strokeWidth={1.1} opacity={0.18}>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <path key={n} d={`M${52 + n * 8} 104L${104} ${52 + n * 8}`} />
            ))}
          </g>
        ),
        edge: full ? (
          <>
            {foil}
            {[1, 2, 3].map((n) => (
              <path key={n} className={`fx-boil fx-boil-${n}`} d={d} fill="none" stroke="#1b1f27" strokeWidth={4.2} strokeLinejoin="round" filter={url(`boil${n}`)} />
            ))}
          </>
        ) : (
          <g mask={url("inkmask")} opacity={0.75}>
            <rect x={-10} y={-10} width={120} height={120} fill={url("rainbow")} />
          </g>
        ),
      };
    }
    case "gold": {
      return {
        ...none,
        fill: url("gold"),
        defs: (
          <>
            <linearGradient id={id("gold")} x1="0" y1="0" x2="0.35" y2="1">
              <stop offset="0" stopColor="#fff4c2" />
              <stop offset="0.22" stopColor="#f2c94c" />
              <stop offset="0.55" stopColor="#c8901e" />
              <stop offset="0.8" stopColor="#8a5a0c" />
              <stop offset="1" stopColor="#e9b949" />
            </linearGradient>
            <pattern id={id("brush")} width="100" height="2.2" patternUnits="userSpaceOnUse">
              <rect width="100" height="0.7" fill="#fff8de" opacity="0.22" />
            </pattern>
          </>
        ),
        inner: (
          <>
            <rect x={0} y={0} width={100} height={100} fill={url("brush")} />
            <ellipse cx={34} cy={26} rx={16} ry={8} fill="#fffbe8" opacity={0.45} transform="rotate(-24 34 26)" />
            {full && <Sweep id={id("sweep")} strength={0.85} />}
          </>
        ),
        around: full ? (
          <g fill="#fff3b0">
            <path className="fx-glint" d={STAR4} transform="translate(80 18) scale(1.5)" />
            <path className="fx-twinkle" style={{ animationDelay: "1.1s" }} d={STAR4} transform="translate(14 30)" />
            <path className="fx-twinkle" style={{ animationDelay: "2.2s" }} d={STAR4} transform="translate(90 70) scale(0.8)" />
          </g>
        ) : null,
      };
    }
    case "neon": {
      const tube = tint(hex, 0.2);
      return {
        ...none,
        ownEdge: true,
        defs: (
          <>
            <radialGradient id={id("plate")} cx="0.5" cy="0.55" r="0.6">
              <stop offset="0" stopColor={hex} stopOpacity="0.28" />
              <stop offset="1" stopColor={hex} stopOpacity="0.04" />
            </radialGradient>
            {full && <Blur id={id("bloom")} deviation={3} />}
            {full && <Blur id={id("spark")} deviation={1.2} />}
          </>
        ),
        under: full ? <path className="fx-neon-bloom" d={d} fill="none" stroke={tube} strokeWidth={10} opacity={0.5} filter={url("bloom")} /> : null,
        inner: <rect x={0} y={0} width={100} height={100} fill={url("plate")} />,
        edge: (
          <g className={full ? "fx-neon-flicker" : undefined}>
            <path d={d} fill="none" stroke={tube} strokeWidth={4} strokeLinejoin="round" />
            <path d={d} fill="none" stroke="#ffffff" strokeWidth={1.3} strokeOpacity={0.9} strokeLinejoin="round" />
            {full && <path className="fx-current" d={d} pathLength={100} fill="none" stroke="#ffffff" strokeWidth={2.6} strokeLinecap="round" strokeDasharray="7 93" filter={url("spark")} />}
          </g>
        ),
      };
    }
    case "chrome": {
      const horizon = mix(hex, "#4b5561", 0.7);
      return {
        ...none,
        fill: url("chrome"),
        defs: (
          <>
            <linearGradient id={id("chrome")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fdfdfe" />
              <stop offset="0.3" stopColor="#c9d2db" />
              <stop offset="0.49" stopColor={horizon} />
              <stop offset="0.53" stopColor="#262d35" />
              <stop offset="0.76" stopColor="#8c98a6" />
              <stop offset="1" stopColor="#e6ebf0" />
            </linearGradient>
          </>
        ),
        inner: (
          <>
            <ellipse cx={32} cy={24} rx={18} ry={7} fill="#ffffff" opacity={0.75} transform="rotate(-20 32 24)" />
            <rect x={62} y={16} width={5} height={14} rx={2} fill="#ffffff" opacity={0.55} transform="rotate(14 64 23)" />
            <rect x={70} y={18} width={3} height={10} rx={1.5} fill="#ffffff" opacity={0.4} transform="rotate(14 71 23)" />
            <path d={d} fill="none" stroke="#ffffff" strokeOpacity={0.6} strokeWidth={2.4} />
            {full && <Sweep id={id("sweep")} strength={0.7} className="fx-sweep fx-sweep-slow" />}
          </>
        ),
      };
    }
    case "crystal": {
      return {
        ...none,
        ownEdge: true,
        fill: url("crystal"),
        defs: (
          <>
            <linearGradient id={id("crystal")} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={tint(hex, 0.8)} stopOpacity="0.9" />
              <stop offset="0.5" stopColor={tint(hex, 0.45)} stopOpacity="0.62" />
              <stop offset="1" stopColor={hex} stopOpacity="0.75" />
            </linearGradient>
            {full && <Blur id={id("rim")} deviation={2} />}
          </>
        ),
        under: full ? <path d={d} fill="none" stroke={tint(hex, 0.6)} strokeWidth={6} opacity={0.5} filter={url("rim")} /> : null,
        inner: (
          <>
            {FACET_LIGHT.map((facet, i) => (
              <path key={facet} d={facet} fill={i === 1 ? hex : "#ffffff"} opacity={i === 1 ? 0.18 : 0.22} />
            ))}
            <g fill="none" stroke="#ffffff" strokeOpacity={0.45} strokeWidth={0.8}>
              {FACETS.map((facet) => (
                <path key={facet} d={facet} />
              ))}
            </g>
            <path d={d} fill="#ffffff" opacity={0.18} transform="translate(9 9) scale(0.82)" />
            {full && (
              <g className="fx-caustic" fill="none" stroke="#ffffff" strokeWidth={1.3} strokeLinecap="round" opacity={0.6}>
                <path d="M-10 64C10 58 22 70 40 64S70 56 90 64S120 70 130 62" />
                <path d="M-10 78C8 72 24 84 44 78S76 70 96 78S124 84 132 76" strokeWidth={0.8} />
              </g>
            )}
          </>
        ),
        edge: <path d={d} fill="none" stroke="#ffffff" strokeOpacity={0.9} strokeWidth={1.5} strokeLinejoin="round" />,
        around: full ? (
          <g fill="#ffffff">
            {[[18, 22, 0], [86, 34, 0.8], [76, 86, 1.6], [12, 70, 2.3]].map(([x, y, delay]) => (
              <path key={x} className="fx-twinkle" style={{ animationDelay: `${delay}s` }} d={STAR4} transform={`translate(${x} ${y})`} />
            ))}
          </g>
        ) : null,
      };
    }
    case "circuit": {
      const trace = mix(hex, "#7dffea", 0.45);
      return {
        ...none,
        ownEdge: true,
        defs: (
          <>
            <pattern id={id("grid")} width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M8 0H0V8" fill="none" stroke={trace} strokeOpacity="0.1" strokeWidth="0.5" />
            </pattern>
            {full && <Blur id={id("pulse")} deviation={1.1} />}
            {full && <Blur id={id("edge")} deviation={2.4} />}
          </>
        ),
        under: full ? <path d={d} fill="none" stroke={trace} strokeWidth={6} opacity={0.45} filter={url("edge")} /> : null,
        inner: (
          <>
            <rect x={0} y={0} width={100} height={100} fill={url("grid")} />
            <g fill="none" stroke={trace} strokeOpacity={0.45} strokeWidth={1.2} strokeLinejoin="round">
              {TRACES.map((trace) => (
                <path key={trace} d={trace} />
              ))}
            </g>
            <g fill={trace} opacity={0.7}>
              {PADS.map(([x, y]) => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r={1.5} />
              ))}
            </g>
            {full && (
              <g fill="none" stroke="#ffffff" strokeWidth={1.8} strokeLinecap="round" filter={url("pulse")}>
                {TRACES.map((path, i) => (
                  <path key={path} className="fx-pulse" style={{ animationDelay: `${(i * 0.37).toFixed(2)}s` }} d={path} pathLength={100} strokeDasharray="10 90" />
                ))}
              </g>
            )}
          </>
        ),
        edge: <path d={d} fill="none" stroke={trace} strokeWidth={2} strokeLinejoin="round" />,
      };
    }
    case "holo": {
      return {
        ...none,
        ownEdge: true,
        fill: url("pearl"),
        defs: (
          <>
            <linearGradient id={id("pearl")} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fbf8ff" />
              <stop offset="0.6" stopColor="#e3e9ff" />
              <stop offset="1" stopColor="#d9d2f5" />
            </linearGradient>
            <Rainbow id={id("foil")} period={50} angle={45} />
            <Rainbow id={id("foil2")} period={70} angle={-30} />
            <mask id={id("rim")} maskUnits="userSpaceOnUse" x={-10} y={-10} width={120} height={120}>
              <path d={d} fill="none" stroke="#fff" strokeWidth={3.2} strokeLinejoin="round" />
            </mask>
          </>
        ),
        inner: (
          <>
            <g className={full ? "fx-foil-diag" : undefined} opacity={full ? 0.6 : 0.45}>
              <rect x={-60} y={-60} width={220} height={220} fill={url("foil")} />
            </g>
            {full && (
              <g className="fx-foil-rev" opacity={0.28}>
                <rect x={-80} y={-60} width={240} height={220} fill={url("foil2")} />
              </g>
            )}
            {full && <Sweep id={id("sweep")} strength={0.75} className="fx-sweep fx-sweep-slow" />}
          </>
        ),
        edge: (
          <>
            <g mask={url("rim")}>
              <g className={full ? "fx-foil" : undefined}>
                <rect x={-60} y={-10} width={220} height={120} fill={url("foil")} />
              </g>
            </g>
            <path d={d} fill="none" stroke="#ffffff" strokeWidth={0.9} strokeLinejoin="round" />
          </>
        ),
        around: full ? (
          <>
            {[[14, 24, "#ff8be6", 0], [88, 30, "#7df4ff", 0.9], [84, 84, "#ffe98a", 1.8], [10, 78, "#8dffc8", 2.6]].map(([x, y, color, delay]) => (
              <path key={String(x)} className="fx-twinkle" style={{ animationDelay: `${delay}s` }} fill={String(color)} d={STAR4} transform={`translate(${x} ${y})`} />
            ))}
          </>
        ) : null,
      };
    }
    case "molten": {
      return {
        ...none,
        ownEdge: true,
        fill: url("rock"),
        defs: (
          <>
            <radialGradient id={id("rock")} cx="0.45" cy="0.4" r="0.7">
              <stop offset="0" stopColor="#3d1d14" />
              <stop offset="1" stopColor="#170806" />
            </radialGradient>
            <radialGradient id={id("heat")} cx="0.5" cy="1" r="0.75">
              <stop offset="0" stopColor="#ff5a1f" stopOpacity="0.7" />
              <stop offset="0.6" stopColor="#ff5a1f" stopOpacity="0.12" />
              <stop offset="1" stopColor="#ff5a1f" stopOpacity="0" />
            </radialGradient>
            {full && <Blur id={id("glow")} deviation={1.8} />}
            {full && <Blur id={id("halo")} deviation={3.2} />}
          </>
        ),
        under: full ? <path className="fx-heat-halo" d={d} fill="none" stroke="#ff5a1f" strokeWidth={8} opacity={0.45} filter={url("halo")} /> : null,
        inner: (
          <>
            <rect x={0} y={0} width={100} height={100} fill={url("heat")} />
            <g className={full ? "fx-crack" : undefined} fill="none" strokeLinecap="round" strokeLinejoin="round">
              {full && (
                <g stroke="#ff6a1a" strokeWidth={4} filter={url("glow")} opacity={0.8}>
                  {CRACKS.map((crack) => (
                    <path key={crack} d={crack} />
                  ))}
                </g>
              )}
              <g stroke="#ff8a2a" strokeWidth={1.7}>
                {CRACKS.map((crack) => (
                  <path key={crack} d={crack} />
                ))}
              </g>
              <g stroke="#ffe08a" strokeWidth={0.6}>
                {CRACKS.map((crack) => (
                  <path key={crack} d={crack} />
                ))}
              </g>
            </g>
          </>
        ),
        edge: <path d={d} fill="none" stroke="#ff6a1a" strokeOpacity={0.9} strokeWidth={1.4} strokeLinejoin="round" />,
        around: full ? (
          <>
            <g fill="none" stroke="#ff9a4a" strokeWidth={1.2} strokeLinecap="round">
              {[[34, 0], [52, 0.8], [68, 1.6]].map(([x, delay]) => (
                <path key={x} className="fx-heat" style={{ animationDelay: `${delay}s` }} d={`M${x} 14c-3 -3 3 -5 0 -8s3 -5 0 -8`} />
              ))}
            </g>
            <g fill="#ffb347">
              {[[30, 0, -4], [46, 0.7, 3], [60, 1.4, -2], [72, 2.1, 5], [40, 2.6, 2]].map(([x, delay, dx]) => (
                <circle key={x} className="fx-ember" style={{ animationDelay: `${delay}s`, ["--fx-dx" as string]: `${dx}px` }} cx={x} cy={20} r={1.1} />
              ))}
            </g>
          </>
        ) : null,
      };
    }
    case "galaxy": {
      const core = mix(hex, "#3b1d7a", 0.45);
      return {
        ...none,
        ownEdge: true,
        fill: url("space"),
        defs: (
          <>
            <radialGradient id={id("space")} cx="0.5" cy="0.55" r="0.65">
              <stop offset="0" stopColor={core} />
              <stop offset="0.65" stopColor="#1a0f45" />
              <stop offset="1" stopColor="#07051a" />
            </radialGradient>
            {full && <Blur id={id("nebula")} deviation={6} />}
            {full && <Blur id={id("edge")} deviation={2.4} />}
          </>
        ),
        under: full ? <path d={d} fill="none" stroke={tint(hex, 0.3)} strokeWidth={6} opacity={0.4} filter={url("edge")} /> : null,
        inner: (
          <>
            <g className={full ? "fx-nebula" : undefined} filter={full ? url("nebula") : undefined} opacity={full ? 0.75 : 0.35}>
              <ellipse cx={34} cy={40} rx={26} ry={14} fill="#ff5fd2" transform="rotate(-25 34 40)" />
              <ellipse cx={68} cy={66} rx={24} ry={12} fill="#4fd8ff" transform="rotate(20 68 66)" />
              <ellipse cx={56} cy={34} rx={14} ry={9} fill={hex} />
            </g>
            <g className={full ? "fx-drift" : undefined} fill="#ffffff">
              {STARS.filter((_, i) => full || i % 2 === 0).map(([x, y, r, delay]) => (
                <circle key={`${x}-${y}`} className={full && delay >= 0 ? "fx-twinkle" : undefined} style={full && delay >= 0 ? { animationDelay: `${delay}s` } : undefined} cx={x} cy={y} r={r} />
              ))}
              <path className={full ? "fx-twinkle" : undefined} style={{ animationDelay: "0.4s" }} d={STAR4} transform="translate(62 26) scale(0.9)" />
            </g>
          </>
        ),
        edge: <path d={d} fill="none" stroke={tint(hex, 0.5)} strokeOpacity={0.75} strokeWidth={1.2} strokeLinejoin="round" />,
        around: full ? (
          <g fill="#ffffff">
            {[[10, 30, 0.2], [92, 22, 1.4], [90, 80, 2.4]].map(([x, y, delay]) => (
              <path key={x} className="fx-twinkle" style={{ animationDelay: `${delay}s` }} d={STAR4} transform={`translate(${x} ${y}) scale(0.7)`} />
            ))}
          </g>
        ) : null,
      };
    }
    default:
      return none;
  }
}
