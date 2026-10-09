// Grump, the grumpy cat (an original character, grump-art.ts: direction C,
// "aplat net"), its markings in the bot's color or a coat of its own, with
// a Grump skin (skin-fx/grump-skins.tsx). Pure SVG: every part is its own
// group (the tail, the legs, the body, the paws, the ears, the head, the
// eyes, the mouth) that turns about its pivot. Small avatars draw a skin's
// still look (no filter, nothing moving) and the bust under 48 px; larger
// ones breathe, blink slowly, twitch an ear and flick the tail tip in CSS
// (grump-mascot.css) and play a skin's idle effect, equip animation and
// move effects. Reduced motion keeps it still.
import "./grump-mascot.css";
import "./skin-fx/skin-fx.css";
import { memo, useId, useMemo, useRef, type ReactNode, type Ref } from "react";
import { MAUS_COLORS } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { GRUMP_SKIN_TIER, type GrumpSkin } from "../../shared/mascot-look";
import {
  GRUMP_ART,
  GRUMP_DEFAULT_HEX,
  GRUMP_LEGS,
  GRUMP_ORDER,
  GRUMP_PIVOTS,
  GRUMP_STANCE_HEAD,
  GRUMP_TAIL,
  grumpLegOps,
  grumpOutline,
  grumpParts,
  grumpViewBox,
  type GrumpExpression,
  type GrumpLeg,
  type GrumpMouth,
  type GrumpOp,
  type GrumpPalette,
  type GrumpStance,
  type Point,
} from "./grump-art";
import { grumpSkinId, grumpSkinLayers, grumpSkinPaint } from "./skin-fx/grump-skins";
import { EquipFx, MoveFx } from "./skin-fx/SkinFx";
import { fxDetail, fxPalette, useEquipBurst, useFxVisibility, useMoveBurst, useReducedMotion, useReplayMove, type FxDetail, type FxMoveRequest } from "./skin-fx/skin-fx";

export type GrumpMood = "idle" | "thinking" | "working" | "happy" | "sleeping" | "listening" | "speaking";

/** The face a mood wears (the five approved moods, and the call's listening and speaking). */
export function grumpExpressionForMood(mood: GrumpMood): GrumpExpression {
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
      return "suspicious";
    default:
      return "neutral";
  }
}

export interface GrumpMascotProps {
  skin?: GrumpSkin | string;
  /** A bot color name (brown) or any hex. */
  color: string;
  size?: number;
  mood?: GrumpMood;
  /** A face of its own, over the mood's (one of the sixteen). */
  expression?: GrumpExpression;
  /** Off draws a still frame (thumbnails, reduced motion). */
  animated?: boolean;
  detail?: FxDetail;
  /** A one-shot move: its skin effect, and with moveBody the body's own motion. */
  move?: FxMoveRequest | null;
  moveBody?: boolean;
  label?: string | null;
  className?: string;
}

export const grumpHexOf = (color: string) => (MAUS_COLORS as Record<string, string>)[color] ?? (/^#[0-9a-fA-F]{6}$/.test(color) ? color : GRUMP_DEFAULT_HEX);

/** Ops as SVG elements with a palette; `uid` keeps clip ids apart. */
export function GrumpOpsSvg({ ops, palette, uid }: { ops: readonly GrumpOp[]; palette: GrumpPalette; uid: string }) {
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

const Ops = memo(GrumpOpsSvg);

/** The groups a live rig moves: one per moving part. */
export interface GrumpRigRefs {
  whole: Ref<SVGGElement>;
  torso: Ref<SVGGElement>;
  head: Ref<SVGGElement>;
  earL: Ref<SVGGElement>;
  earR: Ref<SVGGElement>;
  pawL: Ref<SVGGElement>;
  pawR: Ref<SVGGElement>;
}

const pivot = ([x, y]: readonly [number, number]) => ({ transformOrigin: `${x}px ${y}px` });

/** The live pose a drawing shows beyond its stance and face: the tail's joints, the standing legs, the blink and the gaze. */
export interface GrumpDrawingPose {
  tail?: readonly number[];
  legs?: Partial<Record<GrumpLeg, { hip: number; bend: number; hipAt?: Point }>>;
  blink?: number;
  look?: Point;
}

export interface GrumpDrawingProps {
  uid: string;
  palette: GrumpPalette;
  skin: GrumpSkin;
  hex: string;
  size: number;
  expression: GrumpExpression;
  mouth?: GrumpMouth | null;
  stance?: GrumpStance;
  pose?: GrumpDrawingPose;
  full: boolean;
  rig?: GrumpRigRefs;
  svgRef?: Ref<SVGSVGElement>;
  svgClass?: string;
  defs?: ReactNode;
}

const BODY_OF: Readonly<Record<GrumpStance, string>> = { sit: GRUMP_ART.body, stand: GRUMP_ART.standBody, lie: GRUMP_ART.lieBody, curl: GRUMP_ART.curlBody };

/**
 * One drawing of Grump: the parts in their groups, the skin's treatment on
 * the head and the body. The rig, when given, moves the groups and passes
 * the pose; otherwise CSS does (the idle loops) or nothing does (still).
 */
export function GrumpDrawing({ uid, palette, skin, hex, size, expression, mouth = null, stance = "sit", pose, full, rig, svgRef, svgClass, defs }: GrumpDrawingProps) {
  const tailKey = pose?.tail?.map((v) => Math.round(v * 10)).join(",") ?? "";
  const blink = Math.round((pose?.blink ?? 0) * 20) / 20;
  const lookX = Math.round((pose?.look?.[0] ?? 0) * 10) / 10;
  const lookY = Math.round((pose?.look?.[1] ?? 0) * 10) / 10;
  const parts = useMemo(
    () => grumpParts({ expression, mouth, stance, size, tailBend: tailKey ? tailKey.split(",").map((v) => Number(v) / 10) : undefined, blink, look: [lookX, lookY] }),
    [expression, mouth, stance, size, tailKey, blink, lookX, lookY],
  );
  const ow = grumpOutline(size);
  const bodyPath = BODY_OF[stance];
  const headFx = useMemo(() => grumpSkinLayers(skin, GRUMP_ART.head, hex, `${uid}-hf`, full, "head"), [skin, hex, uid, full]);
  const bodyFx = useMemo(() => grumpSkinLayers(skin, bodyPath, hex, `${uid}-bf`, full, "body"), [skin, bodyPath, hex, uid, full]);
  const head = GRUMP_STANCE_HEAD[stance];
  const [nx, ny] = GRUMP_PIVOTS.neck;
  const headPlace = head.scale === 1 && !head.x && !head.y && !head.rot ? undefined : `translate(${head.x} ${head.y}) rotate(${head.rot} ${nx} ${ny}) translate(${nx} ${ny}) scale(${head.scale}) translate(${-nx} ${-ny})`;
  const legs = (side: "Far" | "Near") =>
    stance === "stand"
      ? GRUMP_LEGS.filter((leg) => leg.endsWith(side)).map((leg) => {
          const at = pose?.legs?.[leg];
          return (
            <g key={leg} className={`grump-leg grump-leg-${leg}`}>
              <Ops ops={grumpLegOps(leg, at?.hip ?? 0, at?.bend ?? 0, ow, at?.hipAt)} palette={palette} uid={`${uid}-${leg}`} />
            </g>
          );
        })
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
  const groups = {
    tail: (
      <g key="tail" className="grump-tail" style={pivot(GRUMP_TAIL[stance][0])}>
        <Ops ops={parts.tail} palette={palette} uid={`${uid}-t`} />
      </g>
    ),
    body: (
      <g key="body" className="grump-body">
        {bodyFx?.under}
        <Ops ops={parts.body} palette={palette} uid={`${uid}-b`} />
        {clipped(`${uid}-bclip`, bodyPath, bodyFx?.inner)}
        {bodyFx?.edge}
      </g>
    ),
    paws: (
      <g key="paws" className="grump-paws">
        <g ref={rig?.pawL} className="grump-paw grump-paw-l">
          <Ops ops={parts.paws.slice(0, parts.paws.length / 2)} palette={palette} uid={`${uid}-pl`} />
        </g>
        <g ref={rig?.pawR} className="grump-paw grump-paw-r">
          <Ops ops={parts.paws.slice(parts.paws.length / 2)} palette={palette} uid={`${uid}-pr`} />
        </g>
      </g>
    ),
    legsFar: <g key="legsFar">{legs("Far")}</g>,
    legsNear: <g key="legsNear">{legs("Near")}</g>,
    head: (
      <g key="head" transform={headPlace}>
        <g ref={rig?.head} className="grump-head" style={pivot(GRUMP_PIVOTS.neck)}>
          {headFx?.under}
          <g ref={rig?.earL} className="grump-ear grump-ear-l" style={pivot(GRUMP_PIVOTS.earL)}>
            <Ops ops={parts.earL} palette={palette} uid={`${uid}-el`} />
          </g>
          <g ref={rig?.earR} className="grump-ear grump-ear-r" style={pivot(GRUMP_PIVOTS.earR)}>
            <Ops ops={parts.earR} palette={palette} uid={`${uid}-er`} />
          </g>
          <Ops ops={parts.head} palette={palette} uid={`${uid}-h`} />
          {clipped(`${uid}-hclip`, GRUMP_ART.head, headFx?.inner)}
          {headFx?.edge}
          <g className="grump-face">
            <g className="grump-brows">
              <Ops ops={parts.brows} palette={palette} uid={`${uid}-br`} />
            </g>
            <g className="grump-eye" style={pivot(GRUMP_PIVOTS.eyeL)}>
              <Ops ops={parts.eyeL} palette={palette} uid={`${uid}-yl`} />
            </g>
            <g className="grump-eye" style={pivot(GRUMP_PIVOTS.eyeR)}>
              <Ops ops={parts.eyeR} palette={palette} uid={`${uid}-yr`} />
            </g>
            <Ops ops={parts.nose} palette={palette} uid={`${uid}-n`} />
            <g className="grump-mouth" style={pivot(GRUMP_PIVOTS.mouth)}>
              <Ops ops={parts.mouth} palette={palette} uid={`${uid}-m`} />
            </g>
            <Ops ops={parts.extras} palette={palette} uid={`${uid}-x`} />
          </g>
        </g>
      </g>
    ),
  };
  // the legs stand on the ground; the torso (tail, body, head) moves over them
  const order = GRUMP_ORDER[stance];
  const torsoKeys = new Set(["tail", "body", "paws", "head"]);
  return (
    <svg viewBox={grumpViewBox(size)} width="100%" height="100%" ref={svgRef} className={svgClass} style={{ overflow: "visible", display: "block" }} data-stance={stance}>
      {(defs || headFx?.defs || bodyFx?.defs) && (
        <defs>
          {defs}
          {headFx?.defs}
          {bodyFx?.defs}
        </defs>
      )}
      <g ref={rig?.whole} className="grump-whole" style={pivot(GRUMP_PIVOTS.ground)}>
        {order.map((key) =>
          torsoKeys.has(key) ? (
            <g key={key} className="grump-torso-part" data-part={key}>
              {groups[key]}
            </g>
          ) : (
            groups[key]
          ),
        )}
      </g>
      {headFx?.around && <g className="skin-fx-around">{headFx.around}</g>}
    </svg>
  );
}

export function GrumpMascot({ skin = "plain", color, size = 44, mood = "idle", expression, animated = true, detail, move, moveBody = false, label = null, className }: GrumpMascotProps) {
  const known = grumpSkinId(skin);
  const hex = grumpHexOf(color);
  const reduced = useReducedMotion();
  const full = fxDetail(size, animated, detail) === "full";
  const live = full && !reduced;
  const uid = `grump-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const paint = useMemo(() => grumpSkinPaint(known, hex, uid), [known, hex, uid]);
  const root = useRef<HTMLSpanElement>(null);
  useFxVisibility(root, live);
  const equip = useEquipBurst(known, live);
  const burst = useMoveBurst(move, live);
  const body = useRef<SVGSVGElement>(null);
  useReplayMove(body, burst && moveBody ? burst.key : null);
  const face = expression ?? grumpExpressionForMood(mood);
  const palette = fxPalette(paint.fx, hex);
  return (
    <span
      ref={root}
      className={cn("grump-mascot relative inline-flex shrink-0", animated && `grump-live grump-mood-${mood}`, live && "skin-fx-live", className)}
      style={{ width: size, height: size }}
      data-character="grump"
      data-grump-skin={known}
      data-skin-tier={GRUMP_SKIN_TIER[known]}
      data-expression={face}
      data-fx={full ? "full" : "static"}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      <GrumpDrawing
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
      {burst && <MoveFx key={burst.key} move={burst.move} palette={palette} uid={`${uid}-mv`} path={GRUMP_ART.head} />}
    </span>
  );
}
