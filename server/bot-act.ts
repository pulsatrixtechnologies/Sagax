// Holds a bot's write until the signed-in person allows it, then performs
// that action as them. The pending body stays in memory. The card stores
// only the request id.

import type { ActTarget, TurnFacts } from "../shared/bot-act.ts";
import { actorForTurn, decideBotAct, summaryOf } from "../shared/bot-act.ts";

const PENDING_CAP = 32;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export type PerformActor =
  | { kind: "person"; sessionId: string; personKey: string; scopes: Array<"admin" | "client"> }
  | { kind: "operator" };

export type BotActAnswerer =
  | { kind: "session"; personKey: string; sessionId: string; scopes: readonly string[]; admin: boolean }
  | { kind: "operator" }
  | { kind: "service" };

export type BotActResult = { status: number; body: Record<string, unknown> };

type LiveSession = { id: string; scopes: Array<"admin" | "client"> };

type CardState = { messageId: string; answered?: string; dismissed?: boolean; expired?: boolean };

type Pending = {
  requestId: string;
  threadId: string;
  messageId: string;
  actorKey: string;
  actor: PerformActor;
  audience: string;
  target: ActTarget;
  createdAt: number;
  running: boolean;
};

export type BotActDeps = {
  now: () => number;
  newId: () => string;
  neededScope: (method: string, path: string) => "admin" | "client";
  operatorAudience: () => string;
  sessionForPerson: (personKey: string) => LiveSession | null;
  performRoute: (actor: PerformActor, target: Extract<ActTarget, { kind: "route" }>) => Promise<{ status: number; text: string }>;
  broadcastUi: (audience: string, command: string, input: Record<string, unknown>) => void;
  postCard: (input: { threadId: string; botId: string; botName: string; botColor: string; requestId: string; summary: string }) => { messageId: string };
  patchCard: (threadId: string, messageId: string, patch: { answered?: "allow" | "deny"; expired?: true }) => void;
  findCard: (threadId: string, requestId: string) => CardState | null;
};

const NONE_REASON: Record<string, string> = {
  automation: "A routine or a webhook cannot act as a person.",
  guest: "A guest turn cannot act as a person.",
  unproven: "This turn is not tied to a signed-in person.",
  stale: "This turn's sender was not proven.",
  shared: "This server has no owner to act as.",
};

export type BotActService = {
  handle(input: {
    facts: TurnFacts;
    raw: unknown;
    threadId: string;
    botId: string;
    botName: string;
    botColor: string;
    mode: "ask" | "edits" | "auto" | "full" | "custom" | undefined;
  }): Promise<BotActResult>;
  confirm(input: {
    threadId: string;
    requestId: string;
    behavior: string;
    answerer: BotActAnswerer;
    sharedServer: boolean;
  }): Promise<{ handled: false } | { handled: true; status: number; body: Record<string, unknown> }>;
};

export function createBotActService(deps: BotActDeps): BotActService {
  const pending = new Map<string, Pending>();

  const sweep = () => {
    const now = deps.now();
    for (const [id, item] of pending) {
      if (item.createdAt + PENDING_TTL_MS > now) continue;
      pending.delete(id);
      deps.patchCard(item.threadId, item.messageId, { expired: true });
    }
  };

  const refuse = (status: number, error: string): BotActResult => ({ status, body: { error } });

  return {
    async handle(input) {
      sweep();
      const actor = actorForTurn(input.facts);
      if (actor.kind === "none") return refuse(403, NONE_REASON[actor.reason] ?? "This turn cannot act.");
      let performActor: PerformActor;
      let scopes: string[];
      if (actor.kind === "person") {
        const session = deps.sessionForPerson(actor.personKey);
        if (!session) return refuse(403, "This person's session is no longer valid.");
        performActor = { kind: "person", sessionId: session.id, personKey: actor.personKey, scopes: session.scopes };
        scopes = session.scopes;
      } else {
        performActor = { kind: "operator" };
        scopes = ["admin", "client"];
      }
      const decision = decideBotAct({ raw: input.raw, mode: input.mode, scopes, neededScope: deps.neededScope });
      if (!decision.ok) return refuse(decision.status, decision.error);
      if (decision.effect === "run") return run(performActor, decision.target);
      const actorKey = performActor.kind === "person" ? `person:${performActor.personKey}` : "operator";
      let waiting = 0;
      for (const item of pending.values()) if (item.actorKey === actorKey) waiting += 1;
      if (waiting >= PENDING_CAP) return refuse(429, "Too many actions are waiting for approval.");
      const requestId = deps.newId();
      const posted = deps.postCard({
        threadId: input.threadId,
        botId: input.botId,
        botName: input.botName,
        botColor: input.botColor,
        requestId,
        summary: decision.summary,
      });
      pending.set(requestId, {
        requestId,
        threadId: input.threadId,
        messageId: posted.messageId,
        actorKey,
        actor: performActor,
        audience: performActor.kind === "person" ? performActor.personKey : deps.operatorAudience(),
        target: decision.target,
        createdAt: deps.now(),
        running: false,
      });
      return {
        status: 200,
        body: { held: true, text: `Approval needed. ${decision.summary} A card is waiting in the conversation. Do not retry this action.` },
      };
    },

    async confirm(input) {
      sweep();
      const card = deps.findCard(input.threadId, input.requestId);
      if (!card) return { handled: false };
      if (card.answered || card.dismissed || card.expired) {
        pending.delete(input.requestId);
        return { handled: true, status: 409, body: { error: "This approval is already settled." } };
      }
      const item = pending.get(input.requestId);
      if (!item || item.threadId !== input.threadId) {
        if (card.messageId) deps.patchCard(input.threadId, card.messageId, { expired: true });
        return { handled: true, status: 409, body: { error: "This approval expired." } };
      }
      if (deps.now() >= item.createdAt + PENDING_TTL_MS) {
        pending.delete(item.requestId);
        deps.patchCard(item.threadId, item.messageId, { expired: true });
        return { handled: true, status: 409, body: { error: "This approval expired." } };
      }
      if (item.running) return { handled: true, status: 409, body: { error: "This approval is already running." } };
      if (input.behavior === "deny") {
        pending.delete(item.requestId);
        deps.patchCard(item.threadId, item.messageId, { answered: "deny" });
        return { handled: true, status: 200, body: { ok: true, outcome: "rejected" } };
      }
      if (input.behavior !== "allow") return { handled: true, status: 400, body: { error: "behavior must be allow or deny." } };
      const replay = replayActor(item, input.answerer, input.sharedServer, deps.neededScope);
      if ("error" in replay) return { handled: true, status: replay.status, body: { error: replay.error } };
      item.running = true;
      try {
        const result = await run(replay, item.target, item.audience);
        if (result.status >= 400) {
          item.running = false;
          const error = typeof result.body.error === "string" ? result.body.error : "The action was refused.";
          return { handled: true, status: result.status, body: { error } };
        }
        pending.delete(item.requestId);
        deps.patchCard(item.threadId, item.messageId, { answered: "allow" });
        return { handled: true, status: 200, body: { ok: true, outcome: "allowed-once" } };
      } catch {
        item.running = false;
        return { handled: true, status: 502, body: { error: "The action could not be completed." } };
      }
    },
  };

  async function run(actor: PerformActor, target: ActTarget, audience?: string): Promise<BotActResult> {
    if (target.kind === "ui") {
      deps.broadcastUi(audience ?? (actor.kind === "person" ? actor.personKey : deps.operatorAudience()), target.command, target.input);
      return { status: 200, body: { text: "Done.", status: 200 } };
    }
    try {
      const performed = await deps.performRoute(actor, target);
      const text = performed.text.trim() ? performed.text.slice(0, 8000) : performed.status < 400 ? "Done." : "The action was refused.";
      if (performed.status >= 400) return { status: performed.status, body: { error: text, text, status: performed.status } };
      return { status: performed.status, body: { text, status: performed.status } };
    } catch {
      return { status: 502, body: { error: "The action could not be completed." } };
    }
  }
}

function replayActor(
  item: Pending,
  answerer: BotActAnswerer,
  sharedServer: boolean,
  neededScope: (method: string, path: string) => "admin" | "client",
): PerformActor | { error: string; status: 403 } {
  const routeScopeOk = (scopes: readonly string[]) => {
    if (item.target.kind !== "route") return true;
    return scopes.includes(neededScope(item.target.method, item.target.path));
  };
  if (item.actor.kind === "person") {
    if (answerer.kind !== "session" || answerer.personKey !== item.actor.personKey) {
      return { error: "Only that person can allow this.", status: 403 };
    }
    if (!routeScopeOk(answerer.scopes)) return { error: "This session cannot call that route.", status: 403 };
    return { kind: "person", sessionId: answerer.sessionId, personKey: answerer.personKey, scopes: answerer.scopes.filter((scope): scope is "admin" | "client" => scope === "admin" || scope === "client") };
  }
  if (sharedServer) return { error: "This server has no owner to act as.", status: 403 };
  if (answerer.kind === "service") return { error: "A service cannot allow this.", status: 403 };
  if (answerer.kind === "operator") return { kind: "operator" };
  if (answerer.kind === "session" && answerer.admin) {
    if (!routeScopeOk(answerer.scopes)) return { error: "This session cannot call that route.", status: 403 };
    return { kind: "person", sessionId: answerer.sessionId, personKey: answerer.personKey, scopes: answerer.scopes.filter((scope): scope is "admin" | "client" => scope === "admin" || scope === "client") };
  }
  return { error: "Only the owner can allow this.", status: 403 };
}

export { summaryOf };
