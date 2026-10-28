// The person's task list for one bot (shared/bot-task-list.ts).
//
//   GET  /api/bots/:id/task-list
//   POST /api/bots/:id/task-list                 { title, state? }
//   POST /api/bots/:id/task-list/:tid/advance
//   POST /api/bots/:id/task-list/:tid/complete
//   POST /api/bots/:id/task-list/:tid/reopen     the person only
//
// The bot uses POST /api/internal/task-list { action, title?, state?, task_id? }.
// It can add, advance and complete. It cannot reopen. The bot id is the
// turn's, never the body's.
import type { RequestAuth } from "../request-auth.ts";
import type { BotTaskStore } from "../bot-task-list.ts";
import { isBotTaskId, type BotTask, type BotTaskAction } from "../../shared/bot-task-list.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotTaskRouteDeps {
  tasks: () => BotTaskStore;
  mayUseBot(auth: RequestAuth, botId: string): boolean;
  /** Whose list this is. Undefined on a one-person server. */
  owner(auth: RequestAuth): string | undefined;
  mayView(auth: RequestAuth, task: BotTask): boolean;
}

export function createBotTaskRoutes(deps: BotTaskRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const list = (method === "GET" && /^\/api\/bots\/([\w-]+)\/task-list$/.exec(path))
      || (method === "POST" && /^\/api\/bots\/([\w-]+)\/task-list$/.exec(path))
      || null;
    const move = method === "POST" ? /^\/api\/bots\/([\w-]+)\/task-list\/(task_[A-Za-z0-9_-]+)\/(advance|complete|reopen)$/.exec(path) : null;
    const matched = list || move;
    if (!matched) return PASS;
    const botId = matched[1]!;
    if (!deps.mayUseBot(auth, botId)) return json(res, 404, { error: "no such bot", code: "not_found" });
    res.setHeader("cache-control", "private, no-store");
    const store = deps.tasks();
    const owner = deps.owner(auth);
    if (list && method === "GET") {
      return json(res, 200, { tasks: store.list(botId).filter((task) => deps.mayView(auth, task)) });
    }
    if (list && method === "POST") {
      const result = store.add(botId, await readBody(req), owner);
      if (!result.ok) return json(res, result.status, { error: result.error, code: result.code });
      return json(res, 201, { task: result.task });
    }
    if (!move) return PASS;
    const id = move[2]!;
    const action = move![3] as BotTaskAction;
    if (!isBotTaskId(id)) return json(res, 404, { error: "No task with that id for this bot.", code: "not_found" });
    const current = store.list(botId).find((task) => task.id === id);
    if (!current || !deps.mayView(auth, current)) return json(res, 404, { error: "No task with that id for this bot.", code: "not_found" });
    const result = store.move(botId, id, action, owner);
    if (!result.ok) return json(res, result.status, { error: result.error, code: result.code });
    return json(res, 200, { task: result.task });
  };
}

export function createBotTaskInternalRoutes(deps: {
  tasks: () => BotTaskStore;
  ownsThread(botId: string, threadId: string): boolean;
  speaker?(threadId: string): string | undefined;
}): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== "/api/internal/task-list") return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!deps.ownsThread(capability.botId, capability.threadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const body = await readBody() as { action?: unknown; title?: unknown; state?: unknown; task_id?: unknown } | null;
    const action = body?.action;
    const store = deps.tasks();
    const botId = capability.botId;
    const owner = deps.speaker?.(capability.threadId);
    if (action === "list") {
      const tasks = store.list(botId).filter((task) => !owner || !task.ownerId || task.ownerId.toLowerCase() === owner.toLowerCase());
      return json(res, 200, { tasks });
    }
    if (action === "add") {
      const result = store.add(botId, { title: body?.title, state: body?.state }, owner);
      if (!result.ok) return json(res, result.status, { error: result.error, code: result.code });
      return json(res, 201, { task: result.task });
    }
    if (action !== "advance" && action !== "complete") {
      return json(res, 400, { error: "action: list, add, advance or complete. Reopening is the person's.", code: "bad_action" });
    }
    const id = typeof body?.task_id === "string" ? body.task_id : "";
    if (!isBotTaskId(id)) return json(res, 400, { error: "task_id: the id list or add gave.", code: "bad_task" });
    const result = store.move(botId, id, action, owner);
    if (!result.ok) return json(res, result.status, { error: result.error, code: result.code });
    return json(res, 200, { task: result.task });
  };
}
