import { describe, expect, it } from "vitest";

import { TEAM_MEMORY_REVIEW_REFUSAL, teamMemoryReviewRefusal } from "./team-memory-review.ts";

describe("team memory review", () => {
  it("lets a member of the section confirm its shared memory", () => {
    expect(teamMemoryReviewRefusal({ admin: false, shared: true, memberOfSection: true })).toBeNull();
  });

  it("lets a workspace admin confirm any section", () => {
    expect(teamMemoryReviewRefusal({ admin: true, shared: true, memberOfSection: false })).toBeNull();
  });

  it("keeps a solo workspace open", () => {
    expect(teamMemoryReviewRefusal({ admin: false, shared: false, memberOfSection: false })).toBeNull();
  });

  it("refuses someone who cannot use a bot in that section", () => {
    expect(teamMemoryReviewRefusal({ admin: false, shared: true, memberOfSection: false })).toBe(TEAM_MEMORY_REVIEW_REFUSAL);
  });
});
