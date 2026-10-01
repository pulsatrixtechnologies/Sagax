// The console's "Open in Sagax" link (slice 7): `<origin>/#thread=<id>&bot=<id>`.
// The app opens that thread once it is listed for the signed-in viewer (the
// server lists only what they may see), else does nothing special. A viewer
// not signed in goes through /pair and the Perspicax sign-in, which end on
// `/` without the hash, so the wanted thread waits in sessionStorage meanwhile.

export interface OpenThreadTarget {
  threadId: string;
  botId: string;
}

const ID = /^[\w-]{1,128}$/;
export const OPEN_THREAD_STORAGE_KEY = "sagax.openThread";
/** A remembered link older than this is dropped (a sign-in that took long). */
export const OPEN_THREAD_MAX_AGE_MS = 15 * 60_000;

/** The thread and bot a hash names, or null when it is not such a link. */
export function parseOpenThreadHash(hash: string): OpenThreadTarget | null {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!text.includes("thread=")) return null;
  const params = new URLSearchParams(text);
  const keys = [...params.keys()];
  if (keys.length !== 2 || !params.has("thread") || !params.has("bot")) return null;
  const threadId = params.get("thread") ?? "";
  const botId = params.get("bot") ?? "";
  return ID.test(threadId) && ID.test(botId) ? { threadId, botId } : null;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function sessionStore(): StorageLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Keep the link of this address through a sign-in (before leaving for
 * /pair or Perspicax). Never throws. */
export function rememberOpenThreadHash(hash: string = globalThis.location?.hash ?? "", storage: StorageLike | null = sessionStore(), now = Date.now()): OpenThreadTarget | null {
  const target = parseOpenThreadHash(hash);
  if (!target || !storage) return target;
  try {
    storage.setItem(OPEN_THREAD_STORAGE_KEY, JSON.stringify({ ...target, at: now }));
  } catch {
    /* private mode or storage blocked: the link opens only when signed in */
  }
  return target;
}

/** The wanted thread, from the address (then cleared from it) or from the
 * one a sign-in kept; read once. Never throws. */
export function takeOpenThreadTarget(
  loc: Pick<Location, "hash" | "pathname" | "search"> | null = globalThis.location ?? null,
  historyApi: Pick<History, "replaceState"> | null = globalThis.history ?? null,
  storage: StorageLike | null = sessionStore(),
  now = Date.now(),
): OpenThreadTarget | null {
  let kept: OpenThreadTarget | null = null;
  try {
    const raw = storage?.getItem(OPEN_THREAD_STORAGE_KEY);
    storage?.removeItem(OPEN_THREAD_STORAGE_KEY);
    if (raw) {
      const value = JSON.parse(raw) as { threadId?: unknown; botId?: unknown; at?: unknown };
      const fresh = typeof value.at === "number" && now - value.at >= 0 && now - value.at <= OPEN_THREAD_MAX_AGE_MS;
      if (fresh && typeof value.threadId === "string" && typeof value.botId === "string" && ID.test(value.threadId) && ID.test(value.botId)) {
        kept = { threadId: value.threadId, botId: value.botId };
      }
    }
  } catch {
    kept = null;
  }
  const fromHash = loc ? parseOpenThreadHash(loc.hash) : null;
  if (fromHash && loc) {
    try {
      historyApi?.replaceState(null, "", `${loc.pathname}${loc.search}`);
    } catch {
      /* the hash stays; harmless */
    }
  }
  return fromHash ?? kept;
}

interface ListedThreads {
  bots: ReadonlyArray<{ id: string; threadId: string; tasks?: ReadonlyArray<{ threadId: string }> }>;
  groups: ReadonlyArray<{ id: string; threadId: string; tasks?: ReadonlyArray<{ threadId: string }> }>;
}

/** Whether the viewer's lists hold this thread: the bot's own thread or
 * task, or a room the thread belongs to. */
export function openThreadVisible(target: OpenThreadTarget, state: ListedThreads): boolean {
  const holds = (owner: { threadId: string; tasks?: ReadonlyArray<{ threadId: string }> }) =>
    owner.threadId === target.threadId || (owner.tasks ?? []).some((task) => task.threadId === target.threadId);
  const bot = state.bots.find((candidate) => candidate.id === target.botId);
  if (bot && holds(bot)) return true;
  return state.groups.some(holds);
}

let taken: { target: OpenThreadTarget | null } | null = null;

/** takeOpenThreadTarget once per page load: a component rendered twice
 * (React strict mode) reads the same answer. */
export function pageOpenThreadTarget(): OpenThreadTarget | null {
  taken ??= { target: takeOpenThreadTarget() };
  return taken.target;
}
