import { describe, expect, it } from "vitest";
import { applyHumanIds, canEditHumans, canPlaceBot } from "./channel-membership.ts";

describe("channel membership", () => {
  it("refuses a human list on a bot-to-bot dm", () => {
    expect(applyHumanIds({ dm: true, humanIds: ["zachary@example.test"] })).toEqual({ ok: false, error: "dm-has-no-humans" });
  });
  it("lets only the bot owner place it", () => {
    expect(canPlaceBot({ actorId: "ada@example.test", ownerUserId: "jc" })).toBe(false);
    expect(canPlaceBot({ actorId: "jc", ownerUserId: "jc" })).toBe(true);
  });
  it("lets an admin edit people and stops a member", () => {
    expect(canEditHumans("admin")).toBe(true);
    expect(canEditHumans("owner")).toBe(true);
    expect(canEditHumans("member")).toBe(false);
  });
});
