// The desktop mascot registry: every character a bot can wear on the
// desktop, one entry each (id, label, what it can animate, how it draws on
// the desktop and as a thumbnail). Adding a character is adding an entry.
// The same behavior state machine (behavior.ts) drives them all; each
// renderer maps the clips it can show and degrades gracefully: the shapes
// and Trombi have no wings, so a flight is a bouncing hop across. The
// character and its look come from the bot (bot.mascotLook); the desktop
// draws a skin's full effects, and its move effects with each move.
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import { OwlAvatar } from "@/components/OwlAvatar";
import { ShapeMascot, type ShapeMood } from "@/components/ShapeMascot";
import type { TrombiPose } from "@/components/retro-assistant/Trombi";
import { SkinnedTrombi } from "@/components/skin-fx/SkinnedTrombi";
import { fxMoveFor, type FxMoveRequest } from "@/components/skin-fx/skin-fx";
import { completeMascotLook, MASCOT_SHAPES, type MascotCharacter, type MascotLook, type MascotShape } from "../../../shared/mascot-look";
import { createFrameSmoother, type MascotActivity, type MascotFrame } from "./behavior";
import Owl25D, { flatTilt, flatTurn } from "./Owl25D";
import type { FloatingPose } from "./protocol";

export interface MascotRenderProps {
  color: string;
  /** The owl's skin (bot.mascotSkin). */
  skin: string;
  /** The bot's character and its look, every choice filled in. */
  look: CompleteLook;
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
  look: CompleteLook;
  size: number;
}

export type CompleteLook = ReturnType<typeof completeMascotLook>;

export interface MascotCapabilities {
  walk: boolean;
  fly: boolean;
  wings: boolean;
  blink: boolean;
  turn: boolean;
  flip: boolean;
}

export interface MascotDefinition {
  id: MascotCharacter;
  capabilities: MascotCapabilities;
  /** What the avatar popover offers for it: the bot colors, the owl skins. */
  paint: { colors: boolean; skins: boolean };
  /** The moves the avatar popover can preview for a character without wings (the owl keeps its wing moves). */
  moves: readonly MascotActivity[];
  Render: ComponentType<MascotRenderProps>;
  Thumb: ComponentType<MascotThumbProps>;
}

const DEG = 180 / Math.PI;

/**
 * A whole-character 2.5D transform for a frame: a perspective turn (spins,
 * facing the other way), a flip in its plane (backflips), lift, lean, squash
 * and size. For characters drawn in one piece (the shapes, Trombi).
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

function OwlRender({ color, skin, size, frame, fps, onHitTest, look, activity, stage }: MascotRenderProps) {
  const [flat, setFlat] = useState(false);
  const owl2d = <Owl25D color={color} skin={skin} size={size} frame={frame} fps={fps} onHitTest={onHitTest} />;
  if (look.style !== "3d" || !stage || flat) return owl2d;
  return (
    <Suspense fallback={owl2d}>
      <Owl3D color={color} skin={skin} activity={activity} stage={stage} owlSize={size} frame={frame} fps={fps} onHitTest={onHitTest} onFail={() => setFlat(true)} />
    </Suspense>
  );
}

function OwlThumb({ color, skin, size }: MascotThumbProps) {
  return <OwlAvatar color={color} skin={skin} size={size} animated={false} trackPointer={false} label={null} />;
}

/* ------------------------------------------------------------ the shapes */

/** A shape's face for a clip. */
export function shapeMoodForClip(activity: MascotActivity, pose: FloatingPose): ShapeMood {
  if (activity === "sleep" || activity === "yawn") return "sleeping";
  if (["petted", "love", "celebrate", "dance", "jump", "wave", "spin", "backflip"].includes(activity)) return "happy";
  if (activity === "working" || activity === "flyOut" || activity === "return") return "working";
  if (activity === "think" || activity === "confused" || pose === "think") return "thinking";
  return "idle";
}

/**
 * The skin effect of the clip playing now: a new request each time a move
 * starts (the behavior machine moves the body itself), none between moves.
 */
export function useClipFx(activity: MascotActivity): FxMoveRequest | null {
  const last = useRef<{ activity: MascotActivity; request: FxMoveRequest | null }>({ activity: "idle", request: null });
  if (last.current.activity !== activity) {
    const move = fxMoveFor(activity);
    last.current = { activity, request: move ? { clip: move, key: Date.now() } : null };
  }
  return last.current.request;
}

function ShapeRender({ color, look, size, activity, pose, frame, fps, onHitTest }: MascotRenderProps) {
  const move = useClipFx(activity);
  return (
    <Motion25D size={size} frame={frame} fps={fps} onHitTest={onHitTest}>
      <ShapeMascot shape={look.shape} skin={look.skins.shape} color={color} size={size * 0.8} mood={shapeMoodForClip(activity, pose)} detail="full" move={move} label={null} />
    </Motion25D>
  );
}

function ShapeThumb({ color, look, size }: MascotThumbProps) {
  return <ShapeMascot shape={look.shape} skin={look.skins.shape} color={color} size={size} animated={false} label={null} />;
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

/** Trombi on the desktop is drawn this much bigger than his box's share (he is thin). */
export const TROMBI_SCALE = 0.72 * 1.15;

function TrombiRender({ size, look, activity, pose, frame, fps, onHitTest }: MascotRenderProps) {
  const move = useClipFx(activity);
  return (
    <Motion25D size={size} frame={frame} fps={fps} onHitTest={onHitTest}>
      <SkinnedTrombi skin={look.skins.trombi} pose={trombiPoseFor(activity, pose)} size={size} width={size * TROMBI_SCALE} detail="full" move={move} label={null} />
    </Motion25D>
  );
}

function TrombiThumb({ size, look }: MascotThumbProps) {
  return <SkinnedTrombi skin={look.skins.trombi} pose="idle" size={size} width={size * 0.8} animated={false} label={null} />;
}

/* ----------------------------------------------------------- registry */

export const MASCOTS: readonly MascotDefinition[] = [
  { id: "owl", capabilities: { walk: true, fly: true, wings: true, blink: true, turn: true, flip: true }, paint: { colors: true, skins: true }, moves: [], Render: OwlRender, Thumb: OwlThumb },
  { id: "shape", capabilities: { walk: true, fly: false, wings: false, blink: true, turn: true, flip: true }, paint: { colors: true, skins: true }, moves: ["wave", "dance", "jump", "hop", "love"], Render: ShapeRender, Thumb: ShapeThumb },
  { id: "trombi", capabilities: { walk: true, fly: false, wings: false, blink: false, turn: true, flip: true }, paint: { colors: false, skins: true }, moves: ["hop", "jump", "dance", "hoot"], Render: TrombiRender, Thumb: TrombiThumb },
];

export function mascotFor(look: Pick<MascotLook, "character"> | undefined): MascotDefinition {
  return MASCOTS.find((entry) => entry.id === look?.character) ?? MASCOTS[0];
}

/** The shapes, in the picker's order. */
export const SHAPE_CHOICES: readonly MascotShape[] = MASCOT_SHAPES;
