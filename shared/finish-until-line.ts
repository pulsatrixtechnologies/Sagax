// "Do not finish until" (#1329, 2026-10-29): the status row Sagax writes in a
// 1:1 conversation while it checks the bot's condition after each turn
// (server/finish-until.ts). The row's name carries English words every client
// can show; the apps draw `tool.finishUntil` in the reader's language.

/** Relaunches Sagax starts on its own before it waits for the person. */
export const FINISH_UNTIL_DEFAULT_ROUNDS = 5;
/** The highest bound a person may set. Each relaunch is a paid turn. */
export const FINISH_UNTIL_MAX_ROUNDS = 50;

export type FinishUntilLineStatus = "relaunch" | "met" | "blocked" | "limit" | "stopped";

export interface FinishUntilLine {
  status: FinishUntilLineStatus;
  /** The person's condition, as it was when the row was written. */
  condition: string;
  /** Relaunch number (status "relaunch") or relaunches spent ("limit"). */
  round?: number;
  /** The bound in force for this bot. */
  max?: number;
  /** The bot's own short words (status "met" or "blocked"). */
  detail?: string;
}

/** The bound for one bot: its own setting, else the default, kept in range. */
export function finishUntilRounds(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return FINISH_UNTIL_DEFAULT_ROUNDS;
  return Math.min(FINISH_UNTIL_MAX_ROUNDS, Math.max(1, Math.round(value)));
}

/** The English line, for clients that do not draw `tool.finishUntil`. */
export function finishUntilLineText(line: FinishUntilLine): string {
  const detail = line.detail ? ` (${line.detail})` : "";
  switch (line.status) {
    case "relaunch": return `Relaunch ${line.round ?? 0}/${line.max ?? 0}: not finished until ${line.condition}`;
    case "met": return `Condition met: ${line.condition}${detail}`;
    case "blocked": return `Waiting for you before the condition is met: ${line.condition}${detail}`;
    case "limit": return `Stopped after ${line.round ?? 0} relaunches, the condition is not met yet: ${line.condition}. Send a message to continue.`;
    default: return `Relaunches stopped: ${line.condition}`;
  }
}

const MARKERS = /[ \t]*<sagax-finish>[\s\S]*?<\/sagax-finish>[ \t]*\n?/g;

/** The reply as the person sees it: every condition marker taken out. */
export function withoutFinishUntilMarker(text: string): string {
  if (!text.includes("<sagax-finish>")) return text;
  return text.replace(MARKERS, "").trimEnd();
}
