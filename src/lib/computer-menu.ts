// The Computer tab's machine menu (the old segmented row cut names off).
// Pure: which power word a machine gets, and how the keyboard moves through
// the list. The view is ScreenPicker in src/components/computer/ComputerMenu.tsx.
import type { LocaleKey } from "@/locales";

/** A machine's power, in the words the menu shows. "on" is Allumé / On. */
export type ComputerPower = "off" | "on" | "paused" | "starting" | "error" | "unavailable";

const STATUS_KEY = {
  off: "orgComputer.choice.status.off",
  on: "orgComputer.choice.status.on",
  paused: "orgComputer.choice.status.paused",
  starting: "orgComputer.choice.status.starting",
  error: "orgComputer.choice.status.error",
  unavailable: "orgComputer.choice.status.unavailable",
} as const satisfies Record<ComputerPower, LocaleKey>;

export function powerLabelKey(power: ComputerPower): LocaleKey {
  return STATUS_KEY[power];
}

/** The screen's five states, with a running machine reading as on. */
export function powerFromScreen(state: "off" | "starting" | "running" | "paused" | "error"): ComputerPower {
  return state === "running" ? "on" : state;
}

/** The person's server environment, the same words the screen uses for it:
 * not configured is off; a state the screen cannot place is unavailable. */
export function powerFromEnvironment(status: { configured: boolean; state?: string | undefined }): ComputerPower {
  if (!status.configured) return "off";
  if (status.state === "running") return "on";
  if (status.state === "paused") return "paused";
  if (status.state === "missing" || status.state === "stopped") return "off";
  return "unavailable";
}

export interface ComputerMenuKey {
  key: string;
  open: boolean;
  count: number;
  /** The highlighted option. */
  active: number;
  /** The option the menu opens on (the one already chosen). */
  chosen: number;
  /** Option labels, for typing the first letter. */
  labels: readonly string[];
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export interface ComputerMenuKeyResult {
  handled: boolean;
  open: boolean;
  active: number;
  /** The option Enter or Space confirms, while the menu is open. */
  select: number | null;
  close: boolean;
}

/** Keyboard for the machine menu. Focus stays on the button; arrows move
 * the highlight, Enter and Space choose it, Escape only closes the menu. */
export function computerMenuOnKey(state: ComputerMenuKey): ComputerMenuKeyResult {
  const stay = { handled: false, open: state.open, active: state.active, select: null, close: false };
  if (state.altKey || state.metaKey || state.ctrlKey || state.count <= 0) return stay;
  const { key, count } = state;
  const chosen = clamp(state.chosen, count);
  const active = clamp(state.active, count);
  if (!state.open) {
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " " || key === "Home" || key === "End") {
      const start = key === "ArrowUp" || key === "End" ? count - 1 : key === "Home" ? 0 : chosen;
      return { handled: true, open: true, active: start, select: null, close: false };
    }
    return stay;
  }
  if (key === "Escape" || key === "Tab") return { handled: key === "Escape", open: false, active, select: null, close: true };
  if (key === "ArrowDown") return { handled: true, open: true, active: (active + 1) % count, select: null, close: false };
  if (key === "ArrowUp") return { handled: true, open: true, active: (active - 1 + count) % count, select: null, close: false };
  if (key === "Home") return { handled: true, open: true, active: 0, select: null, close: false };
  if (key === "End") return { handled: true, open: true, active: count - 1, select: null, close: false };
  if (key === "Enter" || key === " ") return { handled: true, open: false, active, select: active, close: true };
  if (key.length === 1 && /\p{L}|\p{N}/u.test(key)) {
    const q = key.toLocaleLowerCase();
    for (let step = 1; step <= count; step += 1) {
      const index = (active + step) % count;
      if (state.labels[index]?.toLocaleLowerCase().startsWith(q)) {
        return { handled: true, open: true, active: index, select: null, close: false };
      }
    }
  }
  return stay;
}

function clamp(index: number, count: number): number {
  if (count <= 0) return 0;
  if (!Number.isFinite(index) || index < 0) return 0;
  return Math.min(index, count - 1);
}
