// Frog, the smug sad frog (an original character, frog-art.ts: direction C,
// "aplat net"), its skin a tint of the bot's color or a frog of its own, with
// a Frog skin (skin-fx/frog-skins.tsx). Pure SVG: every part is its own group
// (the legs, the body, the head, the throat, each eye, the mouth) that moves
// about its pivot. Small avatars draw a skin's still look (no filter, nothing
// moving) and the bust under 48 px; larger ones breathe with the throat,
// blink one eye then the other in CSS (frog-mascot.css) and play a skin's
// idle effect, equip animation and move effects. Reduced motion keeps it
// still.
import "./frog-mascot.css";
import "./skin-fx/skin-fx.css";
import { memo, useId, useMemo, useRef, type ReactNode, type Ref } from "react";
import { MAUS_COLORS } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { FROG_SKIN_TIER, type FrogSkin } from "../../shared/mascot-look";
import { FROG_ART, FROG_PIVOTS, frogOutline, frogParts, frogThroatOps, frogViewBox, type FrogExpression, type FrogMouth, type FrogOp, type FrogPalette } from "./frog-art";
import { frogSkinId, frogSkinLayers, frogSkinPaint } from "./skin-fx/frog-skins";
import { EquipFx, MoveFx } from "./skin-fx/SkinFx";
import { fxDetail, fxPalette, useEquipBurst, useFxVisibility, useMoveBurst, useReducedMotion, useReplayMove, type FxDetail, type FxMoveRequest } from "./skin-fx/skin-fx";

export type FrogMood = "idle" | "thinking" | "working" | "happy" | "sleeping" | "listening" | "speaking";

/** The face a mood wears (the five approved moods, and the call's listening and speaking). */
export function frogExpressionForMood(mood: FrogMood): FrogExpression {
  switch (mood) {
    case "thinking":
      return "curious";
    case "working":
      return "attentive";
    case "happy":
      return "happy";
    case "sleeping":
      return "sleepy";
    case "listening":
      return "attentive";
    case "speaking":
      return "excited";
    default:
      return "neutral";
  }
}

export interface FrogMascotProps {
  skin?: FrogSkin | string;
  /** A bot color name (green) or any hex. */
  color: string;
  size?: number;
  mood?: FrogMood;
  /** A face of its own, over the mood's (one of the sixteen). */
  expression?: FrogExpression;
  /** Off draws a still frame (thumbnails, reduced motion). */
  animated?: boolean;
  detail?: FxDetail;
  /** A one-shot move: its skin effect, and with moveBody the body's own motion. */
  move?: FxMoveRequest | null;
  moveBody?: boolean;
  label?: string | null;
  className?: string;
}

export const frogHexOf = (color: string) => (MAUS_COLORS as Record<string, string>)[color] ?? (/^#[0-9a-fA-F]{6}$/.test(color) ? color : MAUS_COLORS.green);

/** Ops as SVG elements with a palette; `uid` keeps clip ids apart. */
export function FrogOpsSvg({ ops, palette, uid }: { ops: readonly FrogOp[]; palette: FrogPalette; uid: string }) {
  return (
    <>
      {ops.map((op, i) => {
        const path = (
          <path
            key={op.clip ? undefined : i}
            d={op.d}
            fill={op.fill ? palette[op.fill] : "none"}
            stroke={op.stroke ? palette[op.stroke] : undefined}
            strokeWidth={op.stroke ? op.width : undefined}
            strokeLinejoin={op.stroke ? "round" : undefined}
            strokeLinecap={op.stroke && op.round ? "round" : undefined}
            opacity={op.opacity}
          />
        );
        if (!op.clip) return path;
        const id = `${uid}-c${i}`;
        return (
          <g key={i}>
            <clipPath id={id}>
              <path d={op.clip} />
            </clipPath>
            <g clipPath={`url(#${id})`}>{path}</g>
          </g>
        );
      })}
    </>
  );
}

const Ops = memo(FrogOpsSvg);

/** The refs the live rig (frog-moves.ts) moves or redraws: one group per moving part. */
export interface FrogRigRefs {
  whole: Ref<SVGGElement>;
  head: Ref<SVGGElement>;
  /** Redrawn by the rig: the legs behind, the haunches over the body, the throat, the eyes, the mouth, the tongue, the fly, the pad and the water. */
  legs: Ref<SVGGElement>;
  haunches: Ref<SVGGElement>;
  throat: Ref<SVGGElement>;
  eyeL: Ref<SVGGElement>;
  eyeR: Ref<SVGGElement>;
  mouth: Ref<SVGGElement>;
  tongue: Ref<SVGGElement>;
  fly: Ref<SVGGElement>;
  pad: Ref<SVGGElement>;
  water: Ref<SVGGElement>;
}

const pivot = ([x, y]: readonly [number, number]) => ({ transformOrigin: `${x}px ${y}px` });

export interface FrogDrawingProps {
  uid: string;
  palette: FrogPalette;
  skin: FrogSkin;
  hex: string;
  size: number;
  expression: FrogExpression;
  mouth?: FrogMouth | null;
  full: boolean;
  rig?: FrogRigRefs;
  svgRef?: Ref<SVGSVGElement>;
  svgClass?: string;
  defs?: ReactNode;
}

/** The throat sac's top: it grows from under the lips. */
const THROAT_TOP: readonly [number, number] = [FROG_ART.throat.x, FROG_ART.throat.y - FROG_ART.throat.ry];

/**
 * One drawing of Frog: the parts in their groups, the skin's treatment on the
 * head and the body. The rig, when given, moves and redraws the groups;
 * otherwise CSS does (the idle loops) or nothing does (still).
 */
export function FrogDrawing({ uid, palette, skin, hex, size, expression, mouth = null, full, rig, svgRef, svgClass, defs }: FrogDrawingProps) {
  const parts = useMemo(() => frogParts({ expression, mouth, size }), [expression, mouth, size]);
  const ow = frogOutline(size);
  const throat = useMemo(() => frogThroatOps(1, ow), [ow]);
  const headFx = useMemo(() => frogSkinLayers(skin, FROG_ART.head, hex, `${uid}-hf`, full), [skin, hex, uid, full]);
  const bodyFx = useMemo(() => frogSkinLayers(skin, FROG_ART.body, hex, `${uid}-bf`, full), [skin, hex, uid, full]);
  const clipped = (id: string, d: string, layer: ReactNode) =>
    layer ? (
      <g>
        <clipPath id={id}>
          <path d={d} />
        </clipPath>
        <g clipPath={`url(#${id})`}>{layer}</g>
      </g>
    ) : null;
  return (
    <svg viewBox={frogViewBox(size)} width="100%" height="100%" ref={svgRef} className={svgClass} style={{ overflow: "visible", display: "block" }}>
      {(defs || headFx?.defs || bodyFx?.defs) && (
        <defs>
          {defs}
          {headFx?.defs}
          {bodyFx?.defs}
        </defs>
      )}
      {rig && <g ref={rig.pad} className="frog-pad" />}
      <g ref={rig?.whole} className="frog-whole" style={pivot(FROG_PIVOTS.ground)}>
        {bodyFx?.under}
        {rig && <g ref={rig.legs} className="frog-legs" />}
        <g className="frog-body">
          <Ops ops={parts.body} palette={palette} uid={`${uid}-b`} />
          {clipped(`${uid}-bclip`, FROG_ART.body, bodyFx?.inner)}
          {bodyFx?.edge}
        </g>
        {rig && <g ref={rig.haunches} className="frog-haunches" />}
        <g ref={rig?.head} className="frog-head" style={pivot(FROG_PIVOTS.neck)}>
          {headFx?.under}
          <Ops ops={parts.head} palette={palette} uid={`${uid}-h`} />
          {clipped(`${uid}-hclip`, FROG_ART.head, headFx?.inner)}
          {headFx?.edge}
          <g ref={rig?.throat} className="frog-throat" style={{ ...pivot(THROAT_TOP), transform: rig ? undefined : "scale(0)" }}>
            {!rig && <Ops ops={throat} palette={palette} uid={`${uid}-th`} />}
          </g>
          <g className="frog-face">
            <g className="frog-brows">
              <Ops ops={parts.brows} palette={palette} uid={`${uid}-br`} />
            </g>
            <g ref={rig?.eyeL} className="frog-eye frog-eye-l" style={pivot(FROG_PIVOTS.eyeL)}>
              <Ops ops={parts.eyeL} palette={palette} uid={`${uid}-yl`} />
            </g>
            <g ref={rig?.eyeR} className="frog-eye frog-eye-r" style={pivot(FROG_PIVOTS.eyeR)}>
              <Ops ops={parts.eyeR} palette={palette} uid={`${uid}-yr`} />
            </g>
            <Ops ops={parts.nose} palette={palette} uid={`${uid}-n`} />
            <g ref={rig?.mouth} className="frog-mouth" style={pivot(FROG_PIVOTS.mouth)}>
              <Ops ops={parts.mouth} palette={palette} uid={`${uid}-m`} />
            </g>
            {rig && <g ref={rig.tongue} className="frog-tongue" />}
            <Ops ops={parts.extras} palette={palette} uid={`${uid}-x`} />
          </g>
        </g>
      </g>
      {rig && <g ref={rig.fly} className="frog-fly" />}
      {rig && <g ref={rig.water} className="frog-water" />}
      {headFx?.around && <g className="skin-fx-around">{headFx.around}</g>}
    </svg>
  );
}

export function FrogMascot({ skin = "plain", color, size = 44, mood = "idle", expression, animated = true, detail, move, moveBody = false, label = null, className }: FrogMascotProps) {
  const known = frogSkinId(skin);
  const hex = frogHexOf(color);
  const reduced = useReducedMotion();
  const full = fxDetail(size, animated, detail) === "full";
  const live = full && !reduced;
  const uid = `frog-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const paint = useMemo(() => frogSkinPaint(known, hex, uid), [known, hex, uid]);
  const root = useRef<HTMLSpanElement>(null);
  useFxVisibility(root, live);
  const equip = useEquipBurst(known, live);
  const burst = useMoveBurst(move, live);
  const body = useRef<SVGSVGElement>(null);
  useReplayMove(body, burst && moveBody ? burst.key : null);
  const face = expression ?? frogExpressionForMood(mood);
  const palette = fxPalette(paint.fx, hex);
  return (
    <span
      ref={root}
      className={cn("frog-mascot relative inline-flex shrink-0", animated && `frog-live frog-mood-${mood}`, live && "skin-fx-live", className)}
      style={{ width: size, height: size }}
      data-character="frog"
      data-frog-skin={known}
      data-skin-tier={FROG_SKIN_TIER[known]}
      data-expression={face}
      data-fx={full ? "full" : "static"}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      <FrogDrawing
        uid={uid}
        palette={paint.palette}
        skin={known}
        hex={hex}
        size={size}
        expression={face}
        full={full}
        svgRef={body}
        svgClass={cn(burst && moveBody && `fx-body-move fx-body-${burst.move}`, equip && "fx-equip-pop", full && paint.bodyClass)}
        defs={paint.defs}
      />
      {equip && <EquipFx key={equip} palette={palette} uid={`${uid}-eq`} />}
      {burst && <MoveFx key={burst.key} move={burst.move} palette={palette} uid={`${uid}-mv`} path={FROG_ART.head} />}
    </span>
  );
}
