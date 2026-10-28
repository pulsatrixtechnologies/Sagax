// A goal for one bot in a 1:1 chat. A team keeps its own /goal.
// The person starts, asks where it stands, or stops it. The bot works
// until it reports the goal done, or until the person stops it.

export type SoloGoalStatus = "working" | "stopped" | "completed";

export interface SoloGoal {
  goal: string;
  status: SoloGoalStatus;
  detail?: string;
}

const MARKER = /<sagax-goal>\s*(\{[\s\S]*?\})\s*<\/sagax-goal>/;

export type SoloGoalCommand =
  | { kind: "start"; goal: string }
  | { kind: "status" }
  | { kind: "stop" }
  | { kind: "none" };

/** `/goal …` in a 1:1, or a send already marked as goal mode. */
export function soloGoalCommand(text: string, mode?: string): SoloGoalCommand {
  const trimmed = text.trim();
  const sub = /^\/goal\s+(status|stop)\s*$/i.exec(trimmed);
  if (sub) return { kind: sub[1]!.toLowerCase() as "status" | "stop" };
  if (mode === "goal" && trimmed && !trimmed.startsWith("/goal")) return { kind: "start", goal: trimmed };
  const start = /^\/goal(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!start) return { kind: "none" };
  const goal = (start[1] ?? "").trim();
  return goal ? { kind: "start", goal } : { kind: "none" };
}

export function soloGoalPrompt(goal: string): string {
  return [
    `Goal: ${goal}`,
    "Work toward this goal in this conversation. Keep going until it is done or you are blocked.",
    "When it is done, end your reply with exactly this line, and put a short detail in it:",
    '<sagax-goal>{"status":"completed","detail":"what you finished"}</sagax-goal>',
    "The rest of your reply stays visible. Do not emit that line before the goal is actually done.",
  ].join("\n");
}

export function soloGoalOutcome(text: string): { status: "completed"; detail: string } | null {
  const match = MARKER.exec(text);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]!) as { status?: unknown; detail?: unknown };
    if (parsed.status !== "completed") return null;
    const detail = typeof parsed.detail === "string" ? parsed.detail.trim().slice(0, 240) : "";
    return { status: "completed", detail };
  } catch {
    return null;
  }
}

export function soloGoalStatusText(goal: SoloGoal | undefined): string {
  if (!goal) return "No goal is set for this conversation.";
  if (goal.status === "working") return `Working on: ${goal.goal}`;
  if (goal.status === "completed") return `Done: ${goal.goal}${goal.detail ? ` (${goal.detail})` : ""}`;
  return `Stopped: ${goal.goal}`;
}

/** One goal per thread. Memory only: a restart clears a working goal. */
export class SoloGoals {
  private readonly goals = new Map<string, SoloGoal>();

  get(threadId: string): SoloGoal | undefined {
    return this.goals.get(threadId);
  }

  start(threadId: string, goal: string): SoloGoal {
    const next = { goal, status: "working" as const };
    this.goals.set(threadId, next);
    return next;
  }

  stop(threadId: string): SoloGoal | undefined {
    const current = this.goals.get(threadId);
    if (!current || current.status !== "working") return current;
    const next = { ...current, status: "stopped" as const };
    this.goals.set(threadId, next);
    return next;
  }

  noteReply(threadId: string, text: string): void {
    const current = this.goals.get(threadId);
    if (!current || current.status !== "working") return;
    const outcome = soloGoalOutcome(text);
    if (!outcome) return;
    this.goals.set(threadId, { ...current, status: "completed", detail: outcome.detail });
  }
}
