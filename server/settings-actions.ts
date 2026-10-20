// sagax_settings: a bot reads and changes any setting of the app for the
// person speaking to it (JC, 2026-10-19). The registry
// (shared/settings-actions.ts) names the route the screen calls; the policy
// (shared/settings-actions-policy.ts) decides run or card; the act engine
// (server/bot-act.ts) replays the route with the person's own session, so
// the person's rights, the route's checks, security keys and the audit
// journal apply exactly as by hand. Nothing here writes a setting itself.

import { createHash } from "node:crypto";

import type { ApprovalMode } from "../shared/approval-mode.ts";
import type { TurnFacts } from "../shared/bot-act.ts";
import { acceptablePath, actorForTurn } from "../shared/bot-act.ts";
import { decideSettingEffect, HOLD_TEXT, type SettingClass } from "../shared/settings-actions-policy.ts";
import { pickValue, SETTING_FAMILIES, SETTINGS, settingSpec, valueFits, type SettingIds, type SettingSpec } from "../shared/settings-actions.ts";
import { STEP_UP_CLASSES, botActClasses, type StepUpClass } from "../shared/step-up.ts";
import { valueDigest, type ActRuleCandidate, type BotActResult, type BotActService } from "./bot-act.ts";

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
  audit: (row: { key: string; target?: string; value: unknown; secret: boolean; how: "run" | "allowed" | "rule"; botId: string; actor: string | null }) => void;
  /** A screen command to the person's open app (a device preference). */
  screen: (facts: TurnFacts, command: string, input: Record<string, unknown>) => BotActResult;
  /** A record's name for a card (never its id), or undefined. */
  targetName?: (kind: string, id: string, botId?: string) => string | undefined;
};

export type SettingsActionInput = {
  args: Record<string, unknown>;
  botId: string;
  threadId: string;
  generation: string;
  botName: string;
  botColor: string;
};

/** Settings whose route asks the always-grant key itself. */
const STANDING_GRANTS: ReadonlySet<string> = new Set(["bot.alwaysAllow", "rules.commandAllow", "bot.toolGrant"]);

/** A value as a card shows it: whole up to 600 characters, else its keys and
 * a fingerprint of the whole. */
function describe(value: unknown): string {
  const whole = JSON.stringify(value) ?? "null";
  if (whole.length <= 600) return whole;
  const keys = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).join(", ") : `${whole.length} characters`;
  return `${keys} (sha256 ${createHash("sha256").update(whole).digest("hex").slice(0, 12)})`;
}

/** The step-up classes a change belongs to: the act route's own (a write is
 * irreversible, a routine a standing grant, a delete destructive) plus the
 * setting's. Full answers every call, so entering it carries every class. */
export function settingStepUpClasses(classes: readonly SettingClass[], route: { method: string; path: string }, approvalTo?: ApprovalMode, standingGrant = false): StepUpClass[] {
  const out = new Set<StepUpClass>(botActClasses({ kind: "route", method: route.method, path: route.path }));
  if (standingGrant) out.add("always-grant");
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
    // an id names one record: never a dot segment or a path; a team name
    // travels in the query
    if (given && (given.length > 200 || (spec.target !== "section" && (!/^[\w.:@+-]+$/.test(given) || /^\.+$/.test(given))))) return "target is an id.";
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
      if (!acceptablePath(read.path)) return text(400, `${spec.key}: that target cannot name a record.`);
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
    const self = spec.target === "bot" && ids.target === input.botId;
    const classes = spec.classes ? spec.classes(value, { organization, self }) : (["own"] as SettingClass[]);
    const approvalTo = spec.approvalTo?.(value) as ApprovalMode | undefined;
    const actingOwner = deps.botOwner(input.botId);
    const targetOwner = ownerOf(spec, ids, speaker);
    // ids compare exactly: a legacy person key is case-sensitive
    const same = (a: string | null, b: string | null) => Boolean(a) && a === b;
    // a routine moved to (or created for) a bot is that bot's owner's too
    const named = spec.family === "routine" ? (spec.key === "routine.bot" ? value : (value as { botId?: unknown } | null)?.botId) : undefined;
    const namedOwner = typeof named === "string" ? deps.botOwner(named) : undefined;
    const ownerWork = same(speaker, actingOwner) && same(speaker, targetOwner) && (namedOwner === undefined || same(speaker, namedOwner));
    const where = ids.target ? deps.targetName?.(spec.target, ids.target, ids.botId) : undefined;

    if ("ui" in built) {
      // a preference on the person's device: at Approve for me or Full for
      // the person's own bot it is set at once, otherwise their card
      const decidedUi = decideSettingEffect({ classes, mode: deps.turnMode(input.botId, input.threadId), ownerWork, keyProtected: false });
      if (decidedUi.effect === "hold") {
        const held = await deps.acts().handlePlanned({
          facts,
          target: { kind: "ui", command: built.ui, input: built.input, action: { type: built.ui, ...built.input }, write: true },
          plan: { effect: "hold", summary: `${spec.label} (${spec.key}): ${describe(value)}`, stepUpClasses: [], onDone: (how) => deps.audit({ key: spec.key, value, secret: false, how, botId: input.botId, actor: speaker }) },
          threadId: input.threadId, botId: input.botId, botName: input.botName, botColor: input.botColor,
        });
        return held.status < 400 ? text(200, `${String(held.body.text ?? "")} ${HOLD_TEXT[decidedUi.reason]}`.trim()) : held;
      }
      const result = deps.screen(facts, built.ui, built.input);
      if (result.status < 400) deps.audit({ key: spec.key, value, secret: false, how: "run", botId: input.botId, actor: speaker });
      return result.status < 400 ? text(200, `${spec.label}: set in the person's open Sagax app.`) : result;
    }

    // the path the server will route, as act requires (no dot segment, no
    // encoded character, never internal)
    if (!acceptablePath(built.path)) return text(400, `${spec.key}: that target or value cannot name a record.`);
    const route = { kind: "route" as const, method: built.method, path: built.path, ...(built.query ? { query: built.query } : {}), ...(built.body !== undefined ? { body: built.body } : {}) };
    const stepUpClasses = settingStepUpClasses(classes, built, approvalTo, STANDING_GRANTS.has(spec.key));
    const person = actor.kind === "person" ? actor.personKey : null;
    const keyProtected = deps.keyRequired(person, stepUpClasses, actingOwner).length > 0;
    const decided = decideSettingEffect({ classes, mode: deps.turnMode(input.botId, input.threadId), ownerWork, keyProtected, ...(approvalTo ? { approvalTo } : {}) });
    const secret = classes.includes("secret");
    // the card says what and where (a name, never an id) and the whole value
    // a person allows, or its keys and fingerprint when it is long; a
    // secret's value never
    const summary = `${spec.label} (${spec.key}${where ? `, ${where}` : ""})${secret ? `: ${Object.keys(value && typeof value === "object" ? value : {}).join(", ")}` : `: ${describe(value)}`}`;
    // 2026-10-19 (JC: "Toujours permettre" on every card): what Always allow
    // keeps: this setting of this target, and its exact value when the
    // change is more than a simple one
    const exactValue = classes.some((name) => name !== "own");
    const rule: ActRuleCandidate = {
      tool: "sagax_settings",
      scope: { setting: spec.key, ...(ids.target ? { target: ids.target } : {}), ...(exactValue ? { value: valueDigest(value) } : {}) },
      description: `${spec.label}${where ? ` (${where})` : ""}${exactValue ? (secret ? ", this exact value" : `: ${describe(value)}`) : ""}`.slice(0, 500),
    };
    const result = await deps.acts().handlePlanned({
      facts,
      target: route,
      plan: {
        effect: decided.effect,
        summary,
        stepUpClasses,
        rule,
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
