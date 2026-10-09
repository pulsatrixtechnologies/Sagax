// Ogre, the big green ogre (an original character, ogre-art.ts: direction C,
// "aplat net"), in the bot's color and an Ogre skin (skin-fx/ogre-skins.tsx).
// Pure SVG: the drawing is the rig's layers (ogre-moves.ts ogreFrameLayers),
// each part its own group (the whole, the legs, the body and its belly, the
// arms, the head, the ears, the eyes, the mouth). Small avatars draw a skin's
// still look (no filter, nothing moving) and the bust under 48 px; larger
// ones breathe, blink and wiggle a trumpet in CSS (ogre-mascot.css) and play
// a skin's idle effect, equip animation and move effects. Reduced motion
// keeps it still.
import "./ogre-mascot.css";
import "./skin-fx/skin-fx.css";
import { memo, useId, useMemo, useRef, type ReactNode, type Ref } from "react";
import { MAUS_COLORS } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { OGRE_SKIN_TIER, type OgreSkin } from "../../shared/mascot-look";
import { LOG_DROP, movePath, OGRE_ART, OGRE_PIVOTS, ogreViewBox, type OgreExpression, type OgreOp, type OgrePalette } from "./ogre-art";
import { ogreFrameLayers, restFrame, type OgreFrame, type OgreLayer } from "./ogre-rig";
import { ogreSkinId, ogreSkinLayers, ogreSkinPaint } from "./skin-fx/ogre-skins";
import { EquipFx, MoveFx } from "./skin-fx/SkinFx";
import { fxDetail, fxPalette, useEquipBurst, useFxVisibility, useMoveBurst, useReducedMotion, useReplayMove, type FxDetail, type FxMoveRequest } from "./skin-fx/skin-fx";

export type OgreMood = "idle" | "thinking" | "working" | "happy" | "sleeping" | "listening" | "speaking";

/** The face a mood wears (the five approved moods, and the call's listening and speaking). */
export function ogreExpressionForMood(mood: OgreMood): OgreExpression {
  switch (mood) {
    case "thinking":
      return "curious";
    case "working":
    case "listening":
      return "attentive";
    case "happy":
      return "happy";
    case "sleeping":
      return "sleepy";
    case "speaking":
      return "excited";
    default:
      return "neutral";
  }
}

export interface OgreMascotProps {
  skin?: OgreSkin | string;
  /** A bot color name (green) or any hex. */
  color: string;
  size?: number;
  mood?: OgreMood;
  /** A face of its own, over the mood's (one of the sixteen). */
  expression?: OgreExpression;
  /** Off draws a still frame (thumbnails, reduced motion). */
  animated?: boolean;
  detail?: FxDetail;
  /** A one-shot move: its skin effect, and with moveBody the body's own motion. */
  move?: FxMoveRequest | null;
  moveBody?: boolean;
  label?: string | null;
  className?: string;
}

export const hexOf = (color: string) => (MAUS_COLORS as Record<string, string>)[color] ?? (/^#[0-9a-fA-F]{6}$/.test(color) ? color : MAUS_COLORS.green);

/** Ops as SVG elements with a palette; `uid` keeps clip ids apart. */
export function OgreOpsSvg({ ops, palette, uid }: { ops: readonly OgreOp[]; palette: OgrePalette; uid: string }) {
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

const Ops = memo(OgreOpsSvg);

/** Each layer's pivot (CSS idle loops turn about it), box units. */
const PIVOT: Partial<Record<string, readonly [number, number]>> = {
  whole: OGRE_PIVOTS.ground,
  earL: OGRE_PIVOTS.earL,
  earR: OGRE_PIVOTS.earR,
  eyeL: OGRE_PIVOTS.eyeL,
  eyeR: OGRE_PIVOTS.eyeR,
  mouth: OGRE_PIVOTS.mouth,
  belly: OGRE_PIVOTS.belly,
};

const CLASS: Partial<Record<string, string>> = {
  whole: "ogre-whole",
  body: "ogre-body",
  belly: "ogre-belly",
  head: "ogre-head",
  earL: "ogre-ear ogre-ear-l",
  earR: "ogre-ear ogre-ear-r",
  eyeL: "ogre-eye",
  eyeR: "ogre-eye",
  mouth: "ogre-mouth",
  props: "ogre-props",
};

interface SkinLayers {
  head: ReturnType<typeof ogreSkinLayers>;
  body: ReturnType<typeof ogreSkinLayers>;
}

function clippedLayer(id: string, d: string, layer: ReactNode) {
  if (!layer) return null;
  return (
    <g>
      <clipPath id={id}>
        <path d={d} />
      </clipPath>
      <g clipPath={`url(#${id})`}>{layer}</g>
    </g>
  );
}

/** The rig's layers as SVG groups, the skin's treatment on the head and the body. */
function Layers({ layers, palette, uid, fx, bodyPath }: { layers: readonly OgreLayer[]; palette: OgrePalette; uid: string; fx: SkinLayers; bodyPath: string }) {
  return (
    <>
      {layers.map((layer) => {
        const pivot = PIVOT[layer.key];
        const children = layer.children ? <Layers layers={layer.children} palette={palette} uid={`${uid}-${layer.key}`} fx={fx} bodyPath={bodyPath} /> : null;
        return (
          <g key={layer.key} transform={layer.transform || undefined} className={CLASS[layer.key]} style={pivot ? { transformOrigin: `${pivot[0]}px ${pivot[1]}px` } : undefined}>
            {layer.key === "head" && fx.head?.under}
            {layer.key === "body" && fx.body?.under}
            <Ops ops={layer.ops} palette={palette} uid={`${uid}-${layer.key}`} />
            {layer.key === "body" && clippedLayer(`${uid}-bclip`, bodyPath, fx.body?.inner)}
            {layer.key === "body" && fx.body?.edge}
            {layer.key === "skull" && clippedLayer(`${uid}-hclip`, OGRE_ART.head, fx.head?.inner)}
            {layer.key === "skull" && fx.head?.edge}
            {children}
          </g>
        );
      })}
    </>
  );
}

export interface OgreDrawingProps {
  uid: string;
  palette: OgrePalette;
  skin: OgreSkin;
  hex: string;
  size: number;
  frame: OgreFrame;
  full: boolean;
  svgRef?: Ref<SVGSVGElement>;
  svgClass?: string;
  defs?: ReactNode;
  marks?: ReturnType<typeof ogreSkinPaint>["marks"];
}

/** One drawing of Ogre at a frame (the still rest frame, or the rig's). */
export function OgreDrawing({ uid, palette, skin, hex, size, frame, full, svgRef, svgClass, defs, marks }: OgreDrawingProps) {
  const layers = useMemo(() => ogreFrameLayers(frame, { size, marks }), [frame, size, marks]);
  const bodyPath = frame.stance === "rest" ? OGRE_ART.body : frame.stance === "log" ? movePath(OGRE_ART.torso, 0, LOG_DROP) : OGRE_ART.torso;
  const head = useMemo(() => ogreSkinLayers(skin, OGRE_ART.head, hex, `${uid}-hf`, full, "head"), [skin, hex, uid, full]);
  const body = useMemo(() => ogreSkinLayers(skin, bodyPath, hex, `${uid}-bf`, full), [skin, bodyPath, hex, uid, full]);
  const box = frame.stance === "rest" ? ogreViewBox(size) : "0 0 100 100";
  return (
    <svg viewBox={box} width="100%" height="100%" ref={svgRef} className={svgClass} style={{ overflow: "visible", display: "block" }} data-stance={frame.stance}>
      {(defs || head?.defs || body?.defs) && (
        <defs>
          {defs}
          {head?.defs}
          {body?.defs}
        </defs>
      )}
      <Layers layers={layers} palette={palette} uid={uid} fx={{ head, body }} bodyPath={bodyPath} />
      {head?.around && <g className="skin-fx-around">{head.around}</g>}
    </svg>
  );
}

export function OgreMascot({ skin = "plain", color, size = 44, mood = "idle", expression, animated = true, detail, move, moveBody = false, label = null, className }: OgreMascotProps) {
  const known = ogreSkinId(skin);
  const hex = hexOf(color);
  const reduced = useReducedMotion();
  const full = fxDetail(size, animated, detail) === "full";
  const live = full && !reduced;
  const uid = `ogre-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const paint = useMemo(() => ogreSkinPaint(known, hex, uid), [known, hex, uid]);
  const root = useRef<HTMLSpanElement>(null);
  useFxVisibility(root, live);
  const equip = useEquipBurst(known, live);
  const burst = useMoveBurst(move, live);
  const svg = useRef<SVGSVGElement>(null);
  useReplayMove(svg, burst && moveBody ? burst.key : null);
  const face = expression ?? ogreExpressionForMood(mood);
  const frame = useMemo(() => restFrame("rest", face), [face]);
  const fxPal = fxPalette(paint.fx, hex);
  return (
    <span
      ref={root}
      className={cn("ogre-mascot relative inline-flex shrink-0", animated && `ogre-live ogre-mood-${mood}`, live && "skin-fx-live", className)}
      style={{ width: size, height: size }}
      data-character="ogre"
      data-ogre-skin={known}
      data-skin-tier={OGRE_SKIN_TIER[known]}
      data-expression={frame.expression}
      data-fx={full ? "full" : "static"}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      <OgreDrawing
        uid={uid}
        palette={paint.palette}
        skin={known}
        hex={hex}
        size={size}
        frame={frame}
        full={full}
        svgRef={svg}
        svgClass={cn(burst && moveBody && `fx-body-move fx-body-${burst.move}`, equip && "fx-equip-pop")}
        defs={paint.defs}
        marks={paint.marks}
      />
      {equip && <EquipFx key={equip} palette={fxPal} uid={`${uid}-eq`} />}
      {burst && <MoveFx key={burst.key} move={burst.move} palette={fxPal} uid={`${uid}-mv`} path={OGRE_ART.head} />}
    </span>
  );
}
