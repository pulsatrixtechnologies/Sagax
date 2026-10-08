// The mascot shapes (clean room, 2026-10-08): one soft body in eight shapes
// (shared/mascot-look.ts, shape-art.ts) with two rounded eyes cut through it,
// shaded like clay by default, in thirteen skins (Plain is the clay finish) (skin-fx/shape-skins.tsx).
// shape-engine.ts moves it: the gaze wanders, the body drifts and breathes,
// the eyes blink, the face turns toward the pointer, changes of shape, face
// and color slide, and the fourteen moves (SHAPE_MOVES) play on request.
// Small avatars and thumbnails draw the still pose (nothing moving, no
// filter), so the sidebar and the chat cost nothing; reduced motion keeps
// every size still and plays no move. The desktop mascot draws the same
// component and moves the whole drawing itself.
import "./shape-mascot.css";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { MAUS_COLORS } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { MASCOT_SHAPES, SHAPE_SKIN_TIER, SHAPE_SKINS, type MascotShape, type ShapeSkin, type SkinTier } from "../../shared/mascot-look";
import { SHAPE_ART } from "./shape-art";
import { clayStops, isShapeMove, mixHex, rainbowStops, ShapeEngine, stillFrame, type ShapeExpression, type ShapeFrame } from "./shape-engine";
import { shapeSkinBase, shapeSkinLayers, tint, type ShapeSkinBase, type ShapeSkinLayers } from "./skin-fx/shape-skins";
import { EquipFx, MoveFx } from "./skin-fx/SkinFx";
import { fxDetail, fxPalette, useEquipBurst, useFxVisibility, useMoveBurst, useReducedMotion, useReplayMove, type FxDetail, type FxMoveRequest } from "./skin-fx/skin-fx";

export { SHAPE_ART, EYES } from "./shape-art";

export type ShapeMood = "idle" | "thinking" | "working" | "happy" | "sleeping";

/** The face a mood wears. */
export function expressionForMood(mood: ShapeMood): ShapeExpression {
  switch (mood) {
    case "thinking":
      return "curious";
    case "working":
      return "attentive";
    case "happy":
      return "happy";
    case "sleeping":
      return "sleepy";
    default:
      return "neutral";
  }
}

export interface ShapeMascotProps {
  shape?: MascotShape;
  skin?: ShapeSkin;
  /** A bot color name (green) or any hex. */
  color: string;
  size?: number;
  mood?: ShapeMood;
  /** A face of its own, over the mood's. */
  expression?: ShapeExpression;
  /** Off draws a still frame (thumbnails, reduced motion). */
  animated?: boolean;
  /** The skin's full effects or its cheap still look; by default full when animated and large enough (FX_FULL_MIN). */
  detail?: FxDetail;
  /** A one-shot move to show: one of the fourteen Shapes moves, or a skin effect's move (wave, dance...). */
  move?: FxMoveRequest | null;
  /** The body plays a skin move itself (app avatars); the desktop mascot moves the body on its own. */
  moveBody?: boolean;
  /** The face turns toward the pointer (on by default while live). */
  trackPointer?: boolean;
  label?: string | null;
  className?: string;
}

const hexOf = (color: string) => (MAUS_COLORS as Record<string, string>)[color] ?? (/^#[0-9a-fA-F]{6}$/.test(color) ? color : MAUS_COLORS.green);

export { tint };

/** How a skin paints a shape: its base fill, outline, tier and effect family. Plain is the clay finish. */
export function shapeSkinPaint(skin: ShapeSkin, hex: string): ShapeSkinBase & { tier: SkinTier } {
  const known = SHAPE_SKINS.includes(skin) ? skin : "plain";
  return { ...shapeSkinBase(known, hex), tier: SHAPE_SKIN_TIER[known] };
}

/** Whether a shape runs its live loop (gaze, breath, blinks, moves): full detail, and never under reduced motion. */
export function shapeIsLive(size: number, animated: boolean, detail: FxDetail | undefined, reduced: boolean): boolean {
  return fxDetail(size, animated, detail) === "full" && !reduced;
}

const seconds = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

/**
 * One frame of a shape, as SVG: the body with its eyes cut through it
 * (fill-rule evenodd, so the page shows through), its skin, and what a move
 * adds (dots, a badge, rings behind and in front, ribbons, specks).
 */
export function ShapeFrameSvg({ frame, uid, skin, paint, layers, bodyRef, bodyClass }: { frame: ShapeFrame; uid: string; skin: ShapeSkin; paint: ShapeSkinBase; layers: ShapeSkinLayers; bodyRef?: React.Ref<SVGSVGElement>; bodyClass?: string }) {
  const clay = skin === "plain";
  const fill = clay ? `url(#${uid}-clay)` : layers.fill;
  const cut = frame.body + frame.eyes;
  const settled = frame.morphed < 0.5;
  const dotFill = clay ? `url(#${uid}-dot)` : layers.fill.startsWith("url(") ? paint.fill : layers.fill;
  const rings = (side: "back" | "front"): ReactNode =>
    frame.rings.map((ring, i) =>
      ring[side] ? <path key={`${side}${i}`} d={ring[side]} fill="none" stroke={`url(#${uid}-ring${i})`} strokeWidth={ring.width} strokeLinecap="round" strokeLinejoin="round" opacity={ring.opacity} /> : null,
    );
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" ref={bodyRef} className={bodyClass} style={{ overflow: "visible", display: "block" }} data-eyes={frame.eyes ? "cut" : "none"}>
      <defs>
        <clipPath id={`${uid}-body`}>
          <path d={cut} clipRule="evenodd" />
        </clipPath>
        {clay && (
          <>
            <radialGradient id={`${uid}-clay`} gradientUnits="userSpaceOnUse" cx={frame.light.x} cy={frame.light.y} r={frame.light.r}>
              {clayStops(frame.color).map((stop) => (
                <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
              ))}
            </radialGradient>
            <radialGradient id={`${uid}-dot`} cx="0.36" cy="0.3" r="0.85">
              {clayStops(frame.color).map((stop) => (
                <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
              ))}
            </radialGradient>
          </>
        )}
        {paint.shine && (
          <radialGradient id={`${uid}-shine`} cx="0.32" cy="0.26" r="0.75">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.08" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.18" />
          </radialGradient>
        )}
        {[...frame.rings, ...frame.ribbons].map((line, i) => (
          <linearGradient key={i} id={`${uid}-ring${i}`} gradientUnits="userSpaceOnUse" x1={line.x1} y1={0} x2={line.x2} y2={0}>
            {rainbowStops(line.hue, line.hueSpan).map((color, k) => (
              <stop key={k} offset={k / 2} stopColor={color} />
            ))}
          </linearGradient>
        ))}
        {frame.badge && (
          <mask id={`${uid}-notch`} maskUnits="userSpaceOnUse" x={-60} y={-60} width={220} height={220}>
            <rect x={-60} y={-60} width={220} height={220} fill="#fff" />
            <circle cx={frame.badge.x} cy={frame.badge.y} r={frame.badge.r + frame.badge.notch} fill="#000" />
          </mask>
        )}
        {layers.defs}
      </defs>
      {rings("back")}
      {settled && layers.under}
      <g className="shape-body">
        <g transform={frame.transform} mask={frame.badge ? `url(#${uid}-notch)` : undefined}>
          <path
            className="shape-fill"
            d={cut}
            fillRule="evenodd"
            fill={fill}
            stroke={!layers.ownEdge && paint.stroke ? paint.stroke : undefined}
            strokeWidth={!layers.ownEdge && paint.stroke ? paint.strokeWidth : undefined}
            strokeLinejoin="round"
          />
          {paint.shine && <path d={cut} fillRule="evenodd" fill={`url(#${uid}-shine)`} />}
          {layers.inner && <g clipPath={`url(#${uid}-body)`}>{layers.inner}</g>}
          {settled && layers.edge}
          {frame.dots.map((dot, i) => (
            <circle key={i} cx={dot.x} cy={dot.y} r={dot.r} fill={dotFill} opacity={dot.opacity} />
          ))}
        </g>
        {frame.badge && <circle cx={frame.badge.x} cy={frame.badge.y} r={frame.badge.r} fill="#2a8fe8" />}
      </g>
      {frame.specks.map((speck, i) => (
        <circle key={i} cx={speck.x} cy={speck.y} r={speck.r} fill={mixHex(frame.color, "#0b0b0e", 0.62)} opacity={speck.opacity} />
      ))}
      {rings("front")}
      {frame.ribbons.map((ribbon, i) => (
        <path
          key={i}
          d={ribbon.d}
          fill="none"
          stroke={`url(#${uid}-ring${frame.rings.length + i})`}
          strokeWidth={ribbon.width}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={ribbon.dash >= 1 ? undefined : `${ribbon.dash} ${1 + ribbon.dash}`}
          strokeDashoffset={ribbon.dash >= 1 ? undefined : -ribbon.offset}
          opacity={ribbon.opacity}
        />
      ))}
      {settled && layers.around && <g className="skin-fx-around">{layers.around}</g>}
    </svg>
  );
}

/** The pointer around a box, -1..1 on each axis at about three box widths away. */
function pointerAround(box: DOMRect, x: number, y: number): { x: number; y: number } {
  const reach = Math.max(240, box.width * 3);
  return { x: (x - (box.left + box.width / 2)) / reach, y: (y - (box.top + box.height / 2)) / reach };
}

export function ShapeMascot({ shape = "circle", skin = "plain", color, size = 44, mood = "idle", expression, animated = true, detail, move, moveBody = false, trackPointer = true, label = null, className }: ShapeMascotProps) {
  const known: MascotShape = MASCOT_SHAPES.includes(shape) ? shape : "circle";
  const knownSkin: ShapeSkin = SHAPE_SKINS.includes(skin) ? skin : "plain";
  const hex = hexOf(color);
  const paint = shapeSkinPaint(knownSkin, hex);
  const reduced = useReducedMotion();
  const full = fxDetail(size, animated, detail) === "full";
  const live = shapeIsLive(size, animated, detail, reduced);
  const face = expression ?? expressionForMood(mood);
  const uid = `shape-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const layers = useMemo(() => shapeSkinLayers(knownSkin, SHAPE_ART[known].d, hex, uid, full), [knownSkin, known, hex, uid, full]);
  const root = useRef<HTMLSpanElement>(null);
  useFxVisibility(root, live);
  const equip = useEquipBurst(knownSkin, live);
  const shapeMove = isShapeMove(move?.clip) ? move : null;
  const burst = useMoveBurst(shapeMove ? null : move, live);
  const body = useRef<SVGSVGElement>(null);
  useReplayMove(body, burst && moveBody ? burst.key : null);

  const state = { shape: known, expression: face, color: hex };
  const still = useMemo(() => stillFrame({ shape: known, expression: face, color: hex }), [known, face, hex]);
  const engine = useRef<ShapeEngine | null>(null);
  const [frame, setFrame] = useState<ShapeFrame | null>(null);
  if (live && engine.current) engine.current.set(state, seconds());

  // the live loop: one frame per animation frame while on screen
  useEffect(() => {
    if (!live) {
      engine.current = null;
      setFrame(null);
      return;
    }
    const run = new ShapeEngine(state, seconds());
    engine.current = run;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || root.current?.hasAttribute("data-fx-paused")) return;
      setFrame(run.frame(seconds()));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // the engine follows shape, face and color itself (set above)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // a Shapes move plays once per request
  const lastMove = useRef(0);
  useEffect(() => {
    if (!live || !shapeMove || !engine.current || shapeMove.key === lastMove.current) return;
    lastMove.current = shapeMove.key;
    if (isShapeMove(shapeMove.clip)) engine.current.play(shapeMove.clip, seconds());
  }, [live, shapeMove]);

  // the face turns toward the pointer (a mouse or a pen; touch is ignored)
  useEffect(() => {
    if (!live || !trackPointer || typeof window === "undefined") return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !root.current) return;
      engine.current?.pointer(pointerAround(root.current.getBoundingClientRect(), event.clientX, event.clientY));
    };
    const onLeave = () => engine.current?.pointer(null);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, [live, trackPointer]);

  const shown = live && frame ? frame : still;
  const palette = fxPalette(paint.fx, hex);
  return (
    <span
      ref={root}
      className={cn("shape-mascot relative inline-flex shrink-0", animated && `shape-mascot-live shape-mood-${mood}`, live && "skin-fx-live", className)}
      style={{ width: size, height: size }}
      data-shape={known}
      data-shape-skin={knownSkin}
      data-skin-tier={paint.tier}
      data-expression={face}
      data-fx={full ? "full" : "static"}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      <ShapeFrameSvg
        frame={shown}
        uid={uid}
        skin={knownSkin}
        paint={paint}
        layers={layers}
        bodyRef={body}
        bodyClass={cn(burst && moveBody && `fx-body-move fx-body-${burst.move}`, equip && "fx-equip-pop")}
      />
      {equip && <EquipFx key={equip} palette={palette} uid={`${uid}-eq`} />}
      {burst && <MoveFx key={burst.key} move={burst.move} palette={palette} uid={`${uid}-mv`} path={SHAPE_ART[known].d} />}
    </span>
  );
}
