import type { TerminalProviderKind } from "./terminal-resources.ts";

/** Durable payload on an approval card before a shell session opens. */
export interface TerminalRequestCardData {
  requestId: string;
  resourceId: string;
  provider: TerminalProviderKind;
  label: string;
  hostLabel: string;
  /** Why the bot wants a shell (shown in the card). */
  reason: string;
  botId: string;
  threadId: string;
  /** Set when the person allowed and the session was created. */
  sessionId?: string;
  appliedAt?: number;
}

/** Map the Québec labels on the approval card to allow/deny. */
export function terminalRequestBehavior(answer: string): "allow" | "deny" {
  const normalized = answer.trim().toLowerCase();
  return normalized === "ouvrir un terminal" || normalized === "open terminal" ? "allow" : "deny";
}
