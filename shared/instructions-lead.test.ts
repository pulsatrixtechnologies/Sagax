import { describe, expect, it } from "vitest";

import { INSTRUCTIONS_LEAD_MAX, instructionsLead } from "./instructions-lead.ts";

describe("instructionsLead", () => {
  it("takes the first non-empty line without heading marks", () => {
    expect(instructionsLead("\n\n## Research assistant ##\nFind sources.")).toBe("Research assistant");
    expect(instructionsLead("   \n# \nKeep replies short.")).toBe("Keep replies short.");
    expect(instructionsLead("You   triage\tticket queues.")).toBe("You triage ticket queues.");
    expect(instructionsLead("#hashtag is not a heading")).toBe("#hashtag is not a heading");
  });

  it("is absent for an empty or missing soul", () => {
    expect(instructionsLead(undefined)).toBeUndefined();
    expect(instructionsLead("")).toBeUndefined();
    expect(instructionsLead("\n  \n#\n")).toBeUndefined();
    expect(instructionsLead(42)).toBeUndefined();
  });

  it("is bounded to 140 characters with an ellipsis", () => {
    const lead = instructionsLead("é".repeat(400))!;
    expect(Array.from(lead)).toHaveLength(INSTRUCTIONS_LEAD_MAX);
    expect(lead.endsWith("…")).toBe(true);
    expect(instructionsLead("a".repeat(140))).toBe("a".repeat(140));
  });
});
