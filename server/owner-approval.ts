// What a bot's owner decided ahead of time (2026-10-14, JC):
// docs/superpowers/specs/2026-10-14-bot-owner-permissions.md.
//
// A bot acts with its owner's rights. A permission card that stays within
// those rights (the "owner" route of engine-access.ts) is answered by the
// owner's own rules and the bot's permission mode before it reaches them:
//
// - rules belong to a person (the owner), optionally narrowed to one bot,
//   and name one tool plus a scope read from the call's arguments (the
//   target: resource, operation, repository, host...), never "this tool,
//   whatever it does" unless the owner widened it on purpose;
// - deny wins over ask, which wins over allow;
// - a destructive call (a delete, a bulk change, an external email or SMS)
//   is covered only by an allow rule made for that same kind, in every
//   mode: never implicitly;
// - modes: approval (default: rules, then a card), auto (rules, then
//   approve what no rule covers unless it is destructive), bypass (no card
//   for the owner route, only the journal; deny rules and the destructive
//   rule still hold).
//
// Nothing here answers an admin card, a safety hold, a sandbox widening, a
// question or a guest's turn: the caller never asks (ownerDecision returns
// "card" for them). Pure: the store and the routes live in
// owner-approval-store.ts and index.ts.

import { approvalAction, describeApproval, parseArgs, parseToolId, type ApprovalWords, ENGLISH_WORDS } from "../shared/approval-describe.ts";
import { isOutboundTool } from "../shared/outbound.ts";

export const BOT_PERMISSION_MODES = ["approval", "auto", "bypass"] as const;
export type BotPermissionMode = (typeof BOT_PERMISSION_MODES)[number];
export const RULE_BEHAVIORS = ["allow", "ask", "deny"] as const;
export type RuleBehavior = (typeof RULE_BEHAVIORS)[number];
export type DestructiveKind = "delete" | "bulk" | "external-message";

export type RuleScope = Record<string, string>;

export interface OwnerRule {
  id: string;
  /** The person whose rule it is: the bot's owner when it was made. */
  ownerId: string;
  /** One bot, or null for every bot this person owns. */
  botId: string | null;
  /** normalizeRuleTool: `server__tool` for MCP, the engine's name otherwise. */
  tool: string;
  /** Every key must match the call's own target; empty is any target. */
  scope: RuleScope;
  /** Set only on a rule made for a destructive call of this kind. */
  destructive?: DestructiveKind;
  behavior: RuleBehavior;
  /** Plain words, made from the card, editable by the owner. */
  description: string;
  createdAt: number;
  updatedAt: number;
}

/** One permission call, as the rules read it. */
export interface RuleCall {
  ownerId: string;
  botId: string;
  /** The engine's own tool name (`mcp__srv__tool`, `srv__tool`, `Bash`). */
  tool: string;
  /** The call's JSON arguments, as text (the card's toolInput). */
  input?: string;
  /** MCP annotations, when known. */
  hints?: { readOnly?: boolean; destructive?: boolean };
}

/** `mcp__srv__tool` and `srv__tool` are one tool; a built-in keeps its name. */
export function normalizeRuleTool(tool: string): string {
  const trimmed = tool.trim();
  const parsed = parseToolId(trimmed);
  return parsed.server ? `${parsed.server}__${parsed.name}`.toLowerCase() : trimmed;
}

/** Argument keys that name WHERE a call acts, in the order they are kept.
 * `api`, `resource` and `verb` (or `action`) are the three parts of the
 * per-resource key of the MCP permission registry (`cw:ticket.update`,
 * PR #508, server/mcp-permissions.ts resourceKeyForCall): a rule made on a
 * gateway `api_write` card names the same api, resource and verb, so an
 * Always allow for ticket updates never covers ticket creates. */
const TARGET_KEYS = ["api", "resource", "resource_prefix", "entity", "operation", "method", "verb", "action", "repo", "repository", "server", "domain", "url", "board", "channel", "to"] as const;
const MAX_SCOPE_KEYS = 4;
const MAX_SCOPE_VALUE = 120;

function scopeValue(key: string, value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) value = String(value);
  if (typeof value !== "string") return undefined;
  let text = value.trim();
  if (!text) return undefined;
  if (key === "url") {
    try {
      text = new URL(text).hostname;
    } catch {
      return undefined;
    }
  }
  if (key === "resource" || key === "resource_prefix" || key === "entity") {
    // service/tickets/123 and service.tickets are the family service/tickets
    text = text.replace(/\./g, "/").replace(/^\/+|\/+$/g, "");
    const parts = text.split("/").filter(Boolean);
    while (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1]!)) parts.pop();
    text = parts.join("/");
  }
  if (key === "to" && Array.isArray(value)) return undefined;
  text = text.toLowerCase();
  return text && text.length <= MAX_SCOPE_VALUE ? text : undefined;
}

/** The target of a call: up to four argument values that say where it acts.
 * Two calls with the same scope act on the same kind of target. */
export function ruleScopeFor(input: string | undefined): RuleScope {
  const args = parseArgs(input);
  if (!args) return {};
  const scope: RuleScope = {};
  for (const key of TARGET_KEYS) {
    if (Object.keys(scope).length >= MAX_SCOPE_KEYS) break;
    const value = scopeValue(key, args[key]);
    if (value !== undefined) scope[key === "url" ? "host" : key] = value;
  }
  return scope;
}

const BULK_TOOL = /(^|[_.:-])(bulk|batch|mass|many)([_.:-]|$)/i;
const ID_LIST_KEYS = ["ids", "id", "records", "items", "tickets", "entries", "targets", "recordIds", "ticketIds"];
const MESSAGE_RESOURCE = /(^|\/)(messages?|mail|emails?|sms|calls?)$/i;

/** Which destructive kind a call is, or undefined. A delete first, then a
 * change to two or more records at once, then a message that leaves the
 * organization (email, SMS, call). */
export function destructiveKindOf(call: Pick<RuleCall, "tool" | "input" | "hints">): DestructiveKind | undefined {
  const described = describeApproval(call.tool, call.input, call.hints);
  if (described.risk === "destructive") return "delete";
  const args = parseArgs(call.input);
  const writes = described.risk === "write" || described.risk === "execute";
  if (BULK_TOOL.test(parseToolId(call.tool).name)) return "bulk";
  if (args && writes && ID_LIST_KEYS.some((key) => Array.isArray(args[key]) && (args[key] as unknown[]).length >= 2)) return "bulk";
  const bare = call.tool.startsWith("mcp__") ? call.tool : (() => {
    const parsed = parseToolId(call.tool);
    return parsed.server ? `mcp__${parsed.server}__${parsed.name}` : call.tool;
  })();
  if (isOutboundTool(bare)) return "external-message";
  const resource = typeof args?.resource === "string" ? args.resource.replace(/\./g, "/").replace(/\/+$/, "") : "";
  if (resource && MESSAGE_RESOURCE.test(resource) && (described.risk === "write" || described.risk === "execute")) {
    const op = typeof args?.operation === "string" ? args.operation.toLowerCase() : typeof args?.method === "string" ? args.method.toLowerCase() : "";
    if (!op || op === "create" || op === "post" || op === "send") return "external-message";
  }
  return undefined;
}

function sameText(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Whether one rule covers one call. */
export function ruleMatches(rule: OwnerRule, call: RuleCall, callScope: RuleScope, destructive: DestructiveKind | undefined): boolean {
  if (!sameText(rule.ownerId, call.ownerId)) return false;
  if (rule.botId !== null && rule.botId !== call.botId) return false;
  if (normalizeRuleTool(rule.tool) !== normalizeRuleTool(call.tool)) return false;
  for (const [key, value] of Object.entries(rule.scope)) {
    const own = callScope[key];
    if (own === undefined || !sameText(own, value)) return false;
  }
  // A deny or ask rule covers any kind; an allow covers a destructive call
  // only when it was made for that same kind.
  if (rule.behavior === "allow" && destructive && rule.destructive !== destructive) return false;
  return true;
}

/** The rule that decides a call: deny first, then ask, then allow; within
 * one behavior, the narrowest (most scope keys, one bot over all). */
export function matchOwnerRule(rules: readonly OwnerRule[], call: RuleCall): OwnerRule | undefined {
  const scope = ruleScopeFor(call.input);
  const destructive = destructiveKindOf(call);
  const weight = (rule: OwnerRule) => RULE_BEHAVIORS.indexOf(rule.behavior);
  return rules
    .filter((rule) => ruleMatches(rule, call, scope, destructive))
    .sort((a, b) =>
      weight(b) - weight(a)
      || Object.keys(b.scope).length - Object.keys(a.scope).length
      || Number(b.botId !== null) - Number(a.botId !== null))[0];
}

export type OwnerDecisionSource = "owner-rule" | "owner-rule-deny" | "owner-auto" | "owner-bypass";

export type OwnerDecision =
  | { kind: "allow"; source: Exclude<OwnerDecisionSource, "owner-rule-deny">; rule?: OwnerRule }
  | { kind: "deny"; source: "owner-rule-deny"; rule: OwnerRule }
  | { kind: "card"; reason: "admin" | "hold" | "no-rule" | "ask-rule" | "destructive" | "step-up" | "origin"; rule?: OwnerRule; destructive?: DestructiveKind };

/** What happens to a permission call of the owner route before a card. */
export function ownerDecision(input: {
  mode: BotPermissionMode;
  rules: readonly OwnerRule[];
  call: RuleCall;
  /** The call goes beyond the owner's rights: an admin card, never a rule. */
  adminRoute?: boolean;
  /** A safety hold, a sandbox widening, a question, a guest's turn: a
   * person answers, whatever the mode or rules say. */
  personMustAnswer?: boolean;
  /** The call falls in a class the person protects with a security key
   * (server/step-up-gate.ts callStepUpClasses): no rule and no mode allows
   * it, the card shows and its Allow needs the key. A deny rule still
   * denies. */
  stepUpRequired?: boolean;
  /** Sagax itself would not run this call unasked (an own-environment call
   * from a turn that is not the owner's own, member-environment.ts):
   * neither the mode (auto, bypass) nor an Always allow rule answers it,
   * since what started the turn (another bot, a webhook, an email) may carry
   * someone else's words. A deny rule still denies. */
  autonomyRefused?: boolean;
}): OwnerDecision {
  if (input.adminRoute) return { kind: "card", reason: "admin" };
  if (input.personMustAnswer) return { kind: "card", reason: "hold" };
  const rule = matchOwnerRule(input.rules, input.call);
  if (rule?.behavior === "deny") return { kind: "deny", source: "owner-rule-deny", rule };
  if (input.stepUpRequired) return { kind: "card", reason: "step-up", ...(rule ? { rule } : {}) };
  if (input.autonomyRefused) return { kind: "card", reason: "origin", ...(rule ? { rule } : {}) };
  if (rule?.behavior === "allow") return { kind: "allow", source: "owner-rule", rule };
  const destructive = destructiveKindOf(input.call);
  if (destructive) return { kind: "card", reason: "destructive", destructive, ...(rule ? { rule } : {}) };
  if (input.mode === "bypass") return { kind: "allow", source: "owner-bypass", ...(rule ? { rule } : {}) };
  if (rule?.behavior === "ask") return { kind: "card", reason: "ask-rule", rule };
  if (input.mode === "auto") return { kind: "allow", source: "owner-auto" };
  return { kind: "card", reason: "no-rule" };
}

/** What the card offers to remember: the rule "Always allow" or "Always
 * deny" would save, described in plain words. */
export interface RuleCandidate {
  tool: string;
  scope: RuleScope;
  destructive?: DestructiveKind;
  description: string;
}

function capitalize(text: string): string {
  return text ? text[0]!.toLocaleUpperCase() + text.slice(1) : text;
}

export function describeRule(tool: string, scope: RuleScope, words: ApprovalWords = ENGLISH_WORDS, input?: string): string {
  const action = capitalize(approvalAction(tool, input, undefined, words));
  const target = Object.values(scope).join(", ");
  return (target ? `${action} (${target})` : action).slice(0, 500);
}

export function ruleCandidateFor(call: Pick<RuleCall, "tool" | "input" | "hints">, words: ApprovalWords = ENGLISH_WORDS): RuleCandidate {
  const scope = ruleScopeFor(call.input);
  const destructive = destructiveKindOf(call);
  return {
    tool: normalizeRuleTool(call.tool),
    scope,
    ...(destructive ? { destructive } : {}),
    description: describeRule(call.tool, scope, words, call.input),
  };
}

export function isBotPermissionMode(value: unknown): value is BotPermissionMode {
  return typeof value === "string" && (BOT_PERMISSION_MODES as readonly string[]).includes(value);
}

export function isRuleBehavior(value: unknown): value is RuleBehavior {
  return typeof value === "string" && (RULE_BEHAVIORS as readonly string[]).includes(value);
}
