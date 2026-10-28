// A 1:1 goal's status row (server/solo-goal.ts). The row's name carries the
// English words every client can show; the app draws `tool.soloGoal` in the
// reader's language (src/lib/activity-runs.ts).

export type SoloGoalLineStatus = "none" | "working" | "blocked" | "stopped" | "completed" | "paused";

export interface SoloGoalLine {
  status: SoloGoalLineStatus;
  goal?: string;
  detail?: string;
  /** Turns the bot works on its own before it waits (status "paused"). */
  rounds?: number;
}

/** The English line, for clients that do not draw `tool.soloGoal`. */
export function soloGoalLineText(line: SoloGoalLine): string {
  const detail = line.detail ? ` (${line.detail})` : "";
  switch (line.status) {
    case "none": return "No goal is set for this conversation.";
    case "working": return `Working on: ${line.goal ?? ""}`;
    case "completed": return `Done: ${line.goal ?? ""}${detail}`;
    case "blocked": return `Waiting for you: ${line.goal ?? ""}${detail}`;
    case "paused": return `Paused after ${line.rounds ?? 0} turns: ${line.goal ?? ""}. Send a message to continue.`;
    default: return `Stopped: ${line.goal ?? ""}`;
  }
}

const MARKERS = /[ \t]*<sagax-goal>[\s\S]*?<\/sagax-goal>[ \t]*\n?/g;

/** The reply as the person sees it: every goal marker taken out. */
export function withoutSoloGoalMarker(text: string): string {
  if (!text.includes("<sagax-goal>")) return text;
  return text.replace(MARKERS, "").trimEnd();
}
