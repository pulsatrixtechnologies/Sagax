// "Join a Perspicax server" (slice 8), the solo side: which bots are
// offered, the per-bot choices and what the server's dry export answers.
// Pure, so the card's rules are testable without rendering it.

export interface JoinChoice {
  copy: boolean;
  threads: boolean;
  memory: boolean;
}

/** Defaults: memory travels, conversations do not, nothing is chosen yet. */
export const DEFAULT_JOIN_CHOICE: JoinChoice = { copy: false, threads: false, memory: true };

export interface OrgExportSummary {
  bots: { id: string; name: string; threads: number; messages: number; memoryFiles: number }[];
  groups: { id: string; name: string }[];
  routines: { id: string; name: string }[];
  notCopied: { kind: "room" | "routine" | "grant"; name: string; reason: "other_people" | "bot_not_chosen" | "room_not_copied"; person?: string }[];
  redacted: number;
}

export interface OrgExportAnswer {
  document: unknown;
  filename: string;
  summary: OrgExportSummary;
}

export interface LinkedSubject { iss: string; sub: string; serverOrigin: string; linkedAt: number }

/** The bots this person may copy: their own, or ones with no owner (from
 * before owners were recorded). Hidden bots are left out. */
export function offeredBots<T extends { id: string; name: string; ownerUserId?: string; hidden?: boolean }>(bots: readonly T[], localPrincipalId: string | null | undefined): T[] {
  const self = localPrincipalId?.trim().toLowerCase() ?? "";
  return bots.filter((bot) => {
    if (bot.hidden) return false;
    const owner = bot.ownerUserId?.trim().toLowerCase() ?? "";
    return !owner || owner === "local-owner" || (self !== "" && owner === self);
  });
}

export function choiceFor(choices: Readonly<Record<string, JoinChoice>>, botId: string): JoinChoice {
  return choices[botId] ?? DEFAULT_JOIN_CHOICE;
}

/** Turn one switch; choosing threads or memory also chooses the bot. */
export function withChoice(choices: Readonly<Record<string, JoinChoice>>, botId: string, field: keyof JoinChoice, value: boolean): Record<string, JoinChoice> {
  const current = choiceFor(choices, botId);
  const next = { ...current, [field]: value };
  if (field !== "copy" && value) next.copy = true;
  return { ...choices, [botId]: next };
}

/** The body of POST /api/org/export: the chosen bots, in list order. */
export function exportRequest(bots: readonly { id: string }[], choices: Readonly<Record<string, JoinChoice>>): { bots: { id: string; threads: boolean; memory: boolean }[] } {
  return {
    bots: bots
      .filter((bot) => choiceFor(choices, bot.id).copy)
      .map((bot) => ({ id: bot.id, threads: choiceFor(choices, bot.id).threads, memory: choiceFor(choices, bot.id).memory })),
  };
}

/** An organization server address typed by a person: https anywhere, http
 * only on this computer. Null when it is not one. */
export function serverAddress(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")) return url.origin;
    return null;
  } catch {
    return null;
  }
}

/** Distinct server origins the bots were copied to, newest first. */
export function copiedTo(subjects: readonly LinkedSubject[]): string[] {
  return [...new Set([...subjects].sort((a, b) => b.linkedAt - a.linkedAt).map((subject) => subject.serverOrigin))];
}
