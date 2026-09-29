// The Pulsa Bot owl: traced art, palette, geometry and the pure pose function.
// A TypeScript port of the approved owl.js (owlSvg / owlPalette / owlPose),
// split so React can render the parts and a shared animation loop can drive
// them. Nothing here touches the DOM.
//
// POSE: the reference's 3/4 view facing right, one visible eye. The art is a
// trace (./owl-trace.ts), not a redraw; only the dark colors change per bot.
// The eye internals are fitted circles so gaze and blink can move them.
//
// Flat fills only: no gradients, no filters, no strokes. One clipPath (the
// eyelid is clipped to the iris), whose id the renderer makes unique.

import { OWL_TRACE, type OwlTraceRole } from "./owl-trace";

export { OWL_TRACE };

/** Exact colors sampled from the reference. */
export const OWL_REFERENCE = {
  plumage: "#252226",
  wingNear: "#141014",
  socket: "#110D11",
  cream: "#F6F1E8",
  grey: "#ACA09C",
  greyDark: "#464147",
  iris: "#F8CA48",
  pupil: "#0E0B0E",
  highlight: "#FBF8F2",
} as const;

export type OwlPalette = { [K in keyof typeof OWL_REFERENCE]: string };

/** The white bot's plumage: a warm light grey so the cream face still reads. */
export const OWL_WHITE_PALETTE = { plumage: "#CFCBC4", wingNear: "#A9A59E", socket: "#3A3836" } as const;

/** Below this rendered size the fine details (belly spots) are dropped. */
export const OWL_DETAIL_MIN_SIZE = 36;

const [IX, IY, IR] = OWL_TRACE.iris;
const [PX, PY, PR] = OWL_TRACE.pupil;
const [HX, HY, HR] = OWL_TRACE.highlight;
/** The pupil stays inside the iris. */
const GAZE_MAX = Math.max(1, IR - PR - 0.4);
const LID_TOP = Math.round((IY - IR - 1) * 100) / 100;
const LID_H = IR * 2 + 6;

/** Geometry in viewBox units (0 0 256 256; 1px == 1 unit before scaling). */
export const OWL_GEOM = {
  viewBox: 256,
  eye: { x: IX, y: IY, iris: IR, pupil: PR, highlight: HR },
  gazeMax: GAZE_MAX,
  /** Rest gaze = the reference's forward look (pupil pushed toward the beak). */
  gazeRest: { x: PX - IX, y: PY - IY },
  lidTop: LID_TOP,
  pivots: {
    ground: { x: 128, y: OWL_TRACE.ground },
    shoulder: { x: OWL_TRACE.shoulder[0], y: OWL_TRACE.shoulder[1] },
  },
} as const;

/* ------------------------------------------------------------------ colors */

function hexToRgb(hex: string): [number, number, number] {
  let h = String(hex).trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = Number.parseInt(h, 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Mix a color toward black by `amount` (0..1). */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r * (1 - amount), g * (1 - amount), b * (1 - amount)]);
}

/** True for the white bot (and any near-white color). */
export function isWhiteOwlColor(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  return r > 225 && g > 225 && b > 225;
}

/**
 * Palette for a bot color (hex).
 * 'vivid' (default): plumage = the pure bot color, near wing darkened 30%,
 *   eye socket darkened 70% (tinted, so it harmonizes and the yellow eye pops).
 * 'dark': close to the reference's near-black look, tinted by the bot color.
 * The white bot has its own light-grey palette in both modes.
 */
export function owlPalette(color: string, mode: "vivid" | "dark" = "vivid"): OwlPalette {
  const hex = rgbToHex(hexToRgb(color));
  const base: OwlPalette = { ...OWL_REFERENCE };
  if (isWhiteOwlColor(hex)) return { ...base, ...OWL_WHITE_PALETTE };
  if (mode === "dark") return { ...base, plumage: shade(hex, 0.72), wingNear: shade(hex, 0.85), socket: "#0E0D0E" };
  return { ...base, plumage: hex, wingNear: shade(hex, 0.3), socket: shade(hex, 0.7) };
}

/* ------------------------------------------------------------------- parts */

export interface OwlPath {
  d: string;
  fill: string;
}

export interface OwlSvgParts {
  body: OwlPath[];
  faceMask: OwlPath[];
  /** null below OWL_DETAIL_MIN_SIZE (or when forced off). */
  spots: OwlPath[] | null;
  feet: OwlPath[];
  beak: OwlPath[];
  nearWing: OwlPath[];
  socket: OwlPath[];
  eye: {
    cx: number;
    cy: number;
    iris: { r: number; fill: string };
    pupil: { r: number; fill: string };
    highlight: { cx: number; cy: number; r: number; fill: string };
    /** The clip circle for the lid (slightly larger than the iris). */
    clipR: number;
  };
  lid: { d: string; fill: string };
}

const layer = (role: OwlTraceRole): string[] => OWL_TRACE.layers.find((l) => l.role === role)?.d ?? [];
const paint = (ds: string[], fill: string): OwlPath[] => ds.map((d) => ({ d, fill }));
const round2 = (v: number) => Math.round(v * 100) / 100;
/** The dark-grey layer holds both the beak and the feet; the beak starts high. */
const isBeak = (d: string) => Number.parseFloat(d.slice(1).split(" ")[1] ?? "") < 170;

/**
 * The owl's drawable parts for a palette, in paint order. Pure data: the
 * renderer decides the markup, ids and transforms.
 */
export function owlSvgParts(palette: OwlPalette, opts: { size?: number; spots?: boolean } = {}): OwlSvgParts {
  const small = opts.size != null && opts.size < OWL_DETAIL_MIN_SIZE;
  const spots = opts.spots ?? !small;
  const greyDark = layer("greyDark");
  const lidTop = LID_TOP;
  const lidH = LID_H;
  return {
    body: paint(layer("plumage"), palette.plumage),
    faceMask: [...paint(layer("cream"), palette.cream), ...paint(layer("patch"), palette.plumage)],
    spots: spots ? paint(layer("grey"), palette.grey) : null,
    feet: paint(greyDark.filter((d) => !isBeak(d)), palette.greyDark),
    beak: paint(greyDark.filter(isBeak), palette.greyDark),
    nearWing: paint(layer("wingNear"), palette.wingNear),
    socket: paint(layer("socket"), palette.socket),
    eye: {
      cx: IX,
      cy: IY,
      iris: { r: IR, fill: palette.iris },
      pupil: { r: PR, fill: palette.pupil },
      highlight: { cx: round2(IX + HX - PX), cy: round2(IY + HY - PY), r: HR, fill: palette.highlight },
      clipR: round2(IR + 0.3),
    },
    lid: {
      fill: palette.plumage,
      d:
        `M${round2(IX - IR - 3)} ${round2(lidTop)}H${round2(IX + IR + 3)}V${round2(lidTop + lidH * 0.8)}` +
        `Q${IX} ${round2(lidTop + lidH * 1.12)} ${round2(IX - IR - 3)} ${round2(lidTop + lidH * 0.8)}Z`,
    },
  };
}

/* -------------------------------------------------------------------- pose */

export const OWL_STATES = ["idle", "thinking", "working", "success", "alert", "sleepy"] as const;
export type OwlState = (typeof OWL_STATES)[number];

/** Gaze in gazeMax units (-1..1 per axis, length <= 1); null = rest gaze. */
export type OwlGaze = { x: number; y: number };

export interface OwlPoseFrame {
  x: number;
  y: number;
  sx: number;
  sy: number;
  tilt: number;
  wing: number;
  eyeScale: number;
  lid: number;
  gaze: OwlGaze | null;
  /** A one-shot (loop=false) finished; the caller returns to idle. */
  done: boolean;
}

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeOut = (u: number) => 1 - (1 - u) * (1 - u);

/**
 * Pure pose function: state + time (s) -> transform parameters.
 * `hop` scales the success hop height (1 = the reference's 30 units); small
 * avatars pass less so the jump stays near their box.
 */
export function owlPose(state: OwlState, t: number, loop = true, hop = 1): OwlPoseFrame {
  const pose: OwlPoseFrame = { x: 0, y: 0, sx: 1, sy: 1, tilt: 0, wing: 0, eyeScale: 1, lid: 0, gaze: null, done: false };
  switch (state) {
    case "thinking":
      pose.tilt = 6 * Math.sin((TAU * t) / 3.2);
      pose.gaze = { x: 0.6, y: -0.8 };
      break;
    case "working":
      pose.wing = 7 + 7 * Math.sin(TAU * 6 * t);
      pose.y = -3.5 * Math.abs(Math.sin(TAU * 3 * t));
      pose.gaze = { x: 0.85, y: 0.5 };
      break;
    case "success": {
      const period = 1.8;
      const u = loop ? t % period : Math.min(t, period);
      if (!loop && t >= 1.1) pose.done = true;
      if (u < 0.14) {
        const k = Math.sin((Math.PI / 2) * (u / 0.14));
        pose.sy = 1 - 0.12 * k;
        pose.sx = 1 + 0.08 * k;
      } else if (u < 0.54) {
        const q = (u - 0.14) / 0.4;
        pose.y = -30 * hop * 4 * q * (1 - q);
        pose.sy = 1 + 0.08 * (1 - q);
        pose.sx = 1 - 0.05 * (1 - q);
        pose.gaze = { x: 0.6, y: -0.7 };
      } else if (u < 0.7) {
        const k = Math.sin(Math.PI * ((u - 0.54) / 0.16));
        pose.sy = 1 - 0.14 * k;
        pose.sx = 1 + 0.1 * k;
      } else {
        const d = u - 0.7;
        const w = Math.exp(-d * 7) * Math.sin(d * 26);
        pose.sy = 1 + 0.04 * w;
        pose.sx = 1 - 0.03 * w;
      }
      pose.lid = u > 0.54 && u < 1.2 ? 0.28 : 0;
      break;
    }
    case "alert": {
      const period = 1.8;
      const u = loop ? t % period : t;
      if (!loop && t >= 1.4) pose.done = true;
      pose.eyeScale = 1 + 0.15 * easeOut(clamp(u / 0.12, 0, 1));
      pose.x = u < 0.6 ? 5 * Math.sin(TAU * 12 * u) * Math.exp(-u * 5) : 0;
      pose.gaze = { x: 0.3, y: 0 };
      break;
    }
    case "sleepy":
      pose.lid = 0.55;
      pose.sy = 1 + 0.02 * Math.sin((TAU * t) / 4.6);
      pose.tilt = 2 + 2 * Math.sin((TAU * t) / 4.6 - 0.6);
      pose.gaze = { x: 0.5, y: 0.8 };
      break;
    default:
      // idle: breathing, feet planted; the top moves ~1.1px at 72px
      pose.sy = 1 + 0.016 * Math.sin((TAU * t) / 3.4);
  }
  return pose;
}

/** Gaze (gazeMax units) -> pupil offset in viewBox units. null = rest look. */
export function gazeToOffset(g: OwlGaze | null): { x: number; y: number } {
  if (!g) return { ...OWL_GEOM.gazeRest };
  let { x, y } = g;
  const l = Math.hypot(x, y);
  if (l > 1) {
    x /= l;
    y /= l;
  }
  return { x: x * GAZE_MAX, y: y * GAZE_MAX };
}

/**
 * Pointer position inside the avatar's box -> pupil offset: from the forward
 * rest look, pushed toward the pointer, kept inside the iris.
 */
export function pointerGazeOffset(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const ex = rect.left + (IX / 256) * rect.width;
  const ey = rect.top + (IY / 256) * rect.height;
  const dx = (clientX - ex) / (rect.width * 0.35 || 1);
  const dy = (clientY - ey) / (rect.height * 0.35 || 1);
  const rest = OWL_GEOM.gazeRest;
  let gx = rest.x + dx * GAZE_MAX * 1.6;
  let gy = rest.y + dy * GAZE_MAX * 1.6;
  const gl = Math.hypot(gx, gy);
  if (gl > GAZE_MAX) {
    gx *= GAZE_MAX / gl;
    gy *= GAZE_MAX / gl;
  }
  return { x: gx, y: gy };
}

/* -------------------------------------------------------------- transforms */
// Every part is driven by a CSS transform on an SVG <g>. SVG elements default
// to transform-origin 0 0 in viewBox units, so the pivot is baked in with
// translate(o) ... translate(-o).

const around = (o: { x: number; y: number }, inner: string) =>
  `translate(${o.x}px,${o.y}px) ${inner} translate(${-o.x}px,${-o.y}px)`;

export function rigTransform(p: Pick<OwlPoseFrame, "x" | "y" | "tilt" | "sx" | "sy">): string {
  return (
    `translate(${p.x.toFixed(2)}px,${p.y.toFixed(2)}px) ` +
    around(OWL_GEOM.pivots.ground, `rotate(${p.tilt.toFixed(2)}deg) scale(${p.sx.toFixed(4)},${p.sy.toFixed(4)})`)
  );
}

export function wingTransform(wing: number): string {
  return around(OWL_GEOM.pivots.shoulder, `rotate(${wing.toFixed(2)}deg)`);
}

export function eyesTransform(eyeScale: number): string {
  return around(OWL_GEOM.eye, `scale(${eyeScale.toFixed(4)})`);
}

export function pupilTransform(offset: { x: number; y: number }): string {
  return `translate(${offset.x.toFixed(2)}px,${offset.y.toFixed(2)}px)`;
}

export function lidTransform(lid: number): string {
  const k = clamp(lid, 0, 1);
  return `translate(0px,${LID_TOP}px) scale(1,${k.toFixed(3)}) translate(0px,${-LID_TOP}px)`;
}

/** All five transforms for a pose (used for static renders and first paint). */
export function poseTransforms(pose: OwlPoseFrame, pupil: { x: number; y: number }) {
  return {
    rig: rigTransform(pose),
    nearWing: wingTransform(pose.wing),
    eyes: eyesTransform(pose.eyeScale),
    pupil: pupilTransform(pupil),
    lids: lidTransform(pose.lid),
  };
}

/**
 * Success-hop amplitude for a rendered size. The full hop rises ~12% of the
 * box; small list avatars sit in tight rows, so they hop less.
 */
export function hopForSize(size: number): number {
  if (size <= 24) return 0.35;
  if (size <= 44) return 0.55;
  if (size <= 72) return 0.8;
  return 1;
}
