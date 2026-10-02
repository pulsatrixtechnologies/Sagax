// Engine (harness) slash commands in the chat: what an engine offers for a
// bot's turns, how the composer lists them next to Sagax's own commands, and
// how a typed command reaches the engine.
//
// Claude Code lists its commands, without a model call, in the answer to the
// stream-json control request `initialize` (built-ins, the project's
// .claude/commands and skills, plugin commands and skills, MCP prompts as
// mcp__<server>__<prompt>). The live session's `system/init` adds
// `terminal_slash_commands`: the ones only a terminal can run.
// Codex lists its skills through the app-server's `skills/list`.
//
// Sagax's own commands win a name collision; the engine's is then reachable
// as /engine:<name>, which the server turns back into /<name>.

export type HarnessCommandGroup = "engine" | "plugins" | "mcp";

/** Why a listed command cannot run from the chat. */
export type HarnessCommandUnavailable =
  | "interactive" // needs Claude Code's own terminal UI
  | "managed";    // Sagax manages it (model, effort, sessions, approvals, MCP)

export interface HarnessCommand {
  /** The engine's own name, without the slash (`compact`, `pulsatrix-flow:using-px-flow`). */
  name: string;
  description: string;
  argumentHint?: string;
  aliases?: string[];
  group: HarnessCommandGroup;
  unavailable?: HarnessCommandUnavailable;
  /** Codex: the skill file the turn hands to the engine. */
  path?: string;
}

export interface HarnessCommandList {
  engine: "claude" | "codex";
  commands: HarnessCommand[];
  /** When the list was read (ms since epoch). */
  at: number;
}

/** Sagax's own composer commands. They always win a collision. */
export const SAGAX_COMMAND_NAMES = ["goal", "learn", "setup"] as const;
/** The prefix that reaches an engine command shadowed by a Sagax one. */
export const ENGINE_COMMAND_PREFIX = "engine:";

const NAME = /^[\w][\w.:-]{0,127}$/;
const MAX_COMMANDS = 600;
const MAX_DESCRIPTION = 400;
const MAX_HINT = 160;

/** Commands only Claude Code's terminal can run (a fallback for
 * `terminal_slash_commands`, which only a live session reports). */
const CLAUDE_INTERACTIVE = new Set([
  "doctor", "color", "focus", "reload-plugins", "heapdump", "theme", "vim",
  "terminal-setup", "ide", "keybindings", "statusline", "hooks", "memory",
  "import", "design", "design-consent", "design-revoke", "team-onboarding",
  "remote-control", "add-dir", "export", "copy", "status", "help", "bug",
  "feedback", "release-notes", "upgrade", "privacy-settings", "install-github-app",
]);

/** Commands whose job Sagax does itself: running them inside a bot's
 * session would put it out of step with Sagax (model, effort, the session
 * Sagax resumes, approvals, the MCP servers Sagax mounts). */
const CLAUDE_MANAGED = new Set([
  "clear", "reset", "new", "resume", "rename", "name", "model", "effort", "fast",
  "config", "settings", "permissions", "allowed-tools", "mcp", "output-style",
  "auto-mode-setup", "autocompact", "login", "logout", "exit", "quit",
  "advisor", "agents", "plugin", "plugins", "reload-skills", "sandbox",
]);

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // one line, no control characters
  const clean = value.replace(/[\p{Cc}]+/gu, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function groupOf(name: string): HarnessCommandGroup {
  if (name.startsWith("mcp__")) return "mcp";
  if (name.includes(":")) return "plugins";
  return "engine";
}

/** Claude Code's command list (the `commands` of an `initialize` answer, or
 * the bare names of `slash_commands`) as Sagax lists it. Hidden entries
 * (`__…`) are left out; `terminal` names the session's terminal-only ones. */
export function normalizeClaudeCommands(
  raw: unknown,
  options: { terminal?: readonly string[] } = {},
): HarnessCommand[] {
  if (!Array.isArray(raw)) return [];
  const terminal = new Set(options.terminal ?? []);
  const out: HarnessCommand[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const record = typeof entry === "string" ? { name: entry } : entry && typeof entry === "object" ? entry as Record<string, unknown> : null;
    if (!record) continue;
    const name = typeof record.name === "string" ? record.name.replace(/^\//, "").trim() : "";
    if (!NAME.test(name) || name.startsWith("_") || seen.has(name)) continue;
    seen.add(name);
    const aliases = Array.isArray(record.aliases)
      ? record.aliases.filter((alias): alias is string => typeof alias === "string" && NAME.test(alias) && alias !== name).slice(0, 8)
      : [];
    const argumentHint = text(record.argumentHint, MAX_HINT);
    const unavailable: HarnessCommandUnavailable | undefined = terminal.has(name) || CLAUDE_INTERACTIVE.has(name)
      ? "interactive"
      : CLAUDE_MANAGED.has(name) ? "managed" : undefined;
    out.push({
      name,
      description: text(record.description, MAX_DESCRIPTION),
      ...(argumentHint ? { argumentHint } : {}),
      ...(aliases.length ? { aliases } : {}),
      group: groupOf(name),
      ...(unavailable ? { unavailable } : {}),
    });
    if (out.length >= MAX_COMMANDS) break;
  }
  return out;
}

/** The control response of Claude's `initialize` request, or null. */
export function claudeInitializeCommands(message: unknown, requestId: string): HarnessCommand[] | null {
  if (!message || typeof message !== "object") return null;
  const record = message as { type?: unknown; response?: { subtype?: unknown; request_id?: unknown; response?: { commands?: unknown } } };
  if (record.type !== "control_response" || record.response?.request_id !== requestId) return null;
  if (record.response.subtype !== "success") return [];
  return normalizeClaudeCommands(record.response.response?.commands);
}

/** Codex's `skills/list` result as commands: enabled skills only, a
 * plugin's under Plugins. */
export function normalizeCodexSkills(result: unknown): HarnessCommand[] {
  const data = (result as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: HarnessCommand[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    const skills = (entry as { skills?: unknown } | null)?.skills;
    if (!Array.isArray(skills)) continue;
    for (const skill of skills) {
      if (!skill || typeof skill !== "object") continue;
      const record = skill as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      if (record.enabled === false || !NAME.test(name) || seen.has(name)) continue;
      const path = typeof record.path === "string" ? record.path : "";
      if (!path) continue;
      seen.add(name);
      const interfaceDescription = (record.interface as { shortDescription?: unknown } | undefined)?.shortDescription;
      const description = text(interfaceDescription ?? record.shortDescription ?? record.description, MAX_DESCRIPTION);
      out.push({
        name,
        description,
        group: typeof record.pluginId === "string" && record.pluginId ? "plugins" : "engine",
        path,
      });
      if (out.length >= MAX_COMMANDS) return out;
    }
  }
  return out;
}

// ── a typed command ──────────────────────────────────────────────────────

export interface TypedCommand {
  name: string;
  /** Everything after the name, as typed (leading whitespace removed). */
  args: string;
}

/** The `/name args` at the very start of a message, or null. */
export function parseTypedCommand(message: string): TypedCommand | null {
  const match = /^\/([\w][\w.:-]*)(?:\s+([\s\S]*))?$/.exec(message.trim());
  if (!match) return null;
  return { name: match[1] ?? "", args: (match[2] ?? "").trim() };
}

export function isSagaxCommandName(name: string): boolean {
  return (SAGAX_COMMAND_NAMES as readonly string[]).includes(name.toLowerCase());
}

/** How the composer and the chat show an engine command: its own name, or
 * /engine:<name> when a Sagax command owns that name. */
export function engineCommandLabel(command: Pick<HarnessCommand, "name">): string {
  return isSagaxCommandName(command.name) ? `/${ENGINE_COMMAND_PREFIX}${command.name}` : `/${command.name}`;
}

export type CommandResolution =
  | { kind: "none" }
  | { kind: "sagax"; name: string }
  | { kind: "engine"; command: HarnessCommand; args: string; engineText: string }
  | { kind: "unavailable"; command: HarnessCommand; reason: HarnessCommandUnavailable };

function findCommand(commands: readonly HarnessCommand[], name: string): HarnessCommand | undefined {
  return commands.find((command) => command.name === name)
    ?? commands.find((command) => command.aliases?.includes(name));
}

/** What a message starting with a slash is. Sagax's own commands win; an
 * engine command they shadow is reached as /engine:<name>. A name the
 * engine does not list is an ordinary message. */
export function resolveTypedCommand(message: string, commands: readonly HarnessCommand[]): CommandResolution {
  const typed = parseTypedCommand(message);
  if (!typed) return { kind: "none" };
  if (isSagaxCommandName(typed.name)) return { kind: "sagax", name: typed.name.toLowerCase() };
  const explicit = typed.name.toLowerCase().startsWith(ENGINE_COMMAND_PREFIX);
  const name = explicit ? typed.name.slice(ENGINE_COMMAND_PREFIX.length) : typed.name;
  const command = name ? findCommand(commands, name) : undefined;
  if (!command) return { kind: "none" };
  if (command.unavailable) return { kind: "unavailable", command, reason: command.unavailable };
  const engineText = typed.args ? `/${name} ${typed.args}` : `/${name}`;
  return { kind: "engine", command, args: typed.args, engineText };
}
