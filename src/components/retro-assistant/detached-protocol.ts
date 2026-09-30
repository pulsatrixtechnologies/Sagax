// The messages between the main app page (the assistant's brain) and the
// detached assistant window (a dumb renderer). Mirrors the validation in
// electron/retro-assistant-window.mjs, which checks every payload in main.
import type { AssistantPose, RetroCharacter } from "./logic";

export interface DetachedItem {
  id: string;
  label: string;
  default?: boolean;
}

export interface DetachedBalloon {
  title?: string;
  text?: string;
  question?: string;
  bullets: DetachedItem[];
  buttons: DetachedItem[];
  ask?: { label: string; placeholder: string; search: string; options: string };
}

export interface DetachedSnapshot {
  v: 1;
  character: RetroCharacter;
  pose: AssistantPose;
  reduced: boolean;
  /** The app's language, for the page's lang attribute (strings arrive translated). */
  locale: string;
  /** The character's accessible name. */
  label: string;
  /** The waiting tip's bulb label, or null when none is waiting. */
  bulb: string | null;
  look: { color: string; skin: string } | null;
  /** The right-click menu. */
  menu: DetachedItem[];
  balloon: DetachedBalloon | null;
}

export type DetachedEvent =
  | { type: "click" | "bulb" | "dismiss" | "options" | "context" }
  | { type: "bullet" | "button" | "menu"; id: string }
  | { type: "search"; query: string };

/** window.retroAssistantWindow, from electron/retro-assistant-preload.cjs. */
export interface AssistantWindowBridge {
  moveBy(dx: number, dy: number): Promise<{ x: number; y: number } | null>;
  moved(): void;
  getPosition(): Promise<{ x: number; y: number } | null>;
  resize(width: number, height: number): Promise<unknown>;
  setInteractive(on: boolean): void;
  setFocusable(on: boolean): void;
  send(event: DetachedEvent): void;
  ready(): void;
  onState(callback: (state: DetachedSnapshot) => void): () => void;
}

const ID = /^[a-zA-Z0-9:_-]{1,64}$/;

/** The renderer's own check of an incoming snapshot (main already validated it). */
export function isDetachedSnapshot(value: unknown): value is DetachedSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<DetachedSnapshot>;
  return (
    snapshot.v === 1 &&
    (snapshot.character === "trombi" || snapshot.character === "owl" || snapshot.character === "custom") &&
    typeof snapshot.pose === "string" &&
    Array.isArray(snapshot.menu) &&
    snapshot.menu.every((item) => item && ID.test(item.id) && typeof item.label === "string")
  );
}
