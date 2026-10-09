// Grump, the grumpy cat (an original character, grump-art.ts: direction C,
// "aplat net"), its markings in the bot's color or a coat of its own, with
// a Grump skin (skin-fx/grump-skins.tsx). Pure SVG: every part is its own
// group (the tail, the legs, the body, the paws, the ears, the head, the
// eyes, the mouth). Small avatars draw a skin's still look (no filter,
// nothing moving) and the bust under 48 px. Larger ones breathe, blink
// slowly, twitch an ear and flick the tail in CSS (grump-mascot.css), which
// costs no script; a move (a stretch, a groom, a pounce, a hiss...) or a
// held activity (walking, stalking, loafing, sleeping curled...) runs the
// rig of grump-moves.ts instead: one pose per frame written straight onto
// the groups, the jointed tail and the standing legs (two-bone IK) redrawn
// as paths, and it hands back to CSS once done. The desktop mascot keeps the
// rig running. Reduced motion keeps it still: a move then only shows its
// face.
import "./grump-mascot.css";
import "./skin-fx/skin-fx.css";
import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { MAUS_COLORS } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { GRUMP_SKIN_TIER, type GrumpSkin } from "../../shared/mascot-look";
import {
  ellipsePath,
  GRUMP_ART,
  GRUMP_BUST_MAX,
  GRUMP_DEFAULT_HEX,
  GRUMP_LEG,
  GRUMP_LEGS,
  GRUMP_ORDER,
  GRUMP_PAWS,
  grumpLegOps,
  grumpOutline,
  grumpParts,
  grumpPawOps,
  grumpViewBox,
  legIK,
  tailPath,
  type GrumpExpression,
  type GrumpLeg,
  type GrumpMouth,
  type GrumpOp,
  type GrumpPalette,
  type GrumpStance,
} from "./grump-art";
import { GRUMP_MOVE_TIMING, GrumpRig, grumpHeadPlace, grumpHipsAt, grumpMoveFor, grumpReducedFace, grumpRestPose, grumpTransforms, type GrumpMove, type GrumpPose, type GrumpTransforms } from "./grump-moves";
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
  /** A one-shot move: one of Grump's (a clip name or a move id, grump-moves.ts) plays on the rig; a skin's effect plays with it. */
  move?: FxMoveRequest | null;
  moveBody?: boolean;
  /** A held activity (walk, stalk, loaf, sleep, talk, listen, work, drag): the rig runs it until it changes. */
  activity?: GrumpMove | null;
  /** The rig runs all the time (the desktop mascot), not only during a move or an activity. */
  rig?: boolean;
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

/** The groups and paths the live loop writes, by name. */
export type GrumpGroup = Exclude<keyof GrumpTransforms, "torso">;
export interface GrumpLiveNodes {
  groups: Partial<Record<GrumpGroup, SVGGElement | null>>;
  /** Every torso wrapper (tail, body, paws, head): the crouch and the pitch. */
  torso: Set<SVGGElement>;
  /** The tail's two strokes (outline, markings). */
  tail: (SVGPathElement | null)[];
  /** Each standing leg's three paths (outline, fur, paw). */
  legs: Partial<Record<GrumpLeg, (SVGPathElement | null)[]>>;
  /** Each sitting paw: its group (moved) and the foreleg's two strokes. */
  paws: Partial<Record<"l" | "r", { group: SVGGElement | null; arm: (SVGPathElement | null)[] }>>;
}

const emptyNodes = (): GrumpLiveNodes => ({ groups: {}, torso: new Set(), tail: [], legs: {}, paws: {} });

export interface GrumpDrawingProps {
  uid: string;
  palette: GrumpPalette;
  skin: GrumpSkin;
  hex: string;
  size: number;
  expression: GrumpExpression;
  mouth?: GrumpMouth | null;
  stance?: GrumpStance;
  /** The lids' live blink (0 open..1 shut), quantized by the caller. */
  blink?: number;
  full: boolean;
  /** Where the live loop finds each moving node. */
  nodes?: RefObject<GrumpLiveNodes>;
  /** A pose drawn as it is (a still frame of a move). */
  pose?: GrumpPose | null;
  svgRef?: Ref<SVGSVGElement>;
  svgClass?: string;
  defs?: ReactNode;
}

const BODY_OF: Readonly<Record<GrumpStance, string>> = { sit: GRUMP_ART.body, stand: GRUMP_ART.standBody, lie: GRUMP_ART.lieBody, curl: GRUMP_ART.curlBody };
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The live geometry of a pose: the tail's path, each leg's path and paw, each sitting paw's offset and foreleg. */
export function grumpLiveGeometry(pose: GrumpPose) {
  const hips = grumpHipsAt(pose);
  const legs = Object.fromEntries(
    GRUMP_LEGS.map((leg) => {
      const j = legIK(leg, pose.legs[leg].x, pose.legs[leg].lift, hips[leg]);
      return [leg, { d: `M${r2(j.hip[0])} ${r2(j.hip[1])}L${r2(j.knee[0])} ${r2(j.knee[1])}L${r2(j.paw[0])} ${r2(j.paw[1])}`, paw: ellipsePath(j.paw[0] + 1, j.paw[1] + 0.4, 4.2, 2.6) }];
    }),
  ) as Record<GrumpLeg, { d: string; paw: string }>;
  const paw = (side: "l" | "r", { x, y }: { x: number; y: number }) => {
    const [px, py] = GRUMP_PAWS[side];
    const [sx, sy] = side === "l" ? GRUMP_PAWS.shoulderL : GRUMP_PAWS.shoulderR;
    return { transform: x || y ? `translate(${r2(x)} ${r2(y)})` : "", arm: y < -2.5 ? `M${sx} ${sy}L${r2(px + x)} ${r2(py + y)}` : "" };
  };
  return { tail: tailPath(pose.stance, pose.tail), legs, pawL: paw("l", pose.pawL), pawR: paw("r", pose.pawR) };
}

/**
 * One drawing of Grump: the parts in their groups, the skin's treatment on
 * the head and the body. The live loop moves the nodes (`nodes`), a still
 * frame passes its `pose`, otherwise CSS moves them (the idle loops) or
 * nothing does (still).
 */
export function GrumpDrawing({ uid, palette, skin, hex, size, expression, mouth = null, stance = "sit", blink = 0, full, nodes, pose, svgRef, svgClass, defs }: GrumpDrawingProps) {
  const parts = useMemo(() => grumpParts({ expression, mouth, stance, size, blink }), [expression, mouth, stance, size, blink]);
  const ow = grumpOutline(size);
  const bust = size <= GRUMP_BUST_MAX;
  const bodyPath = BODY_OF[stance];
  const headFx = useMemo(() => grumpSkinLayers(skin, GRUMP_ART.head, hex, `${uid}-hf`, full, "head"), [skin, hex, uid, full]);
  const bodyFx = useMemo(() => grumpSkinLayers(skin, bodyPath, hex, `${uid}-bf`, full, "body"), [skin, bodyPath, hex, uid, full]);
  const still = pose ?? { ...grumpRestPose(), stance };
  const transforms = pose ? grumpTransforms(pose) : null;
  const geometry = grumpLiveGeometry(still);
  const live = nodes?.current;
  const group = (key: GrumpGroup) => ({
    ref: (node: SVGGElement | null) => {
      if (live) live.groups[key] = node;
    },
    transform: transforms?.[key] || undefined,
  });
  const torso = (node: SVGGElement | null) => {
    if (node) live?.torso.add(node);
  };
  const stroke = (role: keyof GrumpPalette, width: number) => ({ fill: "none", stroke: palette[role], strokeWidth: width, strokeLinecap: "round" as const, strokeLinejoin: "round" as const });
  const tw = r2(6 + 2 * ow);
  const legs = (side: "Far" | "Near") =>
    stance === "stand"
      ? GRUMP_LEGS.filter((leg) => leg.endsWith(side)).map((leg) => {
          const far = side === "Far";
          const at = (i: number) => (node: SVGPathElement | null) => {
            if (!live) return;
            (live.legs[leg] ??= [])[i] = node;
          };
          const g = geometry.legs[leg];
          return (
            <g key={leg} className={`grump-leg grump-leg-${leg}`}>
              <path ref={at(0)} d={g.d} {...stroke("line", r2(GRUMP_LEG.width + 2 * ow))} />
              <path ref={at(1)} d={g.d} {...stroke(far ? "creamShade" : "cream", GRUMP_LEG.width)} />
              <path ref={at(2)} d={g.paw} fill={palette[far ? "muzzleShade" : "muzzle"]} stroke={palette.line} strokeWidth={ow} strokeLinejoin="round" />
            </g>
          );
        })
      : null;
  const pawSide = (side: "l" | "r") => {
    const g = side === "l" ? geometry.pawL : geometry.pawR;
    const entry = () => (live ? (live.paws[side] ??= { group: null, arm: [] }) : null);
    return (
      <g key={side} className={`grump-paw grump-paw-${side}`}>
        <path ref={(node) => void (entry() && (entry()!.arm[0] = node))} d={g.arm} {...stroke("line", r2(GRUMP_LEG.width + 2 * ow))} />
        <path ref={(node) => void (entry() && (entry()!.arm[1] = node))} d={g.arm} {...stroke("cream", GRUMP_LEG.width)} />
        <g ref={(node) => void (entry() && (entry()!.group = node))} transform={g.transform || undefined}>
          <Ops ops={grumpPawOps(side, 0, 0, ow)} palette={palette} uid={`${uid}-p${side}`} />
        </g>
      </g>
    );
  };
  const clipped = (id: string, d: string, layer: ReactNode) =>
    layer ? (
      <g>
        <clipPath id={id}>
          <path d={d} />
        </clipPath>
        <g clipPath={`url(#${id})`}>{layer}</g>
      </g>
    ) : null;
  const headPlace = grumpHeadPlace(stance) || undefined;
  const groups = {
    tail: bust ? null : (
      <g key="tail" className="grump-tail">
        <path ref={(node) => void (live && (live.tail[0] = node))} d={geometry.tail} {...stroke("line", tw)} />
        <path ref={(node) => void (live && (live.tail[1] = node))} d={geometry.tail} {...stroke("coat", r2(tw - 2 * ow))} />
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
    paws:
      stance === "sit" ? (
        <g key="paws" className="grump-paws">
          {pawSide("l")}
          {pawSide("r")}
        </g>
      ) : (
        <g key="paws" className="grump-paws">
          <Ops ops={parts.paws} palette={palette} uid={`${uid}-p`} />
        </g>
      ),
    legsFar: <g key="legsFar">{legs("Far")}</g>,
    legsNear: <g key="legsNear">{legs("Near")}</g>,
    head: (
      <g key="head" transform={headPlace}>
        <g className="grump-head" {...group("head")}>
          {headFx?.under}
          <g className="grump-ear grump-ear-l" {...group("earL")}>
            <Ops ops={parts.earL} palette={palette} uid={`${uid}-el`} />
          </g>
          <g className="grump-ear grump-ear-r" {...group("earR")}>
            <Ops ops={parts.earR} palette={palette} uid={`${uid}-er`} />
          </g>
          <Ops ops={parts.head} palette={palette} uid={`${uid}-h`} />
          {clipped(`${uid}-hclip`, GRUMP_ART.head, headFx?.inner)}
          {headFx?.edge}
          <g className="grump-face">
            <g className="grump-brows" {...group("brows")}>
              <Ops ops={parts.brows} palette={palette} uid={`${uid}-br`} />
            </g>
            <g className="grump-eye grump-eye-l">
              <Ops ops={parts.eyeL} palette={palette} uid={`${uid}-yl`} />
            </g>
            <g className="grump-eye grump-eye-r">
              <Ops ops={parts.eyeR} palette={palette} uid={`${uid}-yr`} />
            </g>
            <Ops ops={parts.nose} palette={palette} uid={`${uid}-n`} />
            <g className="grump-mouth" {...group("mouth")}>
              <Ops ops={parts.mouth} palette={palette} uid={`${uid}-m`} />
            </g>
            <Ops ops={parts.extras} palette={palette} uid={`${uid}-x`} />
          </g>
        </g>
      </g>
    ),
  };
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
      <g className="grump-whole" {...group("whole")}>
        {GRUMP_ORDER[stance].map((key) =>
          torsoKeys.has(key) ? (
            <g key={key} ref={torso} transform={transforms?.torso || undefined}>
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

const seconds = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

type Discrete = Pick<GrumpPose, "stance" | "expression" | "mouth"> & { blink: number };
const sameDiscrete = (a: Discrete | null, b: Discrete | null) => a === b || (!!a && !!b && a.stance === b.stance && a.expression === b.expression && a.mouth === b.mouth && a.blink === b.blink);

/** Writes one pose onto the drawing's nodes. */
function writePose(nodes: GrumpLiveNodes, pose: GrumpPose): void {
  const tf = grumpTransforms(pose);
  for (const key of Object.keys(nodes.groups) as GrumpGroup[]) {
    const value = tf[key];
    if (value) nodes.groups[key]?.setAttribute("transform", value);
    else nodes.groups[key]?.removeAttribute("transform");
  }
  for (const node of nodes.torso) {
    if (!node.isConnected) nodes.torso.delete(node);
    else if (tf.torso) node.setAttribute("transform", tf.torso);
    else node.removeAttribute("transform");
  }
  const geometry = grumpLiveGeometry(pose);
  for (const path of nodes.tail) path?.setAttribute("d", geometry.tail);
  for (const leg of GRUMP_LEGS) {
    const paths = nodes.legs[leg];
    if (!paths) continue;
    paths[0]?.setAttribute("d", geometry.legs[leg].d);
    paths[1]?.setAttribute("d", geometry.legs[leg].d);
    paths[2]?.setAttribute("d", geometry.legs[leg].paw);
  }
  for (const side of ["l", "r"] as const) {
    const paw = nodes.paws[side];
    if (!paw) continue;
    const g = side === "l" ? geometry.pawL : geometry.pawR;
    if (g.transform) paw.group?.setAttribute("transform", g.transform);
    else paw.group?.removeAttribute("transform");
    for (const arm of paw.arm) arm?.setAttribute("d", g.arm);
  }
}

/** Takes every live write back off (the CSS idle takes over). */
function clearPose(nodes: GrumpLiveNodes): void {
  writePose(nodes, grumpRestPose());
  for (const node of Object.values(nodes.groups)) node?.removeAttribute("transform");
  for (const node of nodes.torso) node.removeAttribute("transform");
}

export function GrumpMascot({ skin = "plain", color, size = 44, mood = "idle", expression, animated = true, detail, move, moveBody = false, activity = null, rig: alwaysRig = false, label = null, className }: GrumpMascotProps) {
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
  const grumpMove = grumpMoveFor(move?.clip);
  // a move of its own moves the parts; a skin's body motion only for the others
  useReplayMove(body, burst && moveBody && !grumpMove ? burst.key : null);
  const nodes = useRef<GrumpLiveNodes>(emptyNodes());
  const engine = useRef<GrumpRig | null>(null);
  const [discrete, setDiscrete] = useState<Discrete | null>(null);
  const [running, setRunning] = useState(false);
  const keepRunning = useRef(alwaysRig || activity !== null);
  keepRunning.current = alwaysRig || activity !== null;
  const moveKey = move?.key ?? 0;

  // the rig lives while the drawing is live
  useEffect(() => {
    if (!live) {
      engine.current = null;
      return;
    }
    engine.current = new GrumpRig(seconds());
    if (keepRunning.current) setRunning(true);
    return () => {
      engine.current = null;
    };
  }, [live]);

  // a held activity (walking, stalking, loafing, sleeping...)
  useEffect(() => {
    if (!live) return;
    engine.current?.hold(activity, seconds());
    if (activity || alwaysRig) setRunning(true);
  }, [activity, alwaysRig, live]);

  // a one-shot move, once per request
  const lastMove = useRef(0);
  useEffect(() => {
    if (!live || !grumpMove || !moveKey || moveKey === lastMove.current) return;
    lastMove.current = moveKey;
    engine.current?.play(grumpMove, seconds());
    setRunning(true);
  }, [live, grumpMove, moveKey]);

  // under reduced motion a move shows its face, still, for as long as it lasts
  const [stillFace, setStillFace] = useState<Discrete | null>(null);
  useEffect(() => {
    if (live || !animated || !grumpMove || !moveKey) return;
    const face = grumpReducedFace(grumpMove);
    if (!face) return;
    setStillFace({ ...face, blink: 0 });
    const timer = setTimeout(() => setStillFace(null), GRUMP_MOVE_TIMING[grumpMove].duration * 1000);
    return () => clearTimeout(timer);
  }, [live, animated, grumpMove, moveKey]);
  const heldReduced = !live && animated && activity ? grumpReducedFace(activity) : null;
  const heldFace = heldReduced ? { ...heldReduced, blink: 0 } : null;

  // the loop: one pose per animation frame, written straight onto the drawing
  useEffect(() => {
    if (!running || !live) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const run = engine.current;
      if (!run || document.hidden || root.current?.hasAttribute("data-fx-paused")) return;
      const now = seconds();
      const pose = run.pose(now);
      writePose(nodes.current, pose);
      // the lids come down in twelve steps: the eyes redraw only when a step changes
      const next: Discrete = { stance: pose.stance, expression: pose.expression, mouth: pose.mouth, blink: Math.round(pose.blink * 12) / 12 };
      setDiscrete((prev) => (sameDiscrete(prev, next) ? prev : next));
      if (!keepRunning.current && !run.busy(now)) {
        cancelAnimationFrame(raf);
        clearPose(nodes.current);
        setDiscrete(null);
        setRunning(false);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearPose(nodes.current);
    };
  }, [running, live]);

  const shown = (running && live ? discrete : null) ?? stillFace ?? heldFace;
  const face = shown?.expression ?? expression ?? grumpExpressionForMood(mood);
  const palette = fxPalette(paint.fx, hex);
  return (
    <span
      ref={root}
      className={cn("grump-mascot relative inline-flex shrink-0", animated && `grump-live grump-mood-${mood}`, running && live && "grump-rig", live && "skin-fx-live", className)}
      style={{ width: size, height: size }}
      data-character="grump"
      data-grump-skin={known}
      data-skin-tier={GRUMP_SKIN_TIER[known]}
      data-expression={face}
      data-fx={full ? "full" : "static"}
      data-grump-move={grumpMove ?? undefined}
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
        mouth={shown?.mouth ?? null}
        stance={size > GRUMP_BUST_MAX ? (shown?.stance ?? "sit") : "sit"}
        blink={shown?.blink ?? 0}
        full={full}
        nodes={nodes}
        svgRef={body}
        svgClass={cn(burst && moveBody && !grumpMove && `fx-body-move fx-body-${burst.move}`, equip && "fx-equip-pop", full && paint.bodyClass)}
        defs={paint.defs}
      />
      {equip && <EquipFx key={equip} palette={palette} uid={`${uid}-eq`} />}
      {burst && <MoveFx key={burst.key} move={burst.move} palette={palette} uid={`${uid}-mv`} path={GRUMP_ART.head} />}
    </span>
  );
}

/** Kept for the keyframe renders and the tests: a leg's ops at rest. */
export const grumpRestLegOps = (leg: GrumpLeg, size: number) => grumpLegOps(leg, 0, 0, grumpOutline(size));
