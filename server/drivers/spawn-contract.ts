// Why a pooled engine process could not be reused for the next turn
// (docs/voice-mode-xai.md, "Latency"). A relaunch costs the engine's whole
// cold start (process boot, every MCP server reconnected, the session read
// back), which on a call is the largest share of the pause before the bot
// answers. The driver compares the spawn contract of the live process with
// the next turn's and logs the names of the fields that differ, never their
// values (a contract carries tokens and keys).

/** The dotted paths of the leaves that differ between two contracts, at
 * most `limit` of them. Values are never returned. */
export function contractChanges(before: unknown, after: unknown, limit = 8, path = ""): string[] {
  const out: string[] = [];
  const walk = (a: unknown, b: unknown, at: string) => {
    if (out.length >= limit) return;
    if (a === b) return;
    const objects = a !== null && b !== null && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b);
    if (!objects) {
      out.push(at || "(root)");
      return;
    }
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const key of keys) walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], at ? `${at}.${key}` : key);
  };
  walk(before, after, path);
  return out;
}

/** Environment entries of an MCP server that hold a per-turn credential:
 * they are handed to a long-lived process through a file the harness
 * rewrites each turn instead (see `withoutTurnTokens`). */
export const TURN_TOKEN_ENV = ["SAGAX_COMMS_TOKEN"] as const;

/** The MCP servers of a contract with each per-turn token's value masked:
 * two turns of one call then make the same contract. */
export function withoutTurnTokens(servers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(servers)) {
    const env = (server as { env?: Record<string, unknown> } | null)?.env;
    if (!env || !TURN_TOKEN_ENV.some((key) => key in env)) {
      out[name] = server;
      continue;
    }
    const masked = { ...env };
    for (const key of TURN_TOKEN_ENV) if (key in masked) masked[key] = "(turn token)";
    out[name] = { ...(server as object), env: masked };
  }
  return out;
}
