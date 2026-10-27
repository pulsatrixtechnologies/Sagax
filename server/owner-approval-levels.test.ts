// One approval level, rules first (2026-10-26, JC): the matrix of the four
// levels against a rule of each behavior (and none). A rule decides
// whatever the level: Deny refuses even in Full access, Ask shows a card
// even in Full access or Approve for me, Allow automatically goes without a
// card even in Ask for approval. The level only decides what no rule covers.
// Order: organization Refuse/Ask first, then the person's and the bot's
// rules, then the level.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { engineApprovalMode, fullAccessRulesHold, type ApprovalMode } from "../shared/approval-mode.ts";
import { autoVerdict } from "./auto-approve.ts";
import { ownerDecision, ownerVerdictOver, ruleCandidateFor, type OwnerRule, type RuleBehavior } from "./owner-approval.ts";
import { ownerModeForTurn } from "./owner-autonomy.ts";

const OWNER = "pr_alice";
const TOOL = "mcp__perspicax_quasar__cw_psa__write";
const INPUT = JSON.stringify({ resource: "service/tickets/4512", operation: "update", body: { status: "In progress" } });
const LEVELS = ["ask", "edits", "auto", "full"] as const satisfies readonly ApprovalMode[];

function ownerRule(behavior: RuleBehavior): OwnerRule {
  const candidate = ruleCandidateFor({ tool: TOOL, input: INPUT });
  return { id: `r-${behavior}`, ownerId: OWNER, botId: "bot-a", tool: candidate.tool, scope: candidate.scope, behavior, description: candidate.description, createdAt: 1, updatedAt: 1 };
}

type Outcome = "refused" | "card" | "no card";

/** The request.opened pipeline of server/index.ts, in its order: the
 * organization's and the person's rules in their own words (autoVerdict
 * customRule), the level (autoVerdict), the owner's rules and the owner
 * route read from the level (ownerDecision), then ownerVerdictOver. */
function decide(level: ApprovalMode, rule: RuleBehavior | null, org?: "deny" | "ask"): Outcome {
  const base = autoVerdict(level, TOOL, org ? { customRule: { behavior: org, id: "orule_1" } } : {});
  if (base.source === "custom-rule-deny") return "refused";
  const owner = ownerDecision({
    mode: ownerModeForTurn({ approvalMode: level, lineage: "owner", autoAllowed: true, bypassAllowed: true }),
    rules: rule ? [ownerRule(rule)] : [],
    call: { ownerId: OWNER, botId: "bot-a", tool: TOOL, input: INPUT },
  });
  if (owner.kind === "deny") return "refused";
  return ownerVerdictOver(base, owner, TOOL)?.approve ? "no card" : "card";
}

describe("4 levels x a rule Deny / Ask / Allow / none", () => {
  const expected: Record<string, Record<(typeof LEVELS)[number], Outcome>> = {
    deny: { ask: "refused", edits: "refused", auto: "refused", full: "refused" },
    ask: { ask: "card", edits: "card", auto: "card", full: "card" },
    allow: { ask: "no card", edits: "no card", auto: "no card", full: "no card" },
    // no rule: the level decides
    none: { ask: "card", edits: "card", auto: "no card", full: "no card" },
  };
  for (const [behavior, row] of Object.entries(expected)) {
    for (const level of LEVELS) {
      it(`${behavior === "none" ? "no rule" : `a ${behavior} rule`} at ${level}: ${row[level]}`, () => {
        expect(decide(level, behavior === "none" ? null : behavior as RuleBehavior)).toBe(row[level]);
      });
    }
  }

  it("an organization rule comes before the person's: an org Refuse or Ask wins over an Allow rule at every level", () => {
    for (const level of LEVELS) {
      expect(decide(level, "allow", "deny")).toBe("refused");
      expect(decide(level, "allow", "ask")).toBe("card");
      expect(decide(level, null, "ask")).toBe("card");
    }
  });

  it("the engine runs at Ask under Full access while a holding rule is in force (organization Ask or Deny, or any Deny)", () => {
    expect(engineApprovalMode("full", true)).toBe("ask");
    expect(engineApprovalMode("full", false)).toBe("full");
    for (const level of ["ask", "edits", "auto", "custom"] as const) {
      expect(engineApprovalMode(level, true)).toBe(level);
      expect(engineApprovalMode(level, false)).toBe(level);
    }
  });

  it("at Full access a person's own Ask rule does not hold the engine at Ask; an organization Ask or Deny, and any Deny, still do", () => {
    expect(fullAccessRulesHold([{ behavior: "ask" }])).toBe(false);
    expect(fullAccessRulesHold([{ behavior: "ask", org: false }])).toBe(false);
    expect(fullAccessRulesHold([{ behavior: "allow" }])).toBe(false);
    expect(fullAccessRulesHold([{ behavior: "deny", enabled: false }])).toBe(false);
    expect(fullAccessRulesHold([{ behavior: "ask", org: true, enabled: false }])).toBe(false);
    expect(fullAccessRulesHold([{ behavior: "deny" }])).toBe(true);
    expect(fullAccessRulesHold([{ behavior: "deny", org: true }])).toBe(true);
    expect(fullAccessRulesHold([{ behavior: "ask", org: true }])).toBe(true);
    expect(fullAccessRulesHold([{ behavior: "ask" }, { behavior: "deny" }])).toBe(true);
    expect(engineApprovalMode("full", fullAccessRulesHold([{ behavior: "ask" }]))).toBe("full");
    expect(engineApprovalMode("full", fullAccessRulesHold([{ behavior: "ask", org: true }]))).toBe("ask");
    expect(engineApprovalMode("full", fullAccessRulesHold([{ behavior: "deny" }]))).toBe("ask");
  });

  it("request.opened reads the owner's rules even when the level answered (index.ts ownerLayer)", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const start = source.indexOf("const ownerLayer = Boolean(");
    const line = source.slice(start, source.indexOf("\n", start));
    expect(start).toBeGreaterThan(-1);
    expect(line).not.toContain("!baseVerdict?.approve");
    // and both turn launches hand the engine its native level
    expect(source.match(/approvalMode: engineTurnLevel\(/g)?.length).toBe(2);
  });
});
