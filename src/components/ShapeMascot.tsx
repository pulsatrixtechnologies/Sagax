// The original mascot shapes: a soft body in the bot's color with two small
// eyes, in eight shapes (shared/mascot-look.ts) and six skins. Pure SVG and
// CSS, so it costs nothing in the sidebar and the chat. It blinks, breathes,
// looks up while thinking and bounces while working; reduced motion keeps it
// still. The desktop mascot draws the same shapes and moves them itself.
import "./shape-mascot.css";
import { useId } from "react";
import { MAUS_COLORS } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { MASCOT_SHAPES, SHAPE_SKINS, type MascotShape, type ShapeSkin } from "../../shared/mascot-look";

/** Each shape's outline (viewBox 0 0 100 100) and where its eyes sit. */
export const SHAPE_ART: Record<MascotShape, { d: string; eyes: [number, number]; gap: number }> = {
  circle: { d: "M50 8a42 42 0 1 1 0 84a42 42 0 1 1 0-84z", eyes: [50, 52], gap: 11 },
  // a bean, a little tilted, its bump to the left
  blob: { d: "M30 22C40 10 62 8 76 18C90 28 94 50 86 66C78 82 58 92 40 88C22 84 8 70 10 54C11 46 17 42 22 38C26 34 24 28 30 22z", eyes: [54, 50], gap: 11 },
  squircle: { d: "M30 10H70C82 10 90 18 90 30V70C90 82 82 90 70 90H30C18 90 10 82 10 70V30C10 18 18 10 30 10z", eyes: [50, 52], gap: 12 },
  pill: { d: "M30 26H70C83 26 94 37 94 50C94 63 83 74 70 74H30C17 74 6 63 6 50C6 37 17 26 30 26z", eyes: [50, 50], gap: 12 },
  triangle: { d: "M44 14C47 9 53 9 56 14L91 76C94 82 90 88 84 88H16C10 88 6 82 9 76z", eyes: [50, 64], gap: 10 },
  hexagon: { d: "M44 9C48 7 52 7 56 9L84 25C88 27 90 31 90 35V65C90 69 88 73 84 75L56 91C52 93 48 93 44 91L16 75C12 73 10 69 10 65V35C10 31 12 27 16 25z", eyes: [50, 52], gap: 12 },
  // three lobes on a flat base
  cloud: { d: "M24 82C13 82 6 74 6 64C6 54 13 47 22 46C22 32 33 22 46 22C55 22 63 27 67 35C70 33 74 32 78 32C88 32 96 41 95 52C94 60 90 66 84 68C88 72 86 82 78 82z", eyes: [50, 58], gap: 12 },
  // a teardrop, point up
  drop: { d: "M50 6C58 22 82 42 82 62C82 80 68 92 50 92C32 92 18 80 18 62C18 42 42 22 50 6z", eyes: [50, 62], gap: 11 },
};

export type ShapeMood = "idle" | "thinking" | "working" | "happy" | "sleeping";

export interface ShapeMascotProps {
  shape?: MascotShape;
  skin?: ShapeSkin;
  /** A bot color name (green) or any hex. */
  color: string;
  size?: number;
  mood?: ShapeMood;
  /** Off draws a still frame (thumbnails, reduced motion). */
  animated?: boolean;
  label?: string | null;
  className?: string;
}

const hexOf = (color: string) => (MAUS_COLORS as Record<string, string>)[color] ?? (/^#[0-9a-fA-F]{6}$/.test(color) ? color : MAUS_COLORS.green);

/** Mixes a hex color toward white (amount 0..1). */
export function tint(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, "0")).join("")}`;
}

/** How a skin paints a shape: its fill, its outline, its eyes, and an optional glow or shine. */
export function shapeSkinPaint(skin: ShapeSkin, hex: string): { fill: string; stroke: string | null; strokeWidth: number; eyes: string; glow: string | null; shine: boolean } {
  switch (skin) {
    case "glossy":
      return { fill: hex, stroke: null, strokeWidth: 0, eyes: "#1b1f27", glow: null, shine: true };
    case "outline":
      return { fill: tint(hex, 0.92), stroke: hex, strokeWidth: 6, eyes: "#1b1f27", glow: null, shine: false };
    case "neon":
      return { fill: "#14161c", stroke: tint(hex, 0.15), strokeWidth: 4, eyes: tint(hex, 0.35), glow: tint(hex, 0.1), shine: false };
    case "pastel":
      return { fill: tint(hex, 0.55), stroke: null, strokeWidth: 0, eyes: "#3a3f4b", glow: null, shine: false };
    case "night":
      return { fill: "#1c2236", stroke: hex, strokeWidth: 2.5, eyes: "#f6f1e8", glow: null, shine: false };
    default:
      return { fill: hex, stroke: null, strokeWidth: 0, eyes: "#1b1f27", glow: null, shine: false };
  }
}

export function ShapeMascot({ shape = "circle", skin = "plain", color, size = 44, mood = "idle", animated = true, label = null, className }: ShapeMascotProps) {
  const art = SHAPE_ART[MASCOT_SHAPES.includes(shape) ? shape : "circle"];
  const paint = shapeSkinPaint(SHAPE_SKINS.includes(skin) ? skin : "plain", hexOf(color));
  const uid = `shape-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [ex, ey] = art.eyes;
  const look = mood === "thinking" ? -4 : mood === "sleeping" ? 2 : 0;
  const eye = (x: number) =>
    mood === "sleeping" ? (
      <path key={x} d={`M${x - 4} ${ey + 1}q4 3 8 0`} fill="none" stroke={paint.eyes} strokeWidth={2.2} strokeLinecap="round" />
    ) : mood === "happy" ? (
      <path key={x} d={`M${x - 4} ${ey + 1}q4 -4 8 0`} fill="none" stroke={paint.eyes} strokeWidth={2.4} strokeLinecap="round" />
    ) : (
      <ellipse key={x} className="shape-eye" cx={x} cy={ey + look} rx={3.6} ry={4.6} fill={paint.eyes} />
    );
  return (
    <span
      className={cn("shape-mascot inline-flex shrink-0", animated && `shape-mascot-live shape-mood-${mood}`, className)}
      style={{ width: size, height: size }}
      data-shape={shape}
      data-shape-skin={skin}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} style={{ overflow: "visible", display: "block" }}>
        <defs>
          {paint.shine && (
            <radialGradient id={`${uid}-shine`} cx="0.32" cy="0.26" r="0.75">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
              <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.08" />
              <stop offset="1" stopColor="#000000" stopOpacity="0.18" />
            </radialGradient>
          )}
          {paint.glow && (
            <filter id={`${uid}-glow`} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2.4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          )}
        </defs>
        <g className="shape-body">
          <path
            d={art.d}
            fill={paint.fill}
            stroke={paint.stroke ?? undefined}
            strokeWidth={paint.stroke ? paint.strokeWidth : undefined}
            strokeLinejoin="round"
            filter={paint.glow ? `url(#${uid}-glow)` : undefined}
          />
          {paint.shine && <path d={art.d} fill={`url(#${uid}-shine)`} />}
          <g className="shape-eyes">
            {eye(ex - art.gap / 2 - 4)}
            {eye(ex + art.gap / 2 + 4)}
          </g>
        </g>
      </svg>
    </span>
  );
}
