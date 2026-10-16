// The step-up decision for one Allow (shared/step-up.ts, server/security-keys.ts):
// which classes the card falls in, which of them the answering person chose,
// and whether the presented step-up was signed for exactly this card, its
// content and this answer. server/index.ts calls it on every answer path.

import { createHash } from "node:crypto";

import type { RiskClass } from "../shared/custom-rules.ts";
import {
  STEP_UP_CLASSES,
  canonicalJson,
  cardContentText,
  normalizeAnswer,
  stepUpClassesForCard,
  riskClassesFromFacts,
  type StepUpAnswer,
  type StepUpClass,
  type StepUpRefusal,
  type StepUpTarget,
} from "../shared/step-up.ts";
import type { OptionCardData } from "../shared/wire.ts";
import { factsForCall } from "./custom-rules-review.ts";
import { grantDigest, type SecurityKeys } from "./security-keys.ts";

/** The grant an Allow on this card, with this answer, is authorized by:
 * the card, a digest of its content and the answer's widening parts (a
 * standing grant is its own grant, `alwaysAllowStepUpGrant`). */
export function approvalStepUpGrant(threadId: string, requestId: string, card: OptionCardData, answer: StepUpAnswer, extra?: unknown): string {
  const normalized = normalizeAnswer(answer);
  // `extra`: what the card stands for when it holds none of it itself (a
  // bot act's route and body), so the key signs that too.
  const content = createHash("sha256").update(cardContentText(card)).update(extra === undefined ? "" : `\u0000${canonicalJson(extra)}`).digest("base64url");
  return grantDigest(["approval", threadId, requestId, content, canonicalJson({ always: normalized.always, rememberCommand: normalized.rememberCommand, rule: normalized.rule })]);
}

export function alwaysAllowStepUpGrant(botId: string, key: string): string {
  return grantDigest(["always-allow", botId, key]);
}

const UNREADABLE = "Saved security keys could not be read, so this approval cannot be confirmed. Repair security-keys.json on the server.";

export type StepUpDecision = { status: number; body: StepUpRefusal } | null;

/** Null lets the Allow through; else the refusal (403) with the target a
 * client starts a step-up for. A path that cannot carry a step-up passes
 * none and is refused for a card that needs one: never let through. */
export function approvalStepUp(input: {
  keys: SecurityKeys;
  person: string | null;
  /** Whose classes apply when `person` is null (the bot's owner). */
  policyPerson?: string | null;
  /** Classes the card falls in beyond its own fields (a bot act's route). */
  extraClasses?: readonly StepUpClass[];
  /** Content the card stands for beyond its own fields. */
  extraContent?: unknown;
  threadId: string;
  requestId: string;
  card: OptionCardData | undefined;
  behavior: string;
  answer: StepUpAnswer;
  risks: readonly RiskClass[];
  stepUp: unknown;
}): StepUpDecision {
  const { keys, person, threadId, requestId, card, behavior } = input;
  if (behavior !== "allow") return null;
  if (!card || card.answered || card.dismissed || card.expired) {
    // No live card to read: nothing tells what this Allow would do. For a
    // person who chose any class, it is refused, never let through.
    const any = keys.required(person, STEP_UP_CLASSES, input.policyPerson);
    if (!any.length) return null;
    return { status: 409, body: { error: "This approval is no longer waiting.", code: "step_up_failed", classes: any, reason: "wrong-target" } };
  }
  const normalized = normalizeAnswer(input.answer);
  const answer = { always: normalized.always, rememberCommand: normalized.rememberCommand, rule: normalized.rule };
  const classes = [...new Set([...stepUpClassesForCard(card, input.risks, answer), ...(input.extraClasses ?? [])])];
  const required = keys.required(person, classes, input.policyPerson);
  if (!required.length) return null;
  if (keys.store.unreadable) return { status: 403, body: { error: UNREADABLE, code: "step_up_unavailable", classes: required, reason: "unreadable" } };
  if (!person) return { status: 403, body: { error: "This approval needs a security key: only the person can give it, in Sagax.", code: "step_up_required", classes: required } };
  const target: StepUpTarget = { kind: "approval", threadId, requestId, answer };
  if (input.stepUp === undefined || input.stepUp === null || input.stepUp === "") {
    return { status: 403, body: { error: "This approval needs your security key.", code: "step_up_required", classes: required, target } };
  }
  const used = keys.consume(input.stepUp, person, approvalStepUpGrant(threadId, requestId, card, answer, input.extraContent));
  if (!used.ok) return { status: 403, body: { error: "Your security key did not confirm this approval. Try again.", code: "step_up_failed", classes: required, reason: used.reason, target } };
  return null;
}

/** A standing grant (Always allow) saved from a card: the same step-up's
 * own grant, bound to the bot and the key it remembers. */
export function alwaysAllowStepUp(input: {
  keys: SecurityKeys;
  person: string | null;
  policyPerson?: string | null;
  botId: string;
  threadId: string;
  requestId: string;
  card: OptionCardData | undefined;
  key: string;
  risks: readonly RiskClass[];
  stepUp: unknown;
}): StepUpDecision {
  const { keys, person, card } = input;
  if (!card) return null;
  const required = keys.required(person, stepUpClassesForCard(card, input.risks, { alwaysAllowKey: input.key }), input.policyPerson);
  if (!required.length) return null;
  if (keys.store.unreadable) return { status: 403, body: { error: UNREADABLE, code: "step_up_unavailable", classes: required, reason: "unreadable" } };
  if (!person) return { status: 403, body: { error: "Always allow needs a security key: only the person can give it, in Sagax.", code: "step_up_required", classes: required } };
  const target: StepUpTarget = { kind: "approval", threadId: input.threadId, requestId: input.requestId, answer: { alwaysAllowKey: input.key } };
  if (input.stepUp === undefined || input.stepUp === null || input.stepUp === "") {
    return { status: 403, body: { error: "Always allow needs your security key.", code: "step_up_required", classes: required, target } };
  }
  const used = keys.consume(input.stepUp, person, alwaysAllowStepUpGrant(input.botId, input.key));
  if (!used.ok) return { status: 403, body: { error: "Your security key did not confirm this approval. Try again.", code: "step_up_failed", classes: required, reason: used.reason, target } };
  return null;
}

/** The grants a step-up for a waiting card authorizes: the Allow with this
 * answer, and the standing grant when the answer saves one. */
export function approvalGrantsFor(input: { threadId: string; requestId: string; card: OptionCardData; botId: string | undefined; answer: StepUpAnswer | undefined; extraContent?: unknown }): { grants: string[] } | { status: number; error: string } {
  const answer = normalizeAnswer(input.answer);
  const grants = [approvalStepUpGrant(input.threadId, input.requestId, input.card, { always: answer.always, rememberCommand: answer.rememberCommand, rule: answer.rule }, input.extraContent)];
  if (answer.alwaysAllowKey) {
    if (input.card.allowKey !== answer.alwaysAllowKey) return { status: 409, error: "That grant is not on this approval." };
    if (!input.botId) return { status: 404, error: "This approval has no bot." };
    grants.push(alwaysAllowStepUpGrant(input.botId, answer.alwaysAllowKey));
  }
  return { grants };
}

/** The call's risk classes as custom rules read them, with every shell
 * command that is not a plain read in destructive and irreversible
 * (riskClassesFromFacts). A card that cannot be read is in every class. */
export function cardRiskClasses(card: OptionCardData): RiskClass[] {
  if (!card.tool) return [];
  try {
    const binding = card.customRuleCandidate?.binding;
    return riskClassesFromFacts(factsForCall({
      tool: card.tool,
      ...(card.mcpTool ? { mcpTool: card.mcpTool } : {}),
      ...(card.toolInput ? { input: card.toolInput } : {}),
      ...(card.toolHints ? { hints: card.toolHints } : {}),
      ...(binding?.command ? { command: binding.command } : {}),
      summary: card.subtitle,
    }));
  } catch {
    return ["destructive", "irreversible", "money", "external-send"];
  }
}
