import { describe, expect, it } from "vitest";

import {
  looksLikeProgressAck,
  parseDoneWhen,
  requiresDecisionCard,
  unmetCompletion,
} from "./done-when.ts";

describe("done-when (#1818)", () => {
  it("parses tool and first_line clauses, and free text", () => {
    const spec = parseDoneWhen("tool:ask_choice; first_line:PASS|FAIL; CI green");
    expect(spec?.requiresDecisionCard).toBe(true);
    expect(spec?.clauses).toEqual([
      { kind: "tool", name: "ask_choice" },
      { kind: "first_line", tokens: ["PASS", "FAIL"] },
      { kind: "text", value: "CI green" },
    ]);
    expect(requiresDecisionCard("tool:AskUserQuestion")).toBe(true);
    expect(requiresDecisionCard("first_line:PASS|FAIL")).toBe(false);
  });

  it("refuses completed when first_line or required tool is missing", () => {
    expect(unmetCompletion({
      mode: "work",
      doneWhen: "first_line:PASS|FAIL",
      text: "Je lis le plan, les dry-runs et le checklist…",
    })).toMatch(/first line must be PASS\|FAIL/);

    expect(unmetCompletion({
      mode: "work",
      doneWhen: "first_line:PASS|FAIL",
      text: "PASS\nEvidence: dry-run matches plan.",
    })).toBeUndefined();

    expect(unmetCompletion({
      mode: "work",
      doneWhen: "tool:ask_choice",
      text: "I will pose the GO card now.",
      evidence: { toolCalls: 0, tools: [] },
    })).toMatch(/required tool ask_choice/);

    expect(unmetCompletion({
      mode: "work",
      doneWhen: "tool:ask_choice",
      text: "Card posted.",
      evidence: { toolCalls: 1, tools: ["agents_ask_choice"] },
    })).toBeUndefined();
  });

  it("treats progress-only acks as incomplete for mode work without structured done_when", () => {
    expect(looksLikeProgressAck("Je lis le plan, les dry-runs et le checklist…", 0)).toBe(true);
    expect(looksLikeProgressAck("Je relis les payloads…", 0)).toBe(true);
    expect(looksLikeProgressAck("I'll start by reading the plan...", 0)).toBe(true);
    expect(looksLikeProgressAck("PASS\nchecks match", 0)).toBe(false);
    expect(looksLikeProgressAck("CSV export implemented and checked", 0)).toBe(false);

    expect(unmetCompletion({
      mode: "work",
      text: "Je lis le plan…",
    })).toMatch(/progress acknowledgement only/);

    expect(unmetCompletion({
      mode: "consult",
      text: "Je lis le plan…",
    })).toBeUndefined();

    expect(unmetCompletion({
      mode: "work",
      text: "Je lis encore…",
      evidence: { toolCalls: 2, tools: ["read_file", "grep"] },
    })).toBeUndefined();
  });
});
