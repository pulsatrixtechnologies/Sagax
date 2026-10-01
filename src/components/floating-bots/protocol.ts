// The messages between the main app page (every floating bot's brain) and a
// floating bot's window (a dumb renderer). Mirrors the validation in
// electron/floating-bot-window.mjs, which checks every payload in main.

import type { Liveliness, MascotTask } from "./behavior";
import type { FloatingContext } from "./gauge";
import { cleanMascotChoice, type FloatingMascotChoice, type FloatingMascotKind } from "@/lib/floating-bots";

export type FloatingPose = "idle" | "think" | "speak" | "celebrate" | "alert" | "sleep";
export type { MascotTask };
export type FloatingBalloonKind = "chat" | "thinking" | "approval" | "error";

export interface FloatingMenuItem {
  id: string;
  label: string;
  checked?: boolean;
}

export interface FloatingAvatar {
  /** A data: URL on the desktop (the window fetches nothing); the app's own URL in the browser overlay. */
  src: string;
  crop: "circle" | "rounded" | "square";
  zoom: number;
  focusX: number;
  focusY: number;
}

export interface FloatingBalloon {
  kind: FloatingBalloonKind;
  title?: string;
  /** What the person last asked, shown small above the answer. */
  asked?: string;
  text: string;
  streaming: boolean;
  truncated: boolean;
  /** The "Open in the app" link. */
  open: string;
  /** The close button's accessible name. */
  close: string;
  input: { label: string; placeholder: string; send: string } | null;
}

export interface FloatingSnapshot {
  v: 1;
  name: string;
  /** The character's accessible name. */
  label: string;
  color: string;
  skin: string;
  avatar: FloatingAvatar | null;
  pose: FloatingPose;
  reduced: boolean;
  /** The Hibou 98 skin is worn: retro balloon and Trombi's sparkle. */
  retro: boolean;
  /** Bumped when a reply settles; the window plays its sparkle on a change. */
  sparkle: number;
  locale: string;
  menu: FloatingMenuItem[];
  balloon: FloatingBalloon | null;
  /** The bot's work, for the mascot: it flies off while "working" (when flyAway). */
  task: MascotTask;
  /** The Tamagotchi meter, 0..1, kept by the brain per bot. */
  mood: number;
  /** The "Fly away during tasks" setting. */
  flyAway: boolean;
  /** Short texts the mascot shows: the mood meter's label, the parked badge's, its hoot. */
  hints: { mood: string; working: string; hoot?: string };
  /** The "Activity level" setting; normal when absent. */
  liveliness?: Liveliness;
  /** The followed thread's context use, for the energy bar; null before its first turn. */
  context?: FloatingContext | null;
  /** The character this bot wears on the desktop (mascots.tsx); the owl when absent. */
  mascot?: FloatingMascotChoice;
  /** The balloon's tabs and the Mascot tab's texts, translated by the brain. */
  picker?: FloatingPickerLabels;
}

export interface FloatingPickerLabels {
  tabs: string;
  chat: string;
  mascot: string;
  kinds: Record<FloatingMascotKind, string>;
  shape: string;
  style: string;
  flat: string;
  threeD: string;
  bodies: Record<string, string>;
}

/**
 * "click" opens or closes the balloon (a double click, or Enter); "play" is a
 * single click on the mascot and "pet" a stroke over it (both raise its mood).
 */
export type FloatingEvent =
  | { type: "click" | "context" | "dismiss" | "open" | "play" | "pet" }
  /** The Mascot tab: wear another character. */
  | { type: "mascot"; choice: FloatingMascotChoice }
  | { type: "menu"; id: string }
  | { type: "send"; text: string };

export interface FloatingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a floating window stands, the work area of its display, and the pointer (screen coordinates). */
export interface FloatingGeometry {
  bounds: FloatingRect;
  workArea: FloatingRect;
  cursor: { x: number; y: number } | null;
}

/** window.floatingBotWindow, from electron/floating-bot-preload.cjs. */
export interface FloatingWindowBridge {
  /** Optional: an older main process lacks these and the mascot simply stays put. */
  geometry?(): Promise<FloatingGeometry | null>;
  moveTo?(x: number, y: number): Promise<FloatingRect | null>;
  /** While on, the mascot moves its own window and main does not save the spot. */
  autopilot?(on: boolean): void;
  moveBy(dx: number, dy: number): Promise<{ x: number; y: number } | null>;
  moved(): void;
  resize(width: number, height: number): Promise<unknown>;
  setInteractive(on: boolean): void;
  setFocusable(on: boolean): void;
  send(event: FloatingEvent): void;
  ready(): void;
  onState(callback: (state: FloatingSnapshot) => void): () => void;
}

/** window.ogb.floatingBots, from electron/preload.cjs (the local main page only). */
export interface FloatingBotsBridge {
  open(botId: string, alwaysOnTop: boolean): Promise<boolean>;
  close(botId: string): Promise<boolean>;
  setAlwaysOnTop(botId: string, on: boolean): Promise<boolean>;
  list(): Promise<string[]>;
  update(botId: string, snapshot: FloatingSnapshot): void;
  onEvent(cb: (value: { botId: string; event: FloatingEvent }) => void): () => void;
  onClosed(cb: (value: { botId: string }) => void): () => void;
}

const ID = /^[a-zA-Z0-9:_-]{1,64}$/;
const POSES = new Set<FloatingPose>(["idle", "think", "speak", "celebrate", "alert", "sleep"]);
const TASKS = new Set<MascotTask>(["idle", "working", "waiting", "error"]);

/** A snapshot from an older brain may lack the mascot's fields: fill them in. */
export function mascotFields(snapshot: Partial<FloatingSnapshot>): Pick<FloatingSnapshot, "task" | "mood" | "flyAway" | "hints" | "liveliness"> {
  const mood = typeof snapshot.mood === "number" && Number.isFinite(snapshot.mood) ? Math.min(1, Math.max(0, snapshot.mood)) : 0.6;
  return {
    task: TASKS.has(snapshot.task as MascotTask) ? (snapshot.task as MascotTask) : "idle",
    mood,
    flyAway: snapshot.flyAway !== false,
    hints: {
      mood: typeof snapshot.hints?.mood === "string" ? snapshot.hints.mood : "",
      working: typeof snapshot.hints?.working === "string" ? snapshot.hints.working : "",
      ...(typeof snapshot.hints?.hoot === "string" ? { hoot: snapshot.hints.hoot } : {}),
    },
    liveliness: snapshot.liveliness === "calm" || snapshot.liveliness === "lively" ? snapshot.liveliness : "normal",
  };
}

/** The renderer's own check of an incoming snapshot (main already validated it). */
export function isFloatingSnapshot(value: unknown): value is FloatingSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<FloatingSnapshot>;
  return (
    snapshot.v === 1 &&
    typeof snapshot.name === "string" &&
    POSES.has(snapshot.pose as FloatingPose) &&
    Array.isArray(snapshot.menu) &&
    snapshot.menu.every((item) => item && ID.test(item.id) && typeof item.label === "string")
  );
}

/** The brain's check of what came back from a window (main already validated it). */
export function isFloatingEvent(value: unknown): value is FloatingEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as { type?: unknown; id?: unknown; text?: unknown };
  if (event.type === "menu") return typeof event.id === "string" && ID.test(event.id);
  if (event.type === "send") return typeof event.text === "string" && event.text.trim().length > 0;
  if (event.type === "mascot") return Boolean(cleanMascotChoice((value as { choice?: unknown }).choice));
  return ["click", "context", "dismiss", "open", "play", "pet"].includes(event.type as string);
}
