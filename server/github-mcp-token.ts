// The GitHub plugin's MCP server reads the one GitHub connection
// (2026-10-28). A marketplace plugin ships its server as Claude Code does,
// with the token left to the environment:
//
//   "headers": { "Authorization": "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" }
//
// Sagax never expanded that placeholder, so the server went out with the
// literal text and the Installed row said Connected for an account nobody
// had connected. Now the placeholder is the person's GitHub connection
// (Connect apps > Providers > GitHub): at each turn it is replaced with the
// token of the person the turn runs for, never written to config.json and
// never listed; the listing says whether that person has one.
import type { McpServerSpec } from "./contracts.ts";

/** The variable names a GitHub server reads its token from. */
export const GITHUB_TOKEN_VARIABLES = ["GITHUB_PERSONAL_ACCESS_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"] as const;

const PLACEHOLDER = new RegExp(`\\$\\{(?:${GITHUB_TOKEN_VARIABLES.join("|")})(?::-[^}]*)?\\}`, "g");
const HAS_PLACEHOLDER = new RegExp(PLACEHOLDER.source);

function values(spec: McpServerSpec): Record<string, string> {
  return "url" in spec ? spec.headers ?? {} : spec.env ?? {};
}

/** The server takes its token from the GitHub connection. Pure. */
export function readsGithubToken(spec: McpServerSpec): boolean {
  return Object.values(values(spec)).some((value) => HAS_PLACEHOLDER.test(value));
}

/** The servers with each GitHub placeholder replaced by `token`. Without a
 * token they go as they are (the server refuses the literal text, as
 * before). Never mutates its argument. Pure. */
export function withGithubToken<T extends Record<string, McpServerSpec>>(servers: T, token: string | undefined): T {
  if (!token) return servers;
  const out: Record<string, McpServerSpec> = {};
  for (const [name, spec] of Object.entries(servers)) {
    if (!readsGithubToken(spec)) {
      out[name] = spec;
      continue;
    }
    const filled = Object.fromEntries(Object.entries(values(spec)).map(([key, value]) => [key, value.replace(PLACEHOLDER, () => token)]));
    out[name] = "url" in spec ? { ...spec, headers: filled } : { ...spec, env: filled };
  }
  return out as T;
}
