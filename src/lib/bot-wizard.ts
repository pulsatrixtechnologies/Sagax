// The bot creation wizard's client side (shared/bot-wizard.ts has the
// draft, server/routes/bot-wizard.ts keeps it): the calls the screen makes,
// each on an existing route. The bot is a real bot from the first step,
// created with the same Auto defaults as New bot (POST /api/bots); its
// fields change through the bot's own PATCH, its rules through
// /api/custom-rules and its routines through /api/routines when the person
// finishes. Pure helpers are exported for tests.
import { api as defaultApi, type Bot } from "@/state/store";
import { autoSelectionReady } from "@/lib/first-bot";
import {
  kitSuggestions,
  ruleSuggestion,
  routineSuggestion,
  pick,
  type WizardDraft,
  type WizardMode,
  type WizardPatch,
  type WizardAnswers,
  type WizardTool,
} from "../../shared/bot-wizard";

type Request = typeof defaultApi;

/** A draft as the server sends it: with its bot's name. */
export type WireWizardDraft = WizardDraft & { botName?: string };

export interface WizardSuggestions {
  answers?: WizardAnswers;
  rules: Array<{ id: string; behavior: "allow" | "ask" | "deny"; when: string }>;
  routines: Array<{ id: string; name: string; prompt: string; time: string; weekdays: number[] }>;
  tools: WizardTool[];
  apps: string[];
}

export const PENDING_RULE = "pending";

export async function listWizardDrafts(request: Request = defaultApi): Promise<WireWizardDraft[]> {
  return (await request<{ drafts: WireWizardDraft[] }>("/api/bot-wizard")).drafts ?? [];
}

export async function readWizardDraft(botId: string, language: string, request: Request = defaultApi): Promise<{ draft: WireWizardDraft; suggestions: WizardSuggestions }> {
  return request(`/api/bot-wizard/${encodeURIComponent(botId)}?language=${encodeURIComponent(language)}`);
}

export async function startWizardDraft(botId: string, body: { origin: "new" | "redo"; mode: WizardMode; roleId?: string; restart?: boolean }, request: Request = defaultApi): Promise<WireWizardDraft> {
  return (await request<{ draft: WireWizardDraft }>(`/api/bot-wizard/${encodeURIComponent(botId)}`, { method: "PUT", body: JSON.stringify(body) })).draft;
}

export async function patchWizardDraft(botId: string, patch: WizardPatch, request: Request = defaultApi): Promise<WireWizardDraft> {
  return (await request<{ draft: WireWizardDraft }>(`/api/bot-wizard/${encodeURIComponent(botId)}`, { method: "PATCH", body: JSON.stringify(patch) })).draft;
}

export async function writeSoulForMe(botId: string, language: string, request: Request = defaultApi): Promise<{ soul: string; source: "model" | "answers" }> {
  return request(`/api/bot-wizard/${encodeURIComponent(botId)}/soul`, { method: "POST", body: JSON.stringify({ language: language.startsWith("fr") ? "fr" : "en" }) });
}

export async function deleteWizardDraft(botId: string, request: Request = defaultApi): Promise<void> {
  await request(`/api/bot-wizard/${encodeURIComponent(botId)}`, { method: "DELETE" });
}

interface BotDefaultsResponse {
  modelSelection?: { instanceId: string; model: string; auto?: boolean; effort?: string; variant?: string };
  suggestedName?: string;
}

/** The wizard's bot: created at once on the server's Auto defaults, as New
 * bot and the first run do, under the suggested name the person changes in
 * step 1. It stays a draft (its wizard draft says so) until they finish. */
export async function createWizardBot(request: Request = defaultApi): Promise<Bot> {
  const defaults = await request<BotDefaultsResponse>("/api/bot-defaults");
  const selection = defaults.modelSelection;
  const body = {
    ...(defaults.suggestedName?.trim() ? { name: defaults.suggestedName.trim() } : {}),
    ...(autoSelectionReady(selection) ? { modelSelection: selection } : {}),
  };
  return (await request<{ bot: Bot }>("/api/bots", { method: "POST", body: JSON.stringify(body) })).bot;
}

/** The custom rule a suggestion becomes (POST /api/custom-rules). Pure. */
export function ruleBody(suggestionId: string, botId: string, language: string): { when: string; behavior: "allow" | "ask" | "deny"; botId: string; riskScope: string[] } | null {
  const suggestion = ruleSuggestion(suggestionId);
  if (!suggestion) return null;
  return { when: pick(suggestion.when, language), behavior: suggestion.behavior, botId, riskScope: [] };
}

/** Apply or remove one suggested rule; returns the draft's rules patch. */
export async function setSuggestedRule(draft: WizardDraft, suggestionId: string, on: boolean, language: string, request: Request = defaultApi): Promise<Record<string, string | null>> {
  const existing = draft.rules[suggestionId];
  if (!on) {
    if (existing && existing !== PENDING_RULE) {
      try { await request(`/api/custom-rules/${encodeURIComponent(existing)}`, { method: "DELETE" }); }
      catch { /* already removed by hand: the draft forgets it all the same */ }
    }
    return { [suggestionId]: null };
  }
  if (existing && existing !== PENDING_RULE) return {};
  const body = ruleBody(suggestionId, draft.botId, language);
  if (!body) return {};
  const created = await request<{ rule?: { id: string } }>("/api/custom-rules", { method: "POST", body: JSON.stringify(body) });
  return created.rule?.id ? { [suggestionId]: created.rule.id } : {};
}

/** Suggestions the Primary Bot marked "pending" (bot.wizard) in guided
 * mode: the app makes each rule with the person's own session. Pure. */
export function pendingRules(draft: Pick<WizardDraft, "rules">): string[] {
  return Object.entries(draft.rules).filter(([, value]) => value === PENDING_RULE).map(([id]) => id);
}

/** The routine a picked suggestion becomes (POST /api/routines). Pure. */
export function routineBody(suggestionId: string, botId: string, language: string): Record<string, unknown> | null {
  const suggestion = routineSuggestion(suggestionId);
  if (!suggestion) return null;
  return {
    name: pick(suggestion.name, language),
    prompt: pick(suggestion.prompt, language),
    botId,
    target: "bot",
    enabled: true,
    schedule: { type: "daily", time: suggestion.time, weekdays: suggestion.weekdays },
  };
}

/** Finish: create the picked routines, then mark the draft done. A routine
 * that fails is reported, never a reason to undo the bot. */
export async function finishWizard(draft: WizardDraft, language: string, request: Request = defaultApi): Promise<{ draft: WireWizardDraft; failed: string[] }> {
  const failed: string[] = [];
  for (const id of draft.routines) {
    const body = routineBody(id, draft.botId, language);
    if (!body) continue;
    try { await request("/api/routines", { method: "POST", body: JSON.stringify(body) }); }
    catch { failed.push(String(body.name)); }
  }
  const done = (await request<{ draft: WireWizardDraft }>(`/api/bot-wizard/${encodeURIComponent(draft.botId)}/finish`, { method: "POST", body: "{}" })).draft;
  return { draft: done, failed };
}

/** A conversation on a bot, created for the wizard (guided chat, Try it). */
export async function openWizardThread(botId: string, title: string, request: Request = defaultApi): Promise<string> {
  const created = await request<{ bot?: { threadId?: string }; task?: { threadId?: string } }>(`/api/bots/${encodeURIComponent(botId)}/tasks`, { method: "POST", body: JSON.stringify({ title }) });
  const threadId = created.task?.threadId ?? created.bot?.threadId;
  if (!threadId) throw new Error("Could not open a conversation");
  return threadId;
}

export async function sendWizardMessage(botId: string, threadId: string, text: string, request: Request = defaultApi): Promise<void> {
  await request(`/api/bots/${encodeURIComponent(botId)}/messages`, { method: "POST", body: JSON.stringify({ text, threadId, sendId: crypto.randomUUID() }) });
}

/** The bot that guides: the person's Primary Bot, else their first other
 * bot (never the one being made). Pure. */
export function guideBot<T extends Pick<Bot, "id" | "hidden" | "chiefOfStaff">>(bots: readonly T[], draftBotId: string | null): T | null {
  const others = bots.filter((bot) => !bot.hidden && bot.id !== draftBotId);
  return others.find((bot) => bot.chiefOfStaff) ?? others[0] ?? null;
}

/** "Do it for me" chips: the role's answer, only when the field is empty
 * or different. Pure. */
export function answerSuggestion(suggestions: WizardSuggestions | null, key: keyof WizardAnswers, current: string): string | null {
  const value = suggestions?.answers?.[key]?.trim();
  return value && value !== current.trim() ? value : null;
}

/** A routine's schedule in words: "08:00, Mon to Fri". Pure. */
export function scheduleLabel(time: string, weekdays: readonly number[], dayNames: readonly string[], weekdaysLabel: string, everyDayLabel: string): string {
  const days = [...weekdays].sort();
  if (days.length === 7) return `${time}, ${everyDayLabel}`;
  if (days.join() === "1,2,3,4,5") return `${time}, ${weekdaysLabel}`;
  return `${time}, ${days.map((day) => dayNames[day] ?? "").filter(Boolean).join(", ")}`;
}

/** The suggestions of a role, in one language (shared kits). Pure. */
export function wizardSuggestions(roleId: string, language: string): WizardSuggestions {
  return kitSuggestions(roleId, language);
}
