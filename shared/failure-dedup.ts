// One error per bot and cause in a conversation (the maintainer, 2026-10-27): a person
// who sends again while a bot cannot answer must not fill the thread with the
// same failed row and the same access card each time. The server does not
// write a repeat (index.ts), and the clients fold the repeats a thread already
// holds into the last one (ChatView, GroupView; iOS reads the same rule).
//
// A repeat is the same failure of the same bot since that bot last answered:
// a reply in between means the cause went away, so a later failure shows
// again.
import { failedTurnCause } from "./failed-turn.ts";

/** The parts of a stored message this reads. */
export interface DedupMessage {
  id: string;
  role: string;
  kind: string;
  from?: { botId?: string } | null;
  tool?: { name: string; ok?: boolean } | null;
  access?: { reason: string; engine: string; botId?: string } | null;
}

/** What makes two rows the same failure, or null for any other row. */
export function failureKey(message: DedupMessage, threadBotId = ""): string | null {
  if (message.role !== "bot") return null;
  if (message.kind === "access" && message.access) {
    const bot = message.access.botId || message.from?.botId || threadBotId;
    return `access\u0000${bot}\u0000${message.access.reason}\u0000${message.access.engine}`;
  }
  if (message.kind !== "activity" || !message.tool || message.tool.ok !== false) return null;
  const cause = failedTurnCause(message.tool.name);
  if (cause === null) return null;
  return `error\u0000${message.from?.botId || threadBotId}\u0000${cause.replace(/\s+/g, " ").trim()}`;
}

function answeredBy(message: DedupMessage, threadBotId: string): string | null {
  return message.role === "bot" && message.kind === "text" ? message.from?.botId || threadBotId : null;
}

/** The ids of rows that repeat a failure shown later in the same stretch:
 * only the last of each is drawn. */
export function repeatedFailureIds(messages: readonly DedupMessage[], threadBotId = ""): Set<string> {
  const hidden = new Set<string>();
  const latest = new Map<string, string>();
  for (const message of messages) {
    const bot = answeredBy(message, threadBotId);
    if (bot !== null) {
      for (const key of latest.keys()) if (key.split("\u0000")[1] === bot) latest.delete(key);
      continue;
    }
    const key = failureKey(message, threadBotId);
    if (key === null) continue;
    const earlier = latest.get(key);
    if (earlier) hidden.add(earlier);
    latest.set(key, message.id);
  }
  return hidden;
}

/** Whether `candidate` would repeat a failure the thread already shows
 * (the server then does not write it). */
export function repeatsShownFailure(messages: readonly DedupMessage[], candidate: Omit<DedupMessage, "id">, threadBotId = ""): boolean {
  const key = failureKey({ ...candidate, id: "" }, threadBotId);
  if (key === null) return false;
  const bot = key.split("\u0000")[1];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (answeredBy(message, threadBotId) === bot) return false;
    if (failureKey(message, threadBotId) === key) return true;
  }
  return false;
}
