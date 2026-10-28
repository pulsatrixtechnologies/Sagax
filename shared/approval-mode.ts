/** The approval levels exposed by the app. Each one is a provider's own
 * permission mode, passed through: Sagax never decides a permission
 * itself (Full access aside, which answers residual prompts because that is
 * what the person granted). The order is the order the selector shows. */
export const APPROVAL_MODES = ["ask", "edits", "auto", "full", "custom"] as const;

export type ApprovalMode = (typeof APPROVAL_MODES)[number];

/** Why a thread keeps its own approval level instead of its bot's
 * (WireTask.approvalOwn, #1169/#1170). Every other thread follows its bot's
 * current level at the start of each turn: nothing is copied at creation. */
export const APPROVAL_EXCEPTIONS = ["thread", "delegated", "engine", "safety"] as const;
export type ApprovalException = (typeof APPROVAL_EXCEPTIONS)[number];
export function isApprovalException(value: unknown): value is ApprovalException {
  return typeof value === "string" && (APPROVAL_EXCEPTIONS as readonly string[]).includes(value);
}

/** The level a thread runs at as stored: its own while it holds an
 * exception, else its bot's, live. Standing approvals: an exception keeps
 * only its own; a thread that follows the bot gets the bot's and those
 * saved in the thread. Server (projectBotForTask) and clients share it. */
export function threadApprovalFields<B extends { approvalMode?: unknown; autoApprove?: boolean; alwaysAllow?: string[] }>(
  bot: B,
  task: { approvalOwn?: unknown; approvalMode?: unknown; autoApprove?: boolean; alwaysAllow?: string[] },
): Pick<B, "approvalMode" | "autoApprove" | "alwaysAllow"> {
  if (isApprovalException(task.approvalOwn)) {
    return {
      approvalMode: (task.approvalMode ?? (task.autoApprove === undefined ? bot.approvalMode : undefined)) as B["approvalMode"],
      autoApprove: task.autoApprove ?? bot.autoApprove,
      alwaysAllow: [...(task.alwaysAllow ?? bot.alwaysAllow ?? [])],
    };
  }
  return {
    approvalMode: bot.approvalMode as B["approvalMode"],
    autoApprove: bot.autoApprove,
    alwaysAllow: [...new Set([...(bot.alwaysAllow ?? []), ...(task.alwaysAllow ?? [])])],
  };
}

/** Only providers with an implemented permission mapping may expose a level.
 * `edits` (auto-accept edits) exists where the engine has such a mode:
 * Claude and Grok `acceptEdits`, Antigravity `auto_edit`, Qwen `auto-edit`,
 * Gemini `auto_edit`. Codex's Ask already runs `workspace-write`, so an edits
 * level would change nothing there. */
export function supportsApprovalMode(driverKind: string | undefined, mode: ApprovalMode): boolean {
  if (mode === "custom") return driverKind === "codex";
  if (mode === "edits") return ["claudeAgent", "grokAgent", "antigravityAgent", "qwenAgent", "geminiAgent"].includes(driverKind ?? "");
  if (mode !== "full") return true;
  // The chat-completions family has no provider-side reviewer, so Full is
  // implemented in the harness: createOpenAIChatRuntime answers its own tool
  // gate instead of opening a card. Without this a bot on one of these
  // engines could never stop asking — not by its own level, and not through
  // a Primary Bot's delegated Full access either.
  return ["codex", "claudeAgent", "antigravityAgent", "cursorAgent", "grokAgent", "opencodeGo", "qwenAgent", "geminiAgent",
    "clineAgent", "openai-compat", "grok", "minimax", "mistral", "cerebras", "groq"].includes(driverKind ?? "");
}

/** Whether switching engines must first drop this level to Ask. Every mode
 * stops at an engine that cannot run it. 2026-10-26: Full carries to
 * any engine that runs it, as upstream does since 295f947d: the owner chose
 * Full for their own bot, a model change is not a reason to take it back.
 * A Custom grant belongs to one provider's tool semantics and still never
 * crosses engines. Adapted from tahodev's provider-switch guard (#1120). */
export function modelSwitchNeedsAsk(
  mode: ApprovalMode,
  fromDriver: string | undefined,
  toDriver: string | undefined,
): boolean {
  return !supportsApprovalMode(toDriver, mode) ||
    (mode === "custom" && fromDriver !== toDriver);
}

export function hasNativeAutoReview(driverKind: string | undefined): boolean {
  // Qwen Code's `--approval-mode auto` is an LLM classifier that approves
  // safe actions and blocks risky ones — a reviewer, not a rubber stamp.
  return ["codex", "claudeAgent", "cursorAgent", "grokAgent", "qwenAgent"].includes(driverKind ?? "");
}

const APPROVAL_RANK: Record<ApprovalMode, number> = { ask: 0, edits: 1, auto: 2, full: 3, custom: 4 };

export function approvalModeWidens(from: ApprovalMode, to: ApprovalMode): boolean {
  return APPROVAL_RANK[to] > APPROVAL_RANK[from];
}

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return typeof value === "string" && (APPROVAL_MODES as readonly string[]).includes(value);
}

/** Resolve the durable mode without turning the legacy Auto bit into Full
 * access. Records written before approvalMode existed keep their exact old
 * behavior: autoApprove=true is safe Auto; everything else asks. Unknown
 * persisted values also fail closed to that legacy behavior. */
export function approvalModeFor(bot: {
  approvalMode?: unknown;
  autoApprove?: unknown;
  /** Server-only two-phase grant marker. Until Electron confirms it, the
   * stored elevated selection is deliberately executable only as Ask. */
  approvalGrant?: unknown;
  threadId?: string;
}): ApprovalMode {
  const grant = bot.approvalGrant;
  const otherThread = grant && typeof grant === "object" && "threadOnly" in grant && grant.threadOnly === true &&
    "threadId" in grant && typeof grant.threadId === "string" && typeof bot.threadId === "string" && grant.threadId !== bot.threadId;
  if (grant && !otherThread) return "ask";
  if (isApprovalMode(bot.approvalMode)) return bot.approvalMode;
  return bot.autoApprove === true ? "auto" : "ask";
}

/** Ask, Edits and Auto can change while the bot is working. The next
 * approval in that turn reads the new level. Full and Custom still wait. */
const LIVE_APPROVAL_LEVELS = new Set<ApprovalMode>(["ask", "edits", "auto"]);

export function liveApprovalChange(current: ApprovalMode, next: ApprovalMode): boolean {
  return LIVE_APPROVAL_LEVELS.has(current) && LIVE_APPROVAL_LEVELS.has(next);
}

/** A private late-grant recovery may revoke an elevated mode even after a
 * turn began. It can only move to the fail-closed Ask mode. Ask, Edits and
 * Auto use liveApprovalChange instead. */
export function isEmergencyApprovalDowngrade(
  current: ApprovalMode,
  next: ApprovalMode,
): boolean {
  return next === "ask" && (current === "full" || current === "custom");
}

/** 2026-10-26 (one approval level): the level an engine runs natively
 * for one turn. Full access with an Ask or Deny rule in force (the
 * person's own, the bot's or the organization's) runs the engine at Ask, so
 * every call it would have made unasked reaches Sagax: the rule decides
 * the calls it covers and Sagax answers the rest as Full access
 * (auto-approve.ts autoVerdict "full-access"). The server keeps judging
 * with the bot's own level; only the engine's native mode changes. */
export function engineApprovalMode(level: ApprovalMode, rulesHold: boolean): ApprovalMode {
  return level === "full" && rulesHold ? "ask" : level;
}
