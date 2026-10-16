// "Teach a task" from the composer's + menu, shown in the browser: the
// Computer tab switches to the bot's browser, opens its window and starts a
// recording there (src/components/BrowserPanel.tsx). The request waits here
// until the browser view for that bot takes it, so it survives the panel
// mounting after the click.

type Listener = (botId: string) => void;

let pending: { botId: string; at: number } | null = null;
const listeners = new Set<Listener>();
/** A request no view took within this long is stale. */
const PENDING_MS = 60_000;

export function requestBrowserTeach(botId: string): void {
  pending = { botId, at: Date.now() };
  for (const listener of listeners) listener(botId);
}

/** True once for the view that takes the request for its bot. */
export function takeBrowserTeach(botId: string, now = Date.now()): boolean {
  if (!pending || pending.botId !== botId || now - pending.at > PENDING_MS) return false;
  pending = null;
  return true;
}

/** Whether a request for this bot waits, without taking it. */
export function browserTeachPending(botId: string, now = Date.now()): boolean {
  return Boolean(pending && pending.botId === botId && now - pending.at <= PENDING_MS);
}

export function onBrowserTeachRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
