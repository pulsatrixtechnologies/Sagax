// The messages between the main app page (every floating bot's brain) and a
// floating bot's window (a dumb renderer). Mirrors the validation in
// electron/floating-bot-window.mjs, which checks every payload in main.

export type FloatingPose = "idle" | "think" | "speak" | "celebrate" | "alert" | "sleep";
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
}

export type FloatingEvent =
  | { type: "click" | "context" | "dismiss" | "open" }
  | { type: "menu"; id: string }
  | { type: "send"; text: string };

/** window.floatingBotWindow, from electron/floating-bot-preload.cjs. */
export interface FloatingWindowBridge {
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
  return event.type === "click" || event.type === "context" || event.type === "dismiss" || event.type === "open";
}
