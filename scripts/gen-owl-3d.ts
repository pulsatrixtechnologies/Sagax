/**
 * Bakes the 3D Sagax owl into `src/components/floating-bots/owl3d/owl.glb`.
 *
 * Run with `pnpm gen:owl3d`. The model is the SAME character as the 2D owl
 * (src/lib/owl/owl-art.ts): every part is built from owl-art's own traced
 * paths (body, face mask, belly marks, wing, feet, beak, eye socket) as a
 * rounded extrusion, layered front to back, so seen from the front it is the
 * 2D owl exactly and it shows real depth when it turns. The eye keeps the
 * cute 2D look: a big round iris, pupil and highlight dot.
 *
 * It is a skinned model like three.js's RobotExpressive: one skeleton (root,
 * spine, head, two-segment near wing, far wing, tail, two legs, two ear
 * tufts, beak) with smooth weights across the neck and tail, morph targets
 * for the face (blink, sleepy, happy, sad, squint, eyes wide, beak open),
 * and an AnimationClip per mascot clip, baked from the very clips the 2D owl
 * plays (src/components/floating-bots/clips.ts) so both styles move alike.
 * The runtime (owl3d/Owl3D.tsx) recolors it per bot with owl-art's palettes.
 *
 * Original work, no third-party model: license as the repository.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AnimationClip,
  Bone,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  Path,
  Quaternion,
  QuaternionKeyframeTrack,
  Scene,
  Shape,
  ShapeGeometry,
  ShapeUtils,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Uint16BufferAttribute,
  Vector2,
  Vector3,
  VectorKeyframeTrack,
  Euler,
} from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, resample } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import { OWL_GEOM, OWL_REFERENCE, owlSvgParts, type OwlPath } from "../src/lib/owl/owl-art.ts";
import { OWL_TRACE } from "../src/lib/owl/owl-trace.ts";
import { CLIP_MS, clipPose, REST, type ClipName, type MascotFrame } from "../src/components/floating-bots/clips.ts";

/** Run from the repository root (pnpm gen:owl3d); the script itself runs bundled from a cache folder. */
const OUT = join(process.cwd(), "src/components/floating-bots/owl3d/owl.glb");

/* ----------------------------------------------------------- 2D to 3D */

/** viewBox units (x right, y down, 256 square) to model units (y up, feet on 0, 1 unit = 100 viewBox units). */
const S = 1 / 100;
const X = (x: number) => (x - 128) * S;
const Y = (y: number) => (OWL_TRACE.ground - y) * S;

/** Parses owl-art's path data (absolute M, C, L, Z only) into closed outlines. */
function outlines(d: string): Vector2[][] {
  const tokens = d.match(/[MCLZ]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const result: Vector2[][] = [];
  let current: Vector2[] = [];
  let i = 0;
  let command = "";
  const num = () => Number(tokens[i++]);
  let at = new Vector2();
  while (i < tokens.length) {
    if (/[MCLZ]/.test(tokens[i])) command = tokens[i++];
    if (command === "M") {
      if (current.length) result.push(current);
      at = new Vector2(num(), num());
      current = [at.clone()];
      command = "L";
    } else if (command === "L") {
      at = new Vector2(num(), num());
      current.push(at.clone());
    } else if (command === "C") {
      const c1 = new Vector2(num(), num());
      const c2 = new Vector2(num(), num());
      const end = new Vector2(num(), num());
      // a few samples per curve: enough for the silhouette, small file
      for (const t of [0.34, 0.67, 1]) {
        const u = 1 - t;
        current.push(
          new Vector2(
            u * u * u * at.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
            u * u * u * at.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
          ),
        );
      }
      at = end;
    } else if (command === "Z") {
      if (current.length) result.push(current);
      current = [];
    } else {
      i += 1;
    }
  }
  if (current.length) result.push(current);
  return result.filter((loop) => loop.length >= 3);
}

/** Drops points that sit within `tolerance` (viewBox units) of the line through their neighbours. */
function simplify(points: Vector2[], tolerance = 0.45): Vector2[] {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let far = 0;
    const pa = points[a];
    const pb = points[b];
    const length = pa.distanceTo(pb) || 1;
    for (let i = a + 1; i < b; i += 1) {
      const p = points[i];
      const distance = Math.abs((pb.x - pa.x) * (pa.y - p.y) - (pa.x - p.x) * (pb.y - pa.y)) / length;
      if (distance > far) {
        far = distance;
        worst = i;
      }
    }
    if (worst >= 0 && far > tolerance) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** A closed loop simplified in two halves (its start and end are the same point). */
function simplifyLoop(loop: Vector2[]): Vector2[] {
  let far = 0;
  loop.forEach((p, i) => {
    if (p.distanceTo(loop[0]) > loop[far].distanceTo(loop[0])) far = i;
  });
  if (far === 0) return loop;
  const first = simplify(loop.slice(0, far + 1));
  const second = simplify([...loop.slice(far), loop[0]]);
  return [...first, ...second.slice(1, -1)];
}

const toModel = (loop: Vector2[]) => simplifyLoop(loop).map((p) => new Vector2(X(p.x), Y(p.y)));

function inside(point: Vector2, loop: Vector2[]): boolean {
  let hit = false;
  for (let a = 0, b = loop.length - 1; a < loop.length; b = a++) {
    const pa = loop[a];
    const pb = loop[b];
    if (pa.y > point.y !== pb.y > point.y && point.x < ((pb.x - pa.x) * (point.y - pa.y)) / (pb.y - pa.y) + pa.x) hit = !hit;
  }
  return hit;
}

/** Outlines to shapes with holes: the winding of the largest loop is "solid", the other winding cuts holes. */
function shapesOf(paths: string[]): Shape[] {
  const shapes: Shape[] = [];
  for (const d of paths) {
    const loops = outlines(d).map(toModel);
    if (!loops.length) continue;
    const areas = loops.map((loop) => ShapeUtils.area(loop));
    const big = areas.reduce((best, area, index) => (Math.abs(area) > Math.abs(areas[best]) ? index : best), 0);
    const solidSign = Math.sign(areas[big]);
    const solids = loops.map((loop, index) => ({ loop, index })).filter(({ index }) => Math.sign(areas[index]) === solidSign && Math.abs(areas[index]) >= 2e-4);
    const made = solids.map(({ loop }) => ({ loop, shape: new Shape(loop) }));
    loops.forEach((loop, index) => {
      // specks too small to see would only confuse the triangulation
      if (Math.abs(areas[index]) < 2e-4) return;
      if (Math.sign(areas[index]) === solidSign) return;
      const owner = made.find(({ loop: outer }) => inside(loop[0], outer));
      if (owner) owner.shape.holes.push(new Path(loop));
    });
    shapes.push(...made.map(({ shape }) => shape));
  }
  return shapes;
}

interface Slab {
  /** Front face z and thickness (model units); the bevel rounds the rim. */
  front: number;
  depth: number;
  bevel: number;
}

/** A rounded extrusion of the shapes, its front cap at `front`, silhouette exact from the front. */
function slab(shapes: Shape[], { front, depth, bevel }: Slab): BufferGeometry {
  const geometry = new ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    // a small outward bevel: an inward one self-intersects in the thin feather tips and breaks the caps
    bevelSize: Math.min(0.025, bevel * 0.3),
    bevelOffset: -Math.min(0.025, bevel * 0.3),
    bevelSegments: 2,
    curveSegments: 1,
  });
  // put the front of the slab exactly at `front`
  geometry.computeBoundingBox();
  geometry.translate(0, 0, front - geometry.boundingBox!.max.z);
  geometry.deleteAttribute("uv");
  return geometry;
}

/** A flat layer (markings) lying on the body's front at `z`. */
function decal(shapes: Shape[], z: number): BufferGeometry {
  const geometry = new ShapeGeometry(shapes, 1);
  geometry.translate(0, 0, z);
  geometry.deleteAttribute("uv");
  return geometry;
}

/* -------------------------------------------------------------- skeleton */

const v = (x: number, y: number, z = 0) => new Vector3(X(x), Y(y), z);
const EYE = OWL_GEOM.eye;
const NECK_Y = 112;
const TAIL = { x: 70, y: 215 };

function makeBone(name: string, at: Vector3, parent?: Bone): Bone {
  const bone = new Bone();
  // "Bone" suffix: a bone and a part may share a word (the beak, the wings), never a name
  bone.name = `${name}Bone`;
  bone.userData.key = name;
  // positions are relative to the parent's rest position
  bone.userData.rest = at.clone();
  bone.position.copy(parent ? at.clone().sub(parent.userData.rest as Vector3) : at);
  parent?.add(bone);
  return bone;
}

const root = makeBone("root", new Vector3(0, 0, 0));
const spine = makeBone("spine", v(130, 200), root);
const head = makeBone("head", v(150, NECK_Y + 10), spine);
const beak = makeBone("beak", v(186, 88, 0.3), head);
const tuftNear = makeBone("tuftNear", v(178, 22), head);
const tuftFar = makeBone("tuftFar", v(118, 26), head);
const wingNear = makeBone("wingNear", v(OWL_TRACE.shoulder[0], OWL_TRACE.shoulder[1], 0.35), spine);
const wingNearTip = makeBone("wingNearTip", v(92, 185, 0.35), wingNear);
const wingFar = makeBone("wingFar", v(OWL_GEOM.pivots.farShoulder.x, OWL_GEOM.pivots.farShoulder.y, -0.3), spine);
const tail = makeBone("tail", v(TAIL.x + 25, TAIL.y - 15), spine);
const legNear = makeBone("legNear", v(150, 236, 0.15), root);
const legFar = makeBone("legFar", v(118, 236, -0.05), root);
const bones = [root, spine, head, beak, tuftNear, tuftFar, wingNear, wingNearTip, wingFar, tail, legNear, legFar];
const boneIndex = (bone: Bone) => bones.indexOf(bone);

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Up to four weights per vertex, from the vertex's place on the 2D art. */
type Weigher = (x: number, y: number) => [Bone, number][];

function skin(geometry: BufferGeometry, weigh: Weigher): BufferGeometry {
  const position = geometry.getAttribute("position");
  const indices = new Uint16Array(position.count * 4);
  const weights = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i += 1) {
    // back to viewBox units for the weighing rules
    const x = position.getX(i) / S + 128;
    const y = OWL_TRACE.ground - position.getY(i) / S;
    const list = weigh(x, y)
      .filter(([, w]) => w > 0.001)
      .slice(0, 4);
    const total = list.reduce((sum, [, w]) => sum + w, 0) || 1;
    list.forEach(([bone, w], k) => {
      indices[i * 4 + k] = boneIndex(bone);
      weights[i * 4 + k] = w / total;
    });
  }
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
  return geometry;
}

const only = (bone: Bone): Weigher => () => [[bone, 1]];
const bodyWeights: Weigher = (x, y) => {
  const toHead = 1 - smooth(NECK_Y - 18, NECK_Y + 18, y);
  const toTail = smooth(TAIL.x + 35, TAIL.x, x) * smooth(TAIL.y - 30, TAIL.y, y);
  const tuft = (bone: Bone, tx: number) => smooth(42, 18, y) * smooth(40, 8, Math.abs(x - tx));
  const tn = tuft(tuftNear, 190) * toHead;
  const tf = tuft(tuftFar, 112) * toHead;
  return [
    [head, Math.max(0, toHead - tn - tf)],
    [spine, Math.max(0, 1 - toHead - toTail)],
    [tail, toTail],
    [tn > tf ? tuftNear : tuftFar, Math.max(tn, tf)],
  ];
};
const wingWeights: Weigher = (x, y) => {
  const tip = smooth(155, 195, y);
  return [
    [wingNear, 1 - tip],
    [wingNearTip, tip],
  ];
};
const feetWeights: Weigher = (x) => [[x > 134 ? legNear : legFar, 1]];

/* ----------------------------------------------------------------- parts */

const parts = owlSvgParts(OWL_REFERENCE, { size: 256 });
const ds = (list: OwlPath[] | null) => (list ?? []).map((p) => p.d);
const meshes: SkinnedMesh[] = [];

function part(name: string, geometry: BufferGeometry, color: string, weigh: Weigher, extra: Partial<MeshStandardMaterial> = {}): SkinnedMesh {
  const merged = mergeVertices(geometry, 1e-4);
  merged.computeVertexNormals();
  skin(merged, weigh);
  const material = new MeshStandardMaterial({ color: new Color(color), roughness: 0.85, metalness: 0, ...extra });
  material.name = name;
  const mesh = new SkinnedMesh(merged, material);
  mesh.name = name;
  meshes.push(mesh);
  return mesh;
}

// back to front: far wing, body, belly and face, marks, near wing, feet, beak, eye
const farWingShapes = shapesOf(ds(parts.nearWing)).map((shape) => {
  // the far wing is the near one mirrored about the far mirror line (as the 2D owl draws it)
  const mirror = (p: Vector2) => new Vector2(2 * X(OWL_GEOM.farMirrorX) - p.x, p.y);
  const flipped = new Shape(shape.getPoints().map(mirror).reverse());
  return flipped;
});
part("wingFar", slab(farWingShapes, { front: -0.22, depth: 0.06, bevel: 0.05 }), parts.farWing[0].fill, only(wingFar));
part("plumage", slab(shapesOf(ds(parts.body)), { front: 0.28, depth: 0.22, bevel: 0.2 }), parts.body[0].fill, bodyWeights);
part("cream", decal(shapesOf(ds(parts.faceMask.filter((p) => p.fill === OWL_REFERENCE.cream))), 0.285), OWL_REFERENCE.cream, bodyWeights);
part("spots", decal(shapesOf(ds(parts.spots)), 0.29), OWL_REFERENCE.grey, only(spine));
part("socket", decal(shapesOf(ds(parts.socket)), 0.29), OWL_REFERENCE.socket, only(head));
part("feet", slab(shapesOf(ds(parts.feet)), { front: 0.3, depth: 0.08, bevel: 0.05 }), OWL_REFERENCE.greyDark, feetWeights);
part("wingNear", slab(shapesOf(ds(parts.nearWing)), { front: 0.44, depth: 0.04, bevel: 0.06 }), OWL_REFERENCE.wingNear, wingWeights);

// the beak, with an "open" morph: its lower half swings down
const beakGeometry = mergeVertices(slab(shapesOf(ds(parts.beak)), { front: 0.33, depth: 0.04, bevel: 0.05 }), 1e-4);
const beakMesh = part("beak", beakGeometry, OWL_REFERENCE.greyDark, only(head));
{
  const position = beakMesh.geometry.getAttribute("position");
  const open = new Float32Array(position.count * 3);
  let top = Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < position.count; i += 1) {
    top = Math.min(top, -position.getY(i));
    bottom = Math.max(bottom, -position.getY(i));
  }
  const mid = (top + bottom) / 2;
  for (let i = 0; i < position.count; i += 1) {
    const below = Math.max(0, -position.getY(i) - mid) / Math.max(1e-6, bottom - mid);
    open[i * 3 + 1] = -below * 0.06;
    open[i * 3] = -below * 0.02;
  }
  beakMesh.geometry.morphAttributes.position = [new BufferAttribute(open, 3)];
  beakMesh.geometry.morphTargetsRelative = true;
  beakMesh.morphTargetDictionary = { beakOpen: 0 };
  beakMesh.morphTargetInfluences = [0];
}

// the eye: a big round iris, the pupil and its highlight, slightly domed; all grow with "eyesWide"
const eyeCenter = new Vector3(X(EYE.x), Y(EYE.y), 0.295);
function eyePart(name: string, radius: number, color: string, offset: Vector2, z: number, flat = 0.22) {
  const geometry = new SphereGeometry(radius * S, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  geometry.rotateX(Math.PI / 2);
  geometry.scale(1, 1, flat);
  geometry.translate(eyeCenter.x + offset.x * S, eyeCenter.y - offset.y * S, z);
  geometry.deleteAttribute("uv");
  const mesh = part(name, geometry, color, only(head), { roughness: 0.4 });
  const position = mesh.geometry.getAttribute("position");
  const wide = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    wide[i * 3] = (position.getX(i) - eyeCenter.x) * 0.15;
    wide[i * 3 + 1] = (position.getY(i) - eyeCenter.y) * 0.15;
  }
  mesh.geometry.morphAttributes.position = [new BufferAttribute(wide, 3)];
  mesh.geometry.morphTargetsRelative = true;
  mesh.morphTargetDictionary = { eyesWide: 0 };
  mesh.morphTargetInfluences = [0];
  return mesh;
}
const rest = OWL_GEOM.gazeRest;
eyePart("iris", EYE.iris, OWL_REFERENCE.iris, new Vector2(0, 0), 0.295);
eyePart("pupil", EYE.pupil, OWL_REFERENCE.pupil, new Vector2(rest.x, rest.y), 0.31, 0.18);
eyePart("highlight", EYE.highlight, OWL_REFERENCE.highlight, new Vector2(rest.x + (OWL_TRACE.highlight[0] - OWL_TRACE.pupil[0]), rest.y + (OWL_TRACE.highlight[1] - OWL_TRACE.pupil[1])), 0.33, 0.2);

// the lid: a disc over the iris whose lower edge is a "cut" line; open hides it at the top
const LID_MORPHS = ["blink", "sleepy", "happy", "sad", "squint"] as const;
{
  const r = (EYE.iris + 1.2) * S;
  const disc = new CircleGeometry(r, 36);
  disc.deleteAttribute("uv");
  disc.translate(eyeCenter.x, eyeCenter.y, 0.345);
  const position = disc.getAttribute("position");
  const top = eyeCenter.y + r;
  /** Where the lid's lower edge is for a vertex at offset x from the eye's middle (model units). */
  const cuts: Record<(typeof LID_MORPHS)[number] | "open", (x: number) => number> = {
    open: () => top,
    blink: () => eyeCenter.y - r - 0.01,
    sleepy: () => eyeCenter.y + r * 0.05,
    // happy: a smiling lower edge, the eye a crescent
    happy: (x) => eyeCenter.y - r * 0.35 + ((x * x) / (r * r)) * r * 0.9,
    // sad: the lid slopes down toward the beak side
    sad: (x) => eyeCenter.y + r * 0.25 - (x / r) * r * 0.45,
    squint: () => eyeCenter.y + r * 0.35,
  };
  const shaped = (cut: (x: number) => number) => {
    const out = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i) - eyeCenter.x;
      const y = position.getY(i);
      const line = cut(x);
      out[i * 3] = position.getX(i);
      out[i * 3 + 1] = Math.max(y, Math.min(top, line));
      out[i * 3 + 2] = position.getZ(i);
    }
    return out;
  };
  const base = shaped(cuts.open);
  disc.setAttribute("position", new BufferAttribute(base, 3));
  disc.morphAttributes.position = LID_MORPHS.map((name) => {
    const target = shaped(cuts[name]);
    for (let i = 0; i < target.length; i += 1) target[i] -= base[i];
    return new BufferAttribute(target, 3);
  });
  disc.morphTargetsRelative = true;
  const lid = part("lid", disc, OWL_REFERENCE.plumage, only(head));
  lid.morphTargetDictionary = Object.fromEntries(LID_MORPHS.map((name, index) => [name, index]));
  lid.morphTargetInfluences = LID_MORPHS.map(() => 0);
}

/* ------------------------------------------------------------- the pose */

const DEG = Math.PI / 180;
/** How far the head may turn, nod and tilt (radians); the gaze adds a little on top at runtime. */
export const HEAD_MAX = { yaw: 0.35, pitch: 0.4, tilt: 0.4 } as const;
const clampTo = (value: number, max: number) => Math.min(max, Math.max(-max, value));
/** owl-art's turning point (src/components/floating-bots/fit.ts PIVOT: the middle, 62 % down its box). */
const PIVOT = new Vector3(X(128), Y(256 * 0.62), 0);
const quat = (x: number, y: number, z: number) => new Quaternion().setFromEuler(new Euler(x, y, z, "YXZ"));

export interface RigPose {
  bones: Record<string, { position?: Vector3; quaternion: Quaternion; scale?: Vector3 }>;
  morphs: Record<string, number>;
}

/**
 * A frame of the mascot's motion (clips.ts) as bone transforms and morph
 * weights. The owl looks toward +x in the art, so a backflip turns around z
 * (the art's own plane) and a barrel roll around x (the way it flies).
 */
export function rigPose(frame: MascotFrame): RigPose {
  const f = { ...REST, ...frame } as Required<MascotFrame>;
  const lift = Math.min(1, Math.max(0, f.wing));
  // turns, flips and rolls happen around the body's middle (owl-art's pivot), not around the feet
  const turn = quat(f.roll ?? 0, f.spin, f.flip ?? 0);
  const around = PIVOT.clone().sub(PIVOT.clone().applyQuaternion(turn));
  const liftFar = Math.min(1, Math.max(0, f.wingFar ?? f.wing));
  return {
    bones: {
      root: {
        position: new Vector3((f.x ?? 0) * 0.8 + around.x, f.y * 0.8 + around.y, around.z),
        quaternion: turn,
        scale: new Vector3(f.scale, f.scale, f.scale),
      },
      spine: {
        quaternion: quat(0, 0, -f.lean * 0.8 - f.sway * 0.5),
        scale: new Vector3((f.puff ?? 1) / Math.sqrt(f.squash), f.squash, (f.puff ?? 1) / Math.sqrt(f.squash)),
      },
      // the head is a layer of the body's slab: it turns only so far, or it would tear from the body
      head: { quaternion: quat(clampTo(f.headPitch * 0.6, HEAD_MAX.pitch), clampTo(f.headYaw * 0.8, HEAD_MAX.yaw), clampTo(-f.headTilt * 0.7, HEAD_MAX.tilt)) },
      tuftNear: { quaternion: quat(0, 0, -(f.tufts ?? 0) * 0.35) },
      tuftFar: { quaternion: quat(0, 0, (f.tufts ?? 0) * 0.35) },
      // the near wing: spread swings it up and back (as owl-art's 108 degrees), swing on top
      wingNear: { quaternion: quat(0, -lift * 0.3, -(lift * 108 * DEG + (f.wingSwing ?? 0))) },
      wingNearTip: { quaternion: quat(0, 0, -lift * 0.35) },
      wingFar: { quaternion: quat(0, liftFar * 0.3, liftFar * 110 * DEG) },
      tail: { quaternion: quat(0, 0, f.sway * 0.4 + f.lean * 0.3) },
      legNear: { position: new Vector3(0, (f.footNear ?? 0) * 0.12, 0), quaternion: quat(0, 0, (f.footNear ?? 0) * 0.4) },
      legFar: { position: new Vector3(0, (f.footFar ?? 0) * 0.12, 0), quaternion: quat(0, 0, (f.footFar ?? 0) * 0.4) },
      beak: { quaternion: quat(0, 0, 0) },
    },
    morphs: {
      blink: Math.min(1, Math.max(0, f.lid)),
      eyesWide: Math.min(1, Math.max(0, ((f.eyeScale ?? 1) - 1) / 0.3)),
      squint: Math.min(1, Math.max(0, (1 - (f.eyeScale ?? 1)) / 0.15)),
      beakOpen: Math.min(1, Math.max(0, f.beak ?? 0)),
    },
  };
}

/* ------------------------------------------------------------ the clips */

/** The clips baked into the model: every mascot clip, sampled at 30 fps. */
const LOOPING: ClipName[] = ["idle", "walk", "fly", "drag", "working", "sleep"];
const BAKED: ClipName[] = [...(Object.keys(CLIP_MS) as ClipName[]), ...LOOPING, "flyOut", "return"];
const FPS = 20;

/** How long each clip is baked (ms): timed clips their own length, moving ones one cycle. */
const bakedLength = (name: ClipName) =>
  name in CLIP_MS ? CLIP_MS[name as keyof typeof CLIP_MS] : name === "walk" ? 1250 : name === "flyOut" || name === "return" ? 1780 : 2000;

/**
 * Every clip, one after the other, on ONE timeline (a single AnimationClip
 * with one track per bone and face part), with each clip's first and last
 * frame recorded; the runtime cuts them apart (AnimationUtils.subclip).
 * Forty clips as separate glTF animations would weigh mostly in accessors.
 */
function bakeTimeline(): { clip: AnimationClip; ranges: Record<string, [number, number]> } {
  const times: number[] = [];
  const poses: RigPose[] = [];
  const ranges: Record<string, [number, number]> = {};
  for (const name of BAKED) {
    const length = bakedLength(name);
    const start = poses.length;
    for (let ms = 0; ms <= length + 1; ms += 1000 / FPS) {
      times.push(poses.length / FPS);
      const clip = clipPose(name, { elapsed: ms, now: ms, moveMs: length, variant: 0.3, reduced: false });
      poses.push(rigPose({ ...REST, ...clip } as MascotFrame));
    }
    ranges[name] = [start, poses.length - 1];
  }
  const tracks = [];
  for (const bone of bones) {
    const key = bone.userData.key as string;
    const q: number[] = [];
    const p: number[] = [];
    const sc: number[] = [];
    for (const pose of poses) {
      const b = pose.bones[key];
      q.push(...b.quaternion.toArray());
      const at = (bone.position as Vector3).clone().add(b.position ?? new Vector3());
      p.push(at.x, at.y, at.z);
      const scale = b.scale ?? new Vector3(1, 1, 1);
      sc.push(scale.x, scale.y, scale.z);
    }
    tracks.push(new QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, q));
    if (["root", "legNear", "legFar"].includes(key)) tracks.push(new VectorKeyframeTrack(`${bone.name}.position`, times, p));
    if (["root", "spine"].includes(key)) tracks.push(new VectorKeyframeTrack(`${bone.name}.scale`, times, sc));
  }
  // the face: lids (blink, sleepy, happy, sad, squint), eyes, beak
  const lidTrack: number[] = [];
  const wideTrack: number[] = [];
  const beakTrack: number[] = [];
  for (const pose of poses) {
    lidTrack.push(pose.morphs.blink, 0, 0, 0, pose.morphs.squint);
    wideTrack.push(pose.morphs.eyesWide);
    beakTrack.push(pose.morphs.beakOpen);
  }
  tracks.push(new NumberKeyframeTrack("lid.morphTargetInfluences", times, lidTrack));
  for (const eye of ["iris", "pupil", "highlight"]) tracks.push(new NumberKeyframeTrack(`${eye}.morphTargetInfluences`, times, wideTrack));
  tracks.push(new NumberKeyframeTrack("beak.morphTargetInfluences", times, beakTrack));
  return { clip: new AnimationClip("timeline", poses.length / FPS, tracks), ranges };
}

/* ----------------------------------------------------------- export */

class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onloadend?.();
    });
  }
}

async function main() {
  (globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;
  const scene = new Scene();
  const owl = new Group();
  owl.name = "owl";
  owl.add(root);
  for (const mesh of meshes) owl.add(mesh);
  scene.add(owl);
  scene.updateMatrixWorld(true);
  // the bind pose: the bones' rest transforms, now that their world matrices are known
  const skeleton = new Skeleton(bones);
  for (const mesh of meshes) mesh.bind(skeleton);
  const { clip: timeline, ranges } = bakeTimeline();
  const animations = [timeline];
  // where each clip sits on the timeline, read back by the runtime
  owl.userData.clips = ranges;
  owl.userData.fps = FPS;
  if (process.env.OWL3D_STATS) {
    const verts = meshes.map((mesh) => `${mesh.name}:${mesh.geometry.getAttribute("position").count}`).join(" ");
    const keys = animations.reduce((sum, clip) => sum + clip.tracks.reduce((n, track) => n + track.values.length + track.times.length, 0), 0);
    console.log(`vertices ${verts}; animation floats ${keys}`);
  }
  const exporter = new GLTFExporter();
  const raw = (await exporter.parseAsync(scene, { binary: true, animations })) as ArrayBuffer;
  // smaller: identical data shared, unused dropped, redundant animation keys removed,
  // geometry and animation quantized and compressed (EXT_meshopt_compression, decoded by three's MeshoptDecoder)
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  const doc = await io.readBinary(new Uint8Array(raw));
  await doc.transform(dedup(), prune(), resample({ tolerance: 1e-4 }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  const glb = await io.writeBinary(doc);
  writeFileSync(OUT, Buffer.from(glb));
  console.log(`owl.glb: ${(glb.byteLength / 1024).toFixed(1)} KB, ${meshes.length} parts, ${bones.length} bones, ${Object.keys(ranges).length} clips`);
}

await main();
