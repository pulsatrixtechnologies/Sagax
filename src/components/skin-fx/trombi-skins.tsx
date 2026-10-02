// How each Trombi skin paints the paperclip and its note (Trombi.tsx): the
// wire's four strokes, the paper, its lines and margin, and for the premium
// skins the layers around them (a bloom behind the wire, a light running
// along it, a sheen over the paper, particles around). Trombi's eyes never
// change. Coordinates are Trombi's own (viewBox -50 0 310 380).
//
// Still (small avatars, thumbnails, reduced motion) keeps each skin's colors
// with no filter and nothing moving. The keyframes are in skin-fx.css.
import type { ReactNode } from "react";
import type { TrombiSkin } from "../../../shared/mascot-look";
import type { FxKind } from "./skin-fx";

export interface TrombiPaint {
  /** The wire's strokes, outside in: outline, metal, shade, highlight, glint dashes. */
  outer: string;
  main: string;
  shade: string;
  hi: string;
  dash: string;
  /** The note: gradient stops, ruled lines, margin, edge. */
  paper: [string, string, string];
  ruled: string;
  margin: string;
  edge: string;
  /** The paper's curl highlight shows only on light paper. */
  curl: boolean;
  brow: string;
  fx: FxKind;
}

const CLASSIC: TrombiPaint = {
  outer: "#39414c",
  main: "#aab4bf",
  shade: "#77828f",
  hi: "#f4f7fa",
  dash: "#ffffff",
  paper: ["#fff8c4", "#fdf1a6", "#f6e48a"],
  ruled: "#9fb8a4",
  margin: "#e08a8a",
  edge: "#c7b25a",
  curl: true,
  brow: "#1b1f27",
  fx: "plain",
};

/** A gradient's url for the wire, or a flat color: `uid` names this drawing's defs. */
export function trombiPaint(skin: TrombiSkin, uid: string): TrombiPaint {
  const url = (name: string) => `url(#${uid}${name})`;
  switch (skin) {
    case "retro98":
      return { ...CLASSIC, fx: "retro" };
    case "gold":
      return { ...CLASSIC, outer: "#5a3a06", main: url("gold"), shade: "#8a5a0c", hi: "#fffbe0", paper: ["#fffaf0", "#f8ecd0", "#efdcae"], ruled: "#d9c08a", margin: "#c9a13a", edge: "#b8913a", fx: "gold" };
    case "chrome":
      return { ...CLASSIC, outer: "#1f262d", main: url("chrome"), shade: "#4b5561", hi: "#ffffff", paper: ["#f6f8fb", "#e6ecf2", "#d3dce6"], ruled: "#a8b8c8", margin: "#7d93aa", edge: "#8696a8", fx: "chrome" };
    case "neon":
      return { ...CLASSIC, outer: "#ff3fd0", main: "#ff8ae9", shade: "#c21fa3", hi: "#ffffff", dash: "#ffffff", paper: ["#1a2048", "#121738", "#0b0f28"], ruled: "#22e6ff", margin: "#ff4fd8", edge: "#22e6ff", curl: false, brow: "#e8ecff", fx: "neon" };
    case "holo":
      return { ...CLASSIC, outer: "#6b5fa8", main: url("holo"), shade: "#9d8fd6", hi: "#ffffff", paper: ["#fdfbff", "#f0ebff", "#e2e9ff"], ruled: "#b6a8e8", margin: "#ff8be6", edge: "#b49bff", fx: "holo" };
    case "molten":
      return { ...CLASSIC, outer: "#2a0d06", main: url("molten"), shade: "#b8320c", hi: "#fff3c4", dash: "#fff3c4", paper: ["#f6e6c8", "#e7c690", "#6a3418"], ruled: "#b07a4a", margin: "#c2410c", edge: "#8a3a12", fx: "molten" };
    case "glitch":
      return { ...CLASSIC, outer: "#0b0f1a", main: "#2a3348", shade: "#11151f", hi: "#22e6ff", dash: "#ff2bd6", paper: ["#0f1d17", "#0b1611", "#07100c"], ruled: "#1f8f5a", margin: "#ff2bd6", edge: "#22e6ff", curl: false, brow: "#d8ffe9", fx: "glitch" };
    default:
      return CLASSIC;
  }
}

const RAINBOW = ["#ff8be6", "#ffe98a", "#8dffc8", "#7df4ff", "#b49bff", "#ff8be6"];
const STAR = "M0 -9L2.2 -2.2L9 0L2.2 2.2L0 9L-2.2 2.2L-9 0L-2.2 -2.2Z";

export interface TrombiSkinLayers {
  defs: ReactNode;
  /** Over the paper, clipped to it. */
  paper: ReactNode;
  /** Behind the wire. */
  underWire: ReactNode;
  /** Over the wire, under the face. */
  overWire: ReactNode;
  /** Over everything. */
  around: ReactNode;
  /** A class for the whole clip and face (the glitch's slice jitter). */
  bodyClass?: string;
}

/** The skin's layers for one drawing; `wire` is the wire path, `id` names this drawing's defs. */
export function trombiSkinLayers(skin: TrombiSkin, wire: string, id: (name: string) => string, full: boolean): TrombiSkinLayers {
  const url = (name: string) => `url(#${id(name)})`;
  const blur = (name: string, deviation: number) => (
    <filter id={id(name)} x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation={deviation} />
    </filter>
  );
  const glint = (color: string, width: number, dash: string, className: string, filter?: string) =>
    full ? <path className={className} d={wire} pathLength={100} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray={dash} filter={filter} /> : null;
  const none: TrombiSkinLayers = { defs: null, paper: null, underWire: null, overWire: null, around: null };
  switch (skin) {
    case "gold":
      return {
        ...none,
        defs: (
          <>
            <linearGradient id={id("gold")} gradientUnits="userSpaceOnUse" x1="48" y1="56" x2="140" y2="312">
              <stop offset="0" stopColor="#fff1b8" />
              <stop offset="0.25" stopColor="#f2c94c" />
              <stop offset="0.5" stopColor="#b07a12" />
              <stop offset="0.72" stopColor="#ffe08a" />
              <stop offset="1" stopColor="#8a5a0c" />
            </linearGradient>
            {full && blur("glint", 2.4)}
          </>
        ),
        overWire: glint("#ffffff", 5, "4 96", "fx-current fx-current-slow", url("glint")),
        around: full ? (
          <g fill="#ffe27a" stroke="#8a5a0c" strokeWidth={0.8}>
            {[[20, 70, 0], [176, 40, 1.2], [190, 200, 2.2]].map(([x, y, delay]) => (
              <path key={x} className="fx-twinkle" style={{ animationDelay: `${delay}s` }} d={STAR} transform={`translate(${x} ${y})`} />
            ))}
          </g>
        ) : null,
      };
    case "chrome":
      return {
        ...none,
        defs: (
          <>
            <linearGradient id={id("chrome")} gradientUnits="userSpaceOnUse" x1="40" y1="0" x2="148" y2="0">
              <stop offset="0" stopColor="#5b6672" />
              <stop offset="0.18" stopColor="#f4f7fa" />
              <stop offset="0.32" stopColor="#8c98a6" />
              <stop offset="0.5" stopColor="#262d35" />
              <stop offset="0.66" stopColor="#c9d2db" />
              <stop offset="0.84" stopColor="#ffffff" />
              <stop offset="1" stopColor="#6f7a86" />
            </linearGradient>
            {full && blur("spec", 2)}
          </>
        ),
        overWire: glint("#ffffff", 6, "12 88", "fx-current fx-current-slow", url("spec")),
        paper: full ? <Sheen id={id("sheen")} strength={0.6} /> : null,
      };
    case "neon":
      return {
        ...none,
        defs: <>{full && blur("bloom", 6)}{full && blur("spark", 2)}</>,
        underWire: full ? <path className="fx-neon-bloom" d={wire} fill="none" stroke="#ff3fd0" strokeWidth={26} opacity={0.55} filter={url("bloom")} strokeLinecap="round" /> : null,
        overWire: full ? (
          <g className="fx-neon-flicker">{glint("#ffffff", 5, "6 94", "fx-current", url("spark"))}</g>
        ) : null,
        paper: (
          <g opacity={0.5}>
            <rect x={-50} y={0} width={310} height={380} fill="#22e6ff" opacity={0.05} />
          </g>
        ),
      };
    case "holo":
      return {
        ...none,
        defs: (
          <>
            <linearGradient id={id("holo")} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="40" y2="69" spreadMethod="repeat">
              {RAINBOW.map((color, i) => (
                <stop key={i} offset={i / (RAINBOW.length - 1)} stopColor={color} />
              ))}
            </linearGradient>
            <linearGradient id={id("foil")} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="70.71" y2="70.71" spreadMethod="repeat">
              {RAINBOW.map((color, i) => (
                <stop key={i} offset={i / (RAINBOW.length - 1)} stopColor={color} />
              ))}
            </linearGradient>
          </>
        ),
        paper: (
          <>
            <g className={full ? "fx-foil-diag fx-foil-diag-lg" : undefined} opacity={0.35}>
              <rect x={-150} y={-100} width={500} height={560} fill={url("foil")} />
            </g>
            {full && <Sheen id={id("sheen")} strength={0.7} />}
          </>
        ),
        overWire: glint("#ffffff", 4, "5 95", "fx-current"),
        around: full ? (
          <>
            {[[20, 70, "#ff8be6", 0], [176, 40, "#7df4ff", 0.9], [190, 200, "#ffe98a", 1.8], [-20, 250, "#8dffc8", 2.6]].map(([x, y, color, delay]) => (
              <path key={String(x)} className="fx-twinkle" style={{ animationDelay: `${delay}s` }} fill={String(color)} d={STAR} transform={`translate(${x} ${y})`} />
            ))}
          </>
        ) : null,
      };
    case "molten":
      return {
        ...none,
        defs: (
          <>
            <linearGradient id={id("molten")} gradientUnits="userSpaceOnUse" x1="0" y1="56" x2="0" y2="312">
              <stop offset="0" stopColor="#ffe08a" />
              <stop offset="0.45" stopColor="#ff8a2a" />
              <stop offset="1" stopColor="#ff4a12" />
            </linearGradient>
            <radialGradient id={id("burn")} gradientUnits="userSpaceOnUse" cx="-30" cy="340" r="190">
              <stop offset="0" stopColor="#2a0d06" stopOpacity="0.85" />
              <stop offset="0.45" stopColor="#6a2a0c" stopOpacity="0.45" />
              <stop offset="1" stopColor="#6a2a0c" stopOpacity="0" />
            </radialGradient>
            {full && blur("bloom", 6)}
          </>
        ),
        paper: <rect x={-50} y={0} width={310} height={380} fill={url("burn")} />,
        underWire: full ? <path className="fx-heat-halo" d={wire} fill="none" stroke="#ff5a1f" strokeWidth={26} opacity={0.6} filter={url("bloom")} strokeLinecap="round" /> : null,
        around: full ? (
          <>
            <g fill="none" stroke="#ff9a4a" strokeWidth={2.4} strokeLinecap="round">
              {[[70, 0], [100, 0.8], [130, 1.6]].map(([x, delay]) => (
                <path key={x} className="fx-heat" style={{ animationDelay: `${delay}s` }} d={`M${x} 46c-6 -6 6 -10 0 -16s6 -10 0 -16`} />
              ))}
            </g>
            <g fill="#ffb347">
              {[[60, 0, -8], [92, 0.7, 6], [118, 1.4, -4], [140, 2.1, 10], [80, 2.6, 4]].map(([x, delay, dx]) => (
                <circle key={x} className="fx-ember fx-ember-lg" style={{ animationDelay: `${delay}s`, ["--fx-dx" as string]: `${dx}px` }} cx={x} cy={60} r={2.6} />
              ))}
            </g>
          </>
        ) : null,
      };
    case "glitch":
      return {
        ...none,
        defs: (
          <pattern id={id("scan")} width="4" height="6" patternUnits="userSpaceOnUse">
            <rect width="4" height="2" fill="#22e6ff" opacity="0.08" />
          </pattern>
        ),
        paper: (
          <g className={full ? "fx-scan" : undefined}>
            <rect x={-50} y={-12} width={310} height={400} fill={url("scan")} />
          </g>
        ),
        underWire: (
          <>
            <path className={full ? "fx-glitch-r" : undefined} d={wire} fill="none" stroke="#ff2bd6" strokeWidth={11} opacity={0.6} strokeLinecap="round" transform={full ? undefined : "translate(-3 0)"} />
            <path className={full ? "fx-glitch-b" : undefined} d={wire} fill="none" stroke="#22e6ff" strokeWidth={11} opacity={0.6} strokeLinecap="round" transform={full ? undefined : "translate(3 0)"} />
          </>
        ),
        overWire: glint("#22e6ff", 3, "3 22", "fx-current"),
        bodyClass: full ? "fx-glitch-slice" : undefined,
      };
    default:
      return none;
  }
}

/** A light band that sweeps across the note. */
function Sheen({ id, strength }: { id: string; strength: number }) {
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity={strength} />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="fx-sweep fx-sweep-lg">
        <rect x={-130} y={-40} width={70} height={460} fill={`url(#${id})`} transform="rotate(20 100 190)" />
      </g>
    </>
  );
}
