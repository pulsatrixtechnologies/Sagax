// Frog, the smug sad frog (an original character, frog-art.ts: direction C,
// "aplat net"), its skin a tint of the bot's color or a frog of its own, with
// a Frog skin (skin-fx/frog-skins.tsx). Pure SVG: every part is its own group
// (the pad, the legs, the body, the hands, the head, the throat, each eye with
// its pupil and its blink lid, the lips, the tongue, the fly, the pond) that
// moves about its pivot. Small avatars draw a skin's still look (no filter,
// nothing moving) and the bust under 48 px. Larger ones breathe with the
// throat and blink one eye then the other in CSS (frog-mascot.css), which
// costs no script; a move (a hop, a croak, the tongue...) or a held activity
// (hopping along, sunk in the pond, asleep on a lily pad...) runs the rig of
// frog-moves.ts instead, one pose per frame written straight onto the
// groups, and it hands back to CSS once done. The desktop mascot keeps the
// rig running. Reduced motion keeps it still: a move then only shows its face.
import "./frog-mascot.css";
import "./skin-fx/skin-fx.css";
import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { MAUS_COLORS } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { FROG_SKIN_TIER, type FrogSkin } from "../../shared/mascot-look";
import {
  FROG_ART,
  FROG_BUST_MAX,
  FROG_FACES,
  frogEyeLayers,
  frogArmOps,
  frogEyeOps,
  frogFlyOps,
  frogHaunchOps,
  frogLegOps,
  frogOpsToSvg,
  frogOutline,
  frogPadOps,
  frogParts,
  frogThroatOps,
  frogTongueOps,
  frogViewBox,
  frogWaterOps,
  type FrogExpression,
  type FrogMouth,
  type FrogOp,
  type FrogPalette,
} from "./frog-art";
import { FLY_AT, FROG_TRACKS, FrogRig, frogMoveFor, frogReducedFace, frogRestPose, frogTransforms, type FrogGroup, type FrogLid, type FrogMove, type FrogPose } from "./frog-moves";
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
  /** A one-shot move: one of Frog's (a clip name or a move id, frog-moves.ts) plays on the rig; a skin's effect plays with it. */
  move?: FxMoveRequest | null;
  moveBody?: boolean;
  /** A held activity (hopping along, sunk, asleep on a pad, talking...): the rig runs it until it changes. */
  activity?: FrogMove | null;
  /** The rig runs all the time (the desktop mascot), not only during a move or an activity. */
  rig?: boolean;
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

/** The groups the live loop moves (frog-moves.ts FROG_GROUPS) and the ones it redraws (the legs, the haunches, the pond). */
export type FrogGroups = Partial<Record<FrogGroup | "legs" | "haunches" | "arms" | "water", SVGGElement | null>>;

export interface FrogDrawingProps {
  uid: string;
  palette: FrogPalette;
  skin: FrogSkin;
  hex: string;
  size: number;
  expression: FrogExpression;
  mouth?: FrogMouth | null;
  full: boolean;
  /** Where the live loop finds each moving group (it then draws the legs and the pond itself). */
  groups?: RefObject<FrogGroups>;
  /** A pose drawn as it is (a still frame of a move: the keyframe renders, tests, reduced motion's pond and pad). */
  pose?: FrogPose | null;
  /** Seconds into the move of `pose` (where the fly is, the ripples). */
  u?: number;
  svgRef?: Ref<SVGSVGElement>;
  svgClass?: string;
  defs?: ReactNode;
}

/** One eye in its layers: the white, the pupil (moved by a look) and the lids clipped to it, the outline; a closed eye as it is. */
function Eye({ side, expression, ow, palette, uid, group }: { side: -1 | 1; expression: FrogExpression; ow: number; palette: FrogPalette; uid: string; group: (key: FrogGroup) => { ref: (node: SVGGElement | null) => void; transform?: string } }) {
  const spec = FROG_FACES[expression].eyes[side < 0 ? 0 : 1];
  const layers = frogEyeLayers(spec, side, ow);
  if (!layers) return <Ops ops={frogEyeOps(spec, side, ow)} palette={palette} uid={uid} />;
  const clip = `${uid}-clip`;
  return (
    <>
      <Ops ops={layers.white} palette={palette} uid={`${uid}-w`} />
      <clipPath id={clip}>
        <path d={layers.clip} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <g {...group(side < 0 ? "pupilL" : "pupilR")}>
          <Ops ops={layers.pupil} palette={palette} uid={`${uid}-p`} />
        </g>
        <Ops ops={layers.lid} palette={palette} uid={`${uid}-l`} />
        <g {...group(side < 0 ? "lidL" : "lidR")}>
          <Ops ops={layers.blink} palette={palette} uid={`${uid}-b`} />
        </g>
        <g {...group(side < 0 ? "lowL" : "lowR")}>
          <Ops ops={layers.low} palette={palette} uid={`${uid}-lo`} />
        </g>
      </g>
      <Ops ops={layers.outline} palette={palette} uid={`${uid}-o`} />
    </>
  );
}

/** The eyes' blink lids for a face (left, right); a closed eye has none to slide. */
export function frogLids(expression: FrogExpression, ow: number): [FrogLid, FrogLid] {
  const [l, r] = FROG_FACES[expression].eyes;
  const lid = (layers: ReturnType<typeof frogEyeLayers>): FrogLid => (layers ? { height: layers.height, rest: layers.rest } : { height: 0, rest: 1 });
  return [lid(frogEyeLayers(l, -1, ow)), lid(frogEyeLayers(r, 1, ow))];
}

/**
 * One drawing of Frog: the parts in their groups, the skin's treatment on the
 * head and the body. The live loop moves the groups (`groups`) and draws the
 * legs and the pond; a still frame passes its `pose`; otherwise CSS moves the
 * groups (the idle loops) or nothing does (still).
 */
export function FrogDrawing({ uid, palette, skin, hex, size, expression, mouth = null, full, groups, pose, u = 0, svgRef, svgClass, defs }: FrogDrawingProps) {
  const parts = useMemo(() => frogParts({ expression, mouth, size }), [expression, mouth, size]);
  const ow = frogOutline(size);
  const bust = size <= FROG_BUST_MAX;
  const headFx = useMemo(() => frogSkinLayers(skin, FROG_ART.head, hex, `${uid}-hf`, full), [skin, hex, uid, full]);
  const bodyFx = useMemo(() => frogSkinLayers(skin, FROG_ART.body, hex, `${uid}-bf`, full), [skin, hex, uid, full]);
  const still = pose ?? frogRestPose();
  const transforms = frogTransforms(still, { lids: frogLids(expression, ow), u });
  const live = Boolean(groups);
  // each moving group: its ref for the live loop and its transform for a still frame. The pivots are in the
  // transforms; the CSS idle sets its own origins (frog-mascot.css), since an inline origin would shift them.
  const group = (key: FrogGroup) => ({
    ref: (node: SVGGElement | null) => {
      if (groups?.current) groups.current[key] = node;
    },
    transform: transforms[key],
  });
  const own = (key: "legs" | "haunches" | "arms" | "water") => (node: SVGGElement | null) => {
    if (groups?.current) groups.current[key] = node;
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
  const moving = !bust && (live || pose);
  return (
    <svg viewBox={frogViewBox(size)} width="100%" height="100%" ref={svgRef} className={svgClass} style={{ overflow: "visible", display: "block" }}>
      {(defs || headFx?.defs || bodyFx?.defs) && (
        <defs>
          {defs}
          {headFx?.defs}
          {bodyFx?.defs}
        </defs>
      )}
      {moving && (
        <g className="frog-pad" {...group("pad")}>
          <Ops ops={frogPadOps(ow)} palette={palette} uid={`${uid}-pad`} />
        </g>
      )}
      <g className="frog-whole" {...group("whole")}>
        {bodyFx?.under}
        {moving && (
          <g className="frog-legs" ref={own("legs")}>
            {!live && <Ops ops={[...frogLegOps(-1, still.legs, ow), ...frogLegOps(1, still.legs, ow)]} palette={palette} uid={`${uid}-lg`} />}
          </g>
        )}
        <g className="frog-body">
          <Ops ops={parts.body} palette={palette} uid={`${uid}-b`} />
          {clipped(`${uid}-bclip`, FROG_ART.body, bodyFx?.inner)}
          {bodyFx?.edge}
        </g>
        {moving && (
          <g className="frog-haunches" ref={own("haunches")}>
            {!live && <Ops ops={[...frogHaunchOps(-1, still.legs, ow), ...frogHaunchOps(1, still.legs, ow)]} palette={palette} uid={`${uid}-hn`} />}
          </g>
        )}
        <g className="frog-head" {...group("head")}>
          {headFx?.under}
          <Ops ops={parts.head} palette={palette} uid={`${uid}-h`} />
          {clipped(`${uid}-hclip`, FROG_ART.head, headFx?.inner)}
          {headFx?.edge}
          {!bust && (
            <g className="frog-throat" {...group("throat")}>
              <Ops ops={frogThroatOps(1, ow)} palette={palette} uid={`${uid}-th`} />
            </g>
          )}
          <g className="frog-face">
            <g className="frog-brows">
              <Ops ops={parts.brows} palette={palette} uid={`${uid}-br`} />
            </g>
            <g className="frog-eye frog-eye-l">
              <Eye side={-1} expression={expression} ow={ow} palette={palette} uid={`${uid}-yl`} group={group} />
            </g>
            <g className="frog-eye frog-eye-r">
              <Eye side={1} expression={expression} ow={ow} palette={palette} uid={`${uid}-yr`} group={group} />
            </g>
            <Ops ops={parts.nose} palette={palette} uid={`${uid}-n`} />
            <g className="frog-mouth" {...group("mouth")}>
              <Ops ops={parts.mouth} palette={palette} uid={`${uid}-m`} />
            </g>
            {moving && (
              <g className="frog-tongue" {...group("tongue")}>
                <Ops ops={frogTongueOps(FLY_AT, 1, ow)} palette={palette} uid={`${uid}-tg`} />
              </g>
            )}
            <Ops ops={parts.extras} palette={palette} uid={`${uid}-x`} />
          </g>
        </g>
        {moving && (
          <g className="frog-arms" ref={own("arms")}>
            {!live && <Ops ops={[...frogArmOps(-1, still.handLX, still.handLY, ow), ...frogArmOps(1, still.handRX, still.handRY, ow)]} palette={palette} uid={`${uid}-ar`} />}
          </g>
        )}
        <g className="frog-hand frog-hand-l" {...group("handL")}>
          <Ops ops={parts.handL} palette={palette} uid={`${uid}-hl`} />
        </g>
        <g className="frog-hand frog-hand-r" {...group("handR")}>
          <Ops ops={parts.handR} palette={palette} uid={`${uid}-hr`} />
        </g>
      </g>
      {moving && (
        <g className="frog-fly" {...group("fly")}>
          <Ops ops={frogFlyOps(FLY_AT, 0.4, ow)} palette={palette} uid={`${uid}-fl`} />
        </g>
      )}
      {moving && (
        <g className="frog-water" ref={own("water")}>
          {!live && <Ops ops={frogWaterOps(still.water, u, ow)} palette={palette} uid={`${uid}-wt`} />}
        </g>
      )}
      {headFx?.around && <g className="skin-fx-around">{headFx.around}</g>}
    </svg>
  );
}

const seconds = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

type Discrete = Pick<FrogPose, "expression" | "mouth">;
const sameDiscrete = (a: Discrete | null, b: Discrete | null) => a === b || (!!a && !!b && a.expression === b.expression && a.mouth === b.mouth);

/** Redraws a group's content only when what it shows changed (legs and the pond move by their geometry). */
function redraw(node: SVGGElement | null | undefined, key: string, svg: () => string): void {
  if (!node || node.dataset.k === key) return;
  node.dataset.k = key;
  node.innerHTML = svg();
}

export function FrogMascot({ skin = "plain", color, size = 44, mood = "idle", expression, animated = true, detail, move, moveBody = false, activity = null, rig: alwaysRig = false, label = null, className }: FrogMascotProps) {
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
  const frogMove = frogMoveFor(move?.clip);
  // a move of its own (a hop, a croak...) moves the parts; a skin's body motion only for the others
  useReplayMove(body, burst && moveBody && !frogMove ? burst.key : null);
  const groups = useRef<FrogGroups>({});
  const engine = useRef<FrogRig | null>(null);
  const [discrete, setDiscrete] = useState<Discrete | null>(null);
  const [running, setRunning] = useState(false);
  const keepRunning = useRef(alwaysRig || activity !== null);
  keepRunning.current = alwaysRig || activity !== null;
  const moveKey = move?.key ?? 0;
  const ow = frogOutline(size);
  const paletteRef = useRef(paint.palette);
  paletteRef.current = paint.palette;

  // the rig lives while the drawing is live
  useEffect(() => {
    if (!live) {
      engine.current = null;
      return;
    }
    engine.current = new FrogRig(seconds());
    if (keepRunning.current) setRunning(true);
    return () => {
      engine.current = null;
    };
  }, [live]);

  // a held activity (hopping along, sunk, asleep on a pad, talking...)
  useEffect(() => {
    if (!live) return;
    engine.current?.hold(activity, seconds());
    if (activity || alwaysRig) setRunning(true);
  }, [activity, alwaysRig, live]);

  // a one-shot move, once per request
  const lastMove = useRef(0);
  useEffect(() => {
    if (!live || !frogMove || !moveKey || moveKey === lastMove.current) return;
    lastMove.current = moveKey;
    engine.current?.play(frogMove, seconds());
    setRunning(true);
  }, [live, frogMove, moveKey]);

  // under reduced motion a move shows its face (and its pond or pad), still, for as long as it lasts
  const [stillFace, setStillFace] = useState<ReturnType<typeof frogReducedFace>>(null);
  useEffect(() => {
    if (live || !animated || !frogMove || !moveKey) return;
    const face = frogReducedFace(frogMove);
    if (!face) return;
    setStillFace(face);
    const timer = setTimeout(() => setStillFace(null), FROG_TRACKS[frogMove].duration * 1000);
    return () => clearTimeout(timer);
  }, [live, animated, frogMove, moveKey]);
  const heldFace = !live && animated && activity ? frogReducedFace(activity) : null;
  const reducedShown = stillFace ?? heldFace;

  const shown = (running && live ? discrete : null) ?? reducedShown;
  const face = shown?.expression ?? expression ?? frogExpressionForMood(mood);
  const faceRef = useRef(face);
  faceRef.current = face;

  // the loop: one pose per animation frame, written straight onto the groups
  useEffect(() => {
    if (!running || !live) return;
    let raf = 0;
    const clear = () => {
      for (const [key, node] of Object.entries(groups.current)) {
        if (!node) continue;
        if (key === "legs" || key === "haunches" || key === "arms" || key === "water") {
          node.innerHTML = "";
          delete node.dataset.k;
        } else node.removeAttribute("transform");
      }
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const run = engine.current;
      if (!run || document.hidden || root.current?.hasAttribute("data-fx-paused")) return;
      const now = seconds();
      const pose = run.pose(now);
      const u = run.moveTime(now);
      const transforms = frogTransforms(pose, { lids: frogLids(faceRef.current, ow), u });
      for (const key of Object.keys(transforms) as FrogGroup[]) groups.current[key]?.setAttribute("transform", transforms[key]);
      const palette = paletteRef.current;
      const legs = Math.round(pose.legs * 50) / 50;
      redraw(groups.current.legs, String(legs), () => frogOpsToSvg([...frogLegOps(-1, legs, ow), ...frogLegOps(1, legs, ow)], palette, `${uid}-lg${legs}`));
      redraw(groups.current.haunches, String(legs), () => frogOpsToSvg([...frogHaunchOps(-1, legs, ow), ...frogHaunchOps(1, legs, ow)], palette, `${uid}-hn${legs}`));
      const arms = [pose.handLX, pose.handLY, pose.handRX, pose.handRY].map((v) => Math.round(v * 2) / 2);
      redraw(groups.current.arms, arms.join(","), () => frogOpsToSvg([...frogArmOps(-1, arms[0], arms[1], ow), ...frogArmOps(1, arms[2], arms[3], ow)], palette, `${uid}-ar`));
      // the pond ripples while it shows (about 20 redraws a second), and stays empty otherwise
      const water = pose.water < 99.5 ? `${Math.round(pose.water * 4) / 4}:${Math.round(now * 20)}` : "none";
      redraw(groups.current.water, water, () => frogOpsToSvg(frogWaterOps(pose.water, now, ow), palette, `${uid}-wt`));
      const next: Discrete = { expression: pose.expression, mouth: pose.mouth };
      setDiscrete((prev) => (sameDiscrete(prev, next) ? prev : next));
      if (!keepRunning.current && !run.busy(now)) {
        cancelAnimationFrame(raf);
        clear();
        setDiscrete(null);
        setRunning(false);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clear();
    };
  }, [running, live, ow, uid]);

  const palette = fxPalette(paint.fx, hex);
  const rigOn = running && live;
  // reduced motion: a held pond or pad shows as a still frame
  const stillPose = !rigOn && reducedShown && (reducedShown.water < 100 || reducedShown.pad > 0) ? { ...frogRestPose(), water: reducedShown.water, pad: reducedShown.pad } : null;
  return (
    <span
      ref={root}
      className={cn("frog-mascot relative inline-flex shrink-0", animated && `frog-live frog-mood-${mood}`, rigOn && "frog-rig", live && "skin-fx-live", className)}
      style={{ width: size, height: size }}
      data-character="frog"
      data-frog-skin={known}
      data-skin-tier={FROG_SKIN_TIER[known]}
      data-expression={face}
      data-fx={full ? "full" : "static"}
      data-frog-move={frogMove ?? undefined}
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
        mouth={shown?.mouth ?? null}
        full={full}
        groups={rigOn ? groups : undefined}
        pose={stillPose}
        svgRef={body}
        svgClass={cn(burst && moveBody && !frogMove && `fx-body-move fx-body-${burst.move}`, equip && "fx-equip-pop", full && paint.bodyClass)}
        defs={paint.defs}
      />
      {equip && <EquipFx key={equip} palette={palette} uid={`${uid}-eq`} />}
      {burst && <MoveFx key={burst.key} move={burst.move} palette={palette} uid={`${uid}-mv`} path={FROG_ART.head} />}
    </span>
  );
}
