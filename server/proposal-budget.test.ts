import { describe, expect, it } from "vitest";

import { OPEN_PROPOSAL_BUDGET, TEAM_SETUP_WAITING, proposalReplacements } from "./proposal-budget.ts";

const card = (id: string, over: { held?: boolean; teamSetup?: boolean } = {}) => ({ id, held: over.held ?? false, teamSetup: over.teamSetup ?? false });

describe("the open proposal budget (#1059)", () => {
  it("keeps every card below the budget", () => {
    expect(proposalReplacements([card("a", { teamSetup: true }), card("b", { teamSetup: true })])).toEqual({ ok: true, replace: [] });
  });

  it("never replaces a waiting team setup card: the oldest other proposal goes instead", () => {
    const open = [card("setup", { teamSetup: true }), ...Array.from({ length: OPEN_PROPOSAL_BUDGET - 1 }, (_, i) => card(`p${i}`))];
    const plan = proposalReplacements(open);
    expect(plan).toEqual({ ok: true, replace: [card("p0")] });
  });

  it("tells the bot to wait, and replaces nothing, when only team setup or held cards fill the budget", () => {
    const open = Array.from({ length: OPEN_PROPOSAL_BUDGET }, (_, i) => card(`s${i}`, { teamSetup: i % 2 === 0, held: i % 2 === 1 }));
    expect(proposalReplacements(open)).toEqual({ ok: false, error: TEAM_SETUP_WAITING });
    expect(proposalReplacements(open.map((item) => ({ ...item, teamSetup: false, held: true })))).toEqual({ ok: false, error: "confirm or cancel an existing proposal first" });
  });
});
