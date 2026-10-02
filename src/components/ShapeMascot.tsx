// The original mascot shapes: a soft body in the bot's color with two small
// eyes, in thirteen shapes (shared/mascot-look.ts, shape-art.ts) and six skins. Pure SVG and
// CSS, so it costs nothing in the sidebar and the chat. It blinks, breathes,
// looks up while thinking and bounces while working; reduced motion keeps it
// still. The desktop mascot draws the same shapes and moves them itself.
import "./shape-mascot.css";
import { useId } from "react";
import { MAUS_COLORS } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { MASCOT_SHAPES, SHAPE_SKINS, type MascotShape, type ShapeSkin } from "../../shared/mascot-look";
import { EYES, SHAPE_ART } from "./shape-art";

export { SHAPE_ART, EYES } from "./shape-art";

/**
 * The one face every shape wears (EYES, shape-art.ts): the same two slanted
 * ovals on every shape, placed at the shape's face anchor. Sleeping and
 * happy eyes are the same strokes on every shape too.
 */
export function ShapeEyes({ face, color, mood, look }: { face: [number, number]; color: string; mood: ShapeMood; look: number }) {
  const eye = ([dx, dy]: readonly [number, number], key: string) => {
    const x = face[0] + dx;
    const y = face[1] + dy;
    const transform = `rotate(${EYES.tilt} ${x} ${y})`;
    if (mood === "sleeping") return <path key={key} d={`M${x - 5.5} ${y + 1}q5.5 4.6 11 0`} transform={transform} fill="none" stroke={color} strokeWidth={3.2} strokeLinecap="round" />;
    if (mood === "happy") return <path key={key} d={`M${x - 5.5} ${y + 2}q5.5 -6 11 0`} transform={transform} fill="none" stroke={color} strokeWidth={3.4} strokeLinecap="round" />;
    return <ellipse key={key} className="shape-eye" cx={x} cy={y + look} rx={EYES.rx} ry={EYES.ry} transform={transform} fill={color} />;
  };
  return (
    <g className="shape-eyes">
      {eye(EYES.left, "l")}
      {eye(EYES.right, "r")}
    </g>
  );
}

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
  const look = mood === "thinking" ? -3 : 0;
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
          <ShapeEyes face={art.face} color={paint.eyes} mood={mood} look={look} />
        </g>
      </svg>
    </span>
  );
}
