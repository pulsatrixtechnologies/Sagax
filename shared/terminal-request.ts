import type { TerminalDestinationChoice, TerminalProviderKind } from "./terminal-resources.ts";

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
  /** Every destination this person may open from this card, the bot's
   * choice (resourceId/provider above) first. The card lets them pick
   * another before opening; the server checks the pick again. Absent on a
   * card from an older server: only the bot's choice. */
  destinations?: TerminalDestinationChoice[];
  /** Set when the person allowed and the session was created. */
  sessionId?: string;
  appliedAt?: number;
}

/** Map the Québec labels on the approval card to allow/deny. */
export function terminalRequestBehavior(answer: string): "allow" | "deny" {
  const normalized = answer.trim().toLowerCase();
  return normalized === "ouvrir un terminal" || normalized === "open terminal" ? "allow" : "deny";
}

/** The destination a person picked on the card, sent with the allow. */
export interface TerminalDestinationPick {
  provider: TerminalProviderKind;
  resourceId: string;
}

/** A pick from a request body, or null when absent or malformed. */
export function parseTerminalDestinationPick(value: unknown): TerminalDestinationPick | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { provider, resourceId } = value as { provider?: unknown; resourceId?: unknown };
  if (typeof provider !== "string" || typeof resourceId !== "string") return null;
  if (!/^[a-z][a-z-]{1,20}$/.test(provider) || !resourceId || resourceId.length > 200) return null;
  return { provider: provider as TerminalProviderKind, resourceId };
}
