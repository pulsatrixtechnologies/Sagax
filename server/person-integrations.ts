// Who manages a person's own plugins, skills and MCP servers on an
// organization server (Perspicax `sagax_integrations`, migration 0046).
//
// `manage` (the default, and what an older Perspicax means by leaving the
// field out): the person adds, edits and removes their own MCP connections
// (Settings > Mes connexions), connects GitHub, adds marketplaces and
// installs, updates or removes plugins and skills on the bots they own or
// manage, without an admin.
//
// `off`: an admin manages them. Every change above answers 403
// `org_integrations_admin_only`. What the person already saved stays (an
// admin can turn `manage` back on), and it stops being usable at once:
// their servers are not mounted, a running MCP child is stopped, their
// GitHub token is taken out of their environment, and their bots' plugins
// are not loaded. Skills already on a bot still load. The UI shows the
// saved list read-only with a short notice. Signing in again to a server
// they already have is still allowed, so a token can be refreshed for when
// an admin turns use back on; it does not mount the server while `off`.
// An organization admin is never narrowed, and a solo server never reads
// the field.
//
// The engine's own plugin and MCP commands are refused for every person's
// turns: `/plugin`, `/plugins`, `/mcp` and `/reload-*` typed in the chat are
// managed by Sagax for everyone (shared/harness-commands.ts), the host Bash
// is denied on an organization server (withholdHostTools), and `run_command`
// (the person's server environment and their desktop, including a Local VM
// command) refuses the CLIs' plugin, MCP and extension subcommands
// (`enginePluginCommandRefusal`). The tool result tells the bot to install
// through Sagax `act` plugin actions. When integrations are `off`, the
// administrator sentence stays. That check is a courtesy, not the boundary:
// nothing a person installs in their environment reaches a bot's turn, which
// loads only the plugins Sagax keeps and the servers Sagax mounts.

/** The refusal a person gets on a change an admin keeps. */
export const INTEGRATIONS_ADMIN_ONLY = {
  error: "Your administrator manages plugins and MCP servers.",
  code: "org_integrations_admin_only",
} as const;

/** Effective right: an organization admin is never narrowed, and only an
 * explicit `off` pauses everyone else. Absent and `manage` both mean manage. */
export function effectiveIntegrationRights(orgAdmin: boolean, field: "manage" | "off" | undefined): "manage" | "off" {
  return orgAdmin || field !== "off" ? "manage" : "off";
}

/** Saved connections of a non-admin whose right is `off`: kept, not usable. */
export function integrationsPaused(input: { rights: "manage" | "off"; orgAdmin: boolean }): boolean {
  return input.rights === "off" && !input.orgAdmin;
}

/** The tool text a refused `run_command` returns. */
export const INTEGRATIONS_ADMIN_ONLY_COMMAND =
  "Refused: your administrator manages plugins, skills and MCP servers for you, so engine plugin, MCP and extension commands do not run here.";

const ENGINE = String.raw`(?:claude|codex|gemini|kimi|pi|grok|npx\s+(?:-y\s+)?@anthropic-ai/claude-code)`;
const SUBCOMMAND = String.raw`(?:plugins?|mcp|extensions?|marketplace)`;
const ACTION = String.raw`(?:add|add-json|add-from-claude-desktop|install|i|update|upgrade|remove|rm|uninstall|enable|disable|link|import|marketplace|new)`;
// The engine name at a command start: the line's start or after a shell
// separator, a path (`/usr/local/bin/claude`) or `command`/`exec`/`env`.
const ENGINE_COMMAND = new RegExp(
  String.raw`(?:^|[;&|(\n\`]|\$\()\s*(?:(?:command|exec|env|sudo)\s+(?:[A-Z_][A-Z0-9_]*=\S*\s+)*)?(?:\S*/)?${ENGINE}\s+${SUBCOMMAND}\s+${ACTION}\b`,
  "i",
);

/** Whether a shell command installs, updates or removes an engine's
 * plugins, MCP servers or extensions (`claude plugin install ...`,
 * `claude mcp add ...`, `codex mcp add ...`, `gemini extensions install`). */
export function engineIntegrationCommand(command: string): boolean {
  return ENGINE_COMMAND.test(command);
}

/** What `run_command` says instead of running an engine plugin command.
 * Integrations off keeps the administrator sentence. Otherwise the bot
 * installs through Sagax `act`, on every engine. */
export const PLUGIN_ACT_COMMAND =
  "Refused: Sagax installs plugins for this bot. Do not run an engine plugin, MCP or extension command. Call act with plugins.action set to list, addMarketplace, install, setEnabled, uninstall or removeMarketplace. Skills and commands then load on every engine. Hooks and MCP from a plugin stay out.";

export function enginePluginCommandRefusal(integrationsOff: boolean, command: string): string | null {
  if (!engineIntegrationCommand(command)) return null;
  if (integrationsOff) return INTEGRATIONS_ADMIN_ONLY_COMMAND;
  return PLUGIN_ACT_COMMAND;
}
