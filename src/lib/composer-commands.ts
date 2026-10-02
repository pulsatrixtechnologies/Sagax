import {
  engineCommandLabel,
  type HarnessCommand,
  type HarnessCommandGroup,
  type HarnessCommandUnavailable,
} from "../../shared/harness-commands";

export type ComposerSlashCommandId = "goal" | "learn" | "setup";

export interface ComposerSlashCommand {
  id: ComposerSlashCommandId;
  label: `/${ComposerSlashCommandId}`;
  description: string;
}

export interface ComposerSlashTrigger {
  query: string;
  start: number;
  end: number;
}

/** Slash commands configure the whole send, so they are offered only at the
 * beginning of a draft and only while the first token is being typed. */
export function composerSlashTrigger(text: string, caretInput: number): ComposerSlashTrigger | null {
  const caret = Math.max(0, Math.min(text.length, Math.floor(caretInput)));
  const prefix = text.slice(0, caret);
  const match = /^\/([\w.:-]*)$/.exec(prefix);
  if (!match) return null;
  return { query: match[1] ?? "", start: 0, end: caret };
}

/** A typed `/goal …` is equivalent to selecting Goal mode from the menu.
 * null means this is an ordinary chat message; an empty string means the
 * command is present but still needs a goal description or attachment. */
export function goalTextFromComposer(text: string): string | null {
  const match = /^\/goal(?:\s+([\s\S]*))?$/i.exec(text);
  return match ? (match[1] ?? "").trimStart() : null;
}

/** Replace the active slash token and return the caret position immediately
 * after the inserted text. */
export function replaceComposerSlashTrigger(
  text: string,
  trigger: ComposerSlashTrigger,
  replacement: string,
): { text: string; caret: number } {
  const next = `${text.slice(0, trigger.start)}${replacement}${text.slice(trigger.end)}`;
  return { text: next, caret: trigger.start + replacement.length };
}

/** One row of the "/" menu: a Sagax command, or one of the engine's own
 * (shared/harness-commands.ts), grouped Sagax, Engine, Plugins, MCP. */
export type ComposerMenuItem =
  | { kind: "sagax"; key: string; group: "sagax"; label: string; description: string; command: ComposerSlashCommand }
  | {
    kind: "engine";
    key: string;
    group: HarnessCommandGroup;
    label: string;
    description: string;
    argumentHint?: string;
    unavailable?: HarnessCommandUnavailable;
    command: HarnessCommand;
  };

export const COMPOSER_MENU_GROUPS = ["sagax", "engine", "plugins", "mcp"] as const;
export type ComposerMenuGroup = (typeof COMPOSER_MENU_GROUPS)[number];
const MENU_LIMIT = 80;

function matchRank(query: string, names: readonly string[], description: string): number | null {
  if (!query) return 0;
  if (names.some((name) => name.startsWith(query))) return 0;
  // a plugin command by its short name (`using-px-flow` for `pulsatrix-flow:using-px-flow`)
  if (names.some((name) => name.split(":").pop()?.startsWith(query))) return 1;
  if (names.some((name) => name.includes(query))) return 2;
  if (description.toLowerCase().includes(query)) return 3;
  return null;
}

/** The "/" menu for a query: Sagax's commands first, then the engine's by
 * group; within a group the closest names first, what the chat cannot run
 * last. An engine command a Sagax one shadows is offered as /engine:<name>. */
export function composerCommandMenu(
  sagax: readonly ComposerSlashCommand[],
  engine: readonly HarnessCommand[],
  queryInput: string,
): ComposerMenuItem[] {
  const query = queryInput.toLowerCase();
  const ranked: Array<{ item: ComposerMenuItem; rank: number; order: number }> = [];
  sagax.forEach((command, order) => {
    const rank = matchRank(query, [command.id], command.description);
    if (rank !== null) ranked.push({ item: { kind: "sagax", key: `sagax:${command.id}`, group: "sagax", label: command.label, description: command.description, command }, rank, order });
  });
  engine.forEach((command, order) => {
    const label = engineCommandLabel(command);
    const names = [label.slice(1).toLowerCase(), command.name.toLowerCase(), ...(command.aliases ?? []).map((alias) => alias.toLowerCase())];
    const rank = matchRank(query, names, command.description);
    if (rank === null) return;
    ranked.push({
      item: {
        kind: "engine",
        key: `engine:${command.name}`,
        group: command.group,
        label,
        description: command.description,
        ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
        ...(command.unavailable ? { unavailable: command.unavailable } : {}),
        command,
      },
      rank: rank + (command.unavailable ? 10 : 0),
      order,
    });
  });
  const groupIndex = (group: ComposerMenuGroup) => COMPOSER_MENU_GROUPS.indexOf(group);
  ranked.sort((a, b) => groupIndex(a.item.group) - groupIndex(b.item.group) || a.rank - b.rank || a.order - b.order);
  return ranked.slice(0, MENU_LIMIT).map((entry) => entry.item);
}

/** What picking an engine command puts in the draft: its label and a space
 * for its arguments. */
export function engineCommandInsertion(item: Extract<ComposerMenuItem, { kind: "engine" }>): string {
  return `${item.label} `;
}
