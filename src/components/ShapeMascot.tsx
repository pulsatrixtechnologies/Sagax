// The mascot shapes: a soft body in the bot's color with two small eyes, in
// thirteen shapes (shared/mascot-look.ts, shape-art.ts) and thirteen skins,
// four everyday and nine premium (skin-fx/shape-skins.tsx). Pure SVG and CSS.
// Small avatars draw a skin's still look (no filter, nothing moving), so the
// sidebar and the chat cost nothing; larger ones play its idle effect, its
// equip animation and its move effects. It blinks, breathes, looks up while
// thinking and bounces while working; reduced motion keeps it still. The
// desktop mascot draws the same component and moves it itself.
import "./shape-mascot.css";
import { useId, useRef } from "react";
import { MAUS_COLORS } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { MASCOT_SHAPES, SHAPE_SKIN_TIER, SHAPE_SKINS, type MascotShape, type ShapeSkin, type SkinTier } from "../../shared/mascot-look";
import { EYES, SHAPE_ART } from "./shape-art";
import { shapeSkinBase, shapeSkinLayers, tint, type ShapeSkinBase } from "./skin-fx/shape-skins";
import { EquipFx, MoveFx } from "./skin-fx/SkinFx";
import { fxDetail, fxPalette, useEquipBurst, useFxVisibility, useMoveBurst, useReducedMotion, useReplayMove, type FxDetail, type FxMoveRequest } from "./skin-fx/skin-fx";

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
  /** The skin's full effects or its cheap still look; by default full when animated and large enough (FX_FULL_MIN). */
  detail?: FxDetail;
  /** A one-shot move to show: its effect (and, with moveBody, the body's own motion). */
  move?: FxMoveRequest | null;
  /** The body plays the move itself (app avatars); the desktop mascot moves the body on its own. */
  moveBody?: boolean;
  label?: string | null;
  className?: string;
}

const hexOf = (color: string) => (MAUS_COLORS as Record<string, string>)[color] ?? (/^#[0-9a-fA-F]{6}$/.test(color) ? color : MAUS_COLORS.green);

export { tint };

/** How a skin paints a shape: its base fill, outline, eyes, tier and effect family. */
export function shapeSkinPaint(skin: ShapeSkin, hex: string): ShapeSkinBase & { tier: SkinTier } {
  const known = SHAPE_SKINS.includes(skin) ? skin : "plain";
  return { ...shapeSkinBase(known, hex), tier: SHAPE_SKIN_TIER[known] };
}

export function ShapeMascot({ shape = "circle", skin = "plain", color, size = 44, mood = "idle", animated = true, detail, move, moveBody = false, label = null, className }: ShapeMascotProps) {
  const art = SHAPE_ART[MASCOT_SHAPES.includes(shape) ? shape : "circle"];
  const known: ShapeSkin = SHAPE_SKINS.includes(skin) ? skin : "plain";
  const hex = hexOf(color);
  const paint = shapeSkinPaint(known, hex);
  const reduced = useReducedMotion();
  const full = fxDetail(size, animated, detail) === "full";
  const live = full && !reduced;
  const uid = `shape-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const layers = shapeSkinLayers(known, art.d, hex, uid, full);
  const root = useRef<HTMLSpanElement>(null);
  useFxVisibility(root, live);
  const equip = useEquipBurst(known, live);
  const burst = useMoveBurst(move, live);
  const body = useRef<SVGSVGElement>(null);
  useReplayMove(body, burst && moveBody ? burst.key : null);
  const look = mood === "thinking" ? -3 : 0;
  const palette = fxPalette(paint.fx, hex);
  return (
    <span
      ref={root}
      className={cn("shape-mascot relative inline-flex shrink-0", animated && `shape-mascot-live shape-mood-${mood}`, live && "skin-fx-live", className)}
      style={{ width: size, height: size }}
      data-shape={shape}
      data-shape-skin={known}
      data-skin-tier={paint.tier}
      data-fx={full ? "full" : "static"}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        ref={body}
        className={cn(burst && moveBody && `fx-body-move fx-body-${burst.move}`, equip && "fx-equip-pop")}
        style={{ overflow: "visible", display: "block" }}
      >
        <defs>
          <clipPath id={`${uid}-body`}>
            <path d={art.d} />
          </clipPath>
          {paint.shine && (
            <radialGradient id={`${uid}-shine`} cx="0.32" cy="0.26" r="0.75">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
              <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.08" />
              <stop offset="1" stopColor="#000000" stopOpacity="0.18" />
            </radialGradient>
          )}
          {layers.defs}
        </defs>
        {layers.under}
        <g className="shape-body">
          <path
            d={art.d}
            fill={layers.fill}
            stroke={!layers.ownEdge && paint.stroke ? paint.stroke : undefined}
            strokeWidth={!layers.ownEdge && paint.stroke ? paint.strokeWidth : undefined}
            strokeLinejoin="round"
          />
          {paint.shine && <path d={art.d} fill={`url(#${uid}-shine)`} />}
          {layers.inner && <g clipPath={`url(#${uid}-body)`}>{layers.inner}</g>}
          {layers.edge}
          <ShapeEyes face={art.face} color={paint.eyes} mood={mood} look={look} />
        </g>
        {layers.around && <g className="skin-fx-around">{layers.around}</g>}
      </svg>
      {equip && <EquipFx key={equip} palette={palette} uid={`${uid}-eq`} />}
      {burst && <MoveFx key={burst.key} move={burst.move} palette={palette} uid={`${uid}-mv`} path={art.d} />}
    </span>
  );
}
