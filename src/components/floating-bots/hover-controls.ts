// The desktop mascot's hover controls and its click, as pure rules (tested in
// hover-controls.test.ts): when the small row of round controls beside the
// character shows (quick chat, voice, activity, like ChatGPT Pets), and what
// a plain click on the character does (it opens the chat balloon, never a call).

/** The controls show this long after the pointer comes over the character (a pointer passing by shows nothing). */
export const HOVER_IN_MS = 150;
/** ...and stay this long after it leaves, so the pointer can reach them. */
export const HOVER_OUT_MS = 400;

export interface HoverControlsInput {
  /** The pointer (or the keyboard's focus) is over the character or the controls. */
  over: boolean;
  /** When `over` last changed. */
  since: number;
  now: number;
  /** Whether they show now. */
  shown: boolean;
  /** A drag, the away badge, an open menu or no character drawn: never shown. */
  blocked: boolean;
}

/**
 * Whether the hover controls show, and in how many ms to ask again (null:
 * nothing will change by itself). They come HOVER_IN_MS after the pointer
 * arrives and go HOVER_OUT_MS after it leaves; a drag hides them at once.
 */
export function hoverControlsShown({ over, since, now, shown, blocked }: HoverControlsInput): { shown: boolean; recheckIn: number | null } {
  if (blocked) return { shown: false, recheckIn: null };
  const elapsed = Math.max(0, now - since);
  if (over) {
    if (shown) return { shown: true, recheckIn: null };
    return elapsed >= HOVER_IN_MS ? { shown: true, recheckIn: null } : { shown: false, recheckIn: HOVER_IN_MS - elapsed };
  }
  if (!shown) return { shown: false, recheckIn: null };
  return elapsed >= HOVER_OUT_MS ? { shown: false, recheckIn: null } : { shown: true, recheckIn: HOVER_OUT_MS - elapsed };
}

/** How far the pointer must travel before a press on the character becomes a drag (FloatingBotView's slop). */
export const DRAG_SLOP = 4;

/** Whether a press that went this far is a drag. */
export const isDrag = (dx: number, dy: number, slop = DRAG_SLOP) => Math.hypot(dx, dy) >= slop;

export type MascotClick =
  /** cut the bot's voice (a click while it speaks, as in the app's call) */
  | "interrupt"
  /** open or close the chat bubble */
  | "chat"
  /** the second click of a double click: the app on this bot's thread */
  | "open"
  /** nothing: a drag, a long press that opened the menu, a click on a call */
  | "none";

/**
 * What a press released on the character does. A drag moves it and a long
 * press opens the menu (slice 1); a plain click on the idle character opens
 * the chat bubble and never starts a call (the hover call button and the
 * hotkey do); on a call a click only cuts the bot's voice while it speaks and never ends anything
 * (the pill's red button does). A double click still opens the app.
 */
export function mascotClick({ moved, menu, onCall, botAudible, gesture }: {
  moved: boolean;
  menu: boolean;
  onCall: boolean;
  botAudible: boolean;
  gesture: "single" | "double";
}): MascotClick {
  if (moved || menu) return "none";
  if (onCall) return botAudible ? "interrupt" : gesture === "double" ? "open" : "none";
  if (gesture === "double") return "open";
  return "chat";
}
