import { randomUUID } from "node:crypto";

import type { TerminalRequestCardData } from "../shared/terminal-request.ts";
import { terminalResourceKey } from "../shared/terminal-resources.ts";
import type { TerminalAuditEvent } from "./terminal-audit.ts";
import type { Store } from "./store.ts";
import type { createTerminalSessionManager } from "./terminal-sessions.ts";
import type { TerminalResourceRegistry } from "./terminal-resources/registry.ts";
import type { RequestAuth } from "./request-auth.ts";

export interface TerminalRequestServiceDeps {
  store: Store;
  registry: TerminalResourceRegistry;
  sessions: ReturnType<typeof createTerminalSessionManager>;
  principalId(auth: RequestAuth): string | undefined;
  audit: { write: (event: TerminalAuditEvent) => void };
  now: () => number;
}

export function createTerminalRequestService(deps: TerminalRequestServiceDeps) {
  return {
    async submit(args: {
      botId: string;
      threadId: string;
      resourceId: string;
      provider: TerminalRequestCardData["provider"];
      reason: string;
      principalId?: string;
    }): Promise<{ requestId: string; messageId: string } | { error: string }> {
      const authPrincipal = args.principalId?.trim().toLowerCase()
        ?? deps.store.taskByThread(args.botId, args.threadId)?.ownerPrincipalId
        ?? "";
      const ctx = {
        auth: {
          kind: "session" as const,
          session: { id: "internal", principalId: authPrincipal, scopes: ["client"] } as never,
          via: "cookie" as const,
          scopes: ["client"] as const,
        },
        principalId: authPrincipal,
        botId: args.botId,
        threadId: args.threadId,
      };
      const resource = await deps.registry.resolve({ provider: args.provider, id: args.resourceId }, ctx);
      if (!resource) return { error: "Resource unavailable or unknown." };
      const requestId = randomUUID();
      const payload: TerminalRequestCardData = {
        requestId,
        resourceId: args.resourceId,
        provider: args.provider,
        label: resource.label,
        hostLabel: resource.hostLabel,
        reason: args.reason.trim() || resource.label,
        botId: args.botId,
        threadId: args.threadId,
      };
      const bot = deps.store.bot(args.botId);
      const message = deps.store.appendMessage(args.threadId, {
        role: "bot",
        kind: "options",
        from: bot ? { botId: bot.id, name: bot.name, color: bot.color } : undefined,
        card: {
          title: `Ouvrir un terminal sur ${resource.hostLabel}`,
          subtitle: payload.reason,
          options: ["Ouvrir un terminal", "Refuser"],
          requestId,
          tool: "shell_terminal",
          terminalRequest: payload,
        },
      });
      deps.audit.write({
        at: deps.now(),
        kind: "session.requested",
        principalId: authPrincipal,
        botId: args.botId,
        threadId: args.threadId,
        resourceId: terminalResourceKey(args.provider, args.resourceId),
        provider: args.provider,
        requestId,
      });
      return { requestId, messageId: message.id };
    },

    async resolve(args: {
      threadId: string;
      requestId: string;
      behavior: "allow" | "deny" | "answer";
      principalId: string;
    }): Promise<
      | { claimed: false }
      | { claimed: true; status: number; error: string }
      | { claimed: true; outcome: "allowed-once" | "rejected"; alreadySettled?: true }
    > {
      const message = deps.store.messagesFor(args.threadId).find(
        (candidate) => candidate.card?.requestId === args.requestId && candidate.card.terminalRequest,
      );
      const card = message?.card;
      const request = card?.terminalRequest;
      if (!request || !card || !message) return { claimed: false };
      if (card.answered || card.dismissed) {
        return { claimed: true, outcome: card.answered === "allow" ? "allowed-once" : "rejected", alreadySettled: true };
      }
      if (args.behavior !== "allow") {
        deps.audit.write({ at: deps.now(), kind: "session.denied", principalId: args.principalId, requestId: args.requestId });
        deps.store.patchMessage(args.threadId, message.id, {
          card: { ...card, answered: "deny", dismissed: false, held: undefined },
        });
        return { claimed: true, outcome: "rejected" };
      }
      try {
        const session = await deps.sessions.open({
          principalId: args.principalId,
          botId: request.botId,
          threadId: request.threadId,
          resourceKey: terminalResourceKey(request.provider, request.resourceId),
          label: request.label,
          hostLabel: request.hostLabel,
        });
        const applied: TerminalRequestCardData = { ...request, sessionId: session.id, appliedAt: deps.now() };
        deps.store.patchMessage(args.threadId, message.id, {
          card: { ...card, answered: "allow", held: undefined, terminalRequest: applied },
        });
        const bot = deps.store.bot(request.botId);
        deps.store.appendMessage(args.threadId, {
          role: "bot",
          kind: "text",
          from: bot ? { botId: bot.id, name: bot.name, color: bot.color } : undefined,
          text: "",
          terminalEmbed: {
            sessionId: session.id,
            resourceId: request.resourceId,
            provider: request.provider,
            hostLabel: request.hostLabel,
            label: request.label,
            status: session.status,
          },
        });
        return { claimed: true, outcome: "allowed-once" };
      } catch (error) {
        const text = error instanceof Error ? error.message : "Could not open terminal";
        deps.store.patchMessage(args.threadId, message.id, {
          card: { ...card, answered: "deny", subtitle: `${card.subtitle}\n\n${text}` },
        });
        return { claimed: true, status: 409, error: text };
      }
    },
  };
}

export async function resolveAndSendTerminal(
  res: { headersSent: boolean; writableEnded: boolean; writeHead: (code: number) => void; end: (body?: string) => void },
  service: ReturnType<typeof createTerminalRequestService>,
  args: { threadId: string; requestId: string; behavior: "allow" | "deny" | "answer"; principalId: string },
): Promise<boolean> {
  const result = await service.resolve(args);
  if (!result.claimed) return false;
  if ("status" in result) {
    res.writeHead(result.status);
    res.end(JSON.stringify({ error: result.error }));
    return true;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, outcome: result.outcome, alreadySettled: result.alreadySettled === true }));
  return true;
}
