// The bot panel's Suggestions card (reference design): a short list of next
// steps for this bot, built from what the app already knows. Two sources:
// the server's setup checklist (GET /api/bots/:id/overview `setup`) and the
// bot's conversations waiting on the person (a task whose activity is
// "waiting-on-you", or a bot-to-bot conversation in `waitingApprovals`).
// Pure: the card draws the words, this decides which rows and in what order.
import type { BotSettingsSection } from "@/state/store";
import type { SetupStep } from "@/lib/bot-overview-types";
import type { LocaleKey } from "@/locales";

export type BotSuggestionAction =
  | { kind: "openThread"; threadId: string }
  | { kind: "openSection"; section: BotSettingsSection };

export interface BotSuggestion {
  /** Stable across reloads: what Hide remembers. */
  id: string;
  /** i18n key of the bold title. */
  titleKey: LocaleKey;
  /** i18n key of the muted line under it. */
  subtitleKey: LocaleKey;
  /** Values for both keys (a conversation's title). */
  vars?: Record<string, string>;
  action: BotSuggestionAction;
}

export interface BotSuggestionInput {
  setup?: readonly SetupStep[] | null;
  tasks?: ReadonlyArray<{ threadId: string; title?: string; activity?: string; hidden?: true; routineRunId?: string }>;
  waitingApprovals?: ReadonlyArray<{ threadId: string; openedByName?: string }>;
}

const MAX = 4;

const STEP_SECTION: Record<SetupStep["id"], BotSettingsSection> = {
  identity: "overview",
  soul: "soul",
  folder: "access",
  apps: "access",
  schedule: "routines",
};

export function botSuggestions(input: BotSuggestionInput): BotSuggestion[] {
  const out: BotSuggestion[] = [];
  const seen = new Set<string>();
  // What waits on the person comes first: a turn is blocked on it.
  for (const task of input.tasks ?? []) {
    if (task.activity !== "waiting-on-you" || task.hidden || seen.has(task.threadId)) continue;
    seen.add(task.threadId);
    const title = task.title?.trim();
    out.push({
      id: `approval:${task.threadId}`,
      titleKey: "botPanel.suggestions.approval.title",
      subtitleKey: title ? "botPanel.suggestions.approval.inThread" : "botPanel.suggestions.approval.subtitle",
      ...(title ? { vars: { title } } : {}),
      action: { kind: "openThread", threadId: task.threadId },
    });
  }
  for (const row of input.waitingApprovals ?? []) {
    if (seen.has(row.threadId)) continue;
    seen.add(row.threadId);
    const name = row.openedByName?.trim();
    out.push({
      id: `approval:${row.threadId}`,
      titleKey: "botPanel.suggestions.approval.title",
      subtitleKey: name ? "botPanel.suggestions.approval.fromBot" : "botPanel.suggestions.approval.subtitle",
      ...(name ? { vars: { name } } : {}),
      action: { kind: "openThread", threadId: row.threadId },
    });
  }
  for (const step of input.setup ?? []) {
    if (step.done || !(step.id in STEP_SECTION)) continue;
    out.push({
      id: `setup:${step.id}`,
      titleKey: `botPanel.suggestions.setup.${step.id}.title` as LocaleKey,
      subtitleKey: `botPanel.suggestions.setup.${step.id}.subtitle` as LocaleKey,
      action: { kind: "openSection", section: STEP_SECTION[step.id] },
    });
  }
  return out.slice(0, MAX);
}

/** The rows still shown once the person hid some: Hide remembers the ids it
 * hid, so a new suggestion brings the card back. */
export function visibleSuggestions(all: readonly BotSuggestion[], hidden: ReadonlySet<string>): BotSuggestion[] {
  return all.filter((item) => !hidden.has(item.id));
}

const KEY = "sagax.botSuggestions.hidden.v1";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function readAll(store: Storage | null): Record<string, string[]> {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string[]> : {};
  } catch { return {}; }
}

export function hiddenSuggestions(botId: string, store: Storage | null = storage()): Set<string> {
  const list = readAll(store)[botId];
  return new Set(Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : []);
}

/** Hide every suggestion shown now, for this bot, on this computer. */
export function hideSuggestions(botId: string, ids: readonly string[], store: Storage | null = storage()): Set<string> {
  const all = readAll(store);
  const next = [...new Set([...(Array.isArray(all[botId]) ? all[botId]! : []), ...ids])].slice(-50);
  all[botId] = next;
  try { store?.setItem(KEY, JSON.stringify(all)); } catch { /* storage full or off: hidden for this view only */ }
  return new Set(next);
}
