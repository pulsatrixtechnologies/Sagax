// The bot's task list. Not the code work journal, and not a hook that
// holds a turn open. The bot adds a task, moves it forward, and marks it
// done. The person can reopen a done task. Not an organization setting.

export const BOT_TASK_STATES = ["doing", "waiting", "done"] as const;
export type BotTaskState = (typeof BOT_TASK_STATES)[number];

export const BOT_TASK_ACTIONS = ["advance", "complete", "reopen"] as const;
export type BotTaskAction = (typeof BOT_TASK_ACTIONS)[number];

export const BOT_TASK_LIMITS = {
  title: 160,
  perBot: 100,
} as const;

const ID = /^task_[A-Za-z0-9_-]{6,64}$/;

export function isBotTaskId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

export interface BotTask {
  id: string;
  botId: string;
  /** The person the task belongs to. Absent on a one-person server. */
  ownerId?: string;
  title: string;
  state: BotTaskState;
  createdAt: number;
  updatedAt: number;
}

/** The next state, or null when that move is not allowed. complete on a
 * done task stays done. reopen is only from done, and only the person
 * uses it. advance is only doing to waiting. */
export function nextBotTaskState(from: BotTaskState, action: BotTaskAction): BotTaskState | null {
  if (action === "advance") return from === "doing" ? "waiting" : null;
  if (action === "complete") return "done";
  if (action === "reopen") return from === "done" ? "doing" : null;
  return null;
}

export function parseBotTaskTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.replace(/\s+/g, " ").trim();
  if (!title || title.length > BOT_TASK_LIMITS.title) return null;
  return title;
}

/** A new task starts doing, or waiting when it already needs a decision.
 * It is never created done. */
export function parseBotTaskCreate(value: unknown): { ok: true; title: string; state: "doing" | "waiting" } | { ok: false; error: string } {
  const body = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!body) return { ok: false, error: "Send { title, state? }." };
  const title = parseBotTaskTitle(body.title);
  if (!title) return { ok: false, error: `title: one line, 1 to ${BOT_TASK_LIMITS.title} characters.` };
  const state = body.state === undefined ? "doing" : body.state;
  if (state !== "doing" && state !== "waiting") return { ok: false, error: "state: doing or waiting." };
  return { ok: true, title, state };
}

export function canReopenBotTask(state: BotTaskState): boolean {
  return state === "done";
}
