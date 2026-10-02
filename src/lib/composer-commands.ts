import {
  engineCommandLabel,
  leadingMention,
  type GroupCommandMember,
  type GroupCommandResponder,
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
    /** In a group: the bot whose engine lists it (the menu groups by bot). */
    bot?: { id: string; name: string };
    /** In a group that names no single bot: the mention picking it adds. */
    mentionPrefix?: string;
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
 * for its arguments, after the bot's mention when the group needs one. */
export function engineCommandInsertion(item: Extract<ComposerMenuItem, { kind: "engine" }>): string {
  return `${item.mentionPrefix ?? ""}${item.label} `;
}

// ── groups ───────────────────────────────────────────────────────────────

/** The "/" being typed in a group: at the very start, or right after a
 * leading `@Bot ` (that bot's engine commands only). */
export interface ComposerGroupSlash {
  trigger: ComposerSlashTrigger;
  /** The bot the draft starts by mentioning. */
  botId?: string;
}

export function composerGroupSlashTrigger(
  text: string,
  caretInput: number,
  members: readonly GroupCommandMember[],
): ComposerGroupSlash | null {
  const plain = composerSlashTrigger(text, caretInput);
  if (plain) return { trigger: plain };
  const caret = Math.max(0, Math.min(text.length, Math.floor(caretInput)));
  const mention = leadingMention(text, members);
  if (!mention || mention.rest > caret || !/\s/u.test(text[mention.rest - 1] ?? "")) return null;
  const match = /^\/([\w.:-]*)$/.exec(text.slice(mention.rest, caret));
  if (!match) return null;
  return { trigger: { query: match[1] ?? "", start: mention.rest, end: caret }, botId: mention.member.id };
}

/** Whose engine commands a group's "/" menu lists: the mentioned bot, else
 * the lead when it answers alone, else every active member, each picked
 * command then starting with that bot's mention so it reaches it only. */
export function groupCommandTargets<T extends GroupCommandMember>(
  slash: Pick<ComposerGroupSlash, "botId">,
  members: readonly T[],
  defaultResponder: GroupCommandResponder,
): Array<{ bot: T; mention: boolean }> {
  const available = members.filter((member) => !member.hidden);
  if (slash.botId) {
    const bot = available.find((member) => member.id === slash.botId);
    return bot ? [{ bot, mention: false }] : [];
  }
  if (defaultResponder.kind === "member") {
    const lead = available.find((member) => member.id === defaultResponder.botId);
    if (lead) return [{ bot: lead, mention: false }];
  }
  return available.map((bot) => ({ bot, mention: true }));
}

export interface GroupEngineCommands {
  bot: { id: string; name: string };
  commands: readonly HarnessCommand[];
  /** Picking one adds `@Name ` in front. */
  mention: boolean;
}

/** The fewest rows a bot keeps in a group's "/" menu, however many bots. */
const GROUP_MENU_MIN_PER_BOT = 8;

/** How many of its engine commands each bot shows in a group's "/" menu:
 * the menu's room shared evenly, so a bot listing many commands never
 * crowds out the bots after it. */
export function groupMenuLimitPerBot(bots: number): number {
  if (bots <= 0) return 0;
  return Math.max(GROUP_MENU_MIN_PER_BOT, Math.floor(MENU_LIMIT / bots));
}

/** A group's "/" menu: Sagax's commands, then each bot's engine commands
 * under that bot's name, ranked as in a 1:1 and capped per bot. */
export function composerGroupCommandMenu(
  sagax: readonly ComposerSlashCommand[],
  sets: readonly GroupEngineCommands[],
  query: string,
): ComposerMenuItem[] {
  const items: ComposerMenuItem[] = composerCommandMenu(sagax, [], query);
  const perBot = groupMenuLimitPerBot(sets.length);
  for (const set of sets) {
    let shown = 0;
    for (const item of composerCommandMenu([], set.commands, query)) {
      if (shown >= perBot) break;
      if (item.kind !== "engine") continue;
      items.push({
        ...item,
        key: `bot:${set.bot.id}:${item.key}`,
        bot: set.bot,
        ...(set.mention ? { mentionPrefix: `@${set.bot.name} ` } : {}),
      });
      shown += 1;
    }
  }
  return items;
}

/** The heading a menu row starts under: its bot in a group, else its group. */
export function composerMenuSection(item: ComposerMenuItem): string {
  return item.kind === "engine" && item.bot ? `bot:${item.bot.id}` : item.group;
}
