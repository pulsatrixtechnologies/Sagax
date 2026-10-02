// GET /api/bots/:id/activity: what the bot is doing and did lately, for its
// side panel (Details > Coding), and GET /api/bots/:id/activity/item for one
// entry's detail (its tool steps, files, sub-agents, engine and payer).
// Read-only; built from the bot's threads, the work bots hand each other
// (room handoffs, delegations) and its routine runs.
//
// Authorization (shared/bot-activity.ts): the gate in index.ts already hides
// a bot the viewer cannot see. Here every thread passes `threadReadable`
// (on an organization server: the viewer's own threads only), every routine
// run `runSeen` (routineSeenBy: the person it runs as, the bot's owner, or
// anyone holding the run level), and a sub-agent's conversation on another
// bot is linked only when that thread is readable too. A run seen without
// its thread lists no steps and no thread. A failed run's access card
// (`runAccessCard`) reaches the card's audience only: the bot's owner reads
// the card of a run refused on their credentials even when the run's thread
// is another person's private one, and nothing else of that thread.
import type { RequestAuth } from "../request-auth.ts";
import type { WireAccessCard } from "../../shared/wire.ts";
import type { RoutineRun } from "../../shared/routines.ts";
import {
  BOT_ACTIVITY_LIMIT,
  BOT_ACTIVITY_STEPS,
  BOT_ACTIVITY_WINDOW_MS,
  activityStatusActive,
  type BotActivityActor,
  type BotActivityDetail,
  type BotActivityItem,
  type BotActivityStatus,
  type BotActivityStep,
} from "../../shared/bot-activity.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ActivityBot {
  id: string;
  name: string;
  modelSelection?: { instanceId: string; model: string } | null;
}

export interface ActivityTask {
  threadId: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
  busy?: boolean;
  activity?: string;
  waitingForTeammates?: boolean;
  turnStartedAt?: number;
  routineRunId?: string;
  archivedAt?: number;
  ownerPrincipalId?: string;
  openedBy?: { botId: string; name: string; at: number; delegationId?: string; kind?: string };
  modelSelection?: { instanceId: string; model: string } | null;
}

export interface ActivityMessage {
  id: string;
  role: string;
  kind: string;
  at: number;
  text?: string;
  status?: string;
  turnSucceeded?: boolean;
  requestCancelled?: boolean;
  tool?: { name: string; ok?: boolean; summary?: string; itemId?: string; files?: string[]; setup?: boolean };
  digest?: { access?: { via: BotActivityDetail["via"] & string; payer: BotActivityDetail["payer"] & string } };
  sender?: { name?: string } | null;
}

/** A sub-agent or hop this thread started: another bot's conversation. */
export interface ActivityChildRef {
  botId: string;
  threadId?: string;
  title: string;
  status: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  startedAt: number;
}

export interface BotActivityRouteDeps {
  bot(id: string): ActivityBot | null | undefined;
  tasks(botId: string): ActivityTask[];
  /** Who is asking (channelFilterViewerId): undefined for the operator or
   * a solo server, who see everything. */
  viewerId(auth: RequestAuth): string | undefined;
  threadReadable(botId: string, threadId: string, viewerId: string | undefined): boolean;
  /** The viewer may stop a turn there (thread.post). */
  threadWritable(botId: string, threadId: string, viewerId: string | undefined): boolean;
  runs(botId: string): RoutineRun[];
  runSeen(run: RoutineRun, viewerId: string | undefined): boolean;
  messages(threadId: string, limit: number): { messages: ActivityMessage[]; hasMore: boolean };
  children(botId: string, threadId: string): ActivityChildRef[];
  personName(principalId: string): string;
  organization(): boolean;
  /** The access card a failed run left, as this viewer may see it (in the
   * card's audience only); undefined when there is none for them. */
  runAccessCard?(run: RoutineRun, viewerId: string | undefined): WireAccessCard | undefined;
  now?: () => number;
}

const ACTIVE_RUN = new Set(["queued", "running", "waiting"]);

function runStatus(status: RoutineRun["status"]): BotActivityStatus {
  switch (status) {
    case "queued": return "queued";
    case "running": return "running";
    case "waiting": return "waiting";
    case "completed": return "finished";
    case "cancelled": return "stopped";
    default: return "failed";
  }
}

/** A settled thread's outcome, read off its newest turn. */
function settledStatus(messages: readonly ActivityMessage[]): BotActivityStatus {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === "user") return "finished";
    if (message.requestCancelled) return "stopped";
    if (message.status === "failed" || message.turnSucceeded === false) return "failed";
    if (message.turnSucceeded === true || message.kind === "digest") return "finished";
  }
  return "finished";
}

function stepWhere(name: string, organization: boolean): BotActivityStep["where"] {
  if (!organization) return undefined;
  return /sagax-desktop|shared_computer/.test(name) ? "computer" : "server";
}

export function createBotActivityRoutes(deps: BotActivityRouteDeps): RouteHandler {
  const now = deps.now ?? Date.now;

  function startedBy(task: ActivityTask, run: RoutineRun | undefined): BotActivityActor | undefined {
    if (run || task.routineRunId) return { kind: "routine", name: run?.routineName ?? "" };
    if (task.openedBy) return { kind: "bot", name: task.openedBy.name };
    if (task.ownerPrincipalId) {
      const name = deps.personName(task.ownerPrincipalId);
      if (name) return { kind: "person", name };
    }
    return undefined;
  }

  function threadItem(bot: ActivityBot, task: ActivityTask, runs: Map<string, RoutineRun>, viewerId: string | undefined): BotActivityItem {
    const run = task.routineRunId ? runs.get(task.routineRunId) : undefined;
    let status: BotActivityStatus;
    if (run && ACTIVE_RUN.has(run.status)) status = runStatus(run.status);
    else if (task.busy) status = task.activity === "waiting-on-you" ? "waiting" : "running";
    else if (run) status = runStatus(run.status);
    else status = settledStatus(deps.messages(task.threadId, 12).messages);
    const updatedAt = Math.max(task.updatedAt ?? task.createdAt, run?.finishedAt ?? 0);
    const startedAt = activityStatusActive(status)
      ? task.turnStartedAt ?? run?.startedAt ?? task.createdAt
      : run?.startedAt ?? task.createdAt;
    const children = deps.children(bot.id, task.threadId);
    return {
      id: `thread:${task.threadId}`,
      kind: run || task.routineRunId ? "routine" : task.openedBy && task.openedBy.botId !== bot.id ? "hop" : "session",
      botId: bot.id,
      botName: bot.name,
      title: task.title.trim() || run?.routineName || bot.name,
      status,
      startedAt,
      ...(activityStatusActive(status) ? {} : { endedAt: run?.finishedAt ?? updatedAt }),
      updatedAt,
      ...(deps.threadReadable(bot.id, task.threadId, viewerId) ? { threadId: task.threadId } : {}),
      ...(startedBy(task, run) ? { startedBy: startedBy(task, run) } : {}),
      ...(children.length ? { childCount: children.length } : {}),
    };
  }

  function runItem(bot: ActivityBot, run: RoutineRun): BotActivityItem {
    const status = runStatus(run.status);
    const updatedAt = run.finishedAt ?? run.startedAt ?? run.scheduledFor;
    return {
      id: `run:${run.id}`,
      kind: "routine",
      botId: bot.id,
      botName: bot.name,
      title: run.routineName,
      status,
      startedAt: run.startedAt ?? run.scheduledFor,
      ...(activityStatusActive(status) ? {} : { endedAt: updatedAt }),
      updatedAt,
      startedBy: { kind: "routine", name: run.routineName },
    };
  }

  /** The list, newest first with running work on top. */
  function list(bot: ActivityBot, viewerId: string | undefined, limit: number): BotActivityItem[] {
    const since = now() - BOT_ACTIVITY_WINDOW_MS;
    const runs = deps.runs(bot.id).filter((run) => deps.runSeen(run, viewerId));
    const runById = new Map(runs.map((run) => [run.id, run]));
    const items: BotActivityItem[] = [];
    const listedRuns = new Set<string>();
    const listedThreads = new Set<string>();
    for (const task of deps.tasks(bot.id)) {
      if (task.archivedAt) continue;
      if (!deps.threadReadable(bot.id, task.threadId, viewerId)) continue;
      const recent = task.busy || (task.updatedAt ?? task.createdAt) >= since;
      if (!recent) continue;
      if (task.routineRunId) listedRuns.add(task.routineRunId);
      listedThreads.add(task.threadId);
      items.push(threadItem(bot, task, runById, viewerId));
    }
    for (const run of runs) {
      if (listedRuns.has(run.id) || run.status === "missed") continue;
      if (run.threadId && listedThreads.has(run.threadId)) continue;
      const at = run.finishedAt ?? run.startedAt ?? run.scheduledFor;
      if (!ACTIVE_RUN.has(run.status) && at < since) continue;
      if (run.status === "queued" && !run.startedAt) continue;
      items.push(runItem(bot, run));
    }
    return items
      .sort((a, b) => Number(activityStatusActive(b.status)) - Number(activityStatusActive(a.status)) || b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  function childItems(bot: ActivityBot, threadId: string, viewerId: string | undefined): BotActivityItem[] {
    return deps.children(bot.id, threadId).map((child, index) => {
      const other = deps.bot(child.botId);
      const readable = child.threadId ? deps.threadReadable(child.botId, child.threadId, viewerId) : false;
      const status: BotActivityStatus = child.status === "completed" ? "finished" : child.status === "cancelled" ? "stopped" : child.status;
      return {
        id: child.threadId ? `thread:${child.threadId}` : `child:${threadId}:${index}`,
        kind: "subagent",
        botId: child.botId,
        ...(other ? { botName: other.name } : {}),
        // Another person's request text stays theirs: an unreadable
        // sub-agent shows only which bot works and how it goes.
        title: readable ? child.title : other?.name ?? "",
        status,
        startedAt: child.startedAt,
        updatedAt: child.startedAt,
        ...(readable && child.threadId ? { threadId: child.threadId } : {}),
        startedBy: { kind: "bot", name: bot.name },
      } satisfies BotActivityItem;
    });
  }

  function threadDetail(bot: ActivityBot, task: ActivityTask, viewerId: string | undefined, askedRun?: RoutineRun): BotActivityDetail {
    const runs = deps.runs(bot.id).filter((run) => deps.runSeen(run, viewerId));
    const item = threadItem(bot, task, new Map(runs.map((run) => [run.id, run])), viewerId);
    const page = deps.messages(task.threadId, BOT_ACTIVITY_STEPS);
    const organization = deps.organization();
    const steps: BotActivityStep[] = [];
    const files = new Set<string>();
    let access: NonNullable<ActivityMessage["digest"]>["access"];
    for (const message of page.messages) {
      if (message.digest?.access) access = message.digest.access;
      const tool = message.tool;
      if (!tool || tool.setup) continue;
      for (const file of tool.files ?? []) files.add(file);
      const where = stepWhere(tool.name, organization);
      steps.push({
        id: message.id,
        name: tool.name,
        ...(tool.summary ? { summary: tool.summary } : {}),
        ...(typeof tool.ok === "boolean" ? { ok: tool.ok } : {}),
        at: message.at,
        ...(where ? { where } : {}),
        ...(tool.files?.length ? { files: tool.files } : {}),
      });
    }
    // the run asked for by id: its thread no longer names it once it ended
    const run = askedRun ?? (task.routineRunId ? runs.find((entry) => entry.id === task.routineRunId) : undefined);
    const selection = task.modelSelection ?? bot.modelSelection ?? undefined;
    const note = run?.status === "waiting" ? run.attention : run?.status === "failed" ? run.error : undefined;
    const card = run ? runCard(run, viewerId) : undefined;
    return {
      ...item,
      ...(selection ? { engine: { instanceId: selection.instanceId, model: selection.model } } : {}),
      ...(access ? { via: access.via, payer: access.payer } : {}),
      steps,
      stepsTruncated: page.hasMore,
      files: [...files],
      children: childItems(bot, task.threadId, viewerId),
      ...(note ? { note } : {}),
      canStop: activityStatusActive(item.status) && deps.threadWritable(bot.id, task.threadId, viewerId),
      ...(card ? { access: card } : {}),
    };
  }

  function runCard(run: RoutineRun, viewerId: string | undefined): WireAccessCard | undefined {
    return run.status === "failed" ? deps.runAccessCard?.(run, viewerId) : undefined;
  }

  function runDetail(bot: ActivityBot, run: RoutineRun, viewerId: string | undefined): BotActivityDetail {
    const note = run.status === "waiting" ? run.attention : run.status === "failed" ? run.error : undefined;
    const card = runCard(run, viewerId);
    return {
      ...runItem(bot, run),
      steps: [],
      stepsTruncated: false,
      files: [],
      children: [],
      ...(note ? { note } : {}),
      canStop: false,
      ...(card ? { access: card } : {}),
    };
  }

  return async ({ res, url, path, method, auth, json }) => {
    const match = path.match(/^\/api\/bots\/([\w-]+)\/activity(\/item)?$/);
    if (!match) return PASS;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    const bot = deps.bot(match[1]!);
    if (!bot) return json(res, 404, { error: "no such bot" });
    const viewerId = deps.viewerId(auth);
    if (!match[2]) {
      const requested = Number(url.searchParams.get("limit"));
      const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 50) : BOT_ACTIVITY_LIMIT;
      return json(res, 200, { items: list(bot, viewerId, limit) });
    }
    const threadId = url.searchParams.get("threadId");
    const runId = url.searchParams.get("runId");
    if (threadId) {
      const task = deps.tasks(bot.id).find((entry) => entry.threadId === threadId);
      // Not theirs reads exactly like not there.
      if (!task || !deps.threadReadable(bot.id, threadId, viewerId)) return json(res, 404, { error: "no such activity" });
      return json(res, 200, { item: threadDetail(bot, task, viewerId) });
    }
    if (runId) {
      const run = deps.runs(bot.id).find((entry) => entry.id === runId);
      if (!run || !deps.runSeen(run, viewerId)) return json(res, 404, { error: "no such activity" });
      const thread = run.threadId ?? run.executionThreadId;
      const task = thread ? deps.tasks(bot.id).find((entry) => entry.threadId === thread) : undefined;
      if (task && deps.threadReadable(bot.id, task.threadId, viewerId)) return json(res, 200, { item: threadDetail(bot, task, viewerId, run) });
      return json(res, 200, { item: runDetail(bot, run, viewerId) });
    }
    return json(res, 400, { error: "threadId or runId is required" });
  };
}
