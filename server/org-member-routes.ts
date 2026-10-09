// The organization member API (Perspicax master plan 2026-10-09, lot C.1):
// what a person may do with their own bots from an AI client attached to
// Perspicax (Claude Code, claude.ai, Cursor), under their own identity.
//
//   GET  /api/org/member/capabilities          the version and the routes
//   GET  /api/org/member/bots                  the bots the person can see
//   POST /api/org/member/bots/{id}/messages    send, optionally wait (120 s)
//   GET  /api/org/member/threads/{id}          messages since a cursor
//   POST /api/org/member/routines/{id}/run     run a routine now
//   GET  /api/org/member/routines/runs/{id}    one run
//   POST /api/org/member/approvals/{id}        allow or deny a card
//   POST /api/org/member/people/{id}/nudge     nudge a person
//
// Answered before the session gate and before loopback trust, like the admin
// API (server/org-admin-routes.ts): the only credential is an assertion
// Perspicax signs per request for the acting person (typ
// `pulsabot-console+jwt`, `act.sub` `perspicax-mcp` or `console`, at most
// 120 s, single use). The person must be known here, active in the
// directory and not turned off in Sagax.
//
// Each route then checks its `clients.*` permission (shared/permissions.ts)
// and performs the matching Sagax route AS that person, through a 60 s
// session of theirs (SessionRegistry.actAs): every rule the person meets in
// Sagax (visibility, private threads, who may answer a card, Run now) holds
// here unchanged, and a refusal from that route passes through. Every write
// leaves one admin activity row, category `client`, actor the person,
// `via: "perspicax-mcp"`. No row carries message text.
import type { IncomingMessage, ServerResponse } from "node:http";

import { can, permissionLabel, type PermissionKey, type PermissionPrincipal } from "../shared/permissions.ts";
import type { ConsoleAssertion } from "./oidc-rp.ts";
import { AssertionReplayCache } from "./org-admin-routes.ts";
import { compileRoutes, matchRoutes } from "./org-admin-console.ts";

export const ORG_MEMBER_PREFIX = "/api/org/member/";
/** The version `GET capabilities` reports. */
export const ORG_MEMBER_API_VERSION = 1;
export const MEMBER_WAIT_MAX_SECONDS = 120;
export const MEMBER_TEXT_MAX = 32_000;
export const MEMBER_THREAD_LIMIT_MAX = 200;
export const MEMBER_THREAD_LIMIT_DEFAULT = 50;
/** How often a wait looks at the thread. */
export const MEMBER_WAIT_POLL_MS = 400;
/** The longest reply text answered at once; the thread read has the rest. */
export const MEMBER_REPLY_MAX = 32_000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TOKEN_CHARS = 8_192;
const SEND_ID = /^[A-Za-z0-9_-]{8,80}$/;
const THREAD_ID = /^[\w-]{1,160}$/;

/** The acting person, once the assertion verified. */
export interface MemberPerson {
  principalId: string;
  /** The Perspicax user id. */
  sub: string;
  name: string;
  /** An organization admin (Perspicax role admin). */
  admin: boolean;
  /** The assertion's actor, for the audit row. */
  actor: ConsoleAssertion["actor"];
}

/** One Sagax route performed as the person. */
export interface MemberRequest {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

export interface MemberReply {
  status: number;
  body: unknown;
}

export type ThreadStatus = "idle" | "working" | "waiting";

export interface OrgMemberRouteDeps {
  identity: "solo" | "perspicax";
  issuer: string;
  publicOrigin(): string | null;
  linkServerId(): string | null;
  /** Throws on any failure; accepts the `console` and `perspicax-mcp` actors. */
  verify(token: string, audienceOrigin: string, serverId: string | null): Promise<ConsoleAssertion>;
  /** The person behind (issuer, sub): known, else null; `active` false when
   * Perspicax lists them out or Sagax turned them off. */
  personFor(iss: string, sub: string): { principalId: string; name: string; active: boolean; admin: boolean } | null;
  /** What the person holds (server/org-permissions.ts). */
  permissions(principalId: string): PermissionPrincipal;
  /** Perform one Sagax route as this person (a 60 s session of theirs). */
  perform(person: MemberPerson, request: MemberRequest): Promise<MemberReply>;
  /** The live state of a thread the person already reached through
   * `perform`: busy, waiting on a card, or idle. Null when gone. */
  threadStatus(threadId: string): ThreadStatus | null;
  /** A principal id from a principal id or a Perspicax user id. */
  resolvePerson(ref: string): string | null;
  /** One admin activity row, category `client`, actor the person. */
  record(person: MemberPerson, entry: { action: string; target: { kind: string; id?: string; name?: string }; after?: Record<string, unknown> }): void;
  version?(): string;
  now?(): number;
  sleep?(ms: number): Promise<void>;
}

interface Answer {
  status: number;
  body: unknown;
}

interface MemberContext {
  person: MemberPerson;
  params: Record<string, string>;
  url: URL;
  body: unknown;
}

interface MemberRoute {
  method: "GET" | "POST";
  path: string;
  /** The permission the route needs; none for capabilities. */
  permission?: PermissionKey;
  handle(ctx: MemberContext): Promise<Answer>;
}

const answer = (body: unknown, status = 200): Answer => ({ status, body });

/** A refusal: `{code, message, reason, error}` like the admin API. */
function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Answer {
  return { status, body: { code, message, reason: message, error: message, ...extra } };
}

/** A Sagax route's refusal, passed through: its status, its code when it
 * has one, its sentence and its permission when it names one. */
function passThrough(reply: MemberReply, fallback: string): Answer {
  const body = reply.body && typeof reply.body === "object" && !Array.isArray(reply.body) ? reply.body as Record<string, unknown> : {};
  const message = typeof body.message === "string" && body.message ? body.message : typeof body.error === "string" && body.error ? body.error : fallback;
  const permission = typeof body.permission === "string" ? body.permission : undefined;
  const code = permission ? "forbidden_permission" : typeof body.code === "string" ? body.code : reply.status === 404 ? "not_found" : reply.status === 403 ? "forbidden" : reply.status === 409 ? "conflict" : reply.status >= 500 ? "server_error" : "refused";
  const status = reply.status >= 400 && reply.status < 600 ? reply.status : 502;
  return fail(status, code, message.slice(0, 500), permission ? { permission } : {});
}

const okStatus = (reply: MemberReply) => reply.status >= 200 && reply.status < 300;

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "x-sagax-member-api": "1", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readSmallJson(req: IncomingMessage, max = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      bytes += chunk.length;
      if (bytes > max) {
        over = true;
        resolve(undefined);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (over) return;
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolve(null);
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", () => resolve(undefined));
  });
}

/** One message as an AI client reads it: text messages only, never a tool's
 * input or output. */
export interface MemberMessage {
  id: string;
  role: "user" | "bot";
  kind: string;
  text: string;
  at: number | null;
  sender: { name: string } | null;
}

export interface MemberApproval {
  id: string;
  threadId: string;
  title: string;
  subtitle: string;
  tool: string | null;
  options: string[];
}

interface ThreadRead {
  messages: MemberMessage[];
  steps: { count: number; recent: Array<{ tool: string; ok: boolean | null }> };
  approvals: MemberApproval[];
  cursor: string | null;
  /** The cursor was not in the page read: older messages may be missing. */
  gap: boolean;
}

/** Reads a Sagax message page (as the person saw it) after a cursor. */
export function readThreadPage(threadId: string, raw: unknown, since: string | null): ThreadRead {
  const list = Array.isArray(objectOf(raw)?.messages) ? (objectOf(raw)!.messages as unknown[]) : [];
  const all = list.map(objectOf).filter((m): m is Record<string, unknown> => Boolean(m) && typeof m!.id === "string");
  const index = since ? all.findIndex((m) => m.id === since) : -1;
  const after = since && index >= 0 ? all.slice(index + 1) : all;
  const messages: MemberMessage[] = [];
  const recent: Array<{ tool: string; ok: boolean | null }> = [];
  let count = 0;
  for (const m of after) {
    const kind = str(m.kind) ?? "text";
    if (kind === "activity") {
      count += 1;
      const tool = objectOf(m.tool);
      recent.push({ tool: str(tool?.name) ?? "tool", ok: typeof tool?.ok === "boolean" ? tool.ok : null });
      continue;
    }
    const text = str(m.text);
    if ((kind === "text" || kind === "nudge" || kind === "access") && text !== null && (m.role === "user" || m.role === "bot")) {
      const sender = objectOf(m.sender);
      messages.push({ id: m.id as string, role: m.role, kind, text, at: typeof m.at === "number" ? m.at : null, sender: str(sender?.name) ? { name: sender!.name as string } : null });
    }
  }
  // Pending cards are read from the whole page: a card raised before the
  // cursor may still wait.
  const approvals: MemberApproval[] = [];
  for (const m of all) {
    const card = objectOf(m.card);
    const requestId = str(card?.requestId);
    if (!card || !requestId || card.answered !== undefined || card.dismissed === true || card.expired === true) continue;
    approvals.push({
      id: requestId,
      threadId,
      title: str(card.title) ?? "",
      subtitle: str(card.subtitle) ?? "",
      tool: str(card.tool),
      options: Array.isArray(card.options) ? (card.options as unknown[]).filter((o): o is string => typeof o === "string") : [],
    });
  }
  const last = all.at(-1);
  return {
    messages,
    steps: { count, recent: recent.slice(-10) },
    approvals,
    cursor: typeof last?.id === "string" ? last.id : since,
    gap: Boolean(since) && index < 0,
  };
}

/** The bot's words after the person's message: every bot text that follows
 * it, joined, at most MEMBER_REPLY_MAX characters. */
export function replyAfter(messages: readonly MemberMessage[], userMessageId: string | null): string | null {
  const start = userMessageId ? messages.findIndex((m) => m.id === userMessageId) : -1;
  const after = start >= 0 ? messages.slice(start + 1) : userMessageId ? [] : messages;
  const texts = after.filter((m) => m.role === "bot" && m.kind === "text" && m.text.trim()).map((m) => m.text.trim());
  if (!texts.length) return null;
  const joined = texts.join("\n\n");
  return joined.length > MEMBER_REPLY_MAX ? `${joined.slice(0, MEMBER_REPLY_MAX)}\n[...]` : joined;
}

function botStatus(bot: Record<string, unknown> | undefined, archived: boolean): "idle" | "working" | "waiting" | "archived" {
  if (archived) return "archived";
  if (!bot) return "idle";
  if (bot.activity === "waiting-on-you") return "waiting";
  return bot.busy === true ? "working" : "idle";
}

/** The routes, in one table. */
function memberRoutes(deps: OrgMemberRouteDeps): MemberRoute[] {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const readThread = async (person: MemberPerson, threadId: string, since: string | null, limit: number): Promise<ThreadRead | Answer> => {
    const reply = await deps.perform(person, { method: "GET", path: `/api/threads/${encodeURIComponent(threadId)}/messages`, query: { limit: String(limit) } });
    if (!okStatus(reply)) return passThrough(reply, "This conversation cannot be read.");
    return readThreadPage(threadId, reply.body, since);
  };
  const isRead = (value: ThreadRead | Answer): value is ThreadRead => "messages" in value;

  const routes: MemberRoute[] = [
    {
      method: "GET", path: "capabilities",
      async handle() {
        return answer({ api: ORG_MEMBER_API_VERSION, version: deps.version?.() ?? "unknown", routes: routes.map((route) => `${route.method} ${route.path}`).sort() });
      },
    },
    {
      method: "GET", path: "bots", permission: "clients.botsRead",
      async handle({ person }) {
        const [listed, catalogue] = await Promise.all([
          deps.perform(person, { method: "GET", path: "/api/bots", query: { messages: "0" } }),
          deps.perform(person, { method: "GET", path: "/api/bot-catalog" }),
        ]);
        if (!okStatus(listed)) return passThrough(listed, "Your bots cannot be read.");
        const usable = new Map<string, Record<string, unknown>>();
        for (const raw of (objectOf(listed.body)?.bots as unknown[] | undefined) ?? []) {
          const bot = objectOf(raw);
          if (bot && typeof bot.id === "string") usable.set(bot.id, bot);
        }
        const entries = okStatus(catalogue) ? ((objectOf(catalogue.body)?.entries as unknown[] | undefined) ?? []).map(objectOf).filter((e): e is Record<string, unknown> => Boolean(e) && typeof e!.id === "string") : [];
        const seen = new Set<string>();
        const bots = entries.map((entry) => {
          const id = entry.id as string;
          seen.add(id);
          const bot = usable.get(id);
          const owner = objectOf(entry.owner);
          const ownerId = str(owner?.principalId) ?? "";
          return {
            id,
            name: str(entry.name) ?? str(bot?.name) ?? "",
            title: str(entry.title) ?? "",
            description: str(entry.description) ?? "",
            source: str(entry.source) ?? "shared",
            owner: { principalId: ownerId, sub: ownerId === person.principalId ? person.sub : null, name: str(owner?.name) ?? "" },
            status: botStatus(bot, entry.archived === true),
            canMessage: Boolean(bot) && entry.archived !== true,
            threadId: str(bot?.threadId),
          };
        });
        // A bot the person reaches that the catalogue does not list (a solo
        // server's own bots, a section bot): shared with them.
        for (const [id, bot] of usable) {
          if (seen.has(id)) continue;
          bots.push({ id, name: str(bot.name) ?? "", title: str(bot.title) ?? "", description: str(bot.description) ?? "", source: "shared",
            owner: { principalId: "", sub: null, name: "" }, status: botStatus(bot, false), canMessage: true, threadId: str(bot.threadId) });
        }
        bots.sort((a, b) => a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()) || a.id.localeCompare(b.id));
        return answer({ bots });
      },
    },
    {
      method: "POST", path: "bots/{id}/messages", permission: "clients.botsMessage",
      async handle({ person, params, body }) {
        const input = objectOf(body);
        if (!input) return fail(400, "bad_request", "Send { \"text\": \"...\" }.");
        const extra = Object.keys(input).filter((key) => !["text", "threadId", "newThread", "wait", "sendId"].includes(key));
        if (extra.length) return fail(400, "bad_request", `Unknown field: ${extra[0]}.`);
        const text = typeof input.text === "string" ? input.text.trim() : "";
        if (!text || text.length > MEMBER_TEXT_MAX) return fail(400, "bad_request", `text is 1 to ${MEMBER_TEXT_MAX} characters.`);
        if (input.threadId !== undefined && (typeof input.threadId !== "string" || !THREAD_ID.test(input.threadId))) return fail(400, "bad_request", "threadId is a thread id.");
        if (input.newThread !== undefined && typeof input.newThread !== "boolean") return fail(400, "bad_request", "newThread is true or false.");
        if (input.newThread === true && input.threadId !== undefined) return fail(400, "bad_request", "Send threadId or newThread, not both.");
        const wait = input.wait === undefined ? 0 : input.wait;
        if (typeof wait !== "number" || !Number.isFinite(wait) || wait < 0 || wait > MEMBER_WAIT_MAX_SECONDS) return fail(400, "bad_request", `wait is 0 to ${MEMBER_WAIT_MAX_SECONDS} seconds.`);
        if (input.sendId !== undefined && (typeof input.sendId !== "string" || !SEND_ID.test(input.sendId))) return fail(400, "bad_request", "sendId is 8 to 80 letters, digits, _ or -.");
        const botId = params.id!;
        let threadId = input.threadId as string | undefined;
        if (input.newThread === true) {
          const created = await deps.perform(person, { method: "POST", path: `/api/bots/${encodeURIComponent(botId)}/tasks`, body: {} });
          if (!okStatus(created)) return passThrough(created, "A new conversation could not be started.");
          threadId = str(objectOf(objectOf(created.body)?.task)?.threadId) ?? undefined;
          if (!threadId) return fail(502, "server_error", "The new conversation has no id.");
        }
        const sent = await deps.perform(person, {
          method: "POST",
          path: `/api/bots/${encodeURIComponent(botId)}/messages`,
          body: { text, ...(threadId ? { threadId } : {}), ...(input.sendId ? { sendId: input.sendId } : {}) },
        });
        if (!okStatus(sent)) return passThrough(sent, "The message could not be sent.");
        const receipt = objectOf(sent.body) ?? {};
        const finalThread = str(receipt.threadId) ?? threadId ?? null;
        const messageId = str(objectOf(receipt.message)?.id);
        deps.record(person, { action: "client.message", target: { kind: "bot", id: botId }, after: { threadId: finalThread, waited: wait > 0, ...(input.newThread ? { newThread: true } : {}) } });
        if (!finalThread) return answer({ botId, threadId: null, messageId, status: "working", pending: true, reply: null, approvals: [], cursor: null });
        const deadline = now() + wait * 1000;
        let status: ThreadStatus = deps.threadStatus(finalThread) ?? "idle";
        // A queued message has no id yet: its answer is whatever the bot
        // says after the person's newest line.
        // Done when the thread is idle and the bot answered after the
        // message, or idle three looks in a row (a turn that failed or said
        // nothing); a card stops the wait at once.
        let idleLooks = 0;
        while (wait > 0 && now() < deadline) {
          status = deps.threadStatus(finalThread) ?? "idle";
          if (status === "waiting") break;
          if (status === "idle") {
            idleLooks += 1;
            if (idleLooks >= 3) break;
            const read = await readThread(person, finalThread, null, MEMBER_THREAD_LIMIT_MAX);
            if (!isRead(read)) break;
            const anchor = messageId ?? read.messages.findLast((m) => m.role === "user")?.id ?? null;
            if (replyAfter(read.messages, anchor) !== null) break;
          } else {
            idleLooks = 0;
          }
          await sleep(Math.min(MEMBER_WAIT_POLL_MS, Math.max(0, deadline - now())));
        }
        status = deps.threadStatus(finalThread) ?? "idle";
        const read = await readThread(person, finalThread, null, MEMBER_THREAD_LIMIT_MAX);
        if (!isRead(read)) return answer({ botId, threadId: finalThread, messageId, status, pending: true, reply: null, approvals: [], cursor: null });
        const anchor = messageId ?? read.messages.findLast((m) => m.role === "user")?.id ?? null;
        const reply = status === "idle" ? replyAfter(read.messages, anchor) : null;
        // Idle after a wait is done even without words (a failed turn says
        // why in the thread); without a wait, only an answer is.
        const done = status === "idle" && (reply !== null || wait > 0);
        return answer({
          botId,
          threadId: finalThread,
          messageId,
          status: done ? "done" : status,
          pending: !done,
          reply,
          approvals: read.approvals,
          cursor: read.cursor,
        });
      },
    },
    {
      method: "GET", path: "threads/{id}", permission: "clients.botsRead",
      async handle({ person, params, url }) {
        const since = url.searchParams.get("since") || null;
        if (since !== null && !THREAD_ID.test(since)) return fail(400, "bad_request", "since is a message id.");
        const rawLimit = url.searchParams.get("limit");
        const limit = rawLimit === null || rawLimit === "" ? MEMBER_THREAD_LIMIT_DEFAULT : /^\d{1,4}$/.test(rawLimit) ? Number(rawLimit) : Number.NaN;
        if (!Number.isInteger(limit) || limit < 1 || limit > MEMBER_THREAD_LIMIT_MAX) return fail(400, "bad_request", `limit is 1 to ${MEMBER_THREAD_LIMIT_MAX}.`);
        const threadId = params.id!;
        // Read a full page so the cursor is found, then cut to the limit.
        const read = await readThread(person, threadId, since, MEMBER_THREAD_LIMIT_MAX);
        if (!isRead(read)) return read;
        const messages = read.messages.slice(-limit);
        return answer({
          threadId,
          status: deps.threadStatus(threadId) ?? "idle",
          messages,
          steps: read.steps,
          approvals: read.approvals,
          cursor: read.cursor,
          ...(read.gap ? { gap: true } : {}),
        });
      },
    },
    {
      method: "POST", path: "routines/{id}/run", permission: "clients.routinesRun",
      async handle({ person, params }) {
        const reply = await deps.perform(person, { method: "POST", path: `/api/routines/${encodeURIComponent(params.id!)}/run`, body: {} });
        if (!okStatus(reply)) return passThrough(reply, "The routine could not be run.");
        const run = wireRun(objectOf(objectOf(reply.body)?.run));
        deps.record(person, { action: "client.routine_run", target: { kind: "routine", id: params.id! }, after: { runId: run?.id ?? null } });
        return answer({ run }, 201);
      },
    },
    {
      method: "GET", path: "routines/runs/{id}", permission: "clients.routinesRun",
      async handle({ person, params }) {
        const reply = await deps.perform(person, { method: "GET", path: "/api/routines" });
        if (!okStatus(reply)) return passThrough(reply, "Routines cannot be read.");
        const runs = (objectOf(reply.body)?.runs as unknown[] | undefined) ?? [];
        const found = runs.map(objectOf).find((run) => run?.id === params.id);
        if (!found) return fail(404, "not_found", "No such run.");
        return answer({ run: wireRun(found, true) });
      },
    },
    {
      method: "POST", path: "approvals/{id}", permission: "clients.approvalsAnswer",
      async handle({ person, params, body }) {
        const input = objectOf(body);
        const decision = input?.decision;
        const threadId = input?.threadId;
        if (!input || Object.keys(input).some((key) => key !== "decision" && key !== "threadId") || (decision !== "allow" && decision !== "deny") || typeof threadId !== "string" || !THREAD_ID.test(threadId)) {
          return fail(400, "bad_request", "Send { \"threadId\": \"...\", \"decision\": \"allow\" } or \"deny\".");
        }
        const reply = await deps.perform(person, { method: "POST", path: `/api/threads/${encodeURIComponent(threadId)}/respond`, body: { requestId: params.id!, behavior: decision } });
        if (!okStatus(reply)) return passThrough(reply, "This card cannot be answered.");
        deps.record(person, { action: "client.approval", target: { kind: "thread", id: threadId }, after: { requestId: params.id!, decision } });
        return answer({ answered: true, decision });
      },
    },
    {
      method: "POST", path: "people/{id}/nudge", permission: "clients.peopleNudge",
      async handle({ person, params }) {
        const principalId = deps.resolvePerson(params.id!);
        if (!principalId) return fail(404, "not_found", "No such person.");
        const reply = await deps.perform(person, { method: "POST", path: "/api/nudges", body: { principalId } });
        if (!okStatus(reply)) return passThrough(reply, "This person cannot be nudged.");
        const result = objectOf(reply.body) ?? {};
        deps.record(person, { action: "client.nudge", target: { kind: "person", id: principalId } });
        return answer({ ok: true, id: str(result.id), at: typeof result.at === "number" ? result.at : null });
      },
    },
  ];
  return routes;
}

/** A run as an AI client reads it; `detail` adds the output and the error. */
function wireRun(run: Record<string, unknown> | null | undefined, detail = false) {
  if (!run || typeof run.id !== "string") return null;
  const cut = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : null);
  return {
    id: run.id,
    routineId: str(run.routineId),
    routineName: str(run.routineName),
    botId: str(run.botId),
    status: str(run.status),
    threadId: str(run.threadId) ?? str(run.resultsThreadId) ?? str(run.executionThreadId),
    startedAt: typeof run.startedAt === "number" ? run.startedAt : null,
    endedAt: typeof run.finishedAt === "number" ? run.finishedAt : null,
    ...(detail ? { attention: cut(run.attention, 500), error: cut(run.error, 500), output: cut(run.output, MEMBER_REPLY_MAX) } : {}),
  };
}

/** The handler: true when the request was one of ours (answered). */
export function createOrgMemberRoutes(deps: OrgMemberRouteDeps): (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean> {
  const replay = new AssertionReplayCache();
  const now = deps.now ?? Date.now;
  const compiled = compileRoutes(memberRoutes(deps).map((route) => ({ method: route.method, path: route.path, min: "employee" as const, handle: () => ({ status: 500, body: null }), member: route })));
  return async (req, res, url) => {
    const path = url.pathname;
    if (path !== "/api/org/member" && !path.startsWith(ORG_MEMBER_PREFIX)) return false;
    const refuse = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => {
      send(res, status, { code, message, reason: message, error: message, ...extra });
      return true;
    };
    const method = req.method ?? "GET";
    if (deps.identity !== "perspicax") return refuse(403, "identity_perspicax", "This server does not sign people in with Pulsatrix.");
    const header = req.headers.authorization;
    const bearer = typeof header === "string" ? /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1] : undefined;
    if (!bearer) return refuse(401, "assertion_missing", "A Perspicax assertion is required.");
    const audience = deps.publicOrigin();
    if (!audience || bearer.length > MAX_TOKEN_CHARS) {
      return refuse(401, "assertion_invalid", audience ? "The assertion is too long." : "This server has no public address to check the assertion against.");
    }
    let assertion: ConsoleAssertion;
    try {
      assertion = await deps.verify(bearer, audience, deps.linkServerId());
    } catch (error) {
      return refuse(401, "assertion_invalid", (error instanceof Error ? error.message : "The assertion does not verify.").slice(0, 300));
    }
    if (!replay.admit(assertion.jti, assertion.exp * 1000, now())) return refuse(401, "assertion_replayed", "This assertion was already used.");
    const found = deps.personFor(deps.issuer, assertion.sub);
    if (!found) return refuse(403, "unknown_person", "This person is not in this server's directory yet.");
    if (!found.active) return refuse(403, "person_disabled", "This person is turned off in Perspicax or on this server.");
    const person: MemberPerson = {
      principalId: found.principalId,
      sub: assertion.sub,
      name: found.name,
      // Both must say admin: the assertion is fresh, the principal is ours.
      admin: found.admin && assertion.role === "admin",
      actor: assertion.actor,
    };
    const sub = path.startsWith(ORG_MEMBER_PREFIX) ? path.slice(ORG_MEMBER_PREFIX.length) : "";
    const hits = matchRoutes(compiled, sub);
    if (!hits.length) return refuse(404, "not_found", "No such member route.");
    const hit = hits.find((candidate) => candidate.route.method === method);
    if (!hit) {
      const allowed = [...new Set(hits.map((candidate) => candidate.route.method))].join(", ");
      res.setHeader("allow", allowed);
      return refuse(405, "method_not_allowed", `Use ${allowed} here.`);
    }
    const route = (hit.route as unknown as { member: MemberRoute }).member;
    if (route.permission && !can(person.admin ? { admin: true, permissions: [] } : deps.permissions(person.principalId), route.permission)) {
      return refuse(403, "forbidden_permission", `Your profile does not include ${permissionLabel(route.permission, typeof assertion.locale === "string" ? assertion.locale : "en")}. Ask an admin to add it in Perspicax.`, { permission: route.permission });
    }
    let body: unknown = null;
    if (method === "POST") {
      const declared = Number(req.headers["content-length"] ?? 0);
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return refuse(413, "too_large", `The body is larger than ${MAX_BODY_BYTES} bytes.`);
      body = await readSmallJson(req);
      if (body === undefined) return refuse(400, "bad_request", `The body is not JSON, or larger than ${MAX_BODY_BYTES} bytes.`);
    }
    try {
      const reply = await route.handle({ person, params: hit.params, url, body });
      send(res, reply.status, reply.body);
    } catch (error) {
      console.error(`[org-member] ${method} ${sub}: ${error instanceof Error ? error.message : String(error)}`);
      refuse(500, "server_error", "The server could not do this; its log has the details.");
    }
    return true;
  };
}
