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
// `org_integrations_admin_only`; what the person already has keeps working
// (their servers still mount for their turns, their GitHub connection still
// reaches their environment, the bots' plugins and skills still load), and
// the UI shows it read-only with a short notice. An organization admin is
// never narrowed, and a solo server never reads the field.
//
// The engine's own plugin and MCP commands are refused for their turns too:
// `/plugin`, `/plugins`, `/mcp` and `/reload-*` typed in the chat are
// managed by Sagax for everyone (shared/harness-commands.ts), the host Bash
// is denied on an organization server (withholdHostTools), and in the
// person's server environment `run_command` refuses the CLIs' plugin, MCP
// and extension subcommands (`engineIntegrationCommand`). That last check
// is a courtesy, not the boundary: nothing a person installs in their
// environment reaches a bot's turn, which loads only the plugins Sagax
// keeps (`--plugin-dir`) and the servers Sagax mounts.

/** The refusal a person gets on a change an admin keeps. */
export const INTEGRATIONS_ADMIN_ONLY = {
  error: "Your administrator manages plugins and MCP servers.",
  code: "org_integrations_admin_only",
} as const;

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
