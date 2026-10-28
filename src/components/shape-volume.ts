// The shapes' pose and paint (2026-10-18): our own outlines (shape-art.ts),
// each drawn as a solid, softly rounded body in one flat colour, the bot's own
// (no gradient, no highlight, no filter, no raster: crisp at any size).
// - The body is a few slices of one outline, stacked in depth and turned with
//   the pose (yaw, pitch, a little roll), so it shows a side when it turns.
// - A turn out of the picture plane also bends the outline in a gentle
//   perspective (warpPath): the shape rounds into the turn and its top stays
//   on top, instead of rocking flat.
// - Two opaque eyes in a solid ink (dark, or light on a dark body), capsules
//   at rest, wide ovals while busy, full arches when pleased (styledEyes).
// - Every shape stands on the same ground (groundLift) at a size of its own
//   (SHAPE_FIT), so a list of bots rests on one line.
// ShapeMascot.tsx draws it and shape-motion.ts moves it.
import { eyeOutline, mixHex } from "./shape-engine";
import { radiusAt, SHAPE_RADII, smoothClosed } from "./shape-art";
import { MASCOT_SHAPES, type MascotShape } from "../../shared/mascot-look";

/**
 * The resting pose: `yaw` degrees to the right, `pitch` degrees up, `roll`
 * degrees in the picture plane, the scale in the box and a lift (box units,
 * up is negative) that sets the ground. Every slice of the body is a turned
 * copy of one outline, so the silhouette is a few <use> of one path.
 */
export const POSE = { yaw: 14, pitch: 10, roll: -6, scale: 0.83, lift: -4.6 } as const;

/** The body's half thickness (box units) and how its edge rounds: a slice at depth z is scaled by core + (1 - core) * sqrt(1 - (z / depth)^2). */
export const BODY_3D = { depth: 15, core: 0.86, slices: { tiny: 4, small: 6, full: 9 } } as const;

/** Below `small` px the hairline of a white or black body is drawn thicker. */
export const VOLUME_SIZES = { small: 20, full: 28 } as const;

export type VolumeDetail = "tiny" | "small" | "full";

export function volumeDetail(size: number): VolumeDetail {
  if (size < VOLUME_SIZES.small) return "tiny";
  if (size < VOLUME_SIZES.full) return "small";
  return "full";
}

const RAD = Math.PI / 180;
type M3 = [number, number, number, number, number, number, number, number, number];
const mul = (p: M3, q: M3): M3 => [
  p[0] * q[0] + p[1] * q[3] + p[2] * q[6], p[0] * q[1] + p[1] * q[4] + p[2] * q[7], p[0] * q[2] + p[1] * q[5] + p[2] * q[8],
  p[3] * q[0] + p[4] * q[3] + p[5] * q[6], p[3] * q[1] + p[4] * q[4] + p[5] * q[7], p[3] * q[2] + p[4] * q[5] + p[5] * q[8],
  p[6] * q[0] + p[7] * q[3] + p[8] * q[6], p[6] * q[1] + p[7] * q[4] + p[8] * q[7], p[6] * q[2] + p[7] * q[5] + p[8] * q[8],
];

/** A pose at one moment: the turn (degrees), the scale and a small lift (box units, up is negative). */
export interface Pose {
  yaw: number;
  pitch: number;
  roll: number;
  scale: number;
  lift: number;
}

/**
 * Every shape stands on the same ground: its lowest point sits where the
 * pebble's does (stored id bean, the shape the rest pose was measured on), so a sidebar of bots
 * rests on one line instead of each floating at its own height. Box units.
 */
export function groundLift(shape: MascotShape): number {
  const down = (s: MascotShape) => radiusAt(SHAPE_RADII[s], Math.PI) * SHAPE_FIT[s];
  return POSE.scale * 40 * (down("bean") - down(shape));
}

/** The size every shape is drawn at, as if it were a circle of this many R. */
export const FIT = { circle: 0.9, min: 0.78, max: 1.04, reach: 1.08 } as const;

/**
 * Each shape's size in the frame (2026-10-28, measured, no longer set by eye
 * per shape): a body is drawn at the size of a circle of the same area, so a
 * narrow tube and a wide cloud look alike in a list, never reaching past
 * FIT.reach R from the middle.
 */
export function shapeFit(shape: MascotShape): number {
  const radii = SHAPE_RADII[shape];
  const area = radii.reduce((sum, r) => sum + r * r, 0) * (Math.PI / radii.length);
  const reach = radii.reduce((most, r) => Math.max(most, r), 0);
  const fit = FIT.circle * Math.sqrt(Math.PI / area);
  return Math.round(Math.min(FIT.max, FIT.reach / reach, Math.max(FIT.min, fit)) * 1000) / 1000;
}

export const SHAPE_FIT: Readonly<Record<MascotShape, number>> = Object.fromEntries(MASCOT_SHAPES.map((shape) => [shape, shapeFit(shape)])) as Record<MascotShape, number>;

/** The resting pose. */
export const REST_POSE: Pose = { yaw: POSE.yaw, pitch: POSE.pitch, roll: POSE.roll, scale: POSE.scale, lift: POSE.lift };

/** The pose's rotation (x right, y down, z toward the viewer): pitch, then yaw, then roll. */
export function poseRotation(pose: Pose = REST_POSE): M3 {
  const p = pose.pitch * RAD;
  const y = pose.yaw * RAD;
  const r = pose.roll * RAD;
  const rx: M3 = [1, 0, 0, 0, Math.cos(p), -Math.sin(p), 0, Math.sin(p), Math.cos(p)];
  const ry: M3 = [Math.cos(y), 0, Math.sin(y), 0, 1, 0, -Math.sin(y), 0, Math.cos(y)];
  const rz: M3 = [Math.cos(r), -Math.sin(r), 0, Math.sin(r), Math.cos(r), 0, 0, 0, 1];
  return mul(rz, mul(ry, rx));
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** How much a turn narrows the body (a fraction of 1 - cos(angle)): kept light so a shape never looks squashed. */
export const TURN_SQUASH = 0;

/**
 * The slice of the body at depth z (box units), scaled by s, as an SVG matrix
 * around the box's middle. A soft 3D: the outline is never sheared, only
 * turned in the picture plane (roll), narrowed a little along its own axes by
 * the yaw and the pitch, and moved along the depth's direction, so every
 * slice is the same clean shape and the silhouette stays the shape itself.
 */
function sliceMatrix(z: number, s: number, pose: Pose, _R?: M3): string {
  const [a, b, c, d, e, f] = sliceNumbers(z, s, pose);
  return `matrix(${round4(a)} ${round4(b)} ${round4(c)} ${round4(d)} ${round4(e)} ${round4(f)})`;
}

/** An SVG matrix as its six numbers (a b c d e f). */
export type Affine = [number, number, number, number, number, number];

function sliceNumbers(z: number, s: number, pose: Pose): Affine {
  const k = pose.scale;
  const yaw = pose.yaw * RAD;
  const pitch = pose.pitch * RAD;
  const roll = pose.roll * RAD;
  const sx = s * k * (1 - TURN_SQUASH * (1 - Math.cos(yaw)));
  const sy = s * k * (1 - TURN_SQUASH * (1 - Math.cos(pitch)));
  // the depth shows toward the turn: the face moves up and right, the back down and left
  const dx = z * Math.sin(yaw) * k;
  const dy = -z * Math.sin(pitch) * k;
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const a = cr * sx;
  const b = sr * sx;
  const c = -sr * sy;
  const d = cr * sy;
  const tx = cr * dx - sr * dy;
  const ty = sr * dx + cr * dy;
  const e = 50 + tx - (a * 50 + c * 50);
  const f = 50 + pose.lift + ty - (b * 50 + d * 50);
  return [a, b, c, d, e, f];
}

const sliceScale = (z: number) => BODY_3D.core + (1 - BODY_3D.core) * Math.sqrt(Math.max(0, 1 - (z / BODY_3D.depth) ** 2));
const FRONT = BODY_3D.depth * 0.82;

/** The eyes sit on the face's dome, in front of the flat face: they move further up and right as the body turns. */
export const EYE_DOME = 1.25;

/** Every matrix of one pose: the slices behind the face (back to front), the face, and the eyes on its dome. */
export interface PoseMatrices {
  slices: string[];
  face: string;
  eyes: string;
  /** Where the face's outline sits seen from the eyes' own space (they are clipped to it, so a turn never lifts them off the body). */
  eyesClip: string;
}

/**
 * `depth` is the body's thickness now as a share of its resting one
 * (ShapeFrame.depth): a body shrunk to a dot or a bar by a move is that much
 * thinner, so its slices stay inside its own outline instead of smearing it
 * along the turn (a thought dot drawn as a pill).
 */
export function poseMatrices(detail: VolumeDetail, pose: Pose = REST_POSE, depth = 1): PoseMatrices {
  const R = poseRotation(pose);
  const n = BODY_3D.slices[detail];
  const k = Math.min(1, Math.max(0, Number.isFinite(depth) ? depth : 1));
  const slices = Array.from({ length: n - 1 }, (_, i) => {
    const z = -BODY_3D.depth + ((FRONT + BODY_3D.depth) * i) / (n - 1);
    return sliceMatrix(z * k, sliceScale(z), pose, R);
  });
  // the eyes and the face share their linear part and differ by a shift along the
  // depth's direction; seen from the eyes' space the face's outline is that shift undone
  const dz = FRONT * k * (1 - EYE_DOME);
  const lx = (dz * Math.sin(pose.yaw * RAD)) / (sliceScale(FRONT) * (1 - TURN_SQUASH * (1 - Math.cos(pose.yaw * RAD))));
  const ly = (-dz * Math.sin(pose.pitch * RAD)) / (sliceScale(FRONT) * (1 - TURN_SQUASH * (1 - Math.cos(pose.pitch * RAD))));
  return {
    slices,
    face: sliceMatrix(FRONT * k, sliceScale(FRONT), pose, R),
    eyes: sliceMatrix(FRONT * EYE_DOME * k, sliceScale(FRONT), pose, R),
    eyesClip: `translate(${round4(lx)} ${round4(ly)})`,
  };
}

/** The resting face's matrix (skins, the badge and a move's extras sit on it). */
export const viewTransform = (pose: Pose = REST_POSE): string => poseMatrices("small", pose).face;

/**
 * The turn out of the picture plane, as a gentle perspective
 * on the outline itself: a shape turned to its right narrows a little and its
 * near side grows taller than its far side; tilted up, its top widens. The
 * top stays on top (a heart's lobes never tip over) and the shape rounds into
 * the turn like a solid, instead of rocking flat.
 */
export const OUT_OF_PLANE = { perspective: 0.34, narrow: 0.3 } as const;

/** One point of the outline (box units) under the pose's out-of-plane turn. */
export function warpPoint(x: number, y: number, sy: number, cy: number, sp: number, cp: number): [number, number] {
  const u = (x - 50) / 40;
  const v = (y - 50) / 40;
  const across = 1 - OUT_OF_PLANE.narrow * (1 - cy);
  const down = 1 - OUT_OF_PLANE.narrow * (1 - cp);
  const tall = 1 + OUT_OF_PLANE.perspective * u * sy;
  const wide = 1 - OUT_OF_PLANE.perspective * v * sp;
  return [50 + 40 * u * across * wide, 50 + 40 * v * down * tall];
}

/** A path (absolute M/C/L/Q/Z with number pairs, as the engine writes them) under the pose's out-of-plane turn. */
export function warpPath(d: string, pose: Pose): string {
  if (!d) return d;
  const sy = Math.sin(pose.yaw * RAD);
  const cy = Math.cos(pose.yaw * RAD);
  const sp = Math.sin(pose.pitch * RAD);
  const cp = Math.cos(pose.pitch * RAD);
  // the engine writes absolute commands with number pairs (x y): bend each pair
  const out: string[] = [];
  const re = /([A-Za-z])|(-?\d*\.?\d+(?:e-?\d+)?)/g;
  let x: number | null = null;
  for (const m of d.matchAll(re)) {
    if (m[1]) {
      out.push(m[1]);
      continue;
    }
    const v = Number(m[2]);
    if (x === null) {
      x = v;
      continue;
    }
    const [wx, wy] = warpPoint(x, v, sy, cy, sp, cp);
    const last = out[out.length - 1];
    // a space between two pairs that follow one another (C x y x y x y)
    out.push(`${last && !/[A-Za-z]$/.test(last) ? " " : ""}${round2(wx)} ${round2(wy)}`);
    x = null;
  }
  return out.join("");
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The face's matrix as numbers (the slice the eyes sit on). */
export function faceNumbers(pose: Pose, depth = 1): Affine {
  const k = Math.min(1, Math.max(0, Number.isFinite(depth) ? depth : 1));
  return sliceNumbers(FRONT * k, sliceScale(FRONT), pose);
}

/** The body's motion (ShapeFrame.motion: shift, turn about the middle, scale about the middle) as numbers. */
export function motionNumbers(motion: { x: number; y: number; rot: number; sx: number; sy: number }): Affine {
  const r = motion.rot * RAD;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // translate(x y) rotate(rot 50 50) translate(50 50) scale(sx sy) translate(-50 -50)
  const a = cos * motion.sx;
  const b = sin * motion.sx;
  const c = -sin * motion.sy;
  const d = cos * motion.sy;
  // the middle (50, 50) stays put under the scale and the turn, then the shift
  const e = motion.x + 50 - (a * 50 + c * 50);
  const f = motion.y + 50 - (b * 50 + d * 50);
  return [a, b, c, d, e, f];
}

const apply = (m: Affine, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const compose = (p: Affine, q: Affine): Affine => [
  p[0] * q[0] + p[2] * q[1],
  p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3],
  p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4],
  p[1] * q[4] + p[3] * q[5] + p[5],
];

/** The face's matrix in the drawing's own space: the body's motion, then the face (where the posed eyes are measured). */
export function faceInDrawing(motion: { x: number; y: number; rot: number; sx: number; sy: number }, pose: Pose, depth = 1): Affine {
  return compose(motionNumbers(motion), faceNumbers(pose, depth));
}

/** One eye placed on the drawing: its middle, its size and the face's tilt (drawing units). */
export interface PosedEye {
  x: number;
  y: number;
  w: number;
  h: number;
  tilt: number;
}

/**
 * The eyes on the posed body, in the drawing's own space (2026-10-28). Only
 * each eye's middle follows the body (the bend, the face's turn, the body's
 * motion); its shape is the engine's upright capsule at one even scale, so no
 * roll, squash or perspective of the body ever bends, tilts or splits the
 * eyes, and the two eyes stay one level pair of the same size.
 */
export function posedEyes(frame: { body?: string; eyeShapes: readonly { x: number; y: number; w: number; h: number; tilt: number }[]; motion: { x: number; y: number; rot: number; sx: number; sy: number }; depth?: number }, pose: Pose, bend = true): PosedEye[] {
  const eyes = frame.eyeShapes;
  if (!eyes.length) return [];
  const m = faceInDrawing(frame.motion, pose, frame.depth ?? 1);
  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const sy = Math.sin(pose.yaw * RAD);
  const cy = Math.cos(pose.yaw * RAD);
  const sp = Math.sin(pose.pitch * RAD);
  const cp = Math.cos(pose.pitch * RAD);
  const centers = eyes.map((eye) => {
    const [wx, wy] = bend ? warpPoint(eye.x, eye.y, sy, cy, sp, cp) : [eye.x, eye.y];
    return apply(m, wx, wy);
  });
  let placed = eyes.map((eye, i) => ({ x: centers[i][0], y: centers[i][1], w: eye.w * scale, h: eye.h * scale, tilt: eye.tilt }));
  if (placed.length === 2) {
    // one level pair: same middle and the same distance apart as the turned body gives them
    const midX = (placed[0].x + placed[1].x) / 2;
    const midY = (placed[0].y + placed[1].y) / 2;
    const half = Math.hypot(placed[1].x - placed[0].x, placed[1].y - placed[0].y) / 2;
    const side = placed[0].x <= placed[1].x ? 1 : -1;
    placed[0] = { ...placed[0], x: midX - half * side, y: midY };
    placed[1] = { ...placed[1], x: midX + half * side, y: midY };
  }
  // the engine fits the eyes in the resting outline; a hard turn or squash can move the
  // outline under them: gather the pair toward the body's middle, then shrink it, until
  // both sit inside the outline the drawing shows
  const onDrawing = (x: number, y: number) => {
    const [wx, wy] = bend ? warpPoint(x, y, sy, cy, sp, cp) : [x, y];
    return apply(m, wx, wy);
  };
  const body = outlinePoints(frame.body ?? "").map(([x, y]) => onDrawing(x, y));
  if (body.length > 2) {
    const [bx, by] = onDrawing(50, 50);
    const fits = (pair: PosedEye[]) => pair.every((eye) => eyeOutline(eye.x, eye.y, eye.w * 1.1, eye.h * 1.06, eye.tilt).every(([x, y]) => insidePolygon(body, x, y)));
    for (let i = 0; i < 24 && !fits(placed); i += 1) {
      const pull = i < 12 ? 0.1 : 0;
      const shrink = i < 12 ? 1 : 0.92;
      const midX = placed.reduce((sum, eye) => sum + eye.x, 0) / placed.length;
      const midY = placed.reduce((sum, eye) => sum + eye.y, 0) / placed.length;
      const nx = midX + (bx - midX) * pull;
      const ny = midY + (by - midY) * pull;
      placed = placed.map((eye) => ({ ...eye, x: nx + (eye.x - midX) * shrink, y: ny, w: eye.w * shrink, h: eye.h * shrink }));
    }
  }
  return placed;
}

/** The on-curve points of a path the engine wrote (M, then C's end points). */
function outlinePoints(d: string): [number, number][] {
  if (!d) return [];
  const n = d.match(/-?\d*\.?\d+(?:e-?\d+)?/g)?.map(Number) ?? [];
  const pts: [number, number][] = [[n[0], n[1]]];
  for (let i = 2; i + 5 < n.length; i += 6) pts.push([n[i + 4], n[i + 5]]);
  return pts;
}

function insidePolygon(poly: readonly [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The posed eyes as one path (closed capsules). */
export function posedEyesPath(eyes: readonly PosedEye[]): string {
  return eyes.map((eye) => smoothClosed(eyeOutline(eye.x, eye.y, eye.w, eye.h, eye.tilt))).join("");
}

/** How a mood draws the eyes: the capsules, wide ovals (busy), or arcs (pleased, ^ ^). */
export type EyeStyle = "capsule" | "oval" | "arc";

export function eyeStyleFor(mood: string): EyeStyle {
  if (mood === "working" || mood === "streaming") return "oval";
  if (mood === "happy" || mood === "done") return "arc";
  return "capsule";
}

/** Each eye's box from the eyes' path (one closed subpath per eye). */
function eyeBoxes(eyes: string): { cx: number; cy: number; w: number; h: number }[] {
  return eyes
    .split("M")
    .filter(Boolean)
    .map((sub) => {
      const n = sub.match(/-?\d*\.?\d+(?:e-?\d+)?/g)?.map(Number) ?? [];
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let i = 0; i + 1 < n.length; i += 2) {
        x0 = Math.min(x0, n[i]);
        x1 = Math.max(x1, n[i]);
        y0 = Math.min(y0, n[i + 1]);
        y1 = Math.max(y1, n[i + 1]);
      }
      return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
    })
    .filter((b) => Number.isFinite(b.w));
}

/** The eyes drawn in a style. Capsules are the engine's own; ovals and arcs are built on each eye's box, so they follow it (pose, gaze, blink). */
export function styledEyes(eyes: string, style: EyeStyle): string {
  if (style === "capsule" || !eyes) return eyes;
  const boxes = eyeBoxes(eyes);
  // two eyes never touch: an oval or an arch stays within its share of the gap between them
  const gap = boxes.length > 1 ? Math.abs(boxes[1].cx - boxes[0].cx) : Infinity;
  return boxes
    .map(({ cx, cy, w, h }) => {
      // the eye's width holds through a blink (its height closes), so the size follows the width
      const size = Math.max(w * 2.2, 0.01);
      // a blink still closes them: the box's height follows the lid
      const open = Math.min(1, h / Math.max(w * 1.6, 0.01));
      if (style === "oval") {
        const rx = Math.min(size * 0.46, gap * 0.44);
        const ry = Math.max(0.4, size * 0.33 * open);
        return `M${round2(cx - rx)} ${round2(cy)}A${round2(rx)} ${round2(ry)} 0 1 0 ${round2(cx + rx)} ${round2(cy)}A${round2(rx)} ${round2(ry)} 0 1 0 ${round2(cx - rx)} ${round2(cy)}Z`;
      }
      // pleased (∩ ∩): a full, thick half-moon arch, low in the face and centred on the eye
      const hw = Math.min(Math.max(w * 1.35, h * 0.44), gap * 0.42);
      const hh = hw * 0.9 * Math.max(0.25, open);
      const t = Math.max(1.2, hw * 0.72);
      const y = cy + size * 0.36;
      const ix = Math.max(0.2, hw - t);
      const iy = Math.max(0.15, hh - t);
      return `M${round2(cx - hw)} ${round2(y)}A${round2(hw)} ${round2(hh)} 0 0 1 ${round2(cx + hw)} ${round2(y)}L${round2(cx + ix)} ${round2(y)}A${round2(ix)} ${round2(iy)} 0 0 0 ${round2(cx - ix)} ${round2(y)}Z`;
    })
    .join("");
}

/** What writePose last wrote on each drawing (it skips unchanged outlines and eyes). */
const written = new WeakMap<object, { key: string; body: string; eyesKey: string; eyes: string }>();

/**
 * Forget what writePose wrote on a drawing: React drew it again (its own
 * outline and eyes), so the next writePose writes everything, never trusting
 * a memo of a drawing React has since replaced.
 */
export function forgetPose(svg: object): void {
  written.delete(svg);
}

/** The frame writePose draws: the outline, the eyes as capsules, the body's motion and thickness. */
export interface PoseFrame {
  body: string;
  stem?: { d: string; opacity: number } | null;
  eyeShapes: readonly { x: number; y: number; w: number; h: number; tilt: number }[];
  motion: { x: number; y: number; rot: number; sx: number; sy: number };
  depth?: number;
}

/** The eyes of a frame on a pose, in a style, as the drawing shows them. */
export function eyesOnPose(frame: PoseFrame, pose: Pose, style: EyeStyle, bend: boolean): string {
  return styledEyes(posedEyesPath(posedEyes(frame, pose, bend)), style);
}

/**
 * Write a pose onto a drawing of ShapeFrameSvg: the turned outline, the eyes
 * on it, and the slices' and the face's matrices. The only writer of the
 * outline and the eyes between two React draws (writeShapeFrame leaves them).
 */
export function writePose(svg: Pick<SVGSVGElement, "querySelectorAll">, detail: VolumeDetail, pose: Pose, frame?: PoseFrame, style: EyeStyle = "capsule", bend = true): void {
  const depth = frame?.depth ?? 1;
  if (frame) {
    // at rest the turn holds still: the bent outline is kept and only rewritten when it changes
    const memo = written.get(svg) ?? { key: "", body: "", eyesKey: "", eyes: "" };
    const key = bend ? `${pose.yaw.toFixed(2)}|${pose.pitch.toFixed(2)}|` : "";
    if (memo.key !== key + frame.body) {
      memo.key = key + frame.body;
      memo.body = bend ? warpPath(frame.body, pose) : frame.body;
      svg.querySelectorAll("[data-shape-outline]").forEach((node) => node.setAttribute("d", memo.body));
    }
    if (frame.stem) {
      const stem = bend ? warpPath(frame.stem.d, pose) : frame.stem.d;
      const opacity = String(frame.stem.opacity);
      svg.querySelectorAll("[data-shape-stem]").forEach((node) => {
        node.setAttribute("d", stem);
        node.setAttribute("opacity", opacity);
      });
    }
    const m = frame.motion;
    const eyesKey = `${key}${pose.roll.toFixed(2)}|${pose.scale.toFixed(4)}|${pose.lift.toFixed(3)}|${depth.toFixed(3)}|${m.x.toFixed(3)} ${m.y.toFixed(3)} ${m.rot.toFixed(2)} ${m.sx.toFixed(4)} ${m.sy.toFixed(4)}|${style}|${JSON.stringify(frame.eyeShapes)}`;
    if (memo.eyesKey !== eyesKey) {
      memo.eyesKey = eyesKey;
      memo.eyes = eyesOnPose(frame, pose, style, bend);
      svg.querySelectorAll("[data-shape-eyes]").forEach((node) => node.setAttribute("d", memo.eyes));
    }
    written.set(svg, memo);
  }
  const m = poseMatrices(detail, pose, depth);
  svg.querySelectorAll("[data-pose-slice]").forEach((node) => {
    const i = Number(node.getAttribute("data-pose-slice"));
    const t = i < 0 ? m.face : m.slices[i];
    if (t) node.setAttribute("transform", t);
  });
  svg.querySelectorAll("[data-pose-face]").forEach((node) => node.setAttribute("transform", m.face));
}

const relativeLuminance = (hex: string): number => {
  const n = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};

/** The eyes' two inks, both opaque. */
export const EYE_INK = "#16181d";
export const EYE_INK_ON_DARK = "#f4f1ea";

/** One body colour's paints: the flat fill, a hairline for a near-white or near-black body (null otherwise) and the eyes' ink. */
export interface InkPaint {
  fill: string;
  edge: string | null;
  eyes: string;
}

export function inkPaint(hex: string): InkPaint {
  const lum = relativeLuminance(hex);
  return {
    fill: mixHex(hex, hex, 0),
    // a near-white body would vanish on a light ground, a near-black one on a dark ground:
    // a faint hairline of the other ink keeps its silhouette
    edge: lum > 0.7 ? "#000000" : lum < 0.03 ? "#ffffff" : null,
    eyes: lum < 0.05 ? EYE_INK_ON_DARK : EYE_INK,
  };
}
