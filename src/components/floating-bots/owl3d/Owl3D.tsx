// The 3D Sagax owl (preview style): a modeled, rigged and animated owl
// (tools/owl3d/build_owl.py, built in Blender) that is the same character as
// the 2D owl-art. Played like three.js's RobotExpressive example: an
// AnimationMixer with one action per authored clip and cross-fades between
// them, plus a little procedural life on top (it turns toward the way it
// goes, looks at the pointer, blinks). Recolored per bot with owl-art's
// palettes, material by material. Loaded lazily, with three.js, only when a
// bot's owl is set to 3D; the flat owl stays the default.
import { useEffect, useRef } from "react";
import {
  AmbientLight,
  AnimationMixer,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  HemisphereLight,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
  type AnimationClip,
  type Bone,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { MAUS_COLORS } from "@/lib/mascot";
import { owlPalette, type OwlPalette } from "@/lib/owl/owl-art";
import { owlSkinId, owlSkinPalette } from "@/lib/owl/owl-skins";
import { blinkAt, type MascotActivity, type MascotFrame } from "../behavior";
import { CLIP_MS, isTimed, type ClipName } from "../clips";
import { fitOwlCamera } from "./fit3d";
import owlUrl from "./owl.glb?url";

export interface Owl3DProps {
  color: string;
  skin: string;
  activity: MascotActivity;
  /** The canvas (the whole stage) and where the owl's box sits in it. */
  stage: { width: number; height: number; left: number; top: number };
  owlSize: number;
  frame: (now: number) => MascotFrame;
  fps: () => number;
  onHitTest: (test: ((clientX: number, clientY: number) => boolean) | null) => void;
  onFail: () => void;
}

/** The model's clips (tools/owl3d/build_owl.py, CLIPS). */
export const OWL_CLIPS = [
  "idle", "blink", "lookLeft", "lookRight", "tilt", "walk", "hop", "turn", "takeoff", "fly", "glide", "land",
  "wave", "spread", "ruffle", "preen", "peck", "sleep", "wake", "dance", "sad", "startled", "celebrate", "hug",
] as const;
export type OwlClip = (typeof OWL_CLIPS)[number];

/** Which of the model's clips plays each mascot activity (behavior.ts picks the activity). */
export const OWL_CLIP_FOR: Record<ClipName, OwlClip> = {
  idle: "idle",
  working: "idle",
  look: "lookLeft",
  lookBack: "lookRight",
  headSpin: "lookRight",
  tilt: "tilt",
  confused: "tilt",
  think: "tilt",
  bob: "tilt",
  turn: "turn",
  spin: "celebrate",
  celebrate: "celebrate",
  backflip: "hop",
  hop: "hop",
  hopForward: "hop",
  jump: "hop",
  wave: "wave",
  dance: "dance",
  stretch: "wake",
  yawn: "wake",
  wake: "wake",
  wingStretch: "spread",
  hoot: "spread",
  preen: "preen",
  scratch: "preen",
  peck: "peck",
  ruffle: "ruffle",
  angry: "ruffle",
  shy: "hug",
  love: "hug",
  petted: "hug",
  wink: "blink",
  doubleBlink: "blink",
  surprised: "startled",
  startled: "startled",
  land: "land",
  sad: "sad",
  sleep: "sleep",
  walk: "walk",
  fly: "fly",
  drag: "fly",
  flyOut: "takeoff",
  return: "glide",
};

/** Activities whose clip loops until the activity changes; the others play once and hold. */
const LOOPS = new Set<MascotActivity>(["idle", "working", "walk", "fly", "drag", "sleep", "return"]);
/** Activities on the move: the owl turns further toward where it goes. */
const MOVING = new Set<MascotActivity>(["walk", "fly", "drag", "flyOut", "return", "turn"]);
/** Activities that leave the eyes to the pointer (the others look where their clip looks). */
const GAZING = new Set<MascotActivity>(["idle", "working", "tilt", "think", "confused", "bob", "wave", "dance", "hoot"]);
const FADE_S = 0.25;
/** How far it turns toward its side: a 3/4 view at rest, nearly a profile on the move (radians). */
export const FACE_YAW = { rest: 0.6, moving: 1.1 } as const;
/** The pointer turns the head this much at most on top of the clip, and the eyes this much (radians). */
export const GAZE_HEAD_MAX = 0.35;
export const GAZE_EYE_MAX = 0.26;

/** The parts a skin's finish applies to (the feathers). */
const FEATHERS = new Set(["plumage", "wing", "lid"]);

/** Each owl skin in 3D: how the feathers shine or glow (the 2D owl draws effect layers instead). */
export function skinFinish(skin: string): { metalness: number; roughness: number; emissive: string; glow: number; pulse: number } {
  switch (skin) {
    case "gold":
      return { metalness: 0.75, roughness: 0.28, emissive: "#6b4a00", glow: 0.25, pulse: 0 };
    case "neon":
      return { metalness: 0, roughness: 0.4, emissive: "#29f0ff", glow: 0.55, pulse: 0.25 };
    case "inferno":
      return { metalness: 0, roughness: 0.6, emissive: "#ff5a12", glow: 0.6, pulse: 0.3 };
    case "frost":
      return { metalness: 0.1, roughness: 0.2, emissive: "#bfe8ff", glow: 0.3, pulse: 0.1 };
    case "carbon":
      return { metalness: 0.45, roughness: 0.35, emissive: "#000000", glow: 0, pulse: 0 };
    case "lightning":
      return { metalness: 0.2, roughness: 0.45, emissive: "#ffe14a", glow: 0.35, pulse: 0.5 };
    default:
      return { metalness: 0, roughness: 0.8, emissive: "#000000", glow: 0, pulse: 0 };
  }
}

/** Each material's color from the bot's palette (the materials are named by the model). */
export function partColors(palette: OwlPalette): Record<string, string> {
  return {
    plumage: palette.plumage,
    lid: palette.plumage,
    wing: palette.wingNear,
    cream: palette.cream,
    spots: palette.grey,
    feet: palette.greyDark,
    beak: palette.greyDark,
    socket: palette.socket,
    iris: palette.iris,
    pupil: palette.pupil,
    highlight: palette.highlight,
  };
}

/** How fast an activity's clip plays so it lasts as long as behavior.ts gives the activity. */
export function clipSpeed(activity: MascotActivity, clipSeconds: number): number {
  if (!isTimed(activity) || clipSeconds <= 0) return 1;
  return Math.min(2.2, Math.max(0.5, clipSeconds / (CLIP_MS[activity] / 1000)));
}

/** The yaw that faces the owl toward its side (face 1 its natural side, the screen's right; -1 the left). */
export function facingYaw(face: number, moving: boolean): number {
  const f = Math.min(1, Math.max(-1, face));
  return f * (moving ? FACE_YAW.moving : FACE_YAW.rest);
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * The procedural layer over the clips: the head and eyes turned toward the pointer and the
 * blink, set just before drawing and undone right after. The mixer only writes what its
 * clips animate, so nothing set here may stay: an offset kept would add up frame after frame.
 */
export function createOverlay(parts: { head: Bone | null; eyes: Bone[]; lids: { influences: number[]; blink: number }[] }) {
  const axis = (bone: Bone, world: Vector3) => {
    const q = new Quaternion();
    bone.updateWorldMatrix(true, false);
    bone.getWorldQuaternion(q);
    return world.clone().applyQuaternion(q.invert()).normalize();
  };
  // the model's up and right axes in each bone's own frame, read once at rest
  const headUp = parts.head ? axis(parts.head, new Vector3(0, 1, 0)) : null;
  const eyeAxes = parts.eyes.map((eye) => ({ eye, up: axis(eye, new Vector3(0, 1, 0)), right: axis(eye, new Vector3(1, 0, 0)) }));
  const turn = new Quaternion();
  const tilt = new Quaternion();
  return (look: { x: number; y: number }, blink: number) => {
    const saved: (() => void)[] = [];
    if (parts.head && headUp) {
      const head = parts.head;
      const before = head.quaternion.clone();
      head.quaternion.multiply(turn.setFromAxisAngle(headUp, clamp(look.x, -1, 1) * GAZE_HEAD_MAX));
      saved.push(() => head.quaternion.copy(before));
    }
    for (const { eye, up, right } of eyeAxes) {
      const before = eye.quaternion.clone();
      eye.quaternion.multiply(turn.setFromAxisAngle(up, clamp(look.x, -1, 1) * GAZE_EYE_MAX)).multiply(tilt.setFromAxisAngle(right, -clamp(look.y, -1, 1) * GAZE_EYE_MAX * 0.7));
      saved.push(() => eye.quaternion.copy(before));
    }
    for (const lid of parts.lids) {
      const before = lid.influences[lid.blink];
      lid.influences[lid.blink] = Math.max(before, clamp(blink, 0, 1));
      saved.push(() => {
        lid.influences[lid.blink] = before;
      });
    }
    return () => {
      for (const undo of saved) undo();
    };
  };
}

/** A soft round shadow under the owl, drawn once. */
function shadowTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d")!;
  const gradient = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, "rgba(0,0,0,0.35)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

export default function Owl3D({ color, skin, activity, stage, owlSize, frame, fps, onHitTest, onFail }: Owl3DProps) {
  const host = useRef<HTMLSpanElement>(null);
  const live = useRef({ frame, fps, activity });
  live.current = { frame, fps, activity };
  const recolor = useRef<((color: string, skin: string) => void) | null>(null);

  useEffect(() => {
    const box = host.current;
    if (!box) return;
    const canvas = document.createElement("canvas");
    canvas.className = "fb-canvas";
    canvas.setAttribute("aria-hidden", "true");
    box.appendChild(canvas);
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
    } catch {
      canvas.remove();
      onFail();
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    renderer.setSize(stage.width, stage.height);
    const scene = new Scene();
    const camera = new PerspectiveCamera(28, stage.width / stage.height, 0.1, 50);
    const fit = fitOwlCamera(stage, owlSize, 28);
    camera.position.set(fit.target.x, fit.target.y, fit.distance);
    camera.lookAt(fit.target.x, fit.target.y, 0);
    // bright and soft: a sky fill, a key from the front left, a rim from behind
    scene.add(new HemisphereLight(0xffffff, 0xe9e2d8, 0.9));
    scene.add(new AmbientLight(0xffffff, 0.2));
    const key = new DirectionalLight(0xffffff, 1.5);
    key.position.set(-2, 3, 5);
    scene.add(key);
    const rim = new DirectionalLight(0xdfe8ff, 1.1);
    rim.position.set(2, 2.5, -4);
    scene.add(rim);
    const shadow = new Mesh(new PlaneGeometry(1.9, 0.5), new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.005;
    scene.add(shadow);

    let disposed = false;
    let raf = 0;
    let last = 0;
    let mixer: AnimationMixer | null = null;
    let owl: Object3D | null = null;
    const clips = new Map<string, AnimationClip>();
    const actions = new Map<string, AnimationAction>();
    let current: AnimationAction | null = null;
    let playing: MascotActivity | null = null;
    let overlay: ReturnType<typeof createOverlay> | null = null;
    const solids: Mesh[] = [];
    let yaw = 0;
    let turned = false;
    const look = { x: 0, y: 0 };
    let skinPulse = 0;
    const raycaster = new Raycaster();

    const play = (activity: MascotActivity) => {
      if (!mixer || activity === playing) return;
      const name = OWL_CLIP_FOR[activity] ?? "idle";
      const clip = clips.get(name) ?? clips.get("idle");
      if (!clip) return;
      let action = actions.get(name);
      if (!action) {
        action = mixer.clipAction(clip);
        actions.set(name, action);
      }
      playing = activity;
      const loops = LOOPS.has(activity);
      if (current === action) {
        // the same clip for a new activity: start it over, no fade (a fade to itself would hold it still)
        action.reset().play();
      } else {
        action.reset();
        action.enabled = true;
        action.setEffectiveWeight(1);
        action.play();
        if (current) current.crossFadeTo(action, FADE_S, false);
        current = action;
      }
      action.setLoop(loops ? LoopRepeat : LoopOnce, Infinity);
      action.clampWhenFinished = !loops;
      action.timeScale = clipSpeed(activity, clip.duration);
    };

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      owlUrl,
      (gltf) => {
        if (disposed) return;
        owl = gltf.scene;
        scene.add(owl);
        const lids: { influences: number[]; blink: number }[] = [];
        let head: Bone | null = null;
        const eyes: Bone[] = [];
        owl.traverse((node) => {
          const mesh = node as Mesh;
          if (mesh.isMesh) {
            const name = (mesh.material as MeshStandardMaterial).name;
            // a lid is a thin shell, seen from both sides; every other part is closed
            const material = new MeshStandardMaterial({ name, roughness: 0.8, metalness: 0, side: name === "lid" ? DoubleSide : FrontSide });
            mesh.material = material;
            mesh.frustumCulled = false;
            solids.push(mesh);
            const blink = mesh.morphTargetDictionary?.blink;
            if (blink !== undefined && mesh.morphTargetInfluences) lids.push({ influences: mesh.morphTargetInfluences, blink });
          }
          if ((node as Bone).isBone) {
            if (node.name === "head") head = node as Bone;
            if (node.name === "eyeL" || node.name === "eyeR" || node.name === "eye.L" || node.name === "eye.R") eyes.push(node as Bone);
          }
        });
        overlay = createOverlay({ head, eyes, lids });
        recolor.current = (tint, wear) => {
          const hex = (MAUS_COLORS as Record<string, string>)[tint] ?? tint;
          const colors = partColors(owlSkinPalette(owlSkinId(wear), owlPalette(hex), hex));
          const finish = skinFinish(owlSkinId(wear));
          for (const mesh of solids) {
            const material = mesh.material as MeshStandardMaterial;
            const value = colors[material.name];
            if (value) material.color = new Color(value);
            // the skin's look in 3D: a sheen, a glow, a frost, on the feathers only
            const feathers = FEATHERS.has(material.name);
            const shiny = material.name === "iris" || material.name === "pupil" || material.name === "highlight";
            material.metalness = feathers ? finish.metalness : 0;
            material.roughness = feathers ? finish.roughness : shiny ? 0.3 : 0.7;
            material.emissive = new Color(feathers ? finish.emissive : "#000000");
            material.emissiveIntensity = feathers ? finish.glow : 0;
          }
          skinPulse = finish.pulse;
        };
        recolor.current(color, skin);
        mixer = new AnimationMixer(owl);
        for (const clip of gltf.animations) clips.set(clip.name, clip);
        play(live.current.activity);
      },
      undefined,
      () => {
        if (!disposed) onFail();
      },
    );

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      const interval = 1000 / Math.max(1, Math.min(60, live.current.fps()));
      if (now - last < interval - 3) return;
      const dt = Math.min(1 / 30, (now - (last || now)) / 1000);
      last = now;
      if (!mixer || !owl) return;
      const activity = live.current.activity;
      play(activity);
      mixer.update(dt);
      const f = live.current.frame(now);
      // it turns toward the way it goes: a real turn in depth, through facing the camera
      const ease = (tau: number) => 1 - Math.exp(-dt / tau);
      const towards = facingYaw(f.face ?? 1, MOVING.has(activity));
      // the first frame starts facing its way; after that every change of side is a turn
      yaw = turned ? yaw + (towards - yaw) * ease(0.12) : towards;
      turned = true;
      owl.rotation.y = yaw;
      const gazing = GAZING.has(activity);
      look.x += ((gazing ? f.pupilX : 0) - look.x) * ease(0.2);
      look.y += ((gazing ? f.pupilY : 0) - look.y) * ease(0.2);
      if (skinPulse > 0) {
        // a glowing skin breathes (lightning flickers faster)
        const glow = 0.5 + 0.5 * Math.sin((now / 1000) * Math.PI * 2 * (skinPulse > 0.4 ? 3 : 0.8));
        for (const mesh of solids) {
          const material = mesh.material as MeshStandardMaterial;
          if (FEATHERS.has(material.name)) material.emissiveIntensity = 0.2 + glow * skinPulse;
        }
      }
      // on top of the clip, for this frame only: the gaze and the blink (asleep, the clip keeps the eyes shut)
      const undo = overlay?.(look, activity === "sleep" ? 0 : blinkAt(now));
      renderer.render(scene, camera);
      undo?.();
    };
    raf = requestAnimationFrame(tick);
    onHitTest((x, y) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !owl) return false;
      raycaster.setFromCamera(new Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), camera);
      return raycaster.intersectObjects(solids, false).length > 0;
    });
    const lost = (event: Event) => {
      event.preventDefault();
      onFail();
    };
    canvas.addEventListener("webglcontextlost", lost);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("webglcontextlost", lost);
      onHitTest(null);
      mixer?.stopAllAction();
      scene.traverse((node) => {
        const mesh = node as Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          (mesh.material as MeshStandardMaterial).map?.dispose();
          (mesh.material as MeshStandardMaterial).dispose();
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
    // made once per mount; the color follows below, the rest is read live
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => recolor.current?.(color, skin), [color, skin]);

  return <span ref={host} className="fb-canvas-host" style={{ position: "absolute", left: -stage.left, top: -stage.top, width: stage.width, height: stage.height, display: "block" }} />;
}
