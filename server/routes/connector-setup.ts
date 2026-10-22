// "Connect Microsoft Teams" from the chat (shared/connector-setup.ts).
//
// Bot route (INTERNAL_ROUTES, behind the turn's capability):
//   POST /api/internal/connector-setup/open    open_connector_setup: post the card,
//        or tell the agents server to show Sagax's own connection card (Composio)
// Person route (ROUTES), for the person the card is for only:
//   POST /api/connector-setup/:id/check        "J'ai terminé" or back from the browser:
//        the card says "Connecté" only on evidence
//
// No token passes through here: the sign-in happens on grok.com or
// claude.ai in the person's own browser.
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import {
  chooseConnectorSetupRoute,
  claudeInventoryShowsConnected,
  connectorSetupEvidence,
  connectorSetupText,
  isConnectorSetupUrl,
  resolveConnectorSetupTarget,
  type ConnectorSetupView,
} from "../../shared/connector-setup.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS, type RouteHandler } from "./table.ts";

const CHECK = /^\/api\/connector-setup\/(cs_[a-f0-9]{18})\/check$/;

/** The person a card is for, as an opaque digest: the card is stored and
 * sent with the message, the person's id never is. */
export function connectorSetupOwner(principalId: string): string {
  return createHash("sha256").update(`connector-setup\0${principalId.trim().toLowerCase()}`).digest("hex").slice(0, 16);
}

export interface ConnectorSetupContext {
  engine: "grok" | "claude" | "other";
  /** server/harness-connectors.ts accountConnectorsForTurn */
  account: "own" | "foreign" | "none";
  /** Sagax's Connect apps (Composio) are on for this bot */
  composio: boolean;
}

interface Shared {
  /** The setup cards of a conversation. */
  cards(threadId: string): Array<{ messageId: string; view: ConnectorSetupView }>;
  /** The conversation's rows, for evidence (tool calls after the card). */
  messages(threadId: string): ReadonlyArray<{ kind?: string; at?: number; tool?: { name?: string; ok?: boolean; input?: string } }>;
  patch(threadId: string, messageId: string, view: ConnectorSetupView): void;
  now?(): number;
}

const openBody = z.object({
  connector: z.string().trim().min(1).max(120),
  via: z.enum(["grok", "claude", "composio"]).optional(),
  language: z.enum(["fr", "en"]).optional(),
}).strict();

const REFUSALS = {
  foreign: "This bot's engine runs on an account that is not the person's own (the bot owner's or another person's sign-in), so its connectors are not theirs to connect here. Say so in one sentence; they can use a bot on their own engine account.",
  not_on_engine: "That connector is not one of Grok's cloud connectors and Sagax's Connect apps are off for this bot. Say so in one sentence.",
  no_route: "This bot's engine brings no connectors of the person's own account, and Sagax's Connect apps cannot connect that app here. Say so in one sentence; a bot on Claude or Grok (organization server) can connect it.",
} as const;

function check(view: ConnectorSetupView, messages: ReturnType<Shared["messages"]>, claude: Array<{ name: string; status: string }> | null, now: number): ConnectorSetupView {
  const target = resolveConnectorSetupTarget(view.label);
  const evidence = connectorSetupEvidence(messages, view)
    || (view.provider === "claude" && Boolean(claude) && Boolean(target) && claudeInventoryShowsConnected(claude!, target!));
  return { ...view, status: evidence ? "connected" : "pending", checkedAt: now };
}

export function createConnectorSetupInternalRoutes(deps: Shared & {
  ownsThread(botId: string, threadId: string): boolean;
  /** The person speaking in this turn. */
  principal(botId: string, threadId: string): string | undefined;
  /** The bot's engine and whose account it runs on, for this person. */
  context(botId: string, threadId: string, principalId: string): ConnectorSetupContext | null;
  post(input: { botId: string; threadId: string; view: ConnectorSetupView; text: string }): void;
  newId?(): string;
}): InternalRouteHandler {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => `cs_${randomBytes(9).toString("hex")}`);
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== "/api/internal/connector-setup/open") return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!deps.ownsThread(capability.botId, capability.threadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const principalId = deps.principal(capability.botId, capability.threadId)?.trim().toLowerCase();
    if (!principalId) return json(res, 403, { error: "No person speaks in this turn, so there is nobody to sign in. Answer in words." });
    const parsed = openBody.safeParse(await readBody());
    if (!parsed.success) return json(res, 400, { error: "connector names the app (\"Microsoft Teams\", \"Gmail\"); via is grok, claude or composio; language is fr or en." });
    const target = resolveConnectorSetupTarget(parsed.data.connector);
    if (!target) return json(res, 400, { error: "Name the connector to connect." });
    const context = deps.context(capability.botId, capability.threadId, principalId);
    if (!context) return json(res, 409, { error: "This bot has no engine right now. Answer in words." });
    const route = chooseConnectorSetupRoute({ target, ...context, ...(parsed.data.via ? { prefer: parsed.data.via } : {}) });
    if ("refusal" in route) return json(res, 409, { error: REFUSALS[route.refusal] });
    if (route.route === "composio") return json(res, 200, { ok: true, route: "composio", slug: route.slug, label: target.label });
    if (!isConnectorSetupUrl(route.url)) return json(res, 500, { error: "no setup page for that connector" });
    const owner = connectorSetupOwner(principalId);
    const existing = deps.cards(capability.threadId).find(({ view }) => view.owner === owner && view.provider === route.route && view.connector === target.id);
    if (existing) {
      const view = existing.view.status === "connected" ? existing.view : check(existing.view, deps.messages(capability.threadId), null, now());
      if (view !== existing.view && view.status !== existing.view.status) deps.patch(capability.threadId, existing.messageId, view);
      return json(res, 200, { ok: true, route: route.route, label: target.label, status: view.status, card: "existing" });
    }
    const view: ConnectorSetupView = {
      id: newId(),
      connector: target.id,
      label: target.label,
      provider: route.route,
      url: route.url,
      status: "waiting",
      owner,
      createdAt: now(),
    };
    deps.post({ botId: capability.botId, threadId: capability.threadId, view, text: connectorSetupText(view, parsed.data.language ?? "en") });
    return json(res, 200, { ok: true, route: route.route, label: target.label, status: view.status, card: "posted" });
  };
}

export function createConnectorSetupRoutes(deps: Shared & {
  principalId(auth: RequestAuth): string | undefined;
  /** This person's claude.ai connectors read again (the cache refreshed), or null when unknown. */
  claudeConnectors(principalId: string): Promise<Array<{ name: string; status: string }> | null>;
}): RouteHandler {
  const now = deps.now ?? Date.now;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = CHECK.exec(path);
    if (!match) return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    const principalId = deps.principalId(auth)?.trim().toLowerCase();
    if (!principalId) return json(res, 401, { error: "Sign in to check this connection." });
    const body = await readBody(req, 4096).catch(() => null) as { threadId?: unknown } | null;
    const threadId = typeof body?.threadId === "string" ? body.threadId : "";
    const card = threadId ? deps.cards(threadId).find(({ view }) => view.id === match[1]) : undefined;
    // an unknown card and someone else's answer the same
    if (!card || card.view.owner !== connectorSetupOwner(principalId)) return json(res, 404, { error: "gone" });
    if (card.view.status === "connected") return json(res, 200, { view: card.view });
    const claude = card.view.provider === "claude" ? await deps.claudeConnectors(principalId).catch(() => null) : null;
    const view = check(card.view, deps.messages(threadId), claude, now());
    deps.patch(threadId, card.messageId, view);
    return json(res, 200, { view });
  };
}
