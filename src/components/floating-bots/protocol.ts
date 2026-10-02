// The messages between the main app page (every floating bot's brain) and a
// floating bot's window (a dumb renderer). Mirrors the validation in
// electron/floating-bot-window.mjs, which checks every payload in main.

import type { Liveliness, MascotTask } from "./behavior";
import type { FloatingContext } from "./gauge";
import type { MascotLook } from "../../../shared/mascot-look";
import type { FloatingTheme } from "./theme";
import type { CallPhase } from "@/lib/voice-mode/call-machine";
import type { CallSettings } from "@/lib/voice-mode/call-settings";
import type { VoiceModeSettings } from "../../../shared/voice-mode";

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
  /** Earlier exchanges of this conversation, oldest first: scroll up to read them. */
  history?: { asked: string; text: string }[];
  text: string;
  streaming: boolean;
  truncated: boolean;
  /** The "Open in the app" link. */
  open: string;
  /** The close button's accessible name. */
  close: string;
  input: { label: string; placeholder: string; send: string } | null;
}

/**
 * The live voice call with this bot, as the mascot shows it (the brain runs
 * the call, live-call-store.ts; the window only draws it and reports clicks).
 */
export interface FloatingCall {
  phase: CallPhase;
  muted: boolean;
  /** the bot's voice is audible now (a click on the mascot interrupts it) */
  botAudible: boolean;
  /** push to talk (a hold-to-talk button), else hands-free */
  push: boolean;
  /** when the call started (Date.now() in the app) */
  startedAt: number;
  /** the person's words so far, or the bot's sentence now audible */
  line: string;
  transcript: { id: string; who: "you" | "bot"; text: string; interrupted?: boolean }[];
  note: string | null;
  notice: string | null;
  settings: VoiceModeSettings;
  callSettings: CallSettings;
  /** the voices to pick from, once asked for ("voices") */
  voices: { id: string; label: string }[] | null;
  voicesError: string | null;
  enrollment: { state: "none" | "enrolled" | "failed" } | { state: "recording"; share: number };
  previewing: { id: string; loading: boolean } | null;
}

/** What the mascot's call controls ask of the brain. */
export type FloatingCallAction =
  | "start" | "end" | "mute" | "unmute" | "hold" | "resume" | "interrupt" | "retry"
  | "talk" | "release" | "voices" | "enroll" | "forget" | "preview" | "settings" | "call-settings";
export const CALL_ACTIONS: ReadonlySet<FloatingCallAction> = new Set<FloatingCallAction>([
  "start", "end", "mute", "unmute", "hold", "resume", "interrupt", "retry", "talk", "release", "voices", "enroll", "forget", "preview", "settings", "call-settings",
]);

/** How loud each side of the call is now, 0..1 (its own light channel, many times a second). */
export interface FloatingCallLevels {
  bot: number;
  mic: number;
}

export interface FloatingSnapshot {
  v: 1;
  /** The bot's id: the balloon remembers its size and place per bot. */
  id?: string;
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
  hints: { mood: string; working: string; hoot?: string; pin?: string; call?: string };
  /** The "Activity level" setting; normal when absent. */
  liveliness?: Liveliness;
  /** The followed thread's context use, for the energy bar; null before its first turn. */
  context?: FloatingContext | null;
  /** The character this bot wears on the desktop (mascots.tsx); the owl when absent. */
  mascot?: MascotLook;
  /** The app's theme (skin and brand accent), for the balloon; the window's default when absent. */
  theme?: FloatingTheme;
  /** The live voice call with this bot, when there is one. */
  call?: FloatingCall | null;
}


/**
 * "click" opens or closes the balloon (a double click, or Enter); "play" is a
 * single click on the mascot and "pet" a stroke over it (both raise its mood).
 */
export type FloatingEvent =
  | { type: "click" | "context" | "dismiss" | "open" | "play" | "pet" }
  | { type: "menu"; id: string }
  | { type: "send"; text: string }
  | { type: "call"; action: FloatingCallAction; voice?: string; patch?: Record<string, string | number | boolean> };

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
  /** Size the window to what is drawn, keeping the character's corner in place (bottom-right unless said otherwise). */
  resize(width: number, height: number, anchor?: { x: "left" | "right"; y: "top" | "bottom" }): Promise<unknown>;
  setInteractive(on: boolean): void;
  setFocusable(on: boolean): void;
  send(event: FloatingEvent): void;
  ready(): void;
  onState(callback: (state: FloatingSnapshot) => void): () => void;
  /** The call's levels (optional: an older preload lacks it). */
  onLevel?(callback: (levels: FloatingCallLevels) => void): () => void;
}

/** window.ogb.floatingBots, from electron/preload.cjs (the local main page only). */
export interface FloatingBotsBridge {
  open(botId: string, alwaysOnTop: boolean): Promise<boolean>;
  close(botId: string): Promise<boolean>;
  setAlwaysOnTop(botId: string, on: boolean): Promise<boolean>;
  list(): Promise<string[]>;
  update(botId: string, snapshot: FloatingSnapshot): void;
  /** The call's levels for that bot's window (optional: an older preload lacks it). */
  level?(botId: string, levels: FloatingCallLevels): void;
  onEvent(cb: (value: { botId: string; event: FloatingEvent }) => void): () => void;
  onClosed(cb: (value: { botId: string }) => void): () => void;
  /** A window is ready but has no state: send it again (optional: an older preload lacks it). */
  onWant?(cb: (value: { botId: string }) => void): () => void;
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
      ...(typeof snapshot.hints?.pin === "string" ? { pin: snapshot.hints.pin } : {}),
      ...(typeof snapshot.hints?.call === "string" ? { call: snapshot.hints.call } : {}),
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
  const event = value as { type?: unknown; id?: unknown; text?: unknown; action?: unknown };
  if (event.type === "call") return CALL_ACTIONS.has(event.action as FloatingCallAction);
  if (event.type === "menu") return typeof event.id === "string" && ID.test(event.id);
  if (event.type === "send") return typeof event.text === "string" && event.text.trim().length > 0;
  return ["click", "context", "dismiss", "open", "play", "pet"].includes(event.type as string);
}
