// Loi 25 (2026-10-17, re-review of #689): deleting a person's account
// erases every Data scope of theirs on this server, not only the bots they
// own. A person's own scope on someone else's bot (`<botId>~p-<hash>`,
// scope.ts) and the scope of each confidential thread they own
// (`<botId>~t-<hash>`) hold the tables, the sheet, the downloads and the
// exports of that person: each one is closed (its DuckDB database) and its
// folder removed. The scopes root is also read, so a person's folder on a
// bot this process no longer lists goes too.
import { existsSync, readdirSync, rmSync } from "node:fs";

import { DATA_SCOPES_ROOT, dataScopeFolder, forgetDataScope, personScopeKeyFor, threadScopeKeyFor } from "./scope.ts";
import type { DataEngine } from "./types.ts";

export interface ErasePersonDataInput {
  /** The person whose account is deleted. */
  principalId: string;
  /** Every bot of the server (their own scope on each one goes). */
  botIds: readonly string[];
  /** The confidential threads the person owned (each one's scope goes). */
  confidentialThreads: ReadonlyArray<{ botId: string; threadId: string }>;
  engine: Pick<DataEngine, "deleteScope">;
  sheets: { deleteScope(scopeKey: string): void };
  /** Default: the server's derived-scopes root. */
  scopesRoot?: string;
  warn?: (line: string) => void;
}

const BOT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Closes and removes the person's Data scopes. Answers how many scope
 * folders existed and are now gone. Never throws for one scope: each
 * failure is logged and the next scope is still erased. */
export async function erasePersonData(input: ErasePersonDataInput): Promise<{ scopes: number }> {
  const root = input.scopesRoot ?? DATA_SCOPES_ROOT;
  const warn = input.warn ?? ((line: string) => console.warn(line));
  const keys = new Set<string>();
  for (const botId of input.botIds) if (BOT_ID.test(botId)) keys.add(personScopeKeyFor(botId, input.principalId));
  for (const { botId, threadId } of input.confidentialThreads) if (BOT_ID.test(botId)) keys.add(threadScopeKeyFor(botId, threadId));
  // a bot folder under the root this server no longer lists
  let listed: string[] = [];
  try {
    listed = existsSync(root) ? readdirSync(root).filter((name) => BOT_ID.test(name)) : [];
  } catch (error) {
    warn(`account deletion: Data scopes not listed (${error instanceof Error ? error.message : "unknown"})`);
  }
  for (const botId of listed) keys.add(personScopeKeyFor(botId, input.principalId));
  let scopes = 0;
  for (const key of keys) {
    const folder = dataScopeFolder(key, undefined, root);
    const existed = existsSync(folder);
    try {
      await input.engine.deleteScope?.(key);
    } catch (error) {
      warn(`account deletion: a Data database was not closed (${error instanceof Error ? error.message : "unknown"})`);
    }
    try {
      input.sheets.deleteScope(key);
    } catch {
      // already gone
    }
    try {
      rmSync(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch (error) {
      warn(`account deletion: a Data folder was not removed (${error instanceof Error ? error.message : "unknown"})`);
    }
    forgetDataScope(key);
    if (existed && !existsSync(folder)) scopes++;
  }
  return { scopes };
}
