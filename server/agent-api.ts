// The agent-to-agent API: ten tools that let one agent (a Sagax bot, or a
// person's AI client attached to Perspicax) find, create, prompt and read
// other Sagax bots, with the semantics, parameters and limits of Grok Bot's
// own agent tools (docs/agent-api.md):
//
//   list_agents, find_agents, create_agent, send_prompt, await_turn,
//   read_transcript, read_transcript_page, read_latest_page,
//   read_latest_page_with_threads, read_transcript_cold
//
// This file is the core only: validation, the turn handle, waiting for a
// turn, transcript paging, rate limits, scopes and the audit hook. It reads
// no store and starts no turn itself. Two transports feed it a caller and a
// set of dependencies (server/index.ts):
//   - a bot, through its "agents" MCP server (/api/internal/agent-api/*):
//     it reaches the peers its team and allow-list let it reach;
//   - a person's AI client, through the member API
//     (/api/org/member/agents/*, Perspicax's tools of the same names): it
//     reaches the bots that person can use in Sagax.
// Either way every send lands in a hidden conversation (#291, #302) that the
// caller owns, never in the person's open chat.
import { createHmac, timingSafeEqual } from "node:crypto";

export const AGENT_TOOL_NAMES = [
  "list_agents",
  "find_agents",
  "create_agent",
  "send_prompt",
  "await_turn",
  "read_transcript",
  "read_transcript_page",
  "read_latest_page",
  "read_latest_page_with_threads",
  "read_transcript_cold",
] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export const isAgentToolName = (name: string): name is AgentToolName => (AGENT_TOOL_NAMES as readonly string[]).includes(name);

/** The three scopes a caller may hold. */
export type AgentScope = "agents.read" | "agents.send" | "agents.create";

export interface AgentToolPolicy {
  scope: AgentScope;
  /** read: changes nothing; write: sends work; admin: creates something lasting. */
  access: "read" | "write" | "admin";
  readOnly: boolean;
  /** Calls per caller per window (RATE_WINDOW_MS[access]). */
  rate: number;
}

export const RATE_WINDOW_MS = { read: 60_000, write: 60_000, admin: 3_600_000 } as const;

export const AGENT_TOOL_POLICY: Record<AgentToolName, AgentToolPolicy> = {
  list_agents: { scope: "agents.read", access: "read", readOnly: true, rate: 240 },
  find_agents: { scope: "agents.read", access: "read", readOnly: true, rate: 240 },
  create_agent: { scope: "agents.create", access: "admin", readOnly: false, rate: 5 },
  send_prompt: { scope: "agents.send", access: "write", readOnly: false, rate: 30 },
  // await_turn waits on a turn the caller already started: a read.
  await_turn: { scope: "agents.read", access: "read", readOnly: true, rate: 240 },
  read_transcript: { scope: "agents.read", access: "read", readOnly: true, rate: 240 },
  read_transcript_page: { scope: "agents.read", access: "read", readOnly: true, rate: 240 },
  read_latest_page: { scope: "agents.read", access: "read", readOnly: true, rate: 240 },
  read_latest_page_with_threads: { scope: "agents.read", access: "read", readOnly: true, rate: 240 },
  read_transcript_cold: { scope: "agents.read", access: "read", readOnly: true, rate: 240 },
};

// Limits, the reference's where it names one.
export const FIND_LIMIT_MAX = 64;
export const FIND_LIMIT_DEFAULT = 8;
export const PROMPT_MAX_CHARS = 32_000;
export const SEND_FILES_MAX = 8;
export const SEND_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const TIMEOUT_MS_MIN = 1_000;
export const TIMEOUT_MS_MAX = 600_000;
export const TIMEOUT_MS_DEFAULT = 120_000;
export const PAGE_LIMIT_MAX = 200;
export const PAGE_LIMIT_DEFAULT = 20;
export const COLD_PAGE_SIZE = 50;
/** read_transcript answers at most this many entries, newest kept, with a cursor for the rest. */
export const FULL_TRANSCRIPT_MAX = 2_000;
/** One answer's entries stay under this many bytes (JSON), so an MCP
 * gateway reading at most 1 MiB always gets it whole. A page that would be
 * larger keeps its newest entries and continues with next_cursor. */
export const PAGE_MAX_BYTES = 800_000;
export const AGENT_NAME_MAX = 80;
export const AGENT_DESCRIPTION_MAX = 1_000;
export const ENTRY_TEXT_MAX = 16_000;
export const REPLY_MAX_CHARS = 32_000;
/** How long a turn handle stays valid. */
export const HANDLE_TTL_MS = 7 * 24 * 3_600_000;
const POLL_MS = 400;
/** Idle looks in a row that end a wait with no words (a turn that said nothing or failed). */
const IDLE_LOOKS_DONE = 3;

export type SendMode = "fire_and_forget" | "blocking" | "async";
export type OnBusy = "supersede" | "reject" | "queue";
export type AgentStatus = "running" | "idle";
/** A conversation's live state; queued counts as running (its turn is coming). */
export type TurnState = "running" | "waiting" | "queued" | "idle";

export interface AgentCaller {
  kind: "bot" | "person";
  /** The bot id, or the person's principal id. */
  id: string;
  name: string;
  scopes: ReadonlySet<AgentScope>;
  /** For the audit row: perspicax-mcp, console, agents-mcp. */
  via: string;
  /** A bot caller's own conversation (the turn that called). */
  sourceThreadId?: string;
  /** A bot caller's comms depth: a turn another agent started is 1. */
  depth?: number;
  /** A person caller: their Perspicax user id, and whether this call was
   * signed as an organization admin. */
  sub?: string;
  admin?: boolean;
  /** Bot callers: the person the source turn spoke for, when known (the
   * transport fills it; the core only carries it to notify). */
  speakerPrincipalId?: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  status: AgentStatus;
}

export interface TranscriptThread {
  threadId: string;
  title: string;
  hidden: boolean;
}

/** One stored message, as the dependencies hand it over. */
export interface StoredMessage {
  id: string;
  role: string;
  kind?: string;
  text?: string;
  at: number;
  sender?: string | null;
  tool?: { name?: string; ok?: boolean } | null;
  attachments?: Array<{ name?: string; path?: string }> | null;
}

export interface TranscriptEntry {
  cursor: string;
  id: string;
  thread_id: string;
  role: "user" | "agent";
  kind: "text" | "tool" | "note";
  text: string;
  at: number;
  from: string | null;
  files?: string[];
}

export interface FileInput {
  /** Workspace-relative path (bot caller) or the name the file is given (person caller). */
  path: string;
  /** Person callers send the bytes (base64); a bot's files are read from its workspace. */
  content_base64?: string;
}

export interface Refusal {
  status: number;
  code: string;
  message: string;
  extra?: Record<string, unknown>;
}

export const isRefusal = (value: unknown): value is Refusal =>
  Boolean(value) && typeof value === "object" && typeof (value as Refusal).code === "string" && typeof (value as Refusal).status === "number" && typeof (value as Refusal).message === "string";

export const refuse = (status: number, code: string, message: string, extra?: Record<string, unknown>): Refusal => ({ status, code, message, ...(extra ? { extra } : {}) });

export interface AuditEntry {
  tool: AgentToolName | string;
  agentId: string | null;
  outcome: "ok" | "refused" | "error";
  code?: string;
  /** Shape only: never a prompt, a reply or a file's content. */
  detail?: Record<string, unknown>;
}

export interface AgentApiDeps {
  /** Every agent the caller may reach (tenant/org isolation is applied here). */
  agents(caller: AgentCaller): AgentSummary[] | Promise<AgentSummary[]>;
  /** Create one agent for the caller; it greets the user itself. */
  createAgent(caller: AgentCaller, input: { name: string; description: string }): Promise<AgentSummary | Refusal>;
  /** The conversations with this agent the caller may read. */
  threads(caller: AgentCaller, agentId: string): TranscriptThread[];
  /** A conversation's stored messages, oldest first. Never wakes anything. */
  messages(threadId: string): StoredMessage[];
  /** The live state of one conversation. */
  turnState(agentId: string, threadId: string): TurnState;
  /** The caller's hidden conversation with this agent: the newest open one,
   * else a new one. */
  conversation(caller: AgentCaller, agentId: string): Promise<{ threadId: string } | Refusal>;
  /** Put the prompt (and the staged files) into the conversation and start or
   * queue its turn. messageId is the stored prompt's id, when known. */
  post(caller: AgentCaller, agentId: string, threadId: string, prompt: string, files: FileInput[]): Promise<{ messageId: string | null } | Refusal>;
  /** Stop the conversation's running turn (on_busy supersede). */
  interrupt(agentId: string, threadId: string): Promise<void>;
  /** Async mode: tell the caller the turn ended (a bot is woken with the reply). */
  notify?(caller: AgentCaller, agent: AgentSummary, result: TurnResult): void;
  audit(caller: AgentCaller, entry: AuditEntry): void;
  /** The HMAC key turn handles are signed with (at least 32 bytes). */
  secret: Buffer;
  now?(): number;
  sleep?(ms: number): Promise<void>;
}

export interface TurnResult {
  handle: string;
  agent_id: string;
  thread_id: string;
  finished: boolean;
  status: "finished" | "running" | "waiting_for_approval" | "queued";
  /** The agent's words in this turn; empty with finished=true means it said nothing. */
  reply: string;
}

// ── validation ────────────────────────────────────────────────────────

type Args = Record<string, unknown>;
const ID = /^[\w-]{1,128}$/;

const objectArgs = (value: unknown): Args | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Args : value === undefined || value === null ? {} : null;

function onlyKeys(args: Args, allowed: readonly string[]): Refusal | null {
  const extra = Object.keys(args).filter((key) => !allowed.includes(key) && args[key] !== undefined && args[key] !== null);
  return extra.length ? refuse(400, "bad_request", `Unknown parameter: ${extra[0]}. Allowed: ${allowed.join(", ") || "none"}.`) : null;
}

function agentIdArg(args: Args): string | Refusal {
  const id = typeof args.agent_id === "string" ? args.agent_id.trim() : "";
  return ID.test(id) ? id : refuse(400, "bad_request", "agent_id is required: an id exactly as list_agents returned it.");
}

function intArg(args: Args, key: string, min: number, max: number, fallback: number | undefined): number | undefined | Refusal {
  const value = args[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return refuse(400, "bad_request", `${key} is a whole number from ${min} to ${max}.`);
  }
  return value;
}

function cursorArg(args: Args): CursorKey | null | Refusal {
  if (args.cursor === undefined || args.cursor === null || args.cursor === "") return null;
  if (typeof args.cursor !== "string") return refuse(400, "bad_request", "cursor is the next_cursor of a previous page.");
  const key = decodeCursor(args.cursor);
  return key ?? refuse(400, "bad_request", "cursor is not a cursor this API gave out.");
}

// ── cursors and handles ───────────────────────────────────────────────

interface CursorKey {
  at: number;
  threadId: string;
  id: string;
}

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");
const unb64 = (text: string) => Buffer.from(text, "base64url").toString("utf8");

export function encodeCursor(key: CursorKey): string {
  return `c1.${b64(`${key.at}\n${key.threadId}\n${key.id}`)}`;
}

export function decodeCursor(cursor: string): CursorKey | null {
  if (!cursor.startsWith("c1.") || cursor.length > 600) return null;
  const parts = unb64(cursor.slice(3)).split("\n");
  if (parts.length !== 3) return null;
  const at = Number(parts[0]);
  if (!Number.isSafeInteger(at) || !ID.test(parts[1]!) || !parts[2] || parts[2].length > 160) return null;
  return { at, threadId: parts[1]!, id: parts[2]! };
}

/** Entry order: time, then conversation, then message id. */
function compareKeys(a: CursorKey, b: CursorKey): number {
  return a.at - b.at || (a.threadId < b.threadId ? -1 : a.threadId > b.threadId ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

interface HandleBody {
  /** agent id */
  a: string;
  /** conversation */
  t: string;
  /** the prompt's message id, when it was stored at once */
  m: string | null;
  /** issued at (ms): a queued prompt's turn is what follows it */
  i: number;
  /** caller key: a handle answers only the caller it was given to */
  c: string;
}

const callerKey = (caller: AgentCaller) => `${caller.kind}:${caller.id}`;

export function signHandle(secret: Buffer, body: HandleBody): string {
  const payload = b64(JSON.stringify(body));
  const mac = createHmac("sha256", secret).update(payload).digest("base64url").slice(0, 32);
  return `turn_${payload}.${mac}`;
}

export function verifyHandle(secret: Buffer, handle: string, now: number): HandleBody | null {
  if (typeof handle !== "string" || !handle.startsWith("turn_") || handle.length > 1_200) return null;
  const [payload, mac] = handle.slice(5).split(".");
  if (!payload || !mac) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url").slice(0, 32);
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, Buffer.from(expected))) return null;
  try {
    const body = JSON.parse(unb64(payload)) as HandleBody;
    if (typeof body.a !== "string" || typeof body.t !== "string" || typeof body.i !== "number" || typeof body.c !== "string") return null;
    if (now - body.i > HANDLE_TTL_MS) return null;
    return body;
  } catch {
    return null;
  }
}

// ── rate limits ───────────────────────────────────────────────────────

/** A sliding window per caller and tool. Memory only: a restart forgives. */
export class AgentRateLimiter {
  private readonly hits = new Map<string, number[]>();

  /** Null when admitted, else how long until the next call is. */
  admit(caller: AgentCaller, tool: AgentToolName, now: number): number | null {
    const policy = AGENT_TOOL_POLICY[tool];
    const windowMs = RATE_WINDOW_MS[policy.access];
    const key = `${callerKey(caller)}|${tool}`;
    const kept = (this.hits.get(key) ?? []).filter((at) => now - at < windowMs);
    if (kept.length >= policy.rate) {
      this.hits.set(key, kept);
      return Math.max(1, windowMs - (now - kept[0]!));
    }
    kept.push(now);
    this.hits.set(key, kept);
    if (this.hits.size > 10_000) this.prune(now);
    return null;
  }

  private prune(now: number): void {
    for (const [key, list] of this.hits) if (!list.some((at) => now - at < RATE_WINDOW_MS.admin)) this.hits.delete(key);
  }
}

// ── transcript ────────────────────────────────────────────────────────

/** A stored message as a transcript entry; null for what a caller never
 * reads (reasoning, cards' internals, empty rows). Tool rows keep the tool's
 * name and outcome only, never its input or output. */
export function toEntry(threadId: string, message: StoredMessage): TranscriptEntry | null {
  if (!message || typeof message.id !== "string" || typeof message.at !== "number") return null;
  const role = message.role === "user" ? "user" : message.role === "bot" ? "agent" : null;
  if (!role) return null;
  const kind = message.kind ?? "text";
  const files = (message.attachments ?? []).map((file) => file?.name ?? file?.path?.split(/[\\/]/).at(-1) ?? "").filter(Boolean);
  const base = { cursor: encodeCursor({ at: message.at, threadId, id: message.id }), id: message.id, thread_id: threadId, role, at: message.at, from: message.sender ?? null } as const;
  if (kind === "activity") {
    const name = message.tool?.name?.trim();
    if (!name) return null;
    return { ...base, kind: "tool", text: `${name}${message.tool?.ok === false ? " (failed)" : ""}`.slice(0, 300) };
  }
  if (kind === "text" || kind === "nudge" || kind === "access") {
    const text = typeof message.text === "string" ? message.text : "";
    if (!text.trim() && !files.length) return null;
    return { ...base, kind: kind === "text" ? "text" : "note", text: text.length > ENTRY_TEXT_MAX ? `${text.slice(0, ENTRY_TEXT_MAX)}\n[...]` : text, ...(files.length ? { files } : {}) };
  }
  return null;
}

function collectEntries(deps: AgentApiDeps, threads: readonly TranscriptThread[]): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  for (const thread of threads) {
    for (const message of deps.messages(thread.threadId)) {
      const entry = toEntry(thread.threadId, message);
      if (entry) out.push(entry);
    }
  }
  out.sort((a, b) => compareKeys({ at: a.at, threadId: a.thread_id, id: a.id }, { at: b.at, threadId: b.thread_id, id: b.id }));
  return out;
}

const keyOf = (entry: TranscriptEntry): CursorKey => ({ at: entry.at, threadId: entry.thread_id, id: entry.id });

/** The newest `limit` entries strictly before `before` (all when null), and
 * the cursor of the next older page (null when none is left). */
function pageBefore(entries: readonly TranscriptEntry[], before: CursorKey | null, limit: number) {
  const eligible = before ? entries.filter((entry) => compareKeys(keyOf(entry), before) < 0) : entries;
  const picked = eligible.slice(Math.max(0, eligible.length - limit));
  // Newest first until the byte budget is spent; always at least one entry.
  const page: TranscriptEntry[] = [];
  let bytes = 0;
  for (let index = picked.length - 1; index >= 0; index--) {
    const entry = picked[index]!;
    const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (page.length && bytes + size > PAGE_MAX_BYTES) break;
    page.unshift(entry);
    bytes += size;
  }
  const more = eligible.length > page.length;
  return { entries: page, next_cursor: more && page[0] ? page[0].cursor : null };
}

// ── turns ─────────────────────────────────────────────────────────────

/** The agent's words after the anchor, and whether its turn has ended. */
function turnReply(messages: readonly StoredMessage[], anchor: { id: string | null; at: number }): { reply: string; sawAnchor: boolean } {
  let start = -1;
  if (anchor.id) start = messages.findIndex((message) => message.id === anchor.id);
  if (start < 0) {
    // A queued prompt is stored when its turn starts: the newest user line
    // at or after the handle's time is the prompt.
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]!;
      if (message.at < anchor.at - 1_000) break;
      if (message.role === "user") {
        start = index;
        break;
      }
    }
  }
  if (start < 0) return { reply: "", sawAnchor: false };
  const texts: string[] = [];
  for (const message of messages.slice(start + 1)) {
    if (message.role === "user" && (message.kind ?? "text") === "text") break;
    if (message.role === "bot" && (message.kind ?? "text") === "text" && typeof message.text === "string" && message.text.trim()) texts.push(message.text.trim());
  }
  const joined = texts.join("\n\n");
  return { reply: joined.length > REPLY_MAX_CHARS ? `${joined.slice(0, REPLY_MAX_CHARS)}\n[...]` : joined, sawAnchor: true };
}

function statusWord(state: TurnState): TurnResult["status"] {
  return state === "waiting" ? "waiting_for_approval" : state === "queued" ? "queued" : state === "running" ? "running" : "finished";
}

// ── the API ───────────────────────────────────────────────────────────

export interface AgentApiAnswer {
  status: number;
  body: Record<string, unknown>;
}

export interface AgentApi {
  call(caller: AgentCaller, tool: string, rawArgs: unknown, signal?: AbortSignal): Promise<AgentApiAnswer>;
}

/** Ranks agents for a query: the name first, then the description. Zero
 * means no match. */
export function matchScore(agent: AgentSummary, query: string): number {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return 0;
  const name = agent.name.toLocaleLowerCase();
  const description = agent.description.toLocaleLowerCase();
  const words = q.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);
  let score = 0;
  if (name === q) score += 100;
  else if (name.startsWith(q)) score += 60;
  else if (name.includes(q)) score += 40;
  if (description.includes(q)) score += 25;
  for (const word of words) {
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(name)) score += 15;
    else if (name.includes(word)) score += 8;
    if (description.includes(word)) score += 5;
  }
  return score;
}

export function createAgentApi(deps: AgentApiDeps): AgentApi {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const limiter = new AgentRateLimiter();
  if (deps.secret.length < 32) throw new Error("the agent API secret must be at least 32 bytes");

  const ok = (body: Record<string, unknown>): AgentApiAnswer => ({ status: 200, body });
  const asAnswer = (refusal: Refusal): AgentApiAnswer => ({
    status: refusal.status,
    body: { error: refusal.message, code: refusal.code, message: refusal.message, ...refusal.extra },
  });

  /** The agent, when the caller may reach it; one answer for "no such agent" and "not yours". */
  const reachable = async (caller: AgentCaller, agentId: string): Promise<AgentSummary | Refusal> => {
    const agent = (await deps.agents(caller)).find((candidate) => candidate.id === agentId);
    return agent ?? refuse(404, "unknown_agent", "No agent with that id is reachable. Its id must come from list_agents or find_agents.");
  };

  const waitTurn = async (body: HandleBody, handle: string, timeoutMs: number, signal?: AbortSignal): Promise<TurnResult> => {
    const deadline = now() + timeoutMs;
    let idleLooks = 0;
    for (;;) {
      const state = deps.turnState(body.a, body.t);
      const read = turnReply(deps.messages(body.t), { id: body.m, at: body.i });
      if (state === "idle" && read.sawAnchor) {
        idleLooks += 1;
        if (read.reply || idleLooks >= IDLE_LOOKS_DONE) {
          return { handle, agent_id: body.a, thread_id: body.t, finished: true, status: "finished", reply: read.reply };
        }
      } else if (state === "idle") {
        // The prompt is not in the conversation yet (queued behind a slot).
        idleLooks += 1;
        if (idleLooks >= IDLE_LOOKS_DONE * 25) {
          return { handle, agent_id: body.a, thread_id: body.t, finished: false, status: "queued", reply: "" };
        }
      } else {
        idleLooks = 0;
        if (state === "waiting") {
          // A card waits for a person: waiting longer only burns the timeout.
          return { handle, agent_id: body.a, thread_id: body.t, finished: false, status: "waiting_for_approval", reply: read.reply };
        }
      }
      if (signal?.aborted || now() >= deadline) {
        return { handle, agent_id: body.a, thread_id: body.t, finished: false, status: statusWord(state === "idle" ? "queued" : state), reply: read.reply };
      }
      await sleep(Math.min(POLL_MS, Math.max(0, deadline - now())));
    }
  };

  const timeoutNote = "The turn is still going. Call await_turn with this handle to wait for it; never send the prompt again.";
  const resultBody = (result: TurnResult): Record<string, unknown> => ({
    ...result,
    ...(result.finished ? (result.reply ? {} : { note: "The turn finished without text." }) : { next: result.status === "waiting_for_approval" ? "A person must answer an approval in that conversation in Sagax; then call await_turn with this handle." : timeoutNote }),
  });

  const handlers: Record<AgentToolName, (caller: AgentCaller, args: Args, signal?: AbortSignal) => Promise<AgentApiAnswer | Refusal>> = {
    async list_agents(caller, args) {
      const bad = onlyKeys(args, []);
      if (bad) return bad;
      const agents = await deps.agents(caller);
      return ok({ agents: agents.map(({ id, name, description, status }) => ({ id, name, description, status })) });
    },

    async find_agents(caller, args) {
      const bad = onlyKeys(args, ["query", "status", "limit"]);
      if (bad) return bad;
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query || query.length > 200) return refuse(400, "bad_request", "query is 1 to 200 characters: words of the agent's name or description.");
      if (args.status !== undefined && args.status !== null && args.status !== "running" && args.status !== "idle") {
        return refuse(400, "bad_request", "status is running or idle.");
      }
      const limit = intArg(args, "limit", 1, FIND_LIMIT_MAX, FIND_LIMIT_DEFAULT);
      if (isRefusal(limit)) return limit;
      const scored = (await deps.agents(caller))
        .filter((agent) => !args.status || agent.status === args.status)
        .map((agent) => ({ agent, score: matchScore(agent, query) }))
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name));
      // Best matches only: within reach of the top score.
      const top = scored[0]?.score ?? 0;
      const best = scored.filter((hit) => hit.score >= top * 0.4).slice(0, limit);
      return ok({ agents: best.map(({ agent }) => ({ id: agent.id, name: agent.name, description: agent.description, status: agent.status })) });
    },

    async create_agent(caller, args) {
      const bad = onlyKeys(args, ["name", "description"]);
      if (bad) return bad;
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name || name.length > AGENT_NAME_MAX || /[\r\n]/.test(name)) return refuse(400, "bad_request", `name is the display name: one line, 1 to ${AGENT_NAME_MAX} characters.`);
      if (args.description !== undefined && args.description !== null && typeof args.description !== "string") return refuse(400, "bad_request", "description is text.");
      const description = typeof args.description === "string" ? args.description.trim() : "";
      if (description.length > AGENT_DESCRIPTION_MAX) return refuse(400, "bad_request", `description is at most ${AGENT_DESCRIPTION_MAX} characters.`);
      const existing = (await deps.agents(caller)).find((agent) => agent.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
      if (existing) return refuse(409, "agent_exists", `An agent named ${existing.name} already exists (id ${existing.id}). Use it instead of creating another; agents cannot be deleted from here.`);
      const created = await deps.createAgent(caller, { name, description });
      if (isRefusal(created)) return created;
      return ok({
        agent: { id: created.id, name: created.name, description: created.description, status: created.status },
        greeted: true,
        note: "The new agent greets the user itself. Do not send it a first prompt unless asked, and never quote its id to the user. Only the owner can delete it, from the Sagax app.",
      });
    },

    async send_prompt(caller, args, signal) {
      const bad = onlyKeys(args, ["agent_id", "prompt", "mode", "timeout_ms", "on_busy", "files"]);
      if (bad) return bad;
      const agentId = agentIdArg(args);
      if (isRefusal(agentId)) return agentId;
      const prompt = typeof args.prompt === "string" ? args.prompt : "";
      if (!prompt.trim() || prompt.length > PROMPT_MAX_CHARS) return refuse(400, "bad_request", `prompt is 1 to ${PROMPT_MAX_CHARS} characters.`);
      const mode = (args.mode ?? "fire_and_forget") as SendMode;
      if (!["fire_and_forget", "blocking", "async"].includes(mode)) return refuse(400, "bad_request", "mode is fire_and_forget, blocking or async.");
      const onBusy = (args.on_busy ?? "supersede") as OnBusy;
      if (!["supersede", "reject", "queue"].includes(onBusy)) return refuse(400, "bad_request", "on_busy is supersede (default), reject or queue.");
      const timeoutMs = intArg(args, "timeout_ms", TIMEOUT_MS_MIN, TIMEOUT_MS_MAX, TIMEOUT_MS_DEFAULT);
      if (isRefusal(timeoutMs)) return timeoutMs;
      const files = args.files ?? [];
      if (!Array.isArray(files) || files.length > SEND_FILES_MAX) return refuse(400, "bad_request", `files is a list of at most ${SEND_FILES_MAX} workspace-relative paths.`);
      const fileInputs: FileInput[] = [];
      for (const raw of files) {
        const file: FileInput | null = typeof raw === "string" ? { path: raw } : raw && typeof raw === "object" && typeof (raw as FileInput).path === "string" ? raw as FileInput : null;
        if (!file) return refuse(400, "bad_request", "each file is a workspace-relative path.");
        const path = file.path.trim().replace(/\\/g, "/");
        if (!path || path.length > 512 || path.startsWith("/") || /^[a-zA-Z]:/.test(path) || path.split("/").some((part) => part === ".." || part === "")) {
          return refuse(400, "bad_request", `${file.path} is not a workspace-relative path (no leading /, no ..).`);
        }
        if (file.content_base64 !== undefined) {
          if (typeof file.content_base64 !== "string" || Math.floor(file.content_base64.length * 3 / 4) > SEND_FILE_MAX_BYTES + 3) {
            return refuse(413, "file_too_large", `${path} is larger than 25 MiB.`);
          }
        }
        fileInputs.push({ path, ...(file.content_base64 !== undefined ? { content_base64: file.content_base64 } : {}) });
      }
      const agent = await reachable(caller, agentId);
      if (isRefusal(agent)) return agent;
      const conversation = await deps.conversation(caller, agentId);
      if (isRefusal(conversation)) return conversation;
      const { threadId } = conversation;
      const state = deps.turnState(agentId, threadId);
      if (state !== "idle") {
        if (onBusy === "reject") {
          return refuse(409, "busy", `${agent.name} is still working on your previous prompt. Wait with await_turn, or send with on_busy queue or supersede.`, { thread_id: threadId });
        }
        if (onBusy === "supersede" && (state === "running" || state === "waiting")) await deps.interrupt(agentId, threadId);
      }
      const issuedAt = now();
      const posted = await deps.post(caller, agentId, threadId, prompt, fileInputs);
      if (isRefusal(posted)) return posted;
      const body: HandleBody = { a: agentId, t: threadId, m: posted.messageId, i: issuedAt, c: callerKey(caller) };
      const handle = signHandle(deps.secret, body);
      const accepted = { handle, agent_id: agentId, thread_id: threadId, mode, accepted: true, files: fileInputs.length };
      if (mode === "fire_and_forget") return ok({ ...accepted, finished: false, status: "accepted" });
      if (mode === "async") {
        if (deps.notify) {
          const notify = deps.notify;
          // Watch in the background; the caller is told when the turn ends.
          void waitTurn(body, handle, TIMEOUT_MS_MAX * 6).then((result) => {
            if (result.finished || result.status === "waiting_for_approval") notify(caller, agent, result);
          }).catch(() => undefined);
        }
        return ok({ ...accepted, finished: false, status: "accepted", next: "You are notified when the turn ends; or call await_turn with this handle. Never send the prompt again." });
      }
      const result = await waitTurn(body, handle, timeoutMs as number, signal);
      return ok({ ...accepted, ...resultBody(result) });
    },

    async await_turn(caller, args, signal) {
      const bad = onlyKeys(args, ["agent_id", "handle", "timeout_ms"]);
      if (bad) return bad;
      const agentId = agentIdArg(args);
      if (isRefusal(agentId)) return agentId;
      const timeoutMs = intArg(args, "timeout_ms", 0, TIMEOUT_MS_MAX, TIMEOUT_MS_DEFAULT);
      if (isRefusal(timeoutMs)) return timeoutMs;
      const agent = await reachable(caller, agentId);
      if (isRefusal(agent)) return agent;
      if (args.handle !== undefined && args.handle !== null && args.handle !== "") {
        const body = typeof args.handle === "string" ? verifyHandle(deps.secret, args.handle, now()) : null;
        if (!body || body.a !== agentId || body.c !== callerKey(caller)) {
          return refuse(400, "bad_handle", "That handle is not one send_prompt gave you for this agent, or it expired.");
        }
        return ok(resultBody(await waitTurn(body, args.handle as string, timeoutMs!, signal)));
      }
      // No handle: the in-flight turn of the caller's newest conversation
      // with this agent, else its last message.
      const threads = deps.threads(caller, agentId);
      const entries = collectEntries(deps, threads);
      const lastUser = [...entries].reverse().find((entry) => entry.role === "user");
      const threadId = lastUser?.thread_id ?? entries.at(-1)?.thread_id ?? null;
      if (!threadId) return ok({ agent_id: agentId, finished: true, status: "idle", reply: "", note: "You have no conversation with this agent yet." });
      const body: HandleBody = { a: agentId, t: threadId, m: lastUser?.id ?? null, i: lastUser?.at ?? now(), c: callerKey(caller) };
      const handle = signHandle(deps.secret, body);
      if (deps.turnState(agentId, threadId) === "idle") {
        const last = [...entries].reverse().find((entry) => entry.thread_id === threadId && entry.role === "agent" && entry.kind === "text");
        return ok({ handle, agent_id: agentId, thread_id: threadId, finished: true, status: "idle", reply: last?.text ?? "" });
      }
      return ok(resultBody(await waitTurn(body, handle, timeoutMs!, signal)));
    },

    async read_transcript(caller, args) {
      const bad = onlyKeys(args, ["agent_id"]);
      if (bad) return bad;
      const agentId = agentIdArg(args);
      if (isRefusal(agentId)) return agentId;
      const agent = await reachable(caller, agentId);
      if (isRefusal(agent)) return agent;
      const all = collectEntries(deps, deps.threads(caller, agentId));
      const page = pageBefore(all, null, FULL_TRANSCRIPT_MAX);
      const truncated = all.length > page.entries.length;
      return ok({
        agent_id: agentId, status: agent.status, entries: page.entries, total: all.length, truncated, next_cursor: page.next_cursor,
        ...(truncated ? { next: "Older entries did not fit in one answer: read them with read_latest_page or read_transcript_cold, passing next_cursor as cursor, until next_cursor is null." } : {}),
      });
    },

    async read_transcript_page(caller, args) {
      const bad = onlyKeys(args, ["agent_id", "limit", "before_ms", "after_ms", "cursor"]);
      if (bad) return bad;
      const agentId = agentIdArg(args);
      if (isRefusal(agentId)) return agentId;
      const limit = intArg(args, "limit", 1, PAGE_LIMIT_MAX, undefined);
      if (isRefusal(limit)) return limit;
      if (limit === undefined) return refuse(400, "bad_request", `limit is required: 1 to ${PAGE_LIMIT_MAX}.`);
      const upper = args.before_ms;
      if (typeof upper !== "number" || !Number.isSafeInteger(upper) || upper < 0) return refuse(400, "bad_request", "before_ms is required: the inclusive upper bound, in unix milliseconds.");
      const lower = args.after_ms;
      if (lower !== undefined && lower !== null && (typeof lower !== "number" || !Number.isSafeInteger(lower) || lower < 0 || lower > upper)) {
        return refuse(400, "bad_request", "after_ms is the inclusive lower bound in unix milliseconds, at most before_ms.");
      }
      const cursor = cursorArg(args);
      if (isRefusal(cursor)) return cursor;
      const agent = await reachable(caller, agentId);
      if (isRefusal(agent)) return agent;
      const all = collectEntries(deps, deps.threads(caller, agentId)).filter((entry) => entry.at <= upper && (typeof lower !== "number" || entry.at >= lower));
      const page = pageBefore(all, cursor, limit as number);
      return ok({ agent_id: agentId, entries: page.entries, next_cursor: page.next_cursor });
    },

    async read_latest_page(caller, args) {
      return latest(caller, args, false);
    },

    async read_latest_page_with_threads(caller, args) {
      return latest(caller, args, true);
    },

    async read_transcript_cold(caller, args) {
      const bad = onlyKeys(args, ["agent_id", "cursor"]);
      if (bad) return bad;
      const agentId = agentIdArg(args);
      if (isRefusal(agentId)) return agentId;
      const cursor = cursorArg(args);
      if (isRefusal(cursor)) return cursor;
      const agent = await reachable(caller, agentId);
      if (isRefusal(agent)) return agent;
      // Cold: the stored transcript only. No live state is read and nothing
      // of the agent is started (turnState is never called).
      const page = pageBefore(collectEntries(deps, deps.threads(caller, agentId)), cursor, COLD_PAGE_SIZE);
      return ok({ agent_id: agentId, entries: page.entries, next_cursor: page.next_cursor, cold: true });
    },
  };

  const latest = async (caller: AgentCaller, args: Args, withThreads: boolean): Promise<AgentApiAnswer | Refusal> => {
    const bad = onlyKeys(args, ["agent_id", "limit", "cursor"]);
    if (bad) return bad;
    const agentId = agentIdArg(args);
    if (isRefusal(agentId)) return agentId;
    const limit = intArg(args, "limit", 1, PAGE_LIMIT_MAX, PAGE_LIMIT_DEFAULT);
    if (isRefusal(limit)) return limit;
    const cursor = cursorArg(args);
    if (isRefusal(cursor)) return cursor;
    const agent = await reachable(caller, agentId);
    if (isRefusal(agent)) return agent;
    const threads = deps.threads(caller, agentId);
    const all = collectEntries(deps, threads);
    const page = pageBefore(all, cursor, limit!);
    const body: Record<string, unknown> = { agent_id: agentId, status: agent.status, entries: page.entries, next_cursor: page.next_cursor };
    if (withThreads) {
      body.threads = threads.map((thread) => {
        const own = all.filter((entry) => entry.thread_id === thread.threadId);
        const state = deps.turnState(agentId, thread.threadId);
        return {
          thread_id: thread.threadId,
          title: thread.title,
          hidden: thread.hidden,
          count: own.length,
          in_page: page.entries.filter((entry) => entry.thread_id === thread.threadId).length,
          last_at: own.at(-1)?.at ?? null,
          status: state === "idle" ? "idle" : "running",
        };
      });
    }
    return ok(body);
  };

  return {
    async call(caller, tool, rawArgs, signal) {
      if (!isAgentToolName(tool)) return asAnswer(refuse(404, "unknown_tool", `Unknown tool ${tool}.`));
      const args = objectArgs(rawArgs);
      const agentId = args && typeof args.agent_id === "string" ? args.agent_id : null;
      const policy = AGENT_TOOL_POLICY[tool];
      const finish = (answer: AgentApiAnswer, detail?: Record<string, unknown>): AgentApiAnswer => {
        const outcome = answer.status < 400 ? "ok" : answer.status >= 500 ? "error" : "refused";
        deps.audit(caller, {
          tool,
          agentId,
          outcome,
          ...(outcome !== "ok" && typeof answer.body.code === "string" ? { code: answer.body.code } : {}),
          detail: { access: policy.access, ...detail },
        });
        return answer;
      };
      if (!args) return finish(asAnswer(refuse(400, "bad_request", "Arguments are a JSON object.")));
      if (!caller.scopes.has(policy.scope)) {
        return finish(asAnswer(refuse(403, "forbidden_scope", `This caller does not hold the ${policy.scope} scope that ${tool} needs.`, { scope: policy.scope })));
      }
      const wait = limiter.admit(caller, tool, now());
      if (wait !== null) return finish(asAnswer(refuse(429, "rate_limited", `Too many ${tool} calls; try again in ${Math.ceil(wait / 1000)} s.`, { retry_after_ms: wait })));
      try {
        const answer = await handlers[tool](caller, args, signal);
        const shaped = isRefusal(answer) ? asAnswer(answer) : answer;
        const detail: Record<string, unknown> = {};
        if (tool === "send_prompt") {
          detail.mode = args.mode ?? "fire_and_forget";
          detail.onBusy = args.on_busy ?? "supersede";
          detail.files = Array.isArray(args.files) ? args.files.length : 0;
          if (typeof shaped.body.thread_id === "string") detail.threadId = shaped.body.thread_id;
        }
        if (tool === "create_agent" && shaped.status < 400) detail.created = (shaped.body.agent as { id?: string } | undefined)?.id ?? null;
        return finish(shaped, detail);
      } catch (error) {
        console.error(`[agent-api] ${tool}: ${error instanceof Error ? error.message : String(error)}`);
        return finish(asAnswer(refuse(500, "server_error", "The server could not do this; its log has the details.")));
      }
    },
  };
}
