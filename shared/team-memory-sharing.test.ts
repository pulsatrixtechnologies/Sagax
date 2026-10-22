import { describe, expect, it } from "vitest";

import { isTeamMemorySharing, teamMemoryCardReachesMember, teamMemorySharingOf, type TeamMemoryCardDelivery } from "./team-memory-sharing.ts";

const teamCard = { teamMemoryRequest: { section: "Dispatch" } };
const base = (over: Partial<TeamMemoryCardDelivery> = {}): TeamMemoryCardDelivery => ({
  card: teamCard,
  sharing: "shared",
  sharedServer: true,
  cloudHome: false,
  confidential: false,
  memberOfSection: (section) => section === "Dispatch",
  seesCardContext: () => false,
  ...over,
});

describe("teamMemorySharingOf", () => {
  it("reads absent, unknown and shared as shared; only private is private", () => {
    expect(teamMemorySharingOf(undefined)).toBe("shared");
    expect(teamMemorySharingOf({})).toBe("shared");
    expect(teamMemorySharingOf({ teamMemorySharing: "everyone" })).toBe("shared");
    expect(teamMemorySharingOf({ teamMemorySharing: "shared" })).toBe("shared");
    expect(teamMemorySharingOf({ teamMemorySharing: "private" })).toBe("private");
    expect(isTeamMemorySharing("private")).toBe(true);
    expect(isTeamMemorySharing("nobody")).toBe(false);
  });
});

describe("teamMemoryCardReachesMember", () => {
  it("shared: a member of the section gets the card without seeing its bot or conversation", () => {
    expect(teamMemoryCardReachesMember(base())).toBe(true);
  });

  it("private: only a member who also sees the card's bot and conversation", () => {
    expect(teamMemoryCardReachesMember(base({ sharing: "private" }))).toBe(false);
    expect(teamMemoryCardReachesMember(base({ sharing: "private", seesCardContext: () => true }))).toBe(true);
  });

  it("never reaches someone outside the section, whatever the setting", () => {
    for (const sharing of ["shared", "private"] as const) {
      expect(teamMemoryCardReachesMember(base({ sharing, memberOfSection: () => false, seesCardContext: () => true }))).toBe(false);
    }
  });

  it("never carries a personal memory card to another person, whatever the setting", () => {
    const personal = { confidentialMemoryRequest: { id: "r1" } };
    const mixed = { ...teamCard, confidentialMemoryRequest: { id: "r2" } };
    for (const sharing of ["shared", "private"] as const) {
      for (const card of [personal, mixed, { title: "Save to your personal memory?" }]) {
        expect(teamMemoryCardReachesMember(base({ sharing, card, seesCardContext: () => true }))).toBe(false);
      }
    }
  });

  it("never in a confidential conversation, on a Cloud home, or on a one-person server", () => {
    for (const over of [{ confidential: true }, { cloudHome: true }, { sharedServer: false }]) {
      expect(teamMemoryCardReachesMember(base({ ...over, seesCardContext: () => true }))).toBe(false);
    }
  });
});
