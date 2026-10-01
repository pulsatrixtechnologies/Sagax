// The 3D Sagax owl (preview style): the skinned model baked by
// scripts/gen-owl-3d.ts from owl-art's own paths, played like three.js's
// RobotExpressive example: an AnimationMixer with one action per mascot clip
// and cross-fades between them, plus a little procedural life on top (it
// faces the way it goes, looks at the pointer, blinks). Recolored per bot
// with owl-art's palettes. Loaded lazily, with three.js, only when a bot's
// owl is set to 3D; the flat owl stays the default.
import { useEffect, useRef } from "react";
import {
  AmbientLight,
  AnimationClip,
  AnimationMixer,
  CanvasTexture,
  Color,
  DirectionalLight,
  HemisphereLight,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
  type AnimationAction,
  type Bone,
  type KeyframeTrack,
  type Object3D,
  type SkinnedMesh,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { MAUS_COLORS } from "@/lib/mascot";
import { owlPalette, shade, type OwlPalette } from "@/lib/owl/owl-art";
import { owlSkinId, owlSkinPalette } from "@/lib/owl/owl-skins";
import { blinkAt, type MascotActivity, type MascotFrame } from "../behavior";
import { fitOwlCamera } from "./fit3d";
import { flatTurn } from "../Owl25D";
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

/** Clips that loop until the activity changes; the others play once and hold. */
const LOOPS = new Set<MascotActivity>(["idle", "walk", "fly", "drag", "working", "sleep"]);
const FADE_S = 0.25;
/** The head's turn, clip and gaze together, never past this (radians, about 25 degrees): the head is a layer of the body. */
const HEAD_YAW_MAX = 0.45;

/** Each part's color from the bot's palette (the parts are named by the generator). */
export function partColors(palette: OwlPalette): Record<string, string> {
  return {
    plumage: palette.plumage,
    lid: palette.plumage,
    wingNear: palette.wingNear,
    wingFar: shade(palette.wingNear, 0.25),
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

/** One clip cut out of the baked timeline, re-sampled so it starts and ends exactly on its frames. */
export function cutClip(timeline: AnimationClip, name: string, range: [number, number], fps: number): AnimationClip {
  const [start, end] = range;
  const count = end - start + 1;
  const tracks = timeline.tracks.map((track) => {
    // every keyframe track makes its own interpolant (quaternions slerp); the typings omit the method
    const interpolant = (track as unknown as { createInterpolant(): { evaluate(time: number): ArrayLike<number> } }).createInterpolant();
    const size = track.getValueSize();
    const times = new Float32Array(count);
    const values = new Float32Array(count * size);
    for (let i = 0; i < count; i += 1) {
      times[i] = i / fps;
      values.set(interpolant.evaluate((start + i) / fps), i * size);
    }
    const Track = track.constructor as new (name: string, times: Float32Array, values: Float32Array) => KeyframeTrack;
    return new Track(track.name, times, values);
  });
  return new AnimationClip(name, (count - 1) / fps, tracks);
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
    scene.add(new HemisphereLight(0xffffff, 0xf3e7d8, 1.7));
    scene.add(new AmbientLight(0xffffff, 0.35));
    const key = new DirectionalLight(0xffffff, 1.2);
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
    const actions = new Map<string, AnimationAction>();
    let current: AnimationAction | null = null;
    let playing = "";
    let headBone: Bone | null = null;
    let lid: SkinnedMesh | null = null;
    const solids: Mesh[] = [];
    let facing = 1;
    let gaze = 0;
    const raycaster = new Raycaster();

    const play = (name: string) => {
      if (!mixer || name === playing) return;
      const action = actions.get(name) ?? actions.get("idle");
      if (!action) return;
      playing = name;
      action.reset();
      action.setLoop(LOOPS.has(name as MascotActivity) ? LoopRepeat : LoopOnce, Infinity);
      action.clampWhenFinished = true;
      action.enabled = true;
      action.play();
      if (current && current !== action) current.crossFadeTo(action, FADE_S, false);
      current = action;
    };

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      owlUrl,
      (gltf) => {
        if (disposed) return;
        owl = gltf.scene;
        scene.add(owl);
        owl.traverse((node) => {
          const mesh = node as SkinnedMesh;
          if (mesh.isMesh) {
            mesh.material = new MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
            mesh.frustumCulled = false;
            solids.push(mesh);
            if (mesh.name === "lid") lid = mesh;
          }
          if ((node as Bone).isBone && node.name === "headBone") headBone = node as Bone;
        });
        recolor.current = (tint, wear) => {
          const hex = (MAUS_COLORS as Record<string, string>)[tint] ?? tint;
          const colors = partColors(owlSkinPalette(owlSkinId(wear), owlPalette(hex), hex));
          for (const mesh of solids) {
            const value = colors[mesh.name];
            if (value) (mesh.material as MeshStandardMaterial).color = new Color(value);
          }
        };
        recolor.current(color, skin);
        const info = (gltf.scene.getObjectByName("owl")?.userData ?? {}) as { clips?: Record<string, [number, number]>; fps?: number };
        const timeline = gltf.animations[0];
        mixer = new AnimationMixer(owl);
        if (timeline && info.clips) {
          for (const [name, range] of Object.entries(info.clips)) actions.set(name, mixer.clipAction(cutClip(timeline, name, range, info.fps ?? 20)));
        }
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
      play(live.current.activity);
      mixer.update(dt);
      // on top of the clip: face the way it goes, look at the pointer, blink
      const f = live.current.frame(now);
      // facing the other way is a mirror, through a quick squash: a half turn would show the
      // model's flat back (it is the 2D art given depth, not a sculpture)
      facing += ((f.face ?? 1) - facing) * (1 - Math.exp(-dt / 0.08));
      const turn = flatTurn(facing);
      owl.scale.set(turn.sx, turn.sy, 1);
      // the gaze is an offset on top of the clip's head (the mixer rewrites the head every frame),
      // eased, and the total kept within reach so the head never ends up sideways
      gaze += ((live.current.activity === "idle" ? f.pupilX * 0.35 : 0) - gaze) * (1 - Math.exp(-dt / 0.2));
      if (headBone) headBone.rotation.y = Math.min(HEAD_YAW_MAX, Math.max(-HEAD_YAW_MAX, headBone.rotation.y + gaze));
      const lidMesh = lid as SkinnedMesh | null;
      if (lidMesh?.morphTargetInfluences) lidMesh.morphTargetInfluences[0] = Math.max(lidMesh.morphTargetInfluences[0], blinkAt(now));
      renderer.render(scene, camera);
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
