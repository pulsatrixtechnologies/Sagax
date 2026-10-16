// Whose Data database a turn or a panel request reaches (2026-10-16).
//
// A bot's Data tools used to keep one DuckDB database and one sheet per bot.
// On an organization server a bot can be shared with several people, so
// person B could read the tables person A loaded. The scope key fixes that:
//
//   - solo server, or the bot's owner: the bot id itself (the database and
//     sheet that already exist, no migration);
//   - another person on an organization server: `<botId>~p-<16 hex>`, a
//     database of that person's own on that bot;
//   - a confidential thread (the resolver below says so): `<botId>~t-<16 hex>`,
//     a database of that thread only, never mixed with the bot's shared one.
//
// The hex is the start of a SHA-256 of the principal (or thread id), so a key
// names no person and holds no slash (engine.forBot refuses one). A derived
// key's files live under the bot folder (`data-scopes/<suffix>`), so they go
// with the bot. Pure apart from the small in-memory map of who a derived key
// belongs to, which the live frames use to pick their audience.
import { createHash } from "node:crypto";
import { join } from "node:path";

import { botFolder as defaultBotFolder } from "../bot-folder.ts";

/** Separates the bot id from the scope suffix. Bot ids never contain it. */
export const DATA_SCOPE_SEPARATOR = "~";
/** The folder, inside the bot folder, that holds the derived scopes. */
export const DATA_SCOPES_DIR = "data-scopes";

export type DataScopeKind = "bot" | "person" | "thread";

/** A confidential thread's owner, or null for an ordinary thread. */
export type ConfidentialThreadResolver = (threadId: string) => { ownerPrincipalId: string } | null;

let confidentialResolver: ConfidentialThreadResolver = () => null;

/** The hook confidential threads plug into: once set, a confidential thread
 * gets a Data database of its own. Null restores the default (no thread is
 * confidential). */
export function setConfidentialThreadResolver(resolver: ConfidentialThreadResolver | null): void {
  confidentialResolver = resolver ?? (() => null);
}

/** The thread's confidential owner, or null. A resolver that throws counts
 * as confidential with no owner anyone matches (fail closed). */
export function confidentialThreadOwner(threadId: string): { ownerPrincipalId: string } | null {
  try {
    return confidentialResolver(threadId);
  } catch {
    return { ownerPrincipalId: "" };
  }
}

const normalize = (principal: string) => principal.trim().toLowerCase();
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);

interface ScopeMember {
  /** The one principal whose live frames carry this scope's sheet. */
  audience: string;
  /** For a thread scope: the thread, so its folder can be found. */
  threadId?: string;
}

/** Who each derived key belongs to, learned when the key is computed. */
const members = new Map<string, ScopeMember>();

export interface DataScopeRequest {
  botId: string;
  /** True on an organization server. */
  organization: boolean;
  /** The bot's owner. */
  ownerPrincipalId: string;
  /** The person speaking (a turn) or viewing (the panel). Undefined means
   * the owner side: the operator at this computer, a routine, a solo server. */
  principalId?: string;
  /** The turn's thread, or the thread the panel asks about. */
  threadId?: string;
}

/**
 * The Data scope key for a request, or null when it must be refused (a
 * confidential thread reached by someone other than its owner).
 */
export function dataScopeKey(request: DataScopeRequest): string | null {
  const { botId } = request;
  const principal = request.principalId === undefined ? undefined : normalize(request.principalId);
  if (request.threadId) {
    const confidential = confidentialThreadOwner(request.threadId);
    if (confidential) {
      const owner = normalize(confidential.ownerPrincipalId);
      if (principal !== undefined && (!owner || principal !== owner)) return null;
      const key = `${botId}${DATA_SCOPE_SEPARATOR}t-${digest(request.threadId)}`;
      members.set(key, { audience: owner, threadId: request.threadId });
      return key;
    }
  }
  if (!request.organization) return botId;
  if (principal === undefined || principal === normalize(request.ownerPrincipalId)) return botId;
  // An unknown speaker ("") gets a scope of its own too: never the owner's.
  const key = `${botId}${DATA_SCOPE_SEPARATOR}p-${digest(principal)}`;
  members.set(key, { audience: principal });
  return key;
}

/** The bot a scope key belongs to. */
export function dataScopeBotId(key: string): string {
  const at = key.indexOf(DATA_SCOPE_SEPARATOR);
  return at === -1 ? key : key.slice(0, at);
}

export function dataScopeKind(key: string): DataScopeKind {
  const at = key.indexOf(DATA_SCOPE_SEPARATOR);
  if (at === -1) return "bot";
  return key.startsWith("t-", at + 1) ? "thread" : "person";
}

/** The principal a derived scope's frames go to; undefined for the bot
 * scope or a key this process never computed (callers fail closed). */
export function dataScopeAudience(key: string): string | undefined {
  return members.get(key)?.audience;
}

/** The thread of a thread scope, when this process computed its key. */
export function dataScopeThread(key: string): string | undefined {
  return members.get(key)?.threadId;
}

/** Where a scope's database and sheet live: the bot folder for the bot
 * scope, `<bot folder>/data-scopes/<suffix>` for a derived one. */
export function dataScopeFolder(key: string, botFolder: (botId: string) => string = defaultBotFolder): string {
  const botId = dataScopeBotId(key);
  if (key === botId) return botFolder(botId);
  return join(botFolder(botId), DATA_SCOPES_DIR, key.slice(botId.length + DATA_SCOPE_SEPARATOR.length));
}

/** Forgets every derived key of a deleted bot. */
export function forgetDataScopes(botId: string): void {
  for (const key of members.keys()) if (dataScopeBotId(key) === botId) members.delete(key);
}

/** Whether a "data" live frame reaches a client: frames without an audience
 * (a solo server) reach everyone as before; otherwise only that person's
 * streams, and the loopback stream (no viewer) only for the bot scope or
 * when the local operator is the audience. */
export function dataFrameAllowed(
  payload: { kind?: unknown; audience?: unknown; dataScope?: unknown },
  viewerId: string | undefined,
  localPrincipalId: string,
): boolean {
  if (payload.kind !== "data") return true;
  if (typeof payload.audience !== "string") return payload.audience === undefined;
  if (!viewerId) return payload.dataScope === "bot" || (Boolean(payload.audience) && normalize(payload.audience) === normalize(localPrincipalId));
  return Boolean(payload.audience) && normalize(viewerId) === normalize(payload.audience);
}
