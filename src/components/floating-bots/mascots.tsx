// The desktop mascot registry: every character a bot can wear on the
// desktop, one entry each (id, label, what it can animate, how it draws on
// the desktop and as a thumbnail). Adding a character is adding an entry.
// The same behavior state machine (behavior.ts) drives them all; each
// renderer maps the clips it can show and degrades gracefully: the original
// bodies and Trombi have no wings, so a flight is a bouncing hop across.
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import { MAUS_COLORS } from "@/lib/mascot";
import { OwlAvatar } from "@/components/OwlAvatar";
import { CursorAvatar, type CursorState } from "@/components/CursorAvatar";
import { Trombi, type TrombiPose } from "@/components/retro-assistant/Trombi";
import type { FloatingMascotChoice, FloatingMascotKind } from "@/lib/floating-bots";
import { MASCOT_BODIES, MASCOT_BODY_IDS, botMascotBody, type MascotBodyId } from "../../../shared/mascot-bodies";
import { createFrameSmoother, type MascotActivity, type MascotFrame } from "./behavior";
import Owl25D, { flatTilt, flatTurn } from "./Owl25D";
import type { FloatingPose } from "./protocol";

export interface MascotRenderProps {
  color: string;
  skin: string;
  choice: FloatingMascotChoice;
  /** The character's box, px. */
  size: number;
  activity: MascotActivity;
  pose: FloatingPose;
  frame: (now: number) => MascotFrame;
  fps: () => number;
  onHitTest: (test: ((clientX: number, clientY: number) => boolean) | null) => void;
  /** The whole stage around the character's box (a 3D canvas covers it, fit.ts). */
  stage?: { width: number; height: number; left: number; top: number };
}

export interface MascotThumbProps {
  color: string;
  skin: string;
  choice: FloatingMascotChoice;
  size: number;
}

export interface MascotCapabilities {
  walk: boolean;
  fly: boolean;
  wings: boolean;
  blink: boolean;
  turn: boolean;
  flip: boolean;
}

export interface MascotDefinition {
  id: FloatingMascotKind;
  capabilities: MascotCapabilities;
  Render: ComponentType<MascotRenderProps>;
  Thumb: ComponentType<MascotThumbProps>;
}

const hexOf = (color: string) => (MAUS_COLORS as Record<string, string>)[color] ?? color;
const DEG = 180 / Math.PI;

/**
 * A whole-character 2.5D transform for a frame: a perspective turn (spins,
 * facing the other way), a flip in its plane (backflips), lift, lean, squash
 * and size. For characters drawn in one piece (the original bodies, Trombi).
 */
export function motion25dTransform(frame: MascotFrame, size: number): string {
  const facing = flatTurn(frame.face);
  const lift = (frame.y + facing.lift) * size * 0.32;
  const shift = ((frame.x ?? 0) + frame.sway * 0.6) * size * 0.32;
  const squash = frame.squash * facing.sy;
  const tilt = flatTilt((frame.headTilt * 0.5 + frame.lean * 0.4) * DEG);
  // flat drawings never turn in depth: only a tilt, a lift, a squash and the facing swap
  return (
    `translate(${shift.toFixed(2)}px, ${(-lift).toFixed(2)}px) rotate(${tilt.toFixed(2)}deg) ` +
    `scale(${((facing.sx * frame.scale * (frame.puff ?? 1)) / Math.sqrt(squash)).toFixed(4)}, ${(frame.scale * squash).toFixed(4)})`
  );
}

/** Moves a one-piece character with the mascot's frames, and hit-tests its painted pixels. */
function Motion25D({ size, frame, fps, onHitTest, children }: Pick<MascotRenderProps, "size" | "frame" | "fps" | "onHitTest"> & { children: React.ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  const live = useRef({ frame, fps });
  live.current = { frame, fps };
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const smooth = createFrameSmoother();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      if (now - last < 1000 / Math.max(1, Math.min(60, live.current.fps())) - 3) return;
      last = now;
      if (box.current) box.current.style.transform = motion25dTransform(smooth(live.current.frame(now), now), size);
    };
    raf = requestAnimationFrame(tick);
    onHitTest((x, y) => {
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && box.current?.contains(hit) && hit.tagName.toLowerCase() !== "svg" && hit !== box.current);
    });
    return () => {
      cancelAnimationFrame(raf);
      onHitTest(null);
    };
    // the loop reads the latest callbacks through `live`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);
  return (
    <span ref={box} style={{ display: "grid", placeItems: "end center", width: size, height: size, transformOrigin: "50% 62%" }}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------ the owl */

// the 3D owl and three.js: their own chunk, fetched only when a bot's owl is set to 3D
const Owl3D = lazy(() => import("./owl3d/Owl3D"));

function OwlRender({ color, skin, size, frame, fps, onHitTest, choice, activity, stage }: MascotRenderProps) {
  const [flat, setFlat] = useState(false);
  const owl2d = <Owl25D color={color} skin={skin} size={size} frame={frame} fps={fps} onHitTest={onHitTest} />;
  if (choice.style !== "3d" || !stage || flat) return owl2d;
  return (
    <Suspense fallback={owl2d}>
      <Owl3D color={color} skin={skin} activity={activity} stage={stage} owlSize={size} frame={frame} fps={fps} onHitTest={onHitTest} onFail={() => setFlat(true)} />
    </Suspense>
  );
}

function OwlThumb({ color, skin, size }: MascotThumbProps) {
  return <OwlAvatar color={color} skin={skin} size={size} animated={false} trackPointer={false} label={null} />;
}

/* --------------------------------------------- the original mascot bodies */

/** The original mascot's face for a clip. */
export function cursorStateFor(activity: MascotActivity, pose: FloatingPose): CursorState {
  const byActivity: Partial<Record<MascotActivity, CursorState>> = {
    sleep: "sleeping",
    yawn: "drowsy",
    wake: "waking",
    petted: "happy",
    love: "happy",
    spin: "excited",
    backflip: "excited",
    dance: "playful",
    jump: "excited",
    celebrate: "celebrate",
    angry: "angry",
    confused: "confused",
    shy: "shy",
    sad: "sad",
    startled: "surprised",
    surprised: "surprised",
    think: "thinking",
    working: "working",
    drag: "dragging",
    look: "curious",
    lookBack: "curious",
    tilt: "curious",
    hoot: "humming",
    wave: "playful",
    flyOut: "sending",
    return: "receiving",
    fly: "bouncing",
  };
  const mapped = byActivity[activity];
  if (mapped) return mapped;
  if (pose === "think") return "thinking";
  if (pose === "speak") return "listening";
  if (pose === "alert") return "alerting";
  return "idle";
}

function BodyRender({ color, choice, size, activity, pose, frame, fps, onHitTest }: MascotRenderProps) {
  const hex = hexOf(color);
  return (
    <Motion25D size={size} frame={frame} fps={fps} onHitTest={onHitTest}>
      <CursorAvatar
        state={cursorStateFor(activity, pose)}
        size={size * 0.86}
        silhouette={MASCOT_BODIES[botMascotBody(choice.body)]}
        gradient={[hex, hex, hex]}
        motion={0}
        effects={false}
        glyphs={false}
        title={null}
      />
    </Motion25D>
  );
}

function BodyThumb({ color, choice, size }: MascotThumbProps) {
  const hex = hexOf(color);
  return <CursorAvatar state="idle" size={size} silhouette={MASCOT_BODIES[botMascotBody(choice.body)]} gradient={[hex, hex, hex]} motion={0} effects={false} glyphs={false} paused title={null} />;
}

/* ------------------------------------------------------------- Trombi */

/** Trombi's pose for a clip: he has no wings, so a flight is a send. */
export function trombiPoseFor(activity: MascotActivity, pose: FloatingPose): TrombiPose {
  if (activity === "sleep" || activity === "yawn") return "sleep";
  if (activity === "think" || activity === "working") return "think";
  if (["celebrate", "dance", "jump", "spin", "backflip", "love", "petted"].includes(activity)) return "celebrate";
  if (activity === "sad" || activity === "confused") return "bored";
  if (activity === "hoot" || activity === "wave") return "speak";
  if (activity === "flyOut" || activity === "return" || activity === "fly") return "send";
  if (pose === "speak") return "speak";
  if (pose === "think") return "think";
  return "idle";
}

function TrombiRender({ size, activity, pose, frame, fps, onHitTest }: MascotRenderProps) {
  return (
    <Motion25D size={size} frame={frame} fps={fps} onHitTest={onHitTest}>
      <Trombi pose={trombiPoseFor(activity, pose)} size={size * 0.72} label={null} />
    </Motion25D>
  );
}

function TrombiThumb({ size }: MascotThumbProps) {
  return <Trombi pose="idle" size={size * 0.8} still label={null} />;
}

/* ----------------------------------------------------------- registry */

export const MASCOTS: readonly MascotDefinition[] = [
  { id: "owl", capabilities: { walk: true, fly: true, wings: true, blink: true, turn: true, flip: true }, Render: OwlRender, Thumb: OwlThumb },
  { id: "body", capabilities: { walk: true, fly: false, wings: false, blink: true, turn: true, flip: true }, Render: BodyRender, Thumb: BodyThumb },
  { id: "trombi", capabilities: { walk: true, fly: false, wings: false, blink: false, turn: true, flip: true }, Render: TrombiRender, Thumb: TrombiThumb },
];

export const DEFAULT_MASCOT: FloatingMascotChoice = { kind: "owl", style: "2d" };

export function mascotFor(choice: FloatingMascotChoice | undefined): MascotDefinition {
  return MASCOTS.find((entry) => entry.id === choice?.kind) ?? MASCOTS[0];
}

/** The original body shapes, in the picker's order. */
export const BODY_CHOICES: readonly MascotBodyId[] = MASCOT_BODY_IDS;

/** The next character, for the right-click menu item that cycles them. */
export function nextMascot(choice: FloatingMascotChoice | undefined): FloatingMascotChoice {
  const at = MASCOTS.findIndex((entry) => entry.id === (choice?.kind ?? "owl"));
  const kind = MASCOTS[(at + 1) % MASCOTS.length].id;
  return { ...choice, kind };
}
