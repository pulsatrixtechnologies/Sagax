import { describe, expect, it } from "vitest";

import { proactiveProposalAccepts } from "./proactive-proposal.ts";

describe("proactiveProposalAccepts", () => {
  const card = { options: ["Oui, occupe-t'en", "Non merci"], proactiveProposal: { id: "p" } };
  it("is the first option only", () => {
    expect(proactiveProposalAccepts(card, "Oui, occupe-t'en")).toBe(true);
    expect(proactiveProposalAccepts(card, " Oui, occupe-t'en ")).toBe(true);
    expect(proactiveProposalAccepts(card, "Non merci")).toBe(false);
    expect(proactiveProposalAccepts({ options: [] }, "")).toBe(false);
  });
});
