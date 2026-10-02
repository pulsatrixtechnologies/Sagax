// Special-edition skins for the owl ("camos"): pure data, no DOM. A skin
// recolors the traced art (the shape never changes) and names the effects the
// renderer layers around it: an aura behind the owl, overlays clipped to the
// silhouette, particles and arcs in front, a glow behind the eye.
//
// Small avatars (below OWL_DETAIL_MIN_SIZE) keep only the recolor and the
// aura, still; the effects need room to read.
import { botMascotSkin, type MascotSkinId } from "../../../shared/mascot-skins";
import { isBlackOwlColor, isWhiteOwlColor, type OwlPalette } from "./owl-art";

export type OwlSkinId = MascotSkinId;

export { botMascotSkin as owlSkinId };

/** How rare each skin is (the picker's tab and card). */
export { OWL_SKIN_TIER } from "../../../shared/mascot-skins";

export interface OwlSkinLook {
  /** The aura behind the owl: its core color and how strong it is (0..1). */
  aura: { color: string; strength: number } | null;
  /** A glow around the eye (lightning, neon, inferno, frost). */
  eyeGlow: string | null;
  /** A light edge around the silhouette. */
  rim: string | null;
}

const tint = (hex: string, toward: string, t: number) => {
  const a = Number.parseInt(hex.slice(1), 16);
  const b = Number.parseInt(toward.slice(1), 16);
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
};

/**
 * The glowing color of a skin that burns in the bot's own color (neon): the
 * bot color lifted toward white. Black and white have no hue of their own, so
 * they glow electric cyan.
 */
export function owlSkinAccent(hex: string): string {
  if (isBlackOwlColor(hex) || isWhiteOwlColor(hex)) return "#22D3EE";
  return tint(hex, "#FFFFFF", 0.3);
}

/** The palette a skin paints the traced owl with. `base` is the bot's own. */
export function owlSkinPalette(skin: OwlSkinId, base: OwlPalette, hex: string): OwlPalette {
  switch (skin) {
    case "lightning":
      // the bot's own plumage, charged: the eye burns white-blue
      return { ...base, iris: "#D9F7FF", pupil: "#0A1A2E", highlight: "#FFFFFF" };
    case "gold":
      return {
        ...base,
        plumage: "#E2AE34",
        wingNear: "#B07A12",
        socket: "#4A3106",
        cream: "#FFF3CF",
        grey: "#C9994A",
        greyDark: "#6B4A10",
        iris: "#FFE27A",
        pupil: "#2A1A02",
      };
    case "neon": {
      const accent = owlSkinAccent(hex);
      return {
        ...base,
        plumage: "#11131F",
        wingNear: "#0B0C15",
        socket: "#05060B",
        cream: "#21253A",
        grey: accent,
        greyDark: "#2B2F45",
        iris: accent,
        pupil: "#05060B",
      };
    }
    case "inferno":
      return {
        ...base,
        plumage: "#2E0F0A",
        wingNear: "#1D0805",
        socket: "#120302",
        cream: "#FFE0B8",
        grey: "#FF7A2E",
        greyDark: "#3D1A10",
        iris: "#FF8A1F",
        pupil: "#1A0500",
        highlight: "#FFF4D0",
      };
    case "frost":
      return {
        ...base,
        plumage: "#A7D8F2",
        wingNear: "#6FA9D4",
        socket: "#1D4868",
        cream: "#F4FBFF",
        grey: "#86B8D8",
        greyDark: "#4E7C9C",
        iris: "#C8F3FF",
        pupil: "#0B2536",
      };
    case "snowy":
      // the snowy owl: white plumage barred with dark flecks, a yellow eye
      return {
        ...base,
        plumage: "#E8E6E0",
        wingNear: "#C9C5BC",
        socket: "#3A3836",
        cream: "#FFFFFF",
        grey: "#3E3C42",
        greyDark: "#57544F",
        iris: "#F8CA48",
      };
    case "barn":
      // the barn owl: golden buff back, the pale heart face, a warm eye
      return {
        ...base,
        plumage: "#C9985A",
        wingNear: "#A8783D",
        socket: "#3B2A1A",
        cream: "#FBF3E6",
        grey: "#7A6450",
        greyDark: "#CDB79E",
        iris: "#F2B33D",
      };
    case "chrome":
      return {
        ...base,
        plumage: "#9AA6B4",
        wingNear: "#6E7A88",
        socket: "#1F262D",
        cream: "#EEF3F8",
        grey: "#D6DEE8",
        greyDark: "#4A5562",
        iris: "#BFE9FF",
        pupil: "#0D1319",
      };
    case "holo":
      return {
        ...base,
        plumage: "#E3E0F6",
        wingNear: "#C6BEEC",
        socket: "#2A2140",
        cream: "#FFFFFF",
        grey: "#B9A7F0",
        greyDark: "#6B5E9A",
        iris: "#9BF6FF",
        pupil: "#1B1430",
      };
    case "galaxy":
      return {
        ...base,
        plumage: "#1A1140",
        wingNear: "#110B2C",
        socket: "#07041A",
        cream: "#E6E0FF",
        grey: "#C9B8FF",
        greyDark: "#4A3D85",
        iris: "#FFE27A",
        pupil: "#140A2E",
      };
    case "spirit":
      // a friendly ghost: pale, cool and translucent-looking, never menacing
      return {
        ...base,
        plumage: "#A9DCEB",
        wingNear: "#82C4D9",
        socket: "#1D3F52",
        cream: "#F2FBFF",
        grey: "#E3F6FB",
        greyDark: "#6FA3B5",
        iris: "#E8FFFF",
        pupil: "#0B2A38",
      };
    case "carbon":
      return {
        ...base,
        plumage: "#2A2C31",
        wingNear: "#1A1B1F",
        socket: "#0A0A0C",
        greyDark: "#4A4C53",
        iris: "#F8CA48",
      };
    default:
      return base;
  }
}

/** Aura, eye glow and rim for a skin. */
export function owlSkinLook(skin: OwlSkinId, hex: string): OwlSkinLook {
  switch (skin) {
    case "lightning":
      return { aura: { color: "#38BDF8", strength: 0.55 }, eyeGlow: "#7DD3FC", rim: "rgba(186,230,253,0.55)" };
    case "gold":
      return { aura: { color: "#FBBF24", strength: 0.45 }, eyeGlow: null, rim: "rgba(255,226,140,0.6)" };
    case "neon": {
      const accent = owlSkinAccent(hex);
      return { aura: { color: accent, strength: 0.45 }, eyeGlow: accent, rim: accent };
    }
    case "inferno":
      return { aura: { color: "#F97316", strength: 0.6 }, eyeGlow: "#FB923C", rim: "rgba(251,146,60,0.7)" };
    case "frost":
      return { aura: { color: "#7DD3FC", strength: 0.5 }, eyeGlow: "#E0F7FF", rim: "rgba(186,236,255,0.75)" };
    case "carbon":
      return { aura: null, eyeGlow: null, rim: "rgba(200,210,225,0.4)" };
    case "snowy":
      return { aura: null, eyeGlow: null, rim: "rgba(150,160,175,0.45)" };
    case "barn":
      return { aura: null, eyeGlow: null, rim: "rgba(255,236,200,0.5)" };
    case "chrome":
      return { aura: { color: "#CFE3FF", strength: 0.3 }, eyeGlow: null, rim: "rgba(235,242,250,0.75)" };
    case "holo":
      return { aura: { color: "#F5A8FF", strength: 0.4 }, eyeGlow: "#9BF6FF", rim: "rgba(255,255,255,0.8)" };
    case "galaxy":
      return { aura: { color: "#8B6CFF", strength: 0.5 }, eyeGlow: "#FFE27A", rim: "rgba(185,164,255,0.7)" };
    case "spirit":
      return { aura: { color: "#7FF0FF", strength: 0.45 }, eyeGlow: "#C8FFFF", rim: "rgba(200,250,255,0.8)" };
    default:
      return { aura: null, eyeGlow: null, rim: null };
  }
}

/* ------------------------------------------------------------- lightning */

/** A small seeded PRNG so the bolts are the same on every render. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pt = [number, number];
const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * A jagged bolt along a quadratic curve from `a` to `b` (bent toward `c`),
 * with one short fork. Returns an SVG path `d`.
 */
export function owlBolt(a: Pt, c: Pt, b: Pt, seed: number, jag = 7, steps = 9): string {
  const rand = rng(seed);
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0];
    const y = (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1];
    // tangent, for a perpendicular kick that is zero at both ends
    const tx = 2 * (1 - t) * (c[0] - a[0]) + 2 * t * (b[0] - c[0]);
    const ty = 2 * (1 - t) * (c[1] - a[1]) + 2 * t * (b[1] - c[1]);
    const len = Math.hypot(tx, ty) || 1;
    const kick = i === 0 || i === steps ? 0 : (rand() * 2 - 1) * jag;
    pts.push([x + (-ty / len) * kick, y + (tx / len) * kick]);
  }
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}` + pts.slice(1).map(([x, y]) => `L${r1(x)} ${r1(y)}`).join("");
  // one fork off a middle joint
  const at = pts[Math.floor(steps / 2)];
  const dir = rand() > 0.5 ? 1 : -1;
  const fx = at[0] + (rand() * 10 + 8) * dir;
  const fy = at[1] + (rand() * 10 + 6) * (rand() > 0.5 ? 1 : -1);
  d += `M${r1(at[0])} ${r1(at[1])}L${r1((at[0] + fx) / 2 + (rand() * 6 - 3))} ${r1((at[1] + fy) / 2 + (rand() * 6 - 3))}L${r1(fx)} ${r1(fy)}`;
  return d;
}

/** Arcs crackling just outside the silhouette (viewBox units), each flickers on its own clock. */
export const OWL_LIGHTNING_ARCS: { d: string; dur: number; delay: number }[] = [
  { d: owlBolt([44, 104], [22, 40], [112, 10], 11), dur: 1.5, delay: 0 },
  { d: owlBolt([176, 8], [236, 14], [226, 86], 23), dur: 1.9, delay: 0.55 },
  { d: owlBolt([30, 150], [2, 196], [50, 238], 37), dur: 1.3, delay: 0.9 },
  { d: owlBolt([224, 138], [252, 190], [200, 238], 41), dur: 2.1, delay: 0.3 },
  { d: owlBolt([86, 254], [128, 266], [178, 250], 53, 5), dur: 1.7, delay: 1.2 },
  { d: owlBolt([16, 70], [4, 110], [22, 140], 67, 6, 6), dur: 2.5, delay: 0.75 },
];

/** Short arcs crawling over the plumage (clipped to the silhouette). */
export const OWL_LIGHTNING_CRAWL: { d: string; dur: number; delay: number }[] = [
  { d: owlBolt([62, 120], [90, 170], [80, 222], 71, 6, 7), dur: 2.4, delay: 0.5 },
  { d: owlBolt([120, 30], [100, 60], [70, 70], 83, 5, 6), dur: 2.9, delay: 1.6 },
];
