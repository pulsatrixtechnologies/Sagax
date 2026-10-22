// The phone tools broker (shared/phone-tools.ts, audit row 81): which
// phones of a person can do what, the requests waiting on them, the
// answers waiting for the turn that asked, and the "Toujours permettre"
// grants.
//
// - A phone says what it can do (registerDevice) each time its stream opens
//   and while the app is open. A tool is offered to a bot only while a phone
//   of that person registered it recently (PHONE_ONLINE_MS), or for a day
//   when the server can wake it with a push.
// - A request belongs to one person, one bot and one conversation. Only a
//   registered phone of that person answers it; only that bot in that
//   conversation reads the answer, once.
// - Results live in memory until read or expired. Nothing about them is
//   written anywhere: the audit row names the tool and the decision, never
//   the data. Grants are the one thing on disk (<data>/phone-tools/grants.json).
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import {
  checkPhoneToolResult,
  PHONE_TOOL_REQUEST_TTL_MS,
  PHONE_TOOLS,
  phoneToolAccess,
  phoneToolGrantKey,
  type PhoneToolAccess,
  type PhoneToolDecision,
  type PhoneToolId,
  type PhoneToolRequestWire,
} from "../shared/phone-tools.ts";

/** A phone that registered within this long is "around". */
export const PHONE_ONLINE_MS = 15 * 60_000;
/** A phone the server can push to stays reachable this long after it last registered. */
export const PHONE_PUSHABLE_MS = 24 * 60 * 60_000;
/** Requests one person may have waiting at once. */
export const MAX_PENDING_PER_PERSON = 5;

export interface PhoneToolAuditRow {
  person: string;
  botId: string;
  threadId: string;
  tool: PhoneToolId;
  access: PhoneToolAccess;
  /** requested, or what the phone decided, or expired */
  outcome: "requested" | PhoneToolDecision | "expired";
}

export interface PhoneToolBrokerDeps {
  dataDir: string;
  now?: () => number;
  /** The person's phones should fetch their requests (a live frame). */
  notify(person: string): void;
  /** Wake the person's phones for this request (APNs). */
  push?(person: string, request: PhoneToolRequestWire): void;
  /** The server can push to this person's phones. */
  pushable?(person: string): boolean;
  audit?(row: PhoneToolAuditRow): void;
  ttlMs?: number;
}

export type PhoneToolOutcome =
  | { status: "done"; tool: PhoneToolId; result: Record<string, unknown> }
  | { status: "denied" }
  | { status: "failed"; error: string }
  | { status: "expired" }
  | { status: "pending"; requestId: string }
  | { status: "unknown" };

export type PhoneAnswer = { decision: PhoneToolDecision; result?: unknown; error?: string };
export type PhoneAnswerOutcome = { ok: true } | { ok: false; status: 400 | 403 | 404 | 410; error: string };

interface Device {
  deviceName: string;
  tools: PhoneToolId[];
  seenAt: number;
}

interface PendingRequest {
  wire: PhoneToolRequestWire;
  person: string;
  grantKey: string | null;
  outcome?: Exclude<PhoneToolOutcome, { status: "pending" } | { status: "unknown" }>;
  waiters: Array<(outcome: PhoneToolOutcome) => void>;
}

const grantsFile = z.object({
  version: z.literal(1),
  people: z.record(z.string(), z.record(z.string(), z.array(z.string()))),
});

export interface PhoneToolBroker {
  registerDevice(person: string, deviceId: string, device: { deviceName: string; tools: readonly PhoneToolId[] }): void;
  /** The tools this person's phones can run right now, sorted. */
  availableTools(person: string): PhoneToolId[];
  /** A registered phone of this person (the answer route checks it). */
  hasDevice(person: string, deviceId: string): boolean;
  request(input: { person: string; botId: string; botName: string; threadId: string; tool: PhoneToolId; args: Record<string, unknown> }): PhoneToolRequestWire;
  /** Wait up to `ms` for the answer of a request this bot made in this conversation. */
  wait(requestId: string, owner: { botId: string; threadId: string }, ms: number): Promise<PhoneToolOutcome>;
  pendingFor(person: string): PhoneToolRequestWire[];
  answer(person: string, deviceId: string, requestId: string, answer: PhoneAnswer): PhoneAnswerOutcome;
  grants(person: string): Array<{ botId: string; key: string }>;
  revokeGrant(person: string, botId: string, key: string): boolean;
}

export class PhoneToolUnavailable extends Error {
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = "PhoneToolUnavailable";
    this.status = status;
  }
}

const personKey = (person: string) => person.trim().toLowerCase();

export function createPhoneToolBroker(deps: PhoneToolBrokerDeps): PhoneToolBroker {
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? PHONE_TOOL_REQUEST_TTL_MS;
  const devices = new Map<string, Map<string, Device>>();
  const requests = new Map<string, PendingRequest>();
  const dir = join(deps.dataDir, "phone-tools");
  const file = join(dir, "grants.json");
  let grantsByPerson: Map<string, Map<string, Set<string>>> | null = null;

  const loadGrants = () => {
    if (grantsByPerson) return grantsByPerson;
    grantsByPerson = new Map();
    if (!existsSync(file)) return grantsByPerson;
    try {
      const parsed = grantsFile.parse(JSON.parse(readFileSync(file, "utf8")));
      for (const [person, bots] of Object.entries(parsed.people)) {
        const byBot = new Map<string, Set<string>>();
        for (const [botId, keys] of Object.entries(bots)) if (keys.length) byBot.set(botId, new Set(keys));
        if (byBot.size) grantsByPerson.set(person, byBot);
      }
    } catch (error) {
      // a damaged file costs its grants: every request asks again
      console.warn(`phone tools: grants.json could not be read (${error instanceof Error ? error.message : String(error)}); every request asks again`);
    }
    return grantsByPerson;
  };

  const saveGrants = () => {
    const people: Record<string, Record<string, string[]>> = {};
    for (const [person, bots] of loadGrants()) {
      const row: Record<string, string[]> = {};
      for (const [botId, keys] of bots) if (keys.size) row[botId] = [...keys].sort();
      if (Object.keys(row).length) people[person] = row;
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileAtomic(file, `${JSON.stringify({ version: 1, people }, null, 2)}\n`, { mode: 0o600 });
  };

  const granted = (person: string, botId: string, key: string | null) =>
    key !== null && loadGrants().get(person)?.get(botId)?.has(key) === true;

  const audit = (request: PendingRequest, outcome: PhoneToolAuditRow["outcome"]) => {
    try {
      deps.audit?.({ person: request.person, botId: request.wire.botId, threadId: request.wire.threadId, tool: request.wire.tool, access: request.wire.access, outcome });
    } catch {
      /* an audit line never fails the request */
    }
  };

  const settle = (request: PendingRequest, outcome: NonNullable<PendingRequest["outcome"]>) => {
    request.outcome = outcome;
    for (const waiter of request.waiters.splice(0)) waiter(outcome);
  };

  /** Expire what waited too long; forget what nobody came back for. */
  const sweep = () => {
    const at = now();
    for (const [id, request] of requests) {
      if (at < request.wire.expiresAt) continue;
      if (!request.outcome) {
        audit(request, "expired");
        settle(request, { status: "expired" });
        deps.notify(request.person);
      }
      // a settled answer nobody read is dropped with the request
      if (at >= request.wire.expiresAt + ttlMs || request.outcome?.status !== "expired") requests.delete(id);
    }
  };

  const reachable = (person: string, device: Device) => {
    const age = now() - device.seenAt;
    if (age <= PHONE_ONLINE_MS) return true;
    return age <= PHONE_PUSHABLE_MS && deps.pushable?.(person) === true;
  };

  return {
    registerDevice(person, deviceId, device) {
      const who = personKey(person);
      if (!who || !deviceId) return;
      const mine = devices.get(who) ?? new Map<string, Device>();
      const tools = PHONE_TOOLS.filter((tool) => device.tools.includes(tool));
      if (!tools.length) mine.delete(deviceId);
      else mine.set(deviceId, { deviceName: device.deviceName.slice(0, 80), tools, seenAt: now() });
      if (mine.size) devices.set(who, mine);
      else devices.delete(who);
    },

    availableTools(person) {
      const who = personKey(person);
      const tools = new Set<PhoneToolId>();
      for (const device of devices.get(who)?.values() ?? []) {
        if (!reachable(who, device)) continue;
        for (const tool of device.tools) tools.add(tool);
      }
      return [...tools].sort();
    },

    hasDevice(person, deviceId) {
      return devices.get(personKey(person))?.has(deviceId) === true;
    },

    request(input) {
      sweep();
      const person = personKey(input.person);
      if (!this.availableTools(person).includes(input.tool)) {
        throw new PhoneToolUnavailable("No phone of this person can do that right now. Ask them to open Sagax on their iPhone, then try again.");
      }
      const waiting = [...requests.values()].filter((row) => row.person === person && !row.outcome).length;
      if (waiting >= MAX_PENDING_PER_PERSON) {
        throw new PhoneToolUnavailable("Too many requests are already waiting on this person's phone. Wait for them to answer first.", 429);
      }
      const grantKey = phoneToolGrantKey(input.tool, input.args);
      const createdAt = now();
      const wire: PhoneToolRequestWire = {
        id: randomUUID(),
        tool: input.tool,
        args: input.args,
        access: phoneToolAccess(input.tool, input.args),
        botId: input.botId,
        botName: input.botName,
        threadId: input.threadId,
        allowAlways: grantKey !== null,
        preApproved: granted(person, input.botId, grantKey),
        createdAt,
        expiresAt: createdAt + ttlMs,
      };
      const pending: PendingRequest = { wire, person, grantKey, waiters: [] };
      requests.set(wire.id, pending);
      audit(pending, "requested");
      deps.notify(person);
      try {
        deps.push?.(person, wire);
      } catch {
        /* the live frame still reaches an open app */
      }
      return { ...wire };
    },

    async wait(requestId, owner, ms) {
      sweep();
      const request = requests.get(requestId);
      if (!request || request.wire.botId !== owner.botId || request.wire.threadId !== owner.threadId) return { status: "unknown" };
      const take = (outcome: PhoneToolOutcome): PhoneToolOutcome => {
        // read once: the answer leaves the server with this turn (an expired
        // request stays a while, so a late phone hears it expired)
        if (outcome.status !== "pending" && outcome.status !== "expired") requests.delete(requestId);
        return outcome;
      };
      if (request.outcome) return take(request.outcome);
      const outcome = await new Promise<PhoneToolOutcome>((resolve) => {
        let done = false;
        const finish = (value: PhoneToolOutcome) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const index = request.waiters.indexOf(finish);
          if (index >= 0) request.waiters.splice(index, 1);
          resolve(value);
        };
        const remaining = Math.max(0, request.wire.expiresAt - now());
        const timer = setTimeout(() => {
          sweep();
          finish(request.outcome ?? { status: "pending", requestId });
        }, Math.min(ms, remaining + 1));
        timer.unref?.();
        request.waiters.push(finish);
      });
      return take(outcome);
    },

    pendingFor(person) {
      sweep();
      const who = personKey(person);
      return [...requests.values()]
        .filter((row) => row.person === who && !row.outcome)
        .sort((a, b) => a.wire.createdAt - b.wire.createdAt)
        .map((row) => ({ ...row.wire, preApproved: granted(who, row.wire.botId, row.grantKey) }));
    },

    answer(person, deviceId, requestId, answer) {
      sweep();
      const who = personKey(person);
      const request = requests.get(requestId);
      if (!request || request.person !== who) return { ok: false, status: 404, error: "No such request on this phone." };
      if (!this.hasDevice(who, deviceId)) return { ok: false, status: 403, error: "Only a phone that offers its tools can answer." };
      if (request.outcome) {
        return request.outcome.status === "expired"
          ? { ok: false, status: 410, error: "This request expired." }
          : { ok: false, status: 404, error: "This request was already answered." };
      }
      if (answer.decision === "always" && request.grantKey === null) {
        return { ok: false, status: 400, error: "Toujours permettre is not offered for this tool." };
      }
      if (answer.decision === "deny") {
        audit(request, "deny");
        settle(request, { status: "denied" });
        deps.notify(who);
        return { ok: true };
      }
      if (answer.decision === "always" && request.grantKey) {
        const bots = loadGrants().get(who) ?? new Map<string, Set<string>>();
        const keys = bots.get(request.wire.botId) ?? new Set<string>();
        keys.add(request.grantKey);
        bots.set(request.wire.botId, keys);
        loadGrants().set(who, bots);
        saveGrants();
      }
      audit(request, answer.decision);
      deps.notify(who);
      if (answer.error !== undefined && answer.result === undefined) {
        settle(request, { status: "failed", error: answer.error });
        return { ok: true };
      }
      const checked = checkPhoneToolResult(request.wire.tool, request.wire.args, answer.result);
      if (!checked.ok) {
        settle(request, { status: "failed", error: checked.error });
        return { ok: false, status: 400, error: checked.error };
      }
      settle(request, { status: "done", tool: request.wire.tool, result: checked.result });
      return { ok: true };
    },

    grants(person) {
      const rows: Array<{ botId: string; key: string }> = [];
      for (const [botId, keys] of loadGrants().get(personKey(person)) ?? []) {
        for (const key of [...keys].sort()) rows.push({ botId, key });
      }
      return rows;
    },

    revokeGrant(person, botId, key) {
      const who = personKey(person);
      const keys = loadGrants().get(who)?.get(botId);
      if (!keys?.delete(key)) return false;
      if (!keys.size) loadGrants().get(who)?.delete(botId);
      if (!loadGrants().get(who)?.size) loadGrants().delete(who);
      saveGrants();
      return true;
    },
  };
}

/** Whose phone a turn may use, or why not. Owner-only (JC 2026-10-21):
 * the person speaking in their own 1:1 conversation with a bot they own,
 * in a turn they started. Never a room, never another member's bot, never
 * a routine or a bot asking a bot (nobody is there to hold the phone). */
export function phoneToolTurn(input: {
  ownsThread: boolean;
  inRoom: boolean;
  depth: number;
  speakerOrigin?: "person" | "operator" | "owner-routine" | "peer";
  speakerPrincipal?: string;
  ownerPrincipal: string;
}): { person: string } | { error: string } {
  if (!input.ownsThread) return { error: "source conversation does not belong to sender" };
  if (input.inRoom) return { error: "A phone tool is used in a direct conversation with the bot's owner, not in a room." };
  if (input.depth > 0 || (input.speakerOrigin !== "person" && input.speakerOrigin !== "operator")) {
    return { error: "Only the person's own message can use their phone: not a routine, a webhook or another bot." };
  }
  const person = (input.speakerPrincipal ?? "").trim().toLowerCase();
  const owner = input.ownerPrincipal.trim().toLowerCase();
  if (!person || person !== owner) return { error: "Only the bot's owner can use their own phone through it." };
  return { person };
}
