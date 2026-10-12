// Builds the bot panel's launched-agent rows from hidden peer threads this
// bot opened (agent API send_prompt / create_agent then prompt).
import type { BotActivityStatus } from "../shared/bot-activity.ts";
import type { BotLaunchedAgentItem, BotLaunchedAgentPullRequest } from "../shared/bot-launched-agents.ts";
import { BOT_LAUNCHED_AGENTS_LIMIT, BOT_LAUNCHED_AGENTS_WINDOW_MS } from "../shared/bot-launched-agents.ts";
import { CodeWorkCollector, type RepositoryInfo } from "./activity-code-work.ts";
import { addCodingSignal, isCodingWork, type CodingSignals } from "./activity-coding.ts";

export interface LaunchedAgentTask {
  threadId: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
  busy?: boolean;
  activity?: string;
  turnStartedAt?: number;
  hidden?: true;
  openedBy?: { botId: string; at: number };
  cwd?: string | null;
  closedBy?: unknown;
  archivedAt?: number;
}

export interface LaunchedAgentMessage {
  role: string;
  kind: string;
  requestCancelled?: boolean;
  status?: string;
  turnSucceeded?: boolean;
  tool?: { name: string; ok?: boolean; summary?: string; input?: unknown; output?: unknown };
}

export interface LaunchedAgentBot {
  id: string;
  name: string;
  hidden?: boolean;
}

export interface LaunchedAgentsDeps {
  launcherBotId: string;
  bots(): LaunchedAgentBot[];
  tasks(botId: string): LaunchedAgentTask[];
  messages(threadId: string, limit: number): LaunchedAgentMessage[];
  threadReadable(targetBotId: string, threadId: string, viewerId: string | undefined): boolean;
  threadBusy(targetBotId: string, threadId: string): boolean;
  queued(threadId: string): boolean;
  inRepository?(cwd: string): boolean;
  repository?(cwd: string): RepositoryInfo | undefined;
  now?: () => number;
}

const CODING_SCAN = 80;
const SETTLED_SCAN = 12;

function settledStatus(messages: readonly LaunchedAgentMessage[]): BotActivityStatus {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === "user") return "finished";
    if (message.requestCancelled) return "stopped";
    if (message.status === "failed" || message.turnSucceeded === false) return "failed";
    if (message.turnSucceeded === true || message.kind === "digest") return "finished";
  }
  return "finished";
}

function displayTitle(task: LaunchedAgentTask, targetName: string): string {
  const raw = task.title.trim();
  const agentSuffix = /^@[^·]+ · agent$/i;
  const body = raw && !agentSuffix.test(raw) ? raw : "";
  return body ? `${targetName}: ${body}` : targetName;
}

function latestPullRequest(messages: readonly LaunchedAgentMessage[], repository: RepositoryInfo | undefined): BotLaunchedAgentPullRequest | undefined {
  const collector = new CodeWorkCollector(repository?.origin);
  const signals: CodingSignals = { edits: 0, codeFiles: 0, vcs: false };
  for (const message of messages) {
    if (!message.tool) continue;
    addCodingSignal(signals, message.tool);
    collector.add(message.tool, 0);
  }
  if (!isCodingWork(signals, Boolean(repository))) return undefined;
  const prs = collector.result().pullRequests;
  if (!prs.length) return undefined;
  const newest = prs.reduce((best, entry) => (entry.at > best.at ? entry : best), prs[0]!);
  if (!newest.number) return undefined;
  return { number: newest.number, ...(newest.url ? { url: newest.url } : {}) };
}

function statusOf(task: LaunchedAgentTask, deps: LaunchedAgentsDeps): BotActivityStatus {
  if (task.busy) return task.activity === "waiting-on-you" ? "waiting" : "running";
  if (deps.queued(task.threadId)) return "queued";
  return settledStatus(deps.messages(task.threadId, SETTLED_SCAN));
}

export function launchedAgentsForBot(deps: LaunchedAgentsDeps, viewerId: string | undefined): BotLaunchedAgentItem[] {
  const now = (deps.now ?? Date.now)();
  const since = now - BOT_LAUNCHED_AGENTS_WINDOW_MS;
  const out: BotLaunchedAgentItem[] = [];
  for (const peer of deps.bots()) {
    if (peer.hidden) continue;
    for (const task of deps.tasks(peer.id)) {
      if (task.archivedAt || task.closedBy) continue;
      if (task.hidden !== true) continue;
      if (task.openedBy?.botId !== deps.launcherBotId) continue;
      const updatedAt = task.updatedAt ?? task.createdAt;
      const status = statusOf(task, deps);
      const active = status === "running" || status === "waiting" || status === "queued";
      if (!active && updatedAt < since) continue;
      const readable = deps.threadReadable(peer.id, task.threadId, viewerId);
      const messages = deps.messages(task.threadId, CODING_SCAN);
      const repository = task.cwd && deps.inRepository?.(task.cwd) ? deps.repository?.(task.cwd) : undefined;
      const pullRequest = status === "failed" ? latestPullRequest(messages, repository) : undefined;
      out.push({
        id: `thread:${task.threadId}`,
        targetBotId: peer.id,
        targetBotName: peer.name,
        title: displayTitle(task, peer.name),
        status,
        startedAt: task.openedBy?.at ?? task.createdAt,
        updatedAt,
        ...(readable ? { threadId: task.threadId } : {}),
        ...(pullRequest ? { pullRequest } : {}),
      });
    }
  }
  return out
    .sort((a, b) => {
      const active = (s: BotActivityStatus) => s === "running" || s === "waiting" || s === "queued";
      return Number(active(b.status)) - Number(active(a.status)) || b.updatedAt - a.updatedAt;
    })
    .slice(0, BOT_LAUNCHED_AGENTS_LIMIT);
}
