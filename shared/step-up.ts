// Security keys for sensitive approvals (wave 2, package E).
//
// A person may ask that some kinds of approval need one of their security
// keys or passkeys (WebAuthn) on top of the tap: Settings > Security. The
// server classes the card, finds which of those classes the person chose,
// and refuses the Allow unless it carries a step-up that this person's key
// signed for exactly this card, its content and this answer, once, within a
// short time. Without a key that can answer here, the Allow is refused; it
// is never let through silently.
//
// Pure: no clock, no disk, no node built-ins. The server gives the risks it
// read from the call (shared/custom-rules.ts callFacts).

import type { RiskClass } from "./custom-rules.ts";
import type { OptionCardData } from "./wire.ts";

export const STEP_UP_CLASSES = [
  "destructive",
  "irreversible",
  "money",
  "external-send",
  "always-grant",
  "publish-page",
  "rule-change",
] as const;
export type StepUpClass = (typeof STEP_UP_CLASSES)[number];

export function isStepUpClass(value: unknown): value is StepUpClass {
  return typeof value === "string" && (STEP_UP_CLASSES as readonly string[]).includes(value);
}

/** What the person answers besides Allow: each one can widen what the
 * answer does, so the step-up is bound to it too. */
export interface StepUpAnswer {
  /** "Always allow this session" (the provider keeps the allow). */
  always?: boolean;
  /** Remember the exact command for this bot. */
  rememberCommand?: boolean;
  /** Save the card's owner rule (Always allow / Always deny). */
  rule?: "allow" | "deny" | null;
  /** The bot's standing grant (allowKey) saved with this answer. */
  alwaysAllowKey?: string | null;
}

/** What a step-up is asked for. The server recomputes what it binds to
 * from the live card or from the change itself; the client's words are
 * never trusted beyond naming it. */
export type StepUpTarget =
  | { kind: "approval"; threadId: string; requestId: string; answer?: StepUpAnswer }
  | { kind: "settings"; action: StepUpSettingsAction; detail: Record<string, unknown> };

/** The settings changes a step-up can authorize. Each one loosens a
 * protection, or touches the keys themselves. */
export const STEP_UP_SETTINGS_ACTIONS = [
  "security-keys.add",
  "security-keys.remove",
  "security-keys.classes",
  "custom-rules.allow",
  "approval-rules.allow",
  "permission-mode",
] as const;
export type StepUpSettingsAction = (typeof STEP_UP_SETTINGS_ACTIONS)[number];

export function isStepUpSettingsAction(value: unknown): value is StepUpSettingsAction {
  return typeof value === "string" && (STEP_UP_SETTINGS_ACTIONS as readonly string[]).includes(value);
}

/** The settings action each class protects (Settings pages that loosen a
 * rule need the key when "rule-change" is chosen). The key settings
 * themselves need a key whenever the person has one. */
export const SETTINGS_ACTION_CLASS: Readonly<Record<StepUpSettingsAction, StepUpClass | null>> = {
  "security-keys.add": null,
  "security-keys.remove": null,
  "security-keys.classes": null,
  "custom-rules.allow": "rule-change",
  "approval-rules.allow": "rule-change",
  "permission-mode": "rule-change",
};

/** The refusal a route answers when a step-up is needed or failed. */
export interface StepUpRefusal {
  error: string;
  code: "step_up_required" | "step_up_failed" | "step_up_unavailable";
  /** The classes that asked for the key. */
  classes: StepUpClass[];
  /** Why a presented step-up did not count. */
  reason?: StepUpFailure;
  /** What to ask a step-up for, so a client can start it and try again. */
  target?: StepUpTarget;
}

export type StepUpFailure =
  | "missing"
  | "expired"
  | "not-verified"
  | "wrong-person"
  | "wrong-target"
  | "used"
  | "unreadable";

/** One registered key as the app sees it: never its public key. */
export interface SecurityKeyView {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt?: number;
  /** The address the key answers on (WebAuthn RP ID). */
  rpId: string;
  /** "multiDevice": a synced passkey; "singleDevice": a hardware key or a
   * passkey kept on one device. */
  deviceType?: "singleDevice" | "multiDevice";
  backedUp?: boolean;
}

export interface SecurityKeysState {
  keys: SecurityKeyView[];
  classes: StepUpClass[];
  /** The address keys made here answer on, or null when this page cannot
   * use WebAuthn (an IP address, plain http off this computer). */
  rpId: string | null;
  /** The saved keys could not be read: every chosen class refuses. */
  unreadable?: boolean;
}

/** JSON with keys in a fixed order, so the same content always hashes the
 * same (a card read twice, a change sent twice). */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

/** The fields of a card that say what an Allow would do. Status fields
 * (answered, held, who answered...) are left out: they change while the
 * card waits without changing the action. */
const CARD_CONTENT_FIELDS = [
  "requestId",
  "requestType",
  "tool",
  "mcpTool",
  "toolInput",
  "toolHints",
  "title",
  "subtitle",
  "allowKey",
  "allowSession",
  "ownerRule",
  "commandAllowlist",
  "approvalScope",
  "adminApproval",
  "outboundRequest",
  "teamMemoryRequest",
  "routineRequest",
  "profileRequest",
  "modelRequest",
  "teamSetupRequest",
  "skillRequest",
  "botActRequest",
  "terminalRequest",
  "cwActionRequest",
  "customRuleCandidate",
] as const satisfies ReadonlyArray<keyof OptionCardData>;

/** The text whose hash binds a step-up to a card's content. */
export function cardContentText(card: OptionCardData): string {
  const picked: Record<string, unknown> = {};
  for (const field of CARD_CONTENT_FIELDS) {
    if (card[field] !== undefined) picked[field] = card[field];
  }
  // An email draft's status follows the send: only what it sends counts.
  if (card.emailSendRequest) {
    const { status: _status, error: _error, ...rest } = card.emailSendRequest as unknown as Record<string, unknown>;
    picked.emailSendRequest = rest;
  }
  return canonicalJson(picked);
}

/** The answer's parts that widen it, normalized (false and absent are one). */
export function normalizeAnswer(answer: StepUpAnswer | undefined): Required<Pick<StepUpAnswer, "always" | "rememberCommand">> & { rule: "allow" | "deny" | null; alwaysAllowKey: string | null } {
  return {
    always: answer?.always === true,
    rememberCommand: answer?.rememberCommand === true,
    rule: answer?.rule === "allow" || answer?.rule === "deny" ? answer.rule : null,
    alwaysAllowKey: typeof answer?.alwaysAllowKey === "string" && answer.alwaysAllowKey ? answer.alwaysAllowKey : null,
  };
}

const PUBLISH_TOOL = /(^|[_\-.])publish(es|ed|ing)?([_\-.]|$)/i;
const RULE_TOOL = /(^|[_\-.])(rules?|permissions?|polic(y|ies)|allowlist|approval[_\-.]?mode|permission[_\-.]?mode)([_\-.]|$)/i;
const READ_VERB = /^(get|list|read|search|find|query|describe|show|view|fetch|lookup)([_\-.]|$)/i;

function bareToolName(tool: string): string {
  const match = /^(?:mcp__)?[A-Za-z0-9][A-Za-z0-9_.-]*?__([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(tool);
  return (match ? match[1]! : tool).trim();
}

function parsedInput(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/** The classes an Allow on this card falls in. `risks` are the call's
 * risk classes as the server read them (custom-rules callFacts); a card
 * that is no tool call passes none. Classes only ever add up: when in
 * doubt a card is in a class, never out of one. */
export function stepUpClassesForCard(
  card: OptionCardData,
  risks: readonly RiskClass[] = [],
  answer?: StepUpAnswer,
): StepUpClass[] {
  const out = new Set<StepUpClass>();
  for (const risk of risks) out.add(risk);
  if (card.plain?.risk === "destructive" || card.toolHints?.destructive === true) out.add("destructive");
  if (card.ownerRule?.destructive === "delete" || card.ownerRule?.destructive === "bulk") out.add("destructive");
  if (card.ownerRule?.destructive === "external-message") out.add("external-send");
  if (card.outboundRequest || card.emailSendRequest) out.add("external-send");
  if (card.routineRequest?.operation?.action === "delete") out.add("destructive");
  if (card.teamSetupRequest?.deletion) out.add("destructive");
  const tool = card.mcpTool ?? card.tool;
  if (tool) {
    const bare = bareToolName(tool);
    const input = parsedInput(card.toolInput);
    const action = typeof input?.action === "string" ? input.action.toLowerCase() : undefined;
    // Claude's Artifact tool publishes a page unless it only reads or lists.
    if (/^artifact$/i.test(bare) && (action === undefined || action === "publish")) out.add("publish-page");
    else if (PUBLISH_TOOL.test(bare)) out.add("publish-page");
    if (RULE_TOOL.test(bare) && !READ_VERB.test(bare)) out.add("rule-change");
  }
  const normalized = normalizeAnswer(answer);
  if (normalized.always || normalized.rememberCommand || normalized.rule === "allow" || normalized.alwaysAllowKey) out.add("always-grant");
  if (normalized.rule) out.add("rule-change");
  return STEP_UP_CLASSES.filter((name) => out.has(name));
}

/** The classes a person chose that this call falls in. */
export function requiredClasses(chosen: readonly StepUpClass[], classes: readonly StepUpClass[]): StepUpClass[] {
  return STEP_UP_CLASSES.filter((name) => chosen.includes(name) && classes.includes(name));
}

/** A WebAuthn RP ID this page can use, or null. An IP address is never one,
 * and off this computer WebAuthn needs https. */
export function usableRpId(hostname: string, protocol: string): string | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  if (host === "localhost") return host;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[")) return null;
  if (protocol !== "https:") return null;
  return host;
}
