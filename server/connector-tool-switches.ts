// Workspace-level switches for connected-app tools: an admin turns a
// Composio tool off for every bot of this server on the app's detail page.
// They are stored with the app (config.json `composio.disabledTools`, keyed
// by service slug) and every tool not listed stays on. A bot's own grants
// (connectorTools, connector-verdict.ts) still apply on top: a tool reaches
// Composio only when the workspace leaves it on AND the bot is granted it.
import { CONNECTOR_SLUG_PATTERN, CONNECTOR_TOOL_NAME_PATTERN } from "../shared/wire.ts";

/** At most this many tools off per app (Composio toolkits list a few
 * hundred at most). */
export const CONNECTOR_DISABLED_TOOLS_MAX = 1000;
/** At most this many apps carry switches. */
export const CONNECTOR_DISABLED_SERVICES_MAX = 200;

export type ConnectorDisabledTools = Record<string, string[]>;

/** Read one app's list of tools to turn off from a request body. Every name
 * must be a Composio tool name of that app (GMAIL_ for gmail), so a switch
 * on one app's page never turns off another app's tool. */
export function parseDisabledTools(
  slug: string,
  value: unknown,
): { ok: true; tools: string[] } | { ok: false; error: string } {
  if (!CONNECTOR_SLUG_PATTERN.test(slug)) return { ok: false, error: "Unknown app." };
  if (!Array.isArray(value)) return { ok: false, error: "disabledTools must be a list of tool names." };
  if (value.length > CONNECTOR_DISABLED_TOOLS_MAX) {
    return { ok: false, error: `At most ${CONNECTOR_DISABLED_TOOLS_MAX} tools can be turned off for one app.` };
  }
  const prefix = slug.toUpperCase().replace(/-/g, "_") + "_";
  const tools = new Set<string>();
  for (const tool of value) {
    if (typeof tool !== "string" || !CONNECTOR_TOOL_NAME_PATTERN.test(tool)) {
      return { ok: false, error: "disabledTools names must be Composio tool names like GMAIL_SEND_EMAIL." };
    }
    if (!tool.startsWith(prefix)) return { ok: false, error: `${tool} is not a tool of ${slug}.` };
    tools.add(tool);
  }
  return { ok: true, tools: [...tools].sort() };
}

/** The stored map with one app's list replaced; an app with every tool on
 * leaves the map. */
export function withAppDisabledTools(
  current: ConnectorDisabledTools | undefined,
  slug: string,
  tools: string[],
): ConnectorDisabledTools | { error: string } {
  const next: ConnectorDisabledTools = {};
  for (const [service, list] of Object.entries(current ?? {})) {
    if (service !== slug) next[service] = list;
  }
  if (tools.length) {
    if (Object.keys(next).length >= CONNECTOR_DISABLED_SERVICES_MAX) {
      return { error: `At most ${CONNECTOR_DISABLED_SERVICES_MAX} apps can have tools turned off.` };
    }
    next[slug] = tools;
  }
  return next;
}

/** The stored map as read from config, dropping anything malformed rather
 * than failing: a hand-edited entry must never turn a tool back on by
 * breaking the whole map, so only the bad entry is skipped. */
export function readDisabledTools(value: unknown): ConnectorDisabledTools {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: ConnectorDisabledTools = {};
  for (const [slug, list] of Object.entries(value as Record<string, unknown>)) {
    if (!CONNECTOR_SLUG_PATTERN.test(slug) || !Array.isArray(list)) continue;
    const tools = list.filter((tool): tool is string => typeof tool === "string" && CONNECTOR_TOOL_NAME_PATTERN.test(tool));
    if (tools.length) out[slug] = tools;
  }
  return out;
}

/** The tools of one call the workspace has turned off, by exact name. */
export function workspaceDisabledTools(names: readonly string[], disabled: ConnectorDisabledTools): string[] {
  const off = new Set(Object.values(disabled).flat());
  return [...new Set(names)].filter((name) => off.has(name));
}

/** Safe to hand to the model: names the tools and who can change it. */
export function connectorWorkspaceRefusalText(tools: readonly string[]): string {
  const named = tools.map((tool) => '"' + tool + '"').join(", ");
  const one = tools.length === 1;
  return [
    named + " " + (one ? "is" : "are") + " turned off for this workspace.",
    "This call was not performed.",
    "Ask an admin to turn " + (one ? "it" : "them") + " on in Connected apps if " + (one ? "it is" : "they are") + " needed.",
  ].join(" ");
}
