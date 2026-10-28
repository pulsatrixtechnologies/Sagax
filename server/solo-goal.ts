// A goal for one bot in a 1:1 chat. A team keeps its own /goal.
// The person starts, asks where it stands, or stops it. The bot works
// until it reports the goal done, or blocked, or until the person stops it.
//
// #1372: the person sees only the goal they typed. The instruction that
// drives the bot rides the system prompt (soloGoalSystemPrompt) while the
// goal is working, never the person's message, and the marker the bot ends
// its reply with is read and taken out of the reply it shows.

import { soloGoalLineText, type SoloGoalLine } from "../shared/solo-goal-line.ts";
export { withoutSoloGoalMarker } from "../shared/solo-goal-line.ts";

export type SoloGoalStatus = "working" | "blocked" | "stopped" | "completed";

export interface SoloGoal {
  goal: string;
  status: SoloGoalStatus;
  detail?: string;
  /** Turns the harness started on its own toward this goal. */
  rounds: number;
}

/** How many turns the harness starts on its own toward one goal before it
 * waits for the person. Each is a paid turn. */
export const SOLO_GOAL_MAX_ROUNDS = 8;

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

/** The standing instruction, in the system prompt while the goal is
 * working. Empty otherwise. */
export function soloGoalSystemPrompt(goal: SoloGoal | undefined): string {
  if (!goal || goal.status !== "working") return "";
  return [
    `Goal: ${goal.goal}`,
    "The person set this goal for this conversation. Work toward it. Keep going until it is done or you are blocked.",
    "When it is done, end your reply with exactly this line, with a short detail in it:",
    '<sagax-goal>{"status":"completed","detail":"what you finished"}</sagax-goal>',
    "When you cannot go on without the person (a decision, an access, an answer), say what you need and end your reply with:",
    '<sagax-goal>{"status":"blocked","detail":"what you need"}</sagax-goal>',
    "The person never sees that line. Do not write it before the goal is actually done or blocked.",
  ].join("\n");
}

/** The words of a turn the harness starts on its own toward the goal. They
 * reach the model only, never the transcript. */
export function soloGoalContinuePrompt(goal: SoloGoal): string {
  return `Continue working toward the goal: ${goal.goal}\nPick up where you left off. Do not repeat what is already done.`;
}

export function soloGoalOutcome(text: string): { status: "completed" | "blocked"; detail: string } | null {
  const match = MARKER.exec(text);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]!) as { status?: unknown; detail?: unknown };
    if (parsed.status !== "completed" && parsed.status !== "blocked") return null;
    const detail = typeof parsed.detail === "string" ? parsed.detail.trim().slice(0, 240) : "";
    return { status: parsed.status, detail };
  } catch {
    return null;
  }
}

export function soloGoalLine(goal: SoloGoal | undefined): SoloGoalLine {
  if (!goal) return { status: "none" };
  return { status: goal.status, goal: goal.goal, ...(goal.detail ? { detail: goal.detail } : {}) };
}

export function soloGoalStatusText(goal: SoloGoal | undefined): string {
  return soloGoalLineText(soloGoalLine(goal));
}

/** One goal per thread. Memory only: a restart clears a working goal. */
export class SoloGoals {
  private readonly goals = new Map<string, SoloGoal>();

  get(threadId: string): SoloGoal | undefined {
    return this.goals.get(threadId);
  }

  start(threadId: string, goal: string): SoloGoal {
    const next: SoloGoal = { goal, status: "working", rounds: 0 };
    this.goals.set(threadId, next);
    return next;
  }

  /** Put back what was there before a start whose send was refused. */
  restore(threadId: string, previous: SoloGoal | undefined): void {
    if (previous) this.goals.set(threadId, previous);
    else this.goals.delete(threadId);
  }

  stop(threadId: string): SoloGoal | undefined {
    const current = this.goals.get(threadId);
    if (!current || (current.status !== "working" && current.status !== "blocked")) return current;
    const next = { ...current, status: "stopped" as const };
    this.goals.set(threadId, next);
    return next;
  }

  /** The person wrote again in a conversation whose goal waits on them, or
   * paused at the round limit: the goal works again, with fresh rounds. */
  resume(threadId: string): void {
    const current = this.goals.get(threadId);
    if (current && (current.status === "blocked" || (current.status === "working" && current.rounds >= SOLO_GOAL_MAX_ROUNDS))) {
      this.goals.set(threadId, { ...current, status: "working", rounds: 0 });
    }
  }

  /** Read the bot's reply. Returns the goal when this reply settled it. */
  noteReply(threadId: string, text: string): SoloGoal | null {
    const current = this.goals.get(threadId);
    if (!current || current.status !== "working") return null;
    const outcome = soloGoalOutcome(text);
    if (!outcome) return null;
    const next: SoloGoal = { ...current, status: outcome.status, ...(outcome.detail ? { detail: outcome.detail } : {}) };
    this.goals.set(threadId, next);
    return next;
  }

  /** Whether the harness may start one more turn toward this goal; counts
   * it when it may. False once the goal is no longer working, or at the
   * round limit. */
  nextRound(threadId: string): boolean {
    const current = this.goals.get(threadId);
    if (!current || current.status !== "working" || current.rounds >= SOLO_GOAL_MAX_ROUNDS) return false;
    this.goals.set(threadId, { ...current, rounds: current.rounds + 1 });
    return true;
  }
}
