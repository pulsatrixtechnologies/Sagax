// The bot's task list: the to-do list a bot keeps for the person. Not the
// code work journal, and not a hook that holds a turn open. The bot adds a
// task (in progress, waiting for the person, or already done), moves it
// forward, finishes it and leaves a note on it. The person opens a task,
// marks it done, puts it back in progress, reopens it or removes it. Every
// change of state is kept in its history. Not an organization setting.

export const BOT_TASK_STATES = ["doing", "waiting", "done"] as const;
export type BotTaskState = (typeof BOT_TASK_STATES)[number];

/** advance: doing to waiting. complete: to done. resume: waiting to doing.
 * reopen: done to doing. */
export const BOT_TASK_ACTIONS = ["advance", "complete", "resume", "reopen"] as const;
export type BotTaskAction = (typeof BOT_TASK_ACTIONS)[number];

/** What the bot may do with its tool. Reopening and resuming are the person's. */
export const BOT_TOOL_TASK_ACTIONS: readonly BotTaskAction[] = ["advance", "complete"];

export const BOT_TASK_LIMITS = {
  title: 160,
  note: 2000,
  /** state changes kept per task, the newest */
  history: 50,
  perBot: 100,
} as const;

const ID = /^task_[A-Za-z0-9_-]{6,64}$/;

export function isBotTaskId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

export function isBotTaskAction(value: unknown): value is BotTaskAction {
  return typeof value === "string" && (BOT_TASK_ACTIONS as readonly string[]).includes(value);
}

/** One change of state: what it became, when, and who made it. */
export interface BotTaskEvent {
  state: BotTaskState;
  at: number;
  by: "bot" | "person";
}

export interface BotTask {
  id: string;
  botId: string;
  /** The person the task belongs to. Absent on a one-person server. */
  ownerId?: string;
  /** The conversation the bot added it from, so "Answer" opens it. */
  threadId?: string;
  title: string;
  state: BotTaskState;
  /** The bot's note on the task: what it found, what it needs. */
  note?: string;
  /** Every change of state, oldest first. Absent on a task saved before. */
  history?: BotTaskEvent[];
  createdAt: number;
  updatedAt: number;
}

/** The next state, or null when that move is not allowed. complete on a
 * done task stays done. advance is only doing to waiting, resume only
 * waiting to doing, reopen only done to doing. */
export function nextBotTaskState(from: BotTaskState, action: BotTaskAction): BotTaskState | null {
  if (action === "advance") return from === "doing" ? "waiting" : null;
  if (action === "complete") return "done";
  if (action === "resume") return from === "waiting" ? "doing" : null;
  if (action === "reopen") return from === "done" ? "doing" : null;
  return null;
}

/** The moves the person is offered on a task, in menu order. */
export function personBotTaskActions(state: BotTaskState): BotTaskAction[] {
  if (state === "doing") return ["complete"];
  if (state === "waiting") return ["complete", "resume"];
  return ["reopen"];
}

export function parseBotTaskTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.replace(/\s+/g, " ").trim();
  if (!title || title.length > BOT_TASK_LIMITS.title) return null;
  return title;
}

/** A note: trimmed, kept on several lines, 1 to 2000 characters. An empty
 * string clears it (null here means invalid, "" means clear). */
export function parseBotTaskNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const note = value.replace(/\r\n?/g, "\n").trim();
  if (note.length > BOT_TASK_LIMITS.note) return null;
  return note;
}

/** A new task starts in progress, waiting for the person, or already done
 * (finished work the bot records). It may carry the bot's note. */
export function parseBotTaskCreate(value: unknown): { ok: true; title: string; state: BotTaskState; note?: string } | { ok: false; error: string } {
  const body = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!body) return { ok: false, error: "Send { title, state?, note? }." };
  const title = parseBotTaskTitle(body.title);
  if (!title) return { ok: false, error: `title: one line, 1 to ${BOT_TASK_LIMITS.title} characters.` };
  const state = body.state === undefined ? "doing" : body.state;
  if (state !== "doing" && state !== "waiting" && state !== "done") return { ok: false, error: "state: doing, waiting or done." };
  let note: string | undefined;
  if (body.note !== undefined) {
    const parsed = parseBotTaskNote(body.note);
    if (parsed === null) return { ok: false, error: `note: up to ${BOT_TASK_LIMITS.note} characters.` };
    if (parsed) note = parsed;
  }
  return { ok: true, title, state, ...(note ? { note } : {}) };
}

export function canReopenBotTask(state: BotTaskState): boolean {
  return state === "done";
}

/** The task a tool call means: its id, else its exact title (without case)
 * when one task only has it. */
export function findBotTask(tasks: readonly BotTask[], ref: { taskId?: unknown; title?: unknown }): BotTask | "ambiguous" | null {
  if (isBotTaskId(ref.taskId)) return tasks.find((task) => task.id === ref.taskId) ?? null;
  const title = parseBotTaskTitle(ref.title)?.toLowerCase();
  if (!title) return null;
  const matches = tasks.filter((task) => task.title.toLowerCase() === title);
  if (matches.length > 1) return "ambiguous";
  return matches[0] ?? null;
}

/** Whether a task belongs to this person. One rule for the bot's tool and
 * the panel: principal ids compare without case (the turn's speaker is
 * stored lowercased), and a task or a viewer without an owner matches. */
export function sameBotTaskOwner(ownerId: string | undefined, viewerId: string | undefined): boolean {
  if (!ownerId || !viewerId) return true;
  return ownerId.toLowerCase() === viewerId.toLowerCase();
}

/** The live frame the server sends when a bot's task list changes. Ids
 * only: the panel reads the list again with its own rights. */
export const BOT_TASKS_FRAME = "bot.tasks";
export interface BotTasksFrame {
  kind: typeof BOT_TASKS_FRAME;
  botId: string;
  /** The person whose list changed. Absent on a one-person server. */
  audience?: string;
}

/** A task list frame reaches the streams of the person it is for. A stream
 * with no viewer is this computer's operator, who reads every list. */
export function botTasksFrameAllowed(payload: { kind?: unknown; audience?: unknown }, viewerId: string | undefined, localPersonId: string): boolean {
  if (payload.kind !== BOT_TASKS_FRAME) return true;
  if (typeof payload.audience !== "string" || !payload.audience) return true;
  return sameBotTaskOwner(payload.audience, viewerId ?? localPersonId);
}

/** The panel's order: what waits for the person first, then what the bot
 * is doing, then what is done. Newest first in each group. */
export function groupBotTasks(tasks: readonly BotTask[]): Record<BotTaskState, BotTask[]> {
  const groups: Record<BotTaskState, BotTask[]> = { waiting: [], doing: [], done: [] };
  for (const task of tasks) groups[task.state]?.push(task);
  for (const state of BOT_TASK_STATES) groups[state].sort((a, b) => b.updatedAt - a.updatedAt);
  return groups;
}

/** How long a task that just moved to Done keeps its row, checked, before
 * the row folds away (ms), and how long the fold itself takes. */
export const BOT_TASK_DONE_LINGER_MS = 2500;
export const BOT_TASK_DONE_FOLD_MS = 350;

/** The panel's one list: what waits for the person first, then what is in
 * progress, newest first. A task that is done is not listed, except the ones
 * that just moved to Done (`finishing`), which stay among the in-progress
 * rows until their row folds away. */
export function listBotTasks(tasks: readonly BotTask[], finishing: ReadonlySet<string> = new Set()): BotTask[] {
  const groups = groupBotTasks(tasks);
  const rest = [...groups.doing, ...groups.done.filter((task) => finishing.has(task.id))].sort((a, b) => b.updatedAt - a.updatedAt);
  return [...groups.waiting, ...rest];
}

export const BOT_TASK_GROUP_ORDER: readonly BotTaskState[] = ["waiting", "doing", "done"];
