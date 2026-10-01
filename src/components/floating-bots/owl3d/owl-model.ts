// The 3D Sagax owl, built from primitives (lathe, spheres, cones, capsules):
// no model file, no texture download, nothing licensed from anyone. Toon
// shaded with a dark outline so it reads on any wallpaper at 120 to 200 px.
// Its colors come from the same palette as the 2D owl (owl-art.ts): the bot's
// color for the plumage, a darker wing, the cream face and the yellow eyes.
//
// Units: the owl stands on y = 0 and is about 2.3 tall, facing +z.
import {
  BackSide,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  DataTexture,
  Group,
  LatheGeometry,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  Object3D,
  RedFormat,
  SphereGeometry,
  Vector2,
} from "three";
import { owlPalette, owlRim, shade, type OwlPalette } from "@/lib/owl/owl-art";
import { MAUS_COLORS } from "@/lib/mascot";
import type { MascotFrame } from "../behavior";

export interface OwlEye {
  group: Group;
  pupil: Object3D;
  lid: Object3D;
}

export interface OwlRig {
  root: Group;
  /** Turned, lifted and squashed by the frame (the owl's whole body). */
  body: Group;
  head: Group;
  eyes: OwlEye[];
  /** Left, then right; each hinges at its shoulder. */
  wings: Group[];
  /** What a click can land on (outlines excluded). */
  solids: Mesh[];
  palette: OwlPalette;
  dispose(): void;
}

/** A bot color name (green) or a hex, as the 2D owl takes it. */
export function owlHex(color: string): string {
  const named = (MAUS_COLORS as Record<string, string>)[color];
  if (named) return named;
  return /^#?[0-9a-fA-F]{6}$/.test(color) ? (color.startsWith("#") ? color : `#${color}`) : MAUS_COLORS.green;
}

export function owlPalette3d(color: string): OwlPalette {
  return owlPalette(owlHex(color));
}

/** A four-step light ramp: the flat bands of a toon shade. */
function toonRamp(): DataTexture {
  const ramp = new DataTexture(new Uint8Array([70, 140, 215, 255]), 4, 1, RedFormat);
  ramp.minFilter = NearestFilter;
  ramp.magFilter = NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

/** The body's egg profile, bottom to top, spun around y. */
const BODY_PROFILE = [
  [0.0, 0.0],
  [0.36, 0.04],
  [0.6, 0.2],
  [0.73, 0.48],
  [0.75, 0.78],
  [0.68, 1.06],
  [0.52, 1.3],
  [0.28, 1.44],
  [0.0, 1.48],
].map(([x, y]) => new Vector2(x, y));

export function buildOwl(color: string): OwlRig {
  const palette = owlPalette3d(color);
  const ramp = toonRamp();
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const solids: Mesh[] = [];

  const geo = <T extends BufferGeometry>(geometry: T): T => {
    geometries.push(geometry);
    return geometry;
  };
  const toon = (hex: string) => {
    const material = new MeshToonMaterial({ color: new Color(hex), gradientMap: ramp });
    materials.push(material);
    return material;
  };
  const flat = (hex: string) => {
    const material = new MeshBasicMaterial({ color: new Color(hex) });
    materials.push(material);
    return material;
  };
  const mesh = (geometry: BufferGeometry, material: Material, parent: Object3D, at: [number, number, number] = [0, 0, 0], scale?: [number, number, number]) => {
    const part = new Mesh(geometry, material);
    part.position.set(...at);
    if (scale) part.scale.set(...scale);
    parent.add(part);
    solids.push(part);
    return part;
  };
  // the inverted hull: a slightly larger back face in a dark ink draws the contour
  const ink = flat(owlRim(owlHex(color)) ? "#C4D6FF" : shade(palette.plumage, 0.72));
  (ink as MeshBasicMaterial).side = BackSide;
  const outline = (part: Mesh, grow = 1.06) => {
    const hull = new Mesh(part.geometry, ink);
    hull.scale.copy(part.scale).multiplyScalar(grow);
    hull.position.copy(part.position);
    hull.rotation.copy(part.rotation);
    part.parent?.add(hull);
  };

  const plumage = toon(palette.plumage);
  const wingTone = toon(palette.wingNear);
  const cream = toon(palette.cream);
  const beakTone = toon(palette.grey);
  const socket = toon(palette.socket);
  const iris = toon(palette.iris);
  const pupilTone = flat(palette.pupil);
  const shine = flat(palette.highlight);
  const spots = toon(palette.greyDark);

  const root = new Group();
  const body = new Group();
  root.add(body);

  // body and belly
  const torso = mesh(geo(new LatheGeometry(BODY_PROFILE, 36)), plumage, body, [0, 0.12, 0]);
  outline(torso, 1.05);
  const belly = mesh(geo(new SphereGeometry(0.5, 28, 20)), cream, body, [0, 0.66, 0.5], [0.95, 1.2, 0.62]);
  const spot = geo(new SphereGeometry(0.06, 10, 8));
  for (const [x, y] of [[-0.18, 0.84], [0.18, 0.84], [0, 0.66], [-0.22, 0.52], [0.22, 0.52], [0, 0.38]]) {
    mesh(spot, spots, body, [x, y, belly.position.z + 0.29], [1.3, 0.55, 0.5]);
  }

  // tail and feet
  const tail = mesh(geo(new ConeGeometry(0.24, 0.42, 12)), wingTone, body, [0, 0.28, -0.6]);
  tail.rotation.x = -2.2;
  const toe = geo(new CapsuleGeometry(0.05, 0.12, 4, 8));
  for (const side of [-1, 1]) {
    for (const spread of [-0.35, 0, 0.35]) {
      const part = mesh(toe, beakTone, body, [side * 0.24 + Math.sin(spread) * 0.08, 0.06, 0.42], [1, 1, 1]);
      part.rotation.set(Math.PI / 2.2, spread, 0);
    }
  }

  // wings, hinged at the shoulders
  const wings: Group[] = [];
  const wingShape = geo(new SphereGeometry(0.34, 22, 16));
  for (const side of [-1, 1]) {
    const hinge = new Group();
    hinge.position.set(side * 0.66, 1.08, -0.02);
    body.add(hinge);
    const wing = mesh(wingShape, wingTone, hinge, [side * 0.06, -0.36, 0], [0.38, 1.05, 0.78]);
    wing.rotation.z = side * 0.12;
    outline(wing, 1.08);
    wings.push(hinge);
  }

  // the head, on a neck pivot so it can turn, nod and tilt
  const head = new Group();
  head.position.set(0, 1.42, 0.02);
  body.add(head);
  const skull = mesh(geo(new SphereGeometry(0.66, 36, 26)), plumage, head, [0, 0.4, 0], [1.08, 0.9, 0.95]);
  outline(skull, 1.05);
  // the facial disc: two cream bowls around the eyes and a darker socket inside each
  const disc = geo(new SphereGeometry(0.31, 26, 18));
  const ring = geo(new SphereGeometry(0.235, 24, 16));
  const eyes: OwlEye[] = [];
  for (const side of [-1, 1]) {
    mesh(disc, cream, head, [side * 0.26, 0.42, 0.44], [1, 1.05, 0.42]);
    mesh(ring, socket, head, [side * 0.26, 0.43, 0.52], [1, 1, 0.3]);
    // the eye: a yellow iris, a black pupil that follows the pointer, a shine, and a lid
    const eye = new Group();
    eye.position.set(side * 0.26, 0.44, 0.56);
    eye.scale.set(1, 1, 0.6);
    head.add(eye);
    mesh(geo(new SphereGeometry(0.19, 24, 18)), iris, eye);
    const pupil = new Group();
    eye.add(pupil);
    mesh(geo(new SphereGeometry(0.105, 18, 14)), pupilTone, pupil, [0, 0, 0.12], [1, 1, 0.6]);
    mesh(geo(new SphereGeometry(0.03, 10, 8)), shine, pupil, [0.03, 0.04, 0.13]);
    const lid = mesh(geo(new SphereGeometry(0.22, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), plumage, eye);
    eyes.push({ group: eye, pupil, lid });
  }
  // beak
  const beak = mesh(geo(new ConeGeometry(0.09, 0.28, 14)), beakTone, head, [0, 0.27, 0.66]);
  beak.rotation.x = Math.PI / 2 + 0.55;
  // ear tufts
  const tuft = geo(new ConeGeometry(0.14, 0.44, 12));
  for (const side of [-1, 1]) {
    const part = mesh(tuft, wingTone, head, [side * 0.42, 0.98, -0.04]);
    part.rotation.z = -side * 0.42;
    part.rotation.x = -0.12;
  }

  const rig: OwlRig = {
    root,
    body,
    head,
    eyes,
    wings,
    solids,
    palette,
    dispose() {
      for (const geometry of new Set(geometries)) geometry.dispose();
      for (const material of new Set(materials)) material.dispose();
      ramp.dispose();
    },
  };
  poseOwl(rig, REST_FRAME);
  return rig;
}

export const REST_FRAME: MascotFrame = {
  y: 0,
  spin: 0,
  lean: 0,
  sway: 0,
  squash: 1,
  scale: 1,
  headYaw: 0,
  headPitch: 0,
  headTilt: 0,
  wing: 0,
  lid: 0,
  pupilX: 0,
  pupilY: 0,
};

/** The lid's hinge angle: tucked back behind the eye when open, over its front when shut. */
const LID_OPEN = -1.25;
const LID_SHUT = Math.PI / 2;
const PUPIL_REACH = 0.07;
/** A raised wing swings this far out from the body. */
const WING_LIFT = 1.9;

/** Puts every moving part where the frame says. */
export function poseOwl(rig: OwlRig, frame: MascotFrame): void {
  const { root, body, head, eyes, wings } = rig;
  root.position.y = frame.y;
  root.rotation.y = frame.spin;
  root.scale.setScalar(frame.scale);
  body.rotation.x = frame.lean;
  body.rotation.z = frame.sway;
  body.scale.set(1 / Math.sqrt(frame.squash), frame.squash, 1 / Math.sqrt(frame.squash));
  head.rotation.set(frame.headPitch, frame.headYaw, frame.headTilt);
  const lid = LID_OPEN + Math.min(1, Math.max(0, frame.lid)) * (LID_SHUT - LID_OPEN);
  const px = Math.max(-1, Math.min(1, frame.pupilX)) * PUPIL_REACH;
  const py = Math.max(-1, Math.min(1, frame.pupilY)) * PUPIL_REACH;
  for (const eye of eyes) {
    eye.lid.rotation.x = lid;
    eye.pupil.position.set(px, py, 0);
  }
  const lift = Math.min(1, Math.max(0, frame.wing)) * WING_LIFT;
  // left wing swings out to -x, the right one to +x
  wings[0].rotation.z = -lift;
  wings[1].rotation.z = lift;
}
