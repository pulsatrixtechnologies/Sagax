// One file for every bot's task list (shared/bot-task-list.ts). Not the
// code work journal. Written whole, mode 0600, like the artifact index.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { writeFileAtomic } from "./atomic.ts";
import {
  BOT_TASK_LIMITS, isBotTaskId, nextBotTaskState, parseBotTaskCreate,
  type BotTask, type BotTaskAction, type BotTaskState,
} from "../shared/bot-task-list.ts";

export type BotTaskResult =
  | { ok: true; task: BotTask }
  | { ok: false; status: 400 | 404 | 409; error: string; code: string };

export interface BotTaskStore {
  list(botId: string): BotTask[];
  add(botId: string, input: unknown, ownerId?: string): BotTaskResult;
  /** advance and complete are the bot's and the person's. reopen is the person's. */
  move(botId: string, id: string, action: BotTaskAction, ownerId?: string): BotTaskResult;
  removeBot(botId: string): number;
}

function isTask(value: unknown): value is BotTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<BotTask>;
  return isBotTaskId(task.id) && typeof task.botId === "string" && typeof task.title === "string"
    && (task.state === "doing" || task.state === "waiting" || task.state === "done")
    && typeof task.createdAt === "number" && typeof task.updatedAt === "number";
}

function sameOwner(task: BotTask, ownerId: string | undefined): boolean {
  if (!ownerId || !task.ownerId) return true;
  return task.ownerId.toLowerCase() === ownerId.toLowerCase();
}

export function createBotTaskStore(options: { file: string; now?: () => number }): BotTaskStore {
  const now = options.now ?? Date.now;
  const tasks = new Map<string, BotTask>();
  try {
    const parsed = JSON.parse(readFileSync(options.file, "utf8")) as { tasks?: unknown };
    for (const item of Array.isArray(parsed.tasks) ? parsed.tasks : []) {
      if (isTask(item)) tasks.set(item.id, item);
    }
  } catch {
    // no file yet
  }
  const save = () => {
    writeFileAtomic(options.file, JSON.stringify({ version: 1, tasks: Array.from(tasks.values()) }), { mode: 0o600 });
  };
  return {
    list(botId) {
      return Array.from(tasks.values())
        .filter((task) => task.botId === botId)
        .sort((a, b) => Number(a.state === "done") - Number(b.state === "done") || b.updatedAt - a.updatedAt);
    },
    add(botId, input, ownerId) {
      const parsed = parseBotTaskCreate(input);
      if (!parsed.ok) return { ok: false, status: 400, error: parsed.error, code: "bad_task" };
      if (this.list(botId).length >= BOT_TASK_LIMITS.perBot) {
        return { ok: false, status: 409, error: `This bot already has ${BOT_TASK_LIMITS.perBot} tasks. Reopen is not a new one; finish or leave some.`, code: "too_many" };
      }
      const at = now();
      const task: BotTask = {
        id: `task_${randomBytes(9).toString("base64url")}`,
        botId,
        ...(ownerId ? { ownerId } : {}),
        title: parsed.title,
        state: parsed.state,
        createdAt: at,
        updatedAt: at,
      };
      tasks.set(task.id, task);
      save();
      return { ok: true, task };
    },
    move(botId, id, action, ownerId) {
      const task = tasks.get(id);
      if (!task || task.botId !== botId || !sameOwner(task, ownerId)) {
        return { ok: false, status: 404, error: "No task with that id for this bot.", code: "not_found" };
      }
      const state = nextBotTaskState(task.state, action);
      if (!state) {
        const code = action === "reopen" ? "not_done" : "cannot_advance";
        return { ok: false, status: 409, error: action === "reopen" ? "Only a done task can be reopened." : "That task cannot move forward from here.", code };
      }
      if (state !== task.state) {
        task.state = state;
        task.updatedAt = now();
        save();
      }
      return { ok: true, task };
    },
    removeBot(botId) {
      let n = 0;
      for (const [id, task] of tasks) if (task.botId === botId) { tasks.delete(id); n += 1; }
      if (n) save();
      return n;
    },
  };
}

export type { BotTaskState };
