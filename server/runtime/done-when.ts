// Completion criteria for peer assignments (issue #1818).
//
// `doneWhen` on an Assignment is the requester's criterion. Free text stays
// advisory in the envelope. Structured clauses the harness can check:
//
//   tool:<name>              that tool must appear in TurnEvidence.tools
//   first_line:<A>|<B>|…     first non-empty reply line must be one of those
//                            tokens (exact, or token then space / : / , / - / .)
//
// Several clauses join with "; ". Unmet → failed(incomplete), not completed.
//
// Without a structured clause, mode:work still refuses a progress-only ack
// (short intent with no tools and no deliverable token) so an acknowledgement
// cannot close verifier or hub work.
import type { Mode, TurnEvidence } from "./types.ts";

/** Tools that pose a person-facing decision card. Missing one of these when
 * required is the busy-hub GO-card failure mode (#1818 B). */
export const DECISION_CARD_TOOLS = [
  "ask_choice",
  "AskUserQuestion",
  "ask_user_question",
  "request_user_input",
  "ask_user",
  "create_options_card",
] as const;

export type DoneWhenClause =
  | { kind: "tool"; name: string }
  | { kind: "first_line"; tokens: string[] }
  | { kind: "text"; value: string };

export interface DoneWhenSpec {
  /** Original string, clipped. */
  raw: string;
  clauses: DoneWhenClause[];
  /** True when any clause requires a DECISION_CARD_TOOLS entry. */
  requiresDecisionCard: boolean;
}

const DONE_WHEN_MAX = 500;
const ACK_MAX_CHARS = 280;

/** Progress-only acknowledgements reported in #1818 (FR + EN). */
const PROGRESS_ACK = /^(?:(?:ok|okay|ack|received|got it|noted|compris|entendu)[.!]?\s+)?(?:(?:je|j'|i|i'm|i am|i'll|ill|we|on)\s+)?(?:lis|relis|vais\b|reading|looking|checking|starting|reviewing|examining|analysing|analyzing|working on)\b/i;
const DELIVERABLE_TOKEN = /\b(PASS|FAIL|GO|NO(?:GO)?|DONE|COMPLETE(?:D)?|APPROVED|DENIED)\b/i;
const ELLIPSIS_TAIL = /(?:\u2026|\.\.\.)\s*$/;

export function parseDoneWhen(raw: string | undefined): DoneWhenSpec | undefined {
  const text = (raw ?? "").trim().slice(0, DONE_WHEN_MAX);
  if (!text) return undefined;
  const clauses: DoneWhenClause[] = [];
  for (const part of text.split(";")) {
    const piece = part.trim();
    if (!piece) continue;
    const tool = /^tool:\s*([^\s;]+)\s*$/i.exec(piece);
    if (tool) {
      clauses.push({ kind: "tool", name: tool[1]! });
      continue;
    }
    const first = /^first_line:\s*(.+)$/i.exec(piece);
    if (first) {
      const tokens = first[1]!.split("|").map((t) => t.trim()).filter(Boolean);
      if (tokens.length) clauses.push({ kind: "first_line", tokens });
      continue;
    }
    clauses.push({ kind: "text", value: piece });
  }
  const requiresDecisionCard = clauses.some(
    (c) => c.kind === "tool" && DECISION_CARD_TOOLS.some((name) => sameTool(name, c.name)),
  );
  return { raw: text, clauses, requiresDecisionCard };
}

/** Why a would-be completed turn must settle as failed(incomplete), or
 * undefined when the criterion is met (or there is nothing to enforce). */
export function unmetCompletion(
  input: {
    mode: Mode;
    doneWhen?: string;
    text: string;
    evidence?: TurnEvidence;
  },
): string | undefined {
  const spec = parseDoneWhen(input.doneWhen);
  const tools = input.evidence?.tools ?? [];
  const toolCalls = input.evidence?.toolCalls ?? tools.length;

  if (spec) {
    for (const clause of spec.clauses) {
      if (clause.kind === "tool") {
        if (!tools.some((name) => sameTool(name, clause.name))) {
          return `done_when unmet: required tool ${clause.name} did not run`;
        }
      } else if (clause.kind === "first_line") {
        if (!firstLineMatches(input.text, clause.tokens)) {
          return `done_when unmet: first line must be ${clause.tokens.join("|")}`;
        }
      }
      // Free-text clauses stay advisory in the envelope.
    }
    if (spec.clauses.some((c) => c.kind === "tool" || c.kind === "first_line")) return undefined;
  }

  // Mode work without a structured criterion: refuse ack-only replies.
  if (input.mode === "work" && looksLikeProgressAck(input.text, toolCalls)) {
    return "progress acknowledgement only; no deliverable (not completed)";
  }
  return undefined;
}

/** True when doneWhen requires a person decision card (shorter queue bound). */
export function requiresDecisionCard(doneWhen: string | undefined): boolean {
  return parseDoneWhen(doneWhen)?.requiresDecisionCard === true;
}

export function looksLikeProgressAck(text: string, toolCalls: number): boolean {
  if (toolCalls > 0) return false;
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return true;
  if (DELIVERABLE_TOKEN.test(trimmed)) return false;
  if (PROGRESS_ACK.test(trimmed)) return true;
  if (trimmed.length <= ACK_MAX_CHARS && ELLIPSIS_TAIL.test(trimmed)) return true;
  return false;
}

function firstLineMatches(text: string, tokens: string[]): boolean {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  if (!line) return false;
  const upper = line.toUpperCase();
  return tokens.some((token) => {
    const tok = token.toUpperCase();
    if (!tok) return false;
    if (upper === tok) return true;
    return (
      upper.startsWith(`${tok} `)
      || upper.startsWith(`${tok}:`)
      || upper.startsWith(`${tok},`)
      || upper.startsWith(`${tok}-`)
      || upper.startsWith(`${tok}.`)
    );
  });
}

function sameTool(observed: string, required: string): boolean {
  const a = observed.trim().toLowerCase();
  const b = required.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  // agents server / mcp prefixes: agents_ask_choice, mcp__agents__ask_choice
  const bare = (name: string) => name.replace(/^mcp__[^_]+__/, "").replace(/^agents_/, "");
  return bare(a) === bare(b) || a.endsWith(`_${b}`) || a.endsWith(`__${b}`);
}
