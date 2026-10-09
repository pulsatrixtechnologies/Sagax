// Shiba, the dog (an original character, shiba-art.ts: direction C, "aplat
// net"), in the bot's color or a coat of its own and a Shiba skin
// (skin-fx/shiba-skins.tsx). Pure SVG: every part is its own group (the
// tail, the legs, the body, the ears, the head, the eyes, the mouth) that
// turns about its pivot. Small avatars draw a skin's still look (no filter,
// nothing moving) and the bust under 48 px; larger ones breathe, blink, wag
// and twitch an ear in CSS (shiba-mascot.css) and play a skin's idle effect,
// equip animation and move effects. Reduced motion keeps it still.
import "./shiba-mascot.css";
import "./skin-fx/skin-fx.css";
import { memo, useId, useMemo, useRef, type ReactNode, type Ref } from "react";
import { MAUS_COLORS } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { SHIBA_SKIN_TIER, type ShibaSkin } from "../../shared/mascot-look";
import {
  SHIBA_ART,
  SHIBA_HIPS,
  SHIBA_LEGS,
  SHIBA_PIVOTS,
  shibaOutline,
  shibaParts,
  shibaViewBox,
  STANCE_HEAD,
  legOps,
  type MouthKind,
  type ShibaExpression,
  type ShibaLeg,
  type ShibaOp,
  type ShibaPalette,
  type ShibaStance,
} from "./shiba-art";
import { shibaSkinId, shibaSkinLayers, shibaSkinPaint } from "./skin-fx/shiba-skins";
import { EquipFx, MoveFx } from "./skin-fx/SkinFx";
import { fxDetail, fxPalette, useEquipBurst, useFxVisibility, useMoveBurst, useReducedMotion, useReplayMove, type FxDetail, type FxMoveRequest } from "./skin-fx/skin-fx";

export type ShibaMood = "idle" | "thinking" | "working" | "happy" | "sleeping" | "listening" | "speaking";

/** The face a mood wears (the five v3 moods, and the call's listening and speaking). */
export function shibaExpressionForMood(mood: ShibaMood): ShibaExpression {
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

export interface ShibaMascotProps {
  skin?: ShibaSkin | string;
  /** A bot color name (orange) or any hex. */
  color: string;
  size?: number;
  mood?: ShibaMood;
  /** A face of its own, over the mood's (one of the sixteen). */
  expression?: ShibaExpression;
  /** Off draws a still frame (thumbnails, reduced motion). */
  animated?: boolean;
  detail?: FxDetail;
  /** A one-shot move: its skin effect, and with moveBody the body's own motion. */
  move?: FxMoveRequest | null;
  moveBody?: boolean;
  label?: string | null;
  className?: string;
}

export const hexOf = (color: string) => (MAUS_COLORS as Record<string, string>)[color] ?? (/^#[0-9a-fA-F]{6}$/.test(color) ? color : MAUS_COLORS.orange);

/** Ops as SVG elements with a palette; `uid` keeps clip ids apart. */
export function OpsSvg({ ops, palette, uid }: { ops: readonly ShibaOp[]; palette: ShibaPalette; uid: string }) {
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

const Ops = memo(OpsSvg);

/** The refs the live rig (shiba-moves.ts) moves: one group per moving part. */
export interface ShibaRigRefs {
  whole: Ref<SVGGElement>;
  tail: Ref<SVGGElement>;
  head: Ref<SVGGElement>;
  earL: Ref<SVGGElement>;
  earR: Ref<SVGGElement>;
  brows: Ref<SVGGElement>;
  eyeL: Ref<SVGGElement>;
  eyeR: Ref<SVGGElement>;
  mouth: Ref<SVGGElement>;
  legs: Partial<Record<ShibaLeg, Ref<SVGGElement>>>;
}

const pivot = ([x, y]: readonly [number, number]) => ({ transformOrigin: `${x}px ${y}px` });

export interface ShibaDrawingProps {
  uid: string;
  palette: ShibaPalette;
  skin: ShibaSkin;
  hex: string;
  size: number;
  expression: ShibaExpression;
  mouth?: MouthKind | null;
  stance?: ShibaStance;
  full: boolean;
  rig?: ShibaRigRefs;
  svgRef?: Ref<SVGSVGElement>;
  svgClass?: string;
  defs?: ReactNode;
}

/**
 * One drawing of Shiba: the parts in their groups, the skin's treatment on
 * the head and the body. The rig, when given, moves the groups; otherwise
 * CSS does (the idle loops) or nothing does (still).
 */
export function ShibaDrawing({ uid, palette, skin, hex, size, expression, mouth = null, stance = "sit", full, rig, svgRef, svgClass, defs }: ShibaDrawingProps) {
  const parts = useMemo(() => shibaParts({ expression, mouth, stance, size }), [expression, mouth, stance, size]);
  const ow = shibaOutline(size);
  const bodyPath = stance === "stand" ? SHIBA_ART.standBody : stance === "lie" ? SHIBA_ART.lieBody : SHIBA_ART.body;
  const headFx = useMemo(() => shibaSkinLayers(skin, SHIBA_ART.head, hex, `${uid}-hf`, full, "head"), [skin, hex, uid, full]);
  const bodyFx = useMemo(() => shibaSkinLayers(skin, bodyPath, hex, `${uid}-bf`, full), [skin, bodyPath, hex, uid, full]);
  const head = STANCE_HEAD[stance];
  const [nx, ny] = SHIBA_PIVOTS.neck;
  const headPlace = head.scale === 1 && !head.x && !head.y ? undefined : `translate(${head.x} ${head.y}) translate(${nx} ${ny}) scale(${head.scale}) translate(${-nx} ${-ny})`;
  const tailPivot = stance === "stand" ? SHIBA_PIVOTS.standTail : stance === "lie" ? SHIBA_PIVOTS.lieTail : SHIBA_PIVOTS.tail;
  const legs = (side: "Far" | "Near") =>
    stance === "stand"
      ? SHIBA_LEGS.filter((leg) => leg.endsWith(side)).map((leg) => (
          <g key={leg} ref={rig?.legs[leg]} className={`shiba-leg shiba-leg-${leg}`} style={pivot(SHIBA_HIPS[leg])}>
            <Ops ops={legOps(leg, 0, 0, ow)} palette={palette} uid={`${uid}-${leg}`} />
          </g>
        ))
      : null;
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
    <svg viewBox={shibaViewBox(size)} width="100%" height="100%" ref={svgRef} className={svgClass} style={{ overflow: "visible", display: "block" }} data-stance={stance}>
      {(defs || headFx?.defs || bodyFx?.defs) && (
        <defs>
          {defs}
          {headFx?.defs}
          {bodyFx?.defs}
        </defs>
      )}
      <g ref={rig?.whole} className="shiba-whole" style={pivot(SHIBA_PIVOTS.ground)}>
        {bodyFx?.under}
        <g ref={rig?.tail} className="shiba-tail" style={pivot(tailPivot)}>
          <Ops ops={parts.tail} palette={palette} uid={`${uid}-t`} />
        </g>
        {legs("Far")}
        <g className="shiba-body">
          <Ops ops={parts.body} palette={palette} uid={`${uid}-b`} />
          {clipped(`${uid}-bclip`, bodyPath, bodyFx?.inner)}
          {bodyFx?.edge}
        </g>
        {legs("Near")}
        <g transform={headPlace}>
          <g ref={rig?.head} className="shiba-head" style={pivot(SHIBA_PIVOTS.neck)}>
            {headFx?.under}
            <g ref={rig?.earL} className="shiba-ear shiba-ear-l" style={pivot(SHIBA_PIVOTS.earL)}>
              <Ops ops={parts.earL} palette={palette} uid={`${uid}-el`} />
            </g>
            <g ref={rig?.earR} className="shiba-ear shiba-ear-r" style={pivot(SHIBA_PIVOTS.earR)}>
              <Ops ops={parts.earR} palette={palette} uid={`${uid}-er`} />
            </g>
            <Ops ops={parts.head} palette={palette} uid={`${uid}-h`} />
            {clipped(`${uid}-hclip`, SHIBA_ART.head, headFx?.inner)}
            {headFx?.edge}
            <g className="shiba-face">
              <g ref={rig?.brows} className="shiba-brows">
                <Ops ops={parts.brows} palette={palette} uid={`${uid}-br`} />
              </g>
              <g ref={rig?.eyeL} className="shiba-eye" style={pivot(SHIBA_PIVOTS.eyeL)}>
                <Ops ops={parts.eyeL} palette={palette} uid={`${uid}-yl`} />
              </g>
              <g ref={rig?.eyeR} className="shiba-eye" style={pivot(SHIBA_PIVOTS.eyeR)}>
                <Ops ops={parts.eyeR} palette={palette} uid={`${uid}-yr`} />
              </g>
              <Ops ops={parts.nose} palette={palette} uid={`${uid}-n`} />
              <g ref={rig?.mouth} className="shiba-mouth" style={pivot(SHIBA_PIVOTS.mouth)}>
                <Ops ops={parts.mouth} palette={palette} uid={`${uid}-m`} />
              </g>
              <Ops ops={parts.extras} palette={palette} uid={`${uid}-x`} />
            </g>
          </g>
        </g>
      </g>
      {headFx?.around && <g className="skin-fx-around">{headFx.around}</g>}
    </svg>
  );
}

export function ShibaMascot({ skin = "plain", color, size = 44, mood = "idle", expression, animated = true, detail, move, moveBody = false, label = null, className }: ShibaMascotProps) {
  const known = shibaSkinId(skin);
  const hex = hexOf(color);
  const reduced = useReducedMotion();
  const full = fxDetail(size, animated, detail) === "full";
  const live = full && !reduced;
  const uid = `shiba-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const paint = useMemo(() => shibaSkinPaint(known, hex, uid), [known, hex, uid]);
  const root = useRef<HTMLSpanElement>(null);
  useFxVisibility(root, live);
  const equip = useEquipBurst(known, live);
  const burst = useMoveBurst(move, live);
  const body = useRef<SVGSVGElement>(null);
  useReplayMove(body, burst && moveBody ? burst.key : null);
  const face = expression ?? shibaExpressionForMood(mood);
  const palette = fxPalette(paint.fx, hex);
  return (
    <span
      ref={root}
      className={cn("shiba-mascot relative inline-flex shrink-0", animated && `shiba-live shiba-mood-${mood}`, live && "skin-fx-live", className)}
      style={{ width: size, height: size }}
      data-character="shiba"
      data-shiba-skin={known}
      data-skin-tier={SHIBA_SKIN_TIER[known]}
      data-expression={face}
      data-fx={full ? "full" : "static"}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      <ShibaDrawing
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
      {burst && <MoveFx key={burst.key} move={burst.move} palette={palette} uid={`${uid}-mv`} path={SHIBA_ART.head} />}
    </span>
  );
}

