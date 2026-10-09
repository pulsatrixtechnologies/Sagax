// Ogre's rig: one moment of the drawing (`OgreFrame`: the stance, the face,
// where the body, the belly, the head, the ears, the hands and the boots
// are, the props) and the drawing at that moment as nested groups
// (`ogreFrameLayers`), so the component (OgreMascot.tsx), the tests and the
// keyframe renders draw the same. The limbs are two bones placed by their
// hand or boot (ogre-art.ts armOps, legOps); the head hangs from the neck,
// which the body carries. The moves (ogre-moves.ts) are frames over time.
import {
  armOps,
  ellipsePath,
  eyeOps,
  legOps,
  LOG_FEET,
  mapPairs,
  movePath,
  OGRE_BODY,
  OGRE_FACES,
  OGRE_PIVOTS,
  ogreOpsToSvg,
  ogreOutline,
  ogrePalette,
  ogreParts,
  ogreViewBox,
  STANCE_HEAD,
  stancePoint,
  type OgreExpression,
  type OgreMarks,
  type OgreMouth,
  type OgreOp,
  type OgrePalette,
  type OgreParts,
  type OgreStance,
  type Point,
} from "./ogre-art";

/* ------------------------------------------------------------- frames */

/** Something a move adds around the ogre (box units, in the stance's space). */
export type OgreProp =
  | { kind: "bubble"; x: number; y: number; r: number; opacity: number }
  | { kind: "z"; x: number; y: number; size: number; opacity: number }
  | { kind: "shock"; r: number; opacity: number }
  | { kind: "star"; x: number; y: number; size: number; rot: number; opacity: number }
  | { kind: "crumb"; x: number; y: number; r: number; opacity: number }
  | { kind: "letter"; x: number; y: number; rot: number; scale: number; bite: number }
  | { kind: "dust"; x: number; y: number; r: number; opacity: number }
  | { kind: "sweat"; x: number; y: number; opacity: number }
  | { kind: "think"; x: number; y: number; r: number; opacity: number };

/** Where everything is at one moment. Box units, the stance's space. */
export interface OgreFrame {
  stance: OgreStance;
  expression: OgreExpression;
  /** A move's own mouth over the face's. */
  mouth: OgreMouth | null;
  /** The whole figure, about the ground point: offset, lean (degrees), stretch, facing. */
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
  facing: 1 | -1;
  /** The body (torso, belly, shoulders) about the hips: drop and lean. */
  bodyY: number;
  bodyRot: number;
  /** The belly's jiggle about its bottom: stretch and lift. */
  belly: { sx: number; sy: number; y: number };
  /** The head on the neck: offset, turn (degrees), size. */
  head: { x: number; y: number; rot: number; scale: number };
  /** The face's slide inside the head, -1..1 (a turn toward one side), and up or down (- up: the head thrown back). */
  look: number;
  lookY: number;
  /** Each ear's turn (degrees, + up and out), and how far both lie back (0..1). */
  ears: { l: number; r: number; back: number };
  /** The hands and the boots, stance space; open hands; which arm crosses in front. */
  hands: { l: Point; r: Point; openL: boolean; openR: boolean; front: "l" | "r" | null };
  feet: { l: Point; r: Point };
  /** The flexed biceps, 0..1. */
  bulge: number;
  /** Eyelids: 0 open, 1 shut (a blink squeezes the eyes about their middle). */
  blink: number;
  /** The mouth's height (1 rest; talking opens and closes it). */
  mouthOpen: number;
  /** The ground's shake now, box units (the desktop shakes the window by it). */
  shake: number;
  props: OgreProp[];
}

/** The resting frame of a stance. */
export function restFrame(stance: OgreStance = "rest", expression: OgreExpression = "neutral"): OgreFrame {
  const limbs = stance === "log" ? LOG_FEET : OGRE_BODY;
  return {
    stance,
    expression,
    mouth: null,
    x: 0,
    y: 0,
    rot: 0,
    sx: 1,
    sy: 1,
    facing: 1,
    bodyY: 0,
    bodyRot: 0,
    belly: { sx: 1, sy: 1, y: 0 },
    head: { x: 0, y: 0, rot: 0, scale: 1 },
    look: 0,
    lookY: 0,
    ears: { l: 0, r: 0, back: 0 },
    hands: { l: limbs.handL, r: limbs.handR, openL: false, openR: false, front: null },
    feet: { l: limbs.footL, r: limbs.footR },
    bulge: 0,
    blink: 0,
    mouthOpen: 1,
    shake: 0,
    props: [],
  };
}

/* -------------------------------------------------------- the skeleton */

/** A point turned `deg` degrees about `c`. */
export function turn(p: Point, c: Point, deg: number): Point {
  const a = (deg * Math.PI) / 180;
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  return [c[0] + dx * Math.cos(a) - dy * Math.sin(a), c[1] + dx * Math.sin(a) + dy * Math.cos(a)];
}

/** The hips' middle (the body turns about it). */
export const HIPS: Point = [50, 80];

/** A stance-space point carried by the body: its drop and its lean about the hips. */
export function bodyMove(frame: OgreFrame, p: Point): Point {
  const hips = stancePoint(HIPS, frame.stance);
  return turn([p[0], p[1] + frame.bodyY], [hips[0], hips[1] + frame.bodyY], frame.bodyRot);
}

/** Where a joint of the standing body (shoulder, hip) is in a frame. */
export const bodyPoint = (frame: OgreFrame, p: Point): Point => bodyMove(frame, stancePoint(p, frame.stance));

/** Where the neck is in a frame (the head hangs from it): the stance's head place, carried by the body (at rest, the shoulders' breath). */
export function neckPoint(frame: OgreFrame): Point {
  const head = STANCE_HEAD[frame.stance];
  const [nx, ny] = OGRE_PIVOTS.neck;
  const neck: Point = frame.stance === "rest" ? [nx, ny + frame.bodyY * 0.6] : bodyMove(frame, [nx + head.x, ny + head.y]);
  return [neck[0] + frame.head.x, neck[1] + frame.head.y];
}

/** Where a point of the head's art (the rest drawing's box) is in a frame: on the neck, turned and sized with the head. */
export function headPoint(frame: OgreFrame, p: Point): Point {
  const neck = neckPoint(frame);
  const [nx, ny] = OGRE_PIVOTS.neck;
  const scale = STANCE_HEAD[frame.stance].scale * frame.head.scale;
  return turn([neck[0] + (p[0] - nx) * scale, neck[1] + (p[1] - ny) * scale], neck, frame.head.rot);
}

/* ----------------------------------------------------------- layering */

/** One group of the drawing: an SVG transform and its ops. */
export interface OgreLayer {
  key: string;
  transform: string;
  ops: OgreOp[];
  /** Nested groups, drawn after the ops, inside the transform. */
  children?: OgreLayer[];
}

const f2 = (v: number) => String(Math.round(v * 100) / 100);

/** A transform turning `deg` about c and scaling sx, sy about it. */
const about = (c: Point, deg: number, sx = 1, sy = 1) => `translate(${f2(c[0])} ${f2(c[1])})${deg ? ` rotate(${f2(deg)})` : ""}${sx !== 1 || sy !== 1 ? ` scale(${f2(sx)} ${f2(sy)})` : ""} translate(${f2(-c[0])} ${f2(-c[1])})`;

/** The props as ops (stance space). */
export function propOps(props: readonly OgreProp[], ow: number): OgreOp[] {
  const ops: OgreOp[] = [];
  for (const prop of props) {
    if (prop.kind !== "letter" && prop.opacity <= 0.01) continue;
    switch (prop.kind) {
      case "bubble":
        ops.push({ d: ellipsePath(prop.x, prop.y, prop.r, prop.r), fill: "sweat", stroke: "line", width: ow * 0.6, opacity: prop.opacity * 0.75 }, { d: ellipsePath(prop.x - prop.r * 0.35, prop.y - prop.r * 0.4, prop.r * 0.22, prop.r * 0.16, -30), fill: "spec", opacity: prop.opacity });
        break;
      case "z": {
        const s = prop.size;
        const d = `M${f2(prop.x)} ${f2(prop.y)}L${f2(prop.x + s)} ${f2(prop.y)}L${f2(prop.x)} ${f2(prop.y + s)}L${f2(prop.x + s)} ${f2(prop.y + s)}`;
        ops.push({ d, stroke: "line", width: 2.6, round: true, opacity: prop.opacity }, { d, stroke: "tunic", width: 1.2, round: true, opacity: prop.opacity });
        break;
      }
      case "shock":
        // two arcs on each side of the head, opening outward
        for (const s of [-1, 1]) {
          const x0 = 50 + s * prop.r;
          ops.push({ d: `M${f2(x0 - s * 3)} ${f2(14 - prop.r * 0.12)}Q${f2(x0 + s * 4)} 28 ${f2(x0 - s * 3)} ${f2(42 + prop.r * 0.12)}`, stroke: "white", width: 1.8, round: true, opacity: prop.opacity });
        }
        break;
      case "star": {
        const pts: string[] = [];
        for (let i = 0; i < 8; i += 1) {
          const r = i % 2 ? prop.size * 0.42 : prop.size;
          const a = ((prop.rot + i * 45) * Math.PI) / 180;
          pts.push(`${f2(prop.x + Math.sin(a) * r)} ${f2(prop.y - Math.cos(a) * r)}`);
        }
        ops.push({ d: `M${pts.join("L")}Z`, fill: "buckle", stroke: "line", width: ow * 0.5, opacity: prop.opacity });
        break;
      }
      case "crumb":
      case "dust":
        ops.push({ d: ellipsePath(prop.x, prop.y, prop.r, prop.r * (prop.kind === "dust" ? 0.7 : 1)), fill: prop.kind === "dust" ? "tunicShade" : "logEnd", opacity: prop.opacity });
        break;
      case "sweat":
        ops.push({ d: movePath("M0 -3.4C0 -3.4 -2 -0.4 -2 1C-2 2.2 -1.1 3 0 3C1.1 3 2 2.2 2 1C2 -0.4 0 -3.4 0 -3.4Z", prop.x, prop.y), fill: "sweat", stroke: "line", width: ow * 0.5, opacity: prop.opacity });
        break;
      case "think":
        ops.push({ d: ellipsePath(prop.x, prop.y, prop.r, prop.r), fill: "white", stroke: "line", width: ow * 0.5, opacity: prop.opacity });
        break;
      case "letter": {
        // the message: an envelope, bitten one corner at a time
        const w = 9 * prop.scale;
        const h = 6.4 * prop.scale;
        const env = `M${f2(-w / 2)} ${f2(-h / 2)}L${f2(w / 2)} ${f2(-h / 2)}L${f2(w / 2)} ${f2(h / 2)}L${f2(-w / 2)} ${f2(h / 2)}Z`;
        const flap = `M${f2(-w / 2)} ${f2(-h / 2)}L0 ${f2(h * 0.1)}L${f2(w / 2)} ${f2(-h / 2)}`;
        const bite = prop.bite > 0 ? ellipsePath(w / 2, -h / 2, 2.6 * prop.bite, 2.6 * prop.bite) : null;
        const place = (d: string) => mapPairs(d, (x, y) => turn([x + prop.x, y + prop.y], [prop.x, prop.y], prop.rot));
        const body = place(env);
        ops.push({ d: body, fill: "white", stroke: "line", width: ow * 0.7 }, { d: place(flap), stroke: "line", width: ow * 0.6, round: true });
        if (bite) ops.push({ d: place(bite), fill: "skin", clip: body }, { d: place(bite), stroke: "line", width: ow * 0.6, clip: body });
        break;
      }
    }
  }
  return ops;
}

/** The last few part sets, so a frame that keeps its face and stance keeps the same ops (React skips them). */
const PARTS_CACHE = new Map<string, OgreParts>();
function cachedParts(expression: OgreExpression, mouth: OgreMouth | null, stance: OgreStance, size: number, marks: OgreMarks | null): OgreParts {
  const key = `${expression}|${mouth ?? ""}|${stance}|${size}|${marks ?? ""}`;
  const hit = PARTS_CACHE.get(key);
  if (hit) return hit;
  const parts = ogreParts({ expression, mouth, stance, size, marks });
  if (PARTS_CACHE.size > 48) PARTS_CACHE.delete(PARTS_CACHE.keys().next().value as string);
  PARTS_CACHE.set(key, parts);
  return parts;
}

/** The drawing at a frame, as nested groups (the component and the renders draw the same). `blink` closes the eyes. */
export function ogreFrameLayers(frame: OgreFrame, options: { size: number; marks?: OgreMarks | null }): OgreLayer[] {
  const { stance } = frame;
  const ow = ogreOutline(options.size);
  const expression = frame.expression;
  const parts = { ...cachedParts(expression, frame.mouth, stance, options.size, options.marks ?? null) };
  // nearly shut: the closed curve; on the way, the open eyes squeeze about their middle
  if (frame.blink > 0.8 && OGRE_FACES[expression].eyes.every((eye) => eye.kind === "open")) {
    parts.eyeL = eyeOps({ kind: "closed" }, -1, ow);
    parts.eyeR = eyeOps({ kind: "closed" }, 1, ow);
  }
  const squeeze = frame.blink > 0 && frame.blink <= 0.8 ? 1 - 0.9 * frame.blink : 1;
  const ground: Point = [50, 99];
  const whole = `translate(${f2(frame.x)} ${f2(frame.y)}) ${about(ground, frame.rot, frame.sx * frame.facing, frame.sy)}`;
  const hips = stancePoint(HIPS, stance);
  const body = `translate(0 ${f2(frame.bodyY)}) ${about(hips, frame.bodyRot)}`;
  const bellyPivot = stancePoint(OGRE_PIVOTS.belly, stance);
  const belly = `translate(0 ${f2(frame.belly.y)}) ${about(bellyPivot, 0, frame.belly.sx, frame.belly.sy)}`;
  const limbs: Pick<OgreParts, "legL" | "legR" | "armL" | "armR"> =
    stance === "rest"
      ? { legL: [], legR: [], armL: [], armR: [] }
      : {
          legL: legOps(-1, frame.feet.l, ow, { stance, root: bodyPoint(frame, OGRE_BODY.hipL) }),
          legR: legOps(1, frame.feet.r, ow, { stance, root: bodyPoint(frame, OGRE_BODY.hipR) }),
          armL: armOps(-1, frame.hands.l, ow, { stance, root: bodyPoint(frame, OGRE_BODY.shoulderL), open: frame.hands.openL, bulge: frame.bulge }),
          armR: armOps(1, frame.hands.r, ow, { stance, root: bodyPoint(frame, OGRE_BODY.shoulderR), open: frame.hands.openR, bulge: frame.bulge }),
        };
  const neck = neckPoint(frame);
  const headScale = STANCE_HEAD[stance].scale * frame.head.scale;
  const [nx, ny] = OGRE_PIVOTS.neck;
  const head = `translate(${f2(neck[0])} ${f2(neck[1])}) rotate(${f2(frame.head.rot)}) scale(${f2(headScale)}) translate(${-nx} ${-ny})`;
  const far = (side: -1 | 1) => 1 - 0.28 * Math.max(0, frame.look * side);
  const ear = (side: -1 | 1, deg: number) => {
    const pivot = side < 0 ? OGRE_PIVOTS.earL : OGRE_PIVOTS.earR;
    const back = frame.ears.back;
    return about(pivot, side * (deg - 22 * back), far(side) * (1 - 0.38 * back), 1);
  };
  const lookX = frame.look * 3.2;
  const lookY = frame.lookY * 3;
  const arms = frame.hands.front === "l" ? (["armR", "armL"] as const) : (["armL", "armR"] as const);
  return [
    {
      key: "whole",
      transform: whole,
      ops: [],
      children: [
        { key: "log", transform: "", ops: parts.log },
        { key: "legL", transform: "", ops: limbs.legL },
        { key: "legR", transform: "", ops: limbs.legR },
        { key: "body", transform: body, ops: parts.body, children: [{ key: "belly", transform: belly, ops: parts.belly }] },
        { key: arms[0], transform: "", ops: limbs[arms[0]] },
        { key: arms[1], transform: "", ops: limbs[arms[1]] },
        {
          key: "head",
          transform: head,
          ops: [],
          children: [
            { key: "earL", transform: ear(-1, frame.ears.l), ops: parts.earL },
            { key: "earR", transform: ear(1, frame.ears.r), ops: parts.earR },
            { key: "skull", transform: "", ops: parts.head },
            {
              key: "face",
              transform: lookX || lookY ? `translate(${f2(lookX)} ${f2(lookY)})` : "",
              ops: [],
              children: [
                { key: "brows", transform: "", ops: parts.brows },
                { key: "eyeL", transform: squeeze !== 1 ? about(OGRE_PIVOTS.eyeL, 0, 1, squeeze) : "", ops: parts.eyeL },
                { key: "eyeR", transform: squeeze !== 1 ? about(OGRE_PIVOTS.eyeR, 0, 1, squeeze) : "", ops: parts.eyeR },
                { key: "nose", transform: "", ops: parts.nose },
                { key: "mouth", transform: frame.mouthOpen !== 1 ? about([50, 64], 0, 1, frame.mouthOpen) : "", ops: parts.mouth },
              ],
            },
            { key: "extras", transform: "", ops: stance === "rest" ? parts.extras : parts.extras.filter((op) => op.fill) },
          ],
        },
        { key: "props", transform: "", ops: propOps(frame.props, ow) },
      ],
    },
  ];
}

/** Layers as SVG markup (renders, tests). */
export function layersToSvg(layers: readonly OgreLayer[], palette: OgrePalette, uid: string): string {
  return layers
    .map((layer) => {
      const inner = ogreOpsToSvg(layer.ops, palette, `${uid}${layer.key}`) + (layer.children ? layersToSvg(layer.children, palette, `${uid}${layer.key}`) : "");
      return layer.transform ? `<g transform="${layer.transform}">${inner}</g>` : `<g>${inner}</g>`;
    })
    .join("");
}

/** One frame as a whole SVG string (the keyframe renders, the tests). */
export function ogreFrameSvg(frame: OgreFrame, options: { size: number; color?: string | null; palette?: OgrePalette; marks?: OgreMarks | null; uid?: string }): string {
  const palette = options.palette ?? ogrePalette(options.color);
  const viewBox = frame.stance === "rest" ? ogreViewBox(options.size) : "0 0 100 100";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${options.size}" height="${options.size}" overflow="visible">${layersToSvg(ogreFrameLayers(frame, options), palette, options.uid ?? "o")}</svg>`;
}
