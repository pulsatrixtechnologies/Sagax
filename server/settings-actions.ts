// sagax_settings: a bot reads and changes any setting of the app for the
// person speaking to it (JC, 2026-10-19). The registry
// (shared/settings-actions.ts) names the route the screen calls; the policy
// (shared/settings-actions-policy.ts) decides run or card; the act engine
// (server/bot-act.ts) replays the route with the person's own session, so
// the person's rights, the route's checks, security keys and the audit
// journal apply exactly as by hand. Nothing here writes a setting itself.

import type { ApprovalMode } from "../shared/approval-mode.ts";
import type { TurnFacts } from "../shared/bot-act.ts";
import { actorForTurn } from "../shared/bot-act.ts";
import { decideSettingEffect, HOLD_TEXT, type SettingClass } from "../shared/settings-actions-policy.ts";
import { pickValue, SETTING_FAMILIES, SETTINGS, settingSpec, valueFits, type SettingIds, type SettingSpec } from "../shared/settings-actions.ts";
import { STEP_UP_CLASSES, botActClasses, type StepUpClass } from "../shared/step-up.ts";
import type { BotActResult, BotActService } from "./bot-act.ts";

export type SettingsActionDeps = {
  organization: () => boolean;
  facts: (threadId: string, generation: string) => TurnFacts;
  acts: () => BotActService;
  /** The speaker as an owner id: the person, or this computer's operator. */
  operatorId: () => string;
  botOwner: (botId: string) => string | null;
  botOfThread: (threadId: string) => string | null;
  routineBot: (routineId: string) => string | null;
  groupOwner: (groupId: string) => string | null;
  /** The speaking bot's level for this turn (approvalModeForTurn). */
  turnMode: (botId: string, threadId: string) => ApprovalMode;
  /** The step-up classes the person protects among these (security keys). */
  keyRequired: (person: string | null, classes: StepUpClass[], fallback: string | null) => StepUpClass[];
  audit: (row: { key: string; target?: string; value: unknown; secret: boolean; how: "run" | "allowed"; botId: string; actor: string | null }) => void;
  /** A screen command to the person's open app (a device preference). */
  screen: (facts: TurnFacts, command: string, input: Record<string, unknown>) => BotActResult;
};

export type SettingsActionInput = {
  args: Record<string, unknown>;
  botId: string;
  threadId: string;
  generation: string;
  botName: string;
  botColor: string;
};

const PERMISSION_RANK: Readonly<Record<string, ApprovalMode>> = { approval: "ask", auto: "auto", bypass: "full" };

/** The step-up classes a change belongs to: the act route's own (a write is
 * irreversible, a routine a standing grant, a delete destructive) plus the
 * setting's. Full answers every call, so entering it carries every class. */
export function settingStepUpClasses(classes: readonly SettingClass[], route: { method: string; path: string }, approvalTo?: ApprovalMode): StepUpClass[] {
  const out = new Set<StepUpClass>(botActClasses({ kind: "route", method: route.method, path: route.path }));
  if (classes.includes("rule-change")) out.add("rule-change");
  if (classes.includes("delete")) out.add("destructive");
  if (classes.includes("secret") || classes.includes("others") || classes.includes("org") || classes.includes("bulk")) out.add("irreversible");
  if (approvalTo === "full" || approvalTo === "custom") for (const name of STEP_UP_CLASSES) out.add(name);
  return STEP_UP_CLASSES.filter((name) => out.has(name));
}

function text(status: number, body: string): BotActResult {
  return status >= 400 ? { status, body: { error: body } } : { status, body: { text: body } };
}

function listText(family: unknown): string {
  const families = typeof family === "string" && (SETTING_FAMILIES as readonly string[]).includes(family) ? [family] : SETTING_FAMILIES;
  const lines: string[] = [];
  for (const name of families) {
    const specs = SETTINGS.filter((spec) => spec.family === name);
    if (!specs.length) continue;
    lines.push(`# ${name}`);
    for (const spec of specs) {
      const target = spec.target === "none" || spec.target === "self" ? "" : ` [target: ${spec.target} id]`;
      lines.push(`${spec.key}${target} = ${spec.value}: ${spec.label} (${spec.where})`);
    }
  }
  return lines.join("\n");
}

export function createSettingsActions(deps: SettingsActionDeps) {
  /** Fill the ids a setting needs: this bot or this conversation by default. */
  function resolve(spec: SettingSpec, raw: unknown, input: SettingsActionInput, speaker: string | null): SettingIds | string {
    const given = typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
    if (given && (given.length > 200 || /[\s/\\?#%]/.test(given) && spec.target !== "section")) return "target is an id.";
    switch (spec.target) {
      case "bot": return { target: given ?? input.botId, botId: given ?? input.botId };
      case "thread": {
        const threadId = given ?? input.threadId;
        const botId = deps.botOfThread(threadId);
        return botId ? { target: threadId, botId } : "No such conversation.";
      }
      case "routine": {
        if (!given) return "target is the routine's id (list_routines).";
        const botId = deps.routineBot(given);
        return botId ? { target: given, botId } : "No such routine.";
      }
      case "self": return speaker ? { target: speaker } : "This turn has no person.";
      case "none": return {};
      // no item: a new one
      case "credential": return given ? { target: given } : {};
      default: return given ? { target: given } : `target is the ${spec.target}'s id.`;
    }
  }

  /** Who owns what the change touches, for "the owner's own work". */
  function ownerOf(spec: SettingSpec, ids: SettingIds, speaker: string | null): string | null {
    if (spec.target === "bot" || spec.target === "thread" || spec.target === "routine") return ids.botId ? deps.botOwner(ids.botId) : null;
    if (spec.target === "group") return ids.target ? deps.groupOwner(ids.target) : null;
    // the person's own account, device, rules, vault, or a server setting
    // whose classes (org, secret) speak for it
    return speaker;
  }

  /** One value read with the person's own rights, or undefined. */
  async function readValue(facts: TurnFacts, input: SettingsActionInput, path: string, query: Record<string, string> | undefined, list: string | undefined, id: string | undefined, field: string | undefined, match = "id"): Promise<unknown> {
    const answer = await deps.acts().handlePlanned({
      facts,
      target: { kind: "route", method: "GET", path, ...(query ? { query } : {}) },
      plan: { effect: "run", summary: "Read a setting", stepUpClasses: [] },
      threadId: input.threadId, botId: input.botId, botName: input.botName, botColor: input.botColor,
      maxChars: 4_000_000,
    });
    if (answer.status >= 400) throw Object.assign(new Error(String(answer.body.error ?? "refused")), { status: answer.status });
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(answer.body.text ?? ""));
    } catch {
      return undefined;
    }
    let item: unknown = parsed;
    if (list) {
      const rows = (parsed as Record<string, unknown> | null)?.[list];
      item = Array.isArray(rows) ? rows.find((row) => row && typeof row === "object" && (row as Record<string, unknown>)[match] === id) : undefined;
      if (item === undefined) return undefined;
    }
    return pickValue(item, field);
  }

  async function handle(input: SettingsActionInput): Promise<BotActResult> {
    const args = input.args;
    const action = args.action;
    if (action === "list") return text(200, listText(args.family));
    const spec = settingSpec(args.key);
    if (!spec) return text(400, "Unknown setting key. Call sagax_settings with action list (and a family) to see them.");
    const facts = deps.facts(input.threadId, input.generation);
    const actor = actorForTurn(facts);
    const speaker = actor.kind === "person" ? actor.personKey : actor.kind === "operator" ? deps.operatorId() : null;
    const ids = resolve(spec, args.target, input, speaker);
    if (typeof ids === "string") return text(400, ids);

    if (action === "get") {
      if (!spec.read) return text(400, `${spec.key} has no read; see it at ${spec.where}.`);
      const read = spec.read(ids);
      let value: unknown;
      try {
        value = await readValue(facts, input, read.path, read.query, read.list, spec.target === "thread" ? ids.botId : ids.target, read.field, read.match);
      } catch (error) {
        const status = (error as { status?: number }).status ?? 502;
        return text(status, error instanceof Error ? error.message : "The setting could not be read.");
      }
      if (value === undefined && read.list) return text(404, `No such ${spec.target} for this person, or no value.`);
      return text(200, JSON.stringify({ key: spec.key, value: value === undefined ? null : value }).slice(0, 8000));
    }

    if (action !== "set") return text(400, "action is list, get or set.");
    if (!("value" in args)) return text(400, "set needs a value.");
    const value = args.value;
    if (!valueFits(spec.value, value)) return text(400, `${spec.key} takes ${spec.value}.`);
    let built = spec.write(ids, value);
    if (typeof built === "string") return text(400, built);
    if (spec.key === "bot.effort" && "method" in built) {
      // effort lives in the model selection: keep the model, change the effort
      const current = await readValue(facts, input, "/api/bots", { messages: "0" }, "bots", ids.target!, "modelSelection");
      if (!current || typeof current !== "object") return text(404, "This bot's model could not be read.");
      built = { ...built, body: { modelSelection: { ...(current as Record<string, unknown>), effort: value } } };
    }
    const organization = deps.organization();
    const classes = spec.classes ? spec.classes(value, { organization }) : (["own"] as SettingClass[]);
    const approvalTo = spec.key === "bot.permissionMode"
      ? PERMISSION_RANK[String(value)]
      : spec.key === "bot.approvalMode" || spec.key === "thread.approvalMode" ? value as ApprovalMode : undefined;
    const actingOwner = deps.botOwner(input.botId);
    const targetOwner = ownerOf(spec, ids, speaker);
    const same = (a: string | null, b: string | null) => Boolean(a) && Boolean(b) && a!.trim().toLowerCase() === b!.trim().toLowerCase();
    const ownerWork = same(speaker, actingOwner) && same(speaker, targetOwner);

    if ("ui" in built) {
      // a preference on the person's device: at Approve for me or Full for
      // the person's own bot it is set at once, otherwise their card
      const decidedUi = decideSettingEffect({ classes, mode: deps.turnMode(input.botId, input.threadId), ownerWork, keyProtected: false });
      if (decidedUi.effect === "hold") {
        const held = await deps.acts().handle({ facts, raw: { ui: built.ui, input: built.input }, threadId: input.threadId, botId: input.botId, botName: input.botName, botColor: input.botColor, mode: "ask" });
        return held.status < 400 ? text(200, `${String(held.body.text ?? "")} ${HOLD_TEXT[decidedUi.reason]}`.trim()) : held;
      }
      const result = deps.screen(facts, built.ui, built.input);
      if (result.status < 400) deps.audit({ key: spec.key, value, secret: false, how: "run", botId: input.botId, actor: speaker });
      return result.status < 400 ? text(200, `${spec.label}: set in the person's open Sagax app.`) : result;
    }

    const route = { kind: "route" as const, method: built.method, path: built.path, ...(built.query ? { query: built.query } : {}), ...(built.body !== undefined ? { body: built.body } : {}) };
    const stepUpClasses = settingStepUpClasses(classes, built, approvalTo);
    const person = actor.kind === "person" ? actor.personKey : null;
    const keyProtected = deps.keyRequired(person, stepUpClasses, actingOwner).length > 0;
    const decided = decideSettingEffect({ classes, mode: deps.turnMode(input.botId, input.threadId), ownerWork, keyProtected, ...(approvalTo ? { approvalTo } : {}) });
    const secret = classes.includes("secret");
    const summary = `${spec.label} (${spec.key}${ids.target && spec.target !== "self" ? `, ${spec.target}` : ""})${secret ? "" : `: ${JSON.stringify(value).slice(0, 160)}`}`;
    const result = await deps.acts().handlePlanned({
      facts,
      target: route,
      plan: {
        effect: decided.effect,
        summary,
        stepUpClasses,
        onDone: (how) => deps.audit({ key: spec.key, ...(ids.target ? { target: ids.target } : {}), value, secret, how, botId: input.botId, actor: speaker }),
      },
      threadId: input.threadId, botId: input.botId, botName: input.botName, botColor: input.botColor,
    });
    if (decided.effect === "hold" && result.status < 400 && result.body.held) {
      return text(200, `${String(result.body.text ?? "")} ${HOLD_TEXT[decided.reason]}`.trim());
    }
    if (result.status >= 400) return result;
    return text(200, `Done: ${spec.label} changed.`);
  }

  return { handle };
}
