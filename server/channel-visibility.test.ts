import { describe, expect, it } from "vitest";
import { canSeeChannel, canSeeDirectBot, channelViewerId, seesChannel } from "./channel-visibility.ts";

describe("channel visibility", () => {
  it("hides a channel from someone who was not added", () => {
    expect(canSeeChannel({ humanIds: ["jc"], viewerId: "zachary@example.test" })).toBe(false);
    expect(canSeeChannel({ humanIds: ["jc", "zachary@example.test"], viewerId: "zachary@example.test" })).toBe(true);
  });
  it("shows another person's bot in Direct only after a grant", () => {
    expect(canSeeDirectBot({ ownerUserId: "jc", viewerId: "zachary@example.test", directGrants: [] })).toBe(false);
    expect(canSeeDirectBot({ ownerUserId: "jc", viewerId: "zachary@example.test", directGrants: ["zachary@example.test"] })).toBe(true);
    expect(canSeeDirectBot({ ownerUserId: "jc", viewerId: "jc", directGrants: [] })).toBe(true);
  });
  it("hides a channel from an admin who was not added", () => {
    const viewerId = channelViewerId({
      kind: "session",
      scopes: ["admin"],
      session: { email: "ada@example.test" },
    });
    expect(seesChannel({ humanIds: ["jc"] }, viewerId)).toBe(false);
    expect(seesChannel({ humanIds: ["jc", "ada@example.test"] }, viewerId)).toBe(true);
  });
});

