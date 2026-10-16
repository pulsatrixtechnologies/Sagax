// Confidential threads ("Fil confidentiel", JC 2026-10-16).
//
// A person marks one of their 1:1 threads with a bot confidential, at
// creation (New thread menu, or the organization's default) or later. Once
// set it is permanent: the server refuses any change back, and the only way
// out is to delete the thread. To work normally the person opens a new one.
//
// While a thread is confidential the server keeps it to its owner:
//
//   - memory: no automatic capture, no daily log line, no memory_update,
//     memory_log, group or team memory, rules or docs write, no skill staged;
//     the thread never feeds another thread's recall, recent-work brief,
//     session_search or session_read (whoever asks, its owner included);
//     Perspicax memory_write to a team or the organization, memory_propose
//     and memory_promote are refused, and memory_write to the person's own
//     tier ("me") waits for their confirmation card;
//   - exports: left out of a bot zip (owner and console alike), of the
//     console's file browser (tasks and attachments roots) and of the
//     console's organization approval queue;
//   - approvals: cards and their notifications go to the thread owner only,
//     never the bot owner nor an organization admin; a card the owner could
//     not answer (an admin card, another person's machine) is refused;
//   - incidents carry no text: only CONFIDENTIAL_INCIDENT_TEXT, to the owner;
//   - the server log's [omb-turn] line logs "(confidential)", no prompt;
//   - the built-in browser runs in a throwaway profile of this thread,
//     never the bot's own one, discarded at the end of each turn;
//   - its turns work in the owner's environment and the thread's own folder
//     (task-workspaces/<bot>/<thread>), never the bot's project folder;
//   - no routine is created from it, and no artifact is saved from it (an
//     artifact outlives the thread and an admin may open it);
//   - deleting it wipes its messages, event and native logs, its folder, its
//     attachments, and the summaries of its decision-log rows (ids, times,
//     tool names and decisions are kept for the audit).
//
// What it does not do (docs/confidential-threads.md): the server operator,
// a VM or cluster administrator with disk access, backups (Velero keeps 30
// days) and the model provider still receive or can read the content.
//
// Pure: no store, no request. server/index.ts supplies the records.

/** The one text an incident about a confidential thread carries. */
export const CONFIDENTIAL_INCIDENT_TEXT = "un tour d'un fil confidentiel a échoué";

/** The prompt slot of the [omb-turn] log line for a confidential thread. */
export const CONFIDENTIAL_LOG_TEXT = "(confidential)";

/** Error code of a refused change from confidential back to ordinary. */
export const CONFIDENTIAL_PERMANENT = "confidential_permanent";

/** The new thread's flag: what the person asked, else the organization's
 * default. `undefined` and `null` both mean "not said". */
export function newThreadConfidential(requested: unknown, orgDefault: boolean): { ok: true; confidential: boolean } | { ok: false; error: string } {
  if (requested === undefined || requested === null) return { ok: true, confidential: orgDefault };
  if (typeof requested !== "boolean") return { ok: false, error: "confidential must be true or false" };
  return { ok: true, confidential: requested };
}

export type ConfidentialPatch =
  | { kind: "none" }
  | { kind: "make" }
  | { kind: "refused"; status: 400 | 409; error: string; code?: string };

/** A thread PATCH's `confidential`: true (with confirmConfidential: true,
 * the person read that it is permanent) makes it confidential; false on a
 * confidential thread is refused, always. */
export function confidentialPatch(current: { confidential?: unknown }, body: { confidential?: unknown; confirmConfidential?: unknown }): ConfidentialPatch {
  if (body.confirmConfidential !== undefined && typeof body.confirmConfidential !== "boolean") {
    return { kind: "refused", status: 400, error: "confirmConfidential must be a boolean" };
  }
  if (body.confidential === undefined) {
    return body.confirmConfidential === undefined ? { kind: "none" } : { kind: "refused", status: 400, error: "confirmConfidential requires confidential" };
  }
  if (typeof body.confidential !== "boolean") return { kind: "refused", status: 400, error: "confidential must be true or false" };
  const already = current.confidential === true;
  if (!body.confidential) {
    return already
      ? { kind: "refused", status: 409, code: CONFIDENTIAL_PERMANENT, error: "A confidential thread stays confidential. Open a new thread to work normally, or delete this one." }
      : { kind: "none" };
  }
  if (already) return { kind: "none" };
  if (body.confirmConfidential !== true) {
    return { kind: "refused", status: 400, code: "confirm_confidential", error: "Making a thread confidential is permanent: confirm with confirmConfidential: true" };
  }
  return { kind: "make" };
}

/** Internal routes a confidential thread's turn may not call: each writes
 * what the thread says into something other people (or other threads) read. */
const REFUSED_INTERNAL_ROUTES: Record<string, string> = {
  "/api/internal/memory": "memory",
  "/api/internal/memory/log": "memory",
  "/api/internal/group-memory": "memory",
  "/api/internal/team-memory": "memory",
  "/api/internal/workspace/rules": "workspace",
  "/api/internal/workspace/docs": "workspace",
  "/api/internal/skills/stage": "skill",
  "/api/internal/routine-requests": "routine",
  // an artifact outlives the thread and an admin may open it
  "/api/internal/artifacts": "artifact",
};

/** The refusal for an internal write from a confidential thread, or null. */
export function confidentialInternalRefusal(path: string, method: string): { error: string; code: "confidential_thread" } | null {
  if (method !== "POST") return null;
  const what = REFUSED_INTERNAL_ROUTES[path];
  if (!what) return null;
  const error = what === "artifact"
    ? "This is a confidential thread: no artifact is saved from it. Give the result here in the conversation instead."
    : what === "routine"
    ? "This is a confidential thread: no routine can be created from it. Ask the person to set the routine up from an ordinary thread."
    : what === "skill"
      ? "This is a confidential thread: nothing from it is saved as a skill. Keep the work in this thread."
      : what === "workspace"
        ? "This is a confidential thread: nothing from it is written to your rules or shared documents. Keep the work in this thread."
        : "This is a confidential thread: nothing from it is saved to memory or the daily log. Keep it in this thread; do not retry.";
  return { error, code: "confidential_thread" };
}

export type PerspicaxMemoryVerdict = "pass" | "refuse" | "confirm";

/** A Perspicax gateway tool called from a confidential thread: memory to
 * a team or the organization (write, propose, promote) is refused; a write
 * to the person's own tier ("me", the default) needs their confirmation;
 * everything else passes. `name` may carry an MCP prefix. */
export function perspicaxMemoryVerdict(name: string, args: Record<string, unknown> | undefined): PerspicaxMemoryVerdict {
  const tool = name.includes("__") ? name.slice(name.lastIndexOf("__") + 2) : name;
  if (tool === "memory_propose" || tool === "memory_promote") return "refuse";
  if (tool !== "memory_write" && tool !== "memory_save") return "pass";
  const scope = typeof args?.scope === "string" ? args.scope.trim().toLowerCase() : "";
  if (scope === "" || scope === "me") return "confirm";
  return "refuse";
}

export const PERSPICAX_MEMORY_REFUSED = "This is a confidential thread: nothing from it goes to a team or organization memory. Keep it in this thread; do not retry.";

/** What a confirmable memory write must match when it is retried: the
 * fields the person saw on the card. */
export function memoryWriteDigest(args: Record<string, unknown> | undefined): string {
  const field = (key: string) => (typeof args?.[key] === "string" ? (args[key] as string) : "");
  return JSON.stringify([field("topic"), field("title"), field("body")]);
}

const PASS_TTL_MS = 10 * 60_000;

/** One-shot passes for a confidential thread's personal memory write, given
 * when its owner allows the card, used by the next identical call. */
export class ConfidentialMemoryPasses {
  private readonly passes = new Map<string, { digest: string; at: number }[]>();
  private readonly now: () => number;
  // no parameter properties: Node runs this file in strip-only mode
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  grant(threadId: string, digest: string): void {
    const live = (this.passes.get(threadId) ?? []).filter((pass) => this.now() - pass.at < PASS_TTL_MS);
    live.push({ digest, at: this.now() });
    this.passes.set(threadId, live.slice(-8));
  }

  /** Use the pass for this exact write, once. */
  take(threadId: string, digest: string): boolean {
    const live = (this.passes.get(threadId) ?? []).filter((pass) => this.now() - pass.at < PASS_TTL_MS);
    const index = live.findIndex((pass) => pass.digest === digest);
    if (index < 0) {
      if (live.length) this.passes.set(threadId, live); else this.passes.delete(threadId);
      return false;
    }
    live.splice(index, 1);
    if (live.length) this.passes.set(threadId, live); else this.passes.delete(threadId);
    return true;
  }

  forget(threadId: string): void {
    this.passes.delete(threadId);
  }
}

/** The browser session a confidential thread's turns use: a throwaway
 * guest profile of its own, never the bot's (`bot-<id>`) nor a shared one. */
export function confidentialBrowserSession(threadId: string, random: string): string {
  return `conf-${threadId}-${random}`.replace(/[^A-Za-z0-9_.-]/gu, "_").slice(0, 96);
}

/** Whether an approval card in a confidential thread can reach its owner:
 * never an organization admin's card, never a machine other than theirs. */
export function confidentialCardAnswerable(input: { adminApproval: boolean; host: { kind: string; userId?: string }; threadOwner: string }): boolean {
  if (input.adminApproval) return false;
  if (input.host.kind === "machine" && (input.host.userId ?? "").trim().toLowerCase() !== input.threadOwner.trim().toLowerCase()) return false;
  return true;
}

export const CONFIDENTIAL_CARD_REFUSED = "Refused: this is a confidential thread, and only its owner may approve here; nobody else is asked.";
