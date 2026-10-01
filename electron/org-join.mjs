// "Join a Perspicax server" (slice 8), the desktop half: the local Sagax
// hands one organization copy to this main process, which opens the
// organization server and hands the copy to that server's page once. Pure:
// every effect (network, dialogs, environments, the local harness) is
// injected, so node:test covers each rule.
//
// Who may call what (main.mjs checks the sender before calling these):
//   probe, stage, join                  the local renderer only
//   staged, take, finished, removeLocal the main frame of the active saved
//                                       server, and here: only when its
//                                       origin is the staged origin
// A remote page can therefore read nothing local except the one copy the
// person staged for that exact origin, and delete only bots it imported,
// after a native confirmation.

export const STAGE_TTL_MS = 30 * 60_000;
export const PROBE_TIMEOUT_MS = 5_000;
/** The backup limit (50 MiB) plus 1 MiB, as shared/org-import.ts. */
export const MAX_STAGED_BYTES = 51 * 1024 * 1024;
const PERSON_REF = /^pr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[\w-]{1,200}$/;

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The shape the main process checks before holding a copy. The org server
 * parses it fully again (shared/org-import.ts) before writing anything.
 * Returns the bot keys and names, or throws. */
export function checkStagedDocument(document) {
  if (!isRecord(document) || document.format !== "sagax.org-import" || document.version !== 1) throw new Error("not an organization copy");
  if (typeof document.self !== "string" || !PERSON_REF.test(document.self)) throw new Error("not an organization copy");
  const backup = document.backup;
  if (!isRecord(backup) || backup.format !== "openmaus.backup" || !Array.isArray(backup.bots) || !backup.bots.length || backup.bots.length > 200) {
    throw new Error("not an organization copy");
  }
  if (!isRecord(document.choices) || !isRecord(document.people)) throw new Error("not an organization copy");
  const bots = backup.bots.map((bot) => {
    if (!isRecord(bot) || typeof bot.key !== "string" || !KEY.test(bot.key) || typeof bot.name !== "string") throw new Error("not an organization copy");
    return { key: bot.key, name: bot.name.slice(0, 200) };
  });
  const keys = bots.map((bot) => bot.key).sort();
  const chosen = Object.keys(document.choices).sort();
  if (new Set(keys).size !== keys.length || chosen.length !== keys.length || chosen.some((key, i) => key !== keys[i])) throw new Error("not an organization copy");
  let size = 0;
  try {
    size = Buffer.byteLength(JSON.stringify(document));
  } catch {
    throw new Error("not an organization copy");
  }
  if (size > MAX_STAGED_BYTES) throw new Error("this copy is too large");
  return bots;
}

/** Preferences handed over at join: string values under a bounded number of
 * plain keys (the page keeps only the keys it knows,
 * shared/user-preferences.ts). Anything else is dropped. */
export function checkPreferences(input) {
  if (!isRecord(input)) return null;
  const out = {};
  for (const [key, value] of Object.entries(input).slice(0, 64)) {
    if (/^[\w.:-]{1,80}$/.test(key) && typeof value === "string" && value.length <= 8192) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/** A report from the org page: the shape of POST /api/org/import's answer,
 * every bot key one the staged copy carried. Returns the imported keys and
 * the subject, or throws. */
export function checkReport(report, stagedKeys) {
  if (!isRecord(report) || !Array.isArray(report.bots) || !isRecord(report.subject)) throw new Error("not an import report");
  const { iss, sub } = report.subject;
  if (typeof iss !== "string" || !iss || iss.length > 2048 || typeof sub !== "string" || !sub || sub.length > 255) throw new Error("not an import report");
  const allowed = new Set(stagedKeys);
  const keys = report.bots.map((bot) => (isRecord(bot) ? bot.sourceKey : undefined));
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key))) throw new Error("the report names bots that were not staged");
  return { keys: [...new Set(keys)], iss, sub };
}

/**
 * @param {{
 *   fetch: typeof fetch,
 *   now?: () => number,
 *   parseLink: (address: string) => { origin: string } | null,
 *   saveEnvironment: (origin: string, options?: { serverMode?: boolean }) => void,
 *   navigate: (url: string) => void,
 *   confirm: (names: string[]) => Promise<boolean>,
 *   deleteLocalBot: (key: string) => Promise<boolean>,
 *   postLinkedSubject: (input: { iss: string, sub: string, serverOrigin: string }) => Promise<void>,
 *   signIn?: (origin: string) => Promise<void> | void,
 * }} deps
 */
export function createOrgJoin(deps) {
  const now = deps.now ?? Date.now;
  let probed = null;
  /** { origin, at, document | null, bots: [{ key, name }], imported: Set } */
  let held = null;
  /** Server mode: this computer's preferences for the server it joined,
   * handed once to that server's page. { origin, at, preferences } */
  let heldPreferences = null;

  const current = () => {
    if (held && now() - held.at >= STAGE_TTL_MS) held = null;
    return held;
  };
  const forOrigin = (senderOrigin) => {
    const copy = current();
    return copy && copy.origin === senderOrigin ? copy : null;
  };

  return {
    /** The organization server behind an address: its descriptor must say
     * it signs people in with Perspicax. Remembered as the only origin
     * `stage` accepts. */
    async probe(address) {
      const link = deps.parseLink(typeof address === "string" ? address : "");
      if (!link) throw new Error("Enter an https server address, or http://localhost on this computer.");
      const origin = new URL(link.origin).origin;
      let descriptor;
      try {
        const response = await deps.fetch(`${origin}/.well-known/openmausbot/environment`, {
          redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        descriptor = await response.json();
      } catch {
        throw new Error("That server could not be reached.");
      }
      const identity = isRecord(descriptor) ? descriptor.identity : undefined;
      if (!isRecord(identity) || identity.kind !== "perspicax" || typeof identity.issuer !== "string") {
        throw new Error("That server does not sign people in with Pulsatrix.");
      }
      probed = origin;
      return { origin, issuer: identity.issuer };
    },

    /** Hold one copy for the probed origin (30 minutes), save that server,
     * make it active and open it. */
    async stage(input) {
      const origin = isRecord(input) && typeof input.origin === "string" ? input.origin : "";
      if (!probed || origin !== probed) throw new Error("Check the server address first.");
      const bots = checkStagedDocument(input.document);
      held = { origin, at: now(), document: input.document, bots, imported: new Set() };
      deps.saveEnvironment(origin);
      deps.navigate(`${origin}/`);
      return { ok: true };
    },

    /** Join the probed server with nothing to copy (the launch screen's
     * Server mode, and "Join" with no bot chosen): save it, make it active,
     * open its sign-in page and start "Sign in with Pulsatrix" there, the
     * same sign-in its own page offers (electron/oidc-system-sign-in.cjs, always the system browser).
     * `serverMode: true` (the launch screen) locks the app to that server:
     * no Local, no other server, until server mode is left. */
    async join(input) {
      const origin = isRecord(input) && typeof input.origin === "string" ? input.origin : "";
      if (!probed || origin !== probed) throw new Error("Check the server address first.");
      const preferences = input.serverMode === true ? checkPreferences(input.preferences) : null;
      heldPreferences = preferences ? { origin, at: now(), preferences } : null;
      deps.saveEnvironment(origin, input.serverMode === true ? { serverMode: true } : undefined);
      deps.navigate(`${origin}/pair`);
      try {
        await deps.signIn?.(origin);
      } catch {
        throw new Error("The server is saved, but its sign-in could not start. Use Sign in with Pulsatrix on its page.");
      }
      return { ok: true };
    },

    /** The preferences brought from this computer, once, to the page of
     * the server they were brought for (src/lib/user-preferences-sync.ts). */
    takePreferences(senderOrigin) {
      const copy = heldPreferences;
      if (!copy || copy.origin !== senderOrigin || now() - copy.at >= STAGE_TTL_MS) return null;
      heldPreferences = null;
      return copy.preferences;
    },

    /** Whether a copy waits for this page's origin. */
    staged(senderOrigin) {
      const copy = forOrigin(senderOrigin);
      if (!copy) return null;
      return { origin: copy.origin, bots: copy.bots.length, name: copy.bots.map((bot) => bot.name).join(", ").slice(0, 200) };
    },

    /** The copy, once. Afterwards only its bot keys and names are kept. */
    take(senderOrigin) {
      const copy = forOrigin(senderOrigin);
      if (!copy || !copy.document) return null;
      const document = copy.document;
      copy.document = null;
      return document;
    },

    /** The org page reports what it imported: remembered for removeLocal,
     * and the organization account is recorded on the local server. */
    async finished(senderOrigin, input) {
      const copy = forOrigin(senderOrigin);
      if (!copy) throw new Error("No copy was staged for this server.");
      const { keys, iss, sub } = checkReport(isRecord(input) ? input.report : undefined, copy.bots.map((bot) => bot.key));
      for (const key of keys) copy.imported.add(key);
      await deps.postLinkedSubject({ iss, sub, serverOrigin: copy.origin });
      return { ok: true };
    },

    /** Delete local bots the org page reported imported, after the person
     * confirms in a native dialog. Nothing else. */
    async removeLocal(senderOrigin, keys) {
      const copy = forOrigin(senderOrigin);
      if (!copy) throw new Error("No copy was staged for this server.");
      if (!Array.isArray(keys) || !keys.length || keys.some((key) => typeof key !== "string" || !copy.imported.has(key))) {
        throw new Error("Only bots copied into this server can be removed.");
      }
      const unique = [...new Set(keys)];
      const names = unique.map((key) => copy.bots.find((bot) => bot.key === key)?.name ?? key);
      if (!(await deps.confirm(names))) return { removed: [] };
      const removed = [];
      for (const key of unique) {
        if (await deps.deleteLocalBot(key)) {
          removed.push(key);
          copy.imported.delete(key);
        }
      }
      return { removed };
    },
  };
}

/** The Forget dialog's text; an organization server adds what leaving
 * means for the bots copied there (spec D11). */
export function forgetDetail(isOrganization) {
  const base = "This app signs out of that server. The server keeps its own session list; revoke it there too if the device is gone.";
  return isOrganization
    ? `${base} Your bots copied there stay in the organization; your bots on this computer are unchanged.`
    : base;
}
