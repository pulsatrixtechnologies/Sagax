import { describe, expect, it } from "vitest";
import { applyHumanIds, canEditHumans, canPlaceBot, firstUnseenPerson, ownerUserIdForPlacement } from "./channel-membership.ts";

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
  it("refuses an admin who is not the bot owner", () => {
    const ownerUserId = ownerUserIdForPlacement({
      recordedOwnerUserId: "jc",
      orgOwnerUserId: "ada@example.test",
      localOperatorId: "local-owner",
    });
    expect(ownerUserId).toBe("jc");
    expect(canPlaceBot({ actorId: "ada@example.test", ownerUserId })).toBe(false);
    expect(canPlaceBot({ actorId: "jc", ownerUserId })).toBe(true);
  });
  it("lets only the org owner place a bot that has no owner", () => {
    const ownerUserId = ownerUserIdForPlacement({
      orgOwnerUserId: "jc",
      localOperatorId: "local-owner",
    });
    expect(ownerUserId).toBe("jc");
    expect(canPlaceBot({ actorId: "ada@example.test", ownerUserId })).toBe(false);
    expect(canPlaceBot({ actorId: "zachary@example.test", ownerUserId })).toBe(false);
    expect(canPlaceBot({ actorId: "local-owner", ownerUserId })).toBe(false);
    expect(canPlaceBot({ actorId: "jc", ownerUserId })).toBe(true);
  });
  it("lets only the local operator place a bot before an organization exists", () => {
    const ownerUserId = ownerUserIdForPlacement({ localOperatorId: "local-owner" });
    expect(ownerUserId).toBe("local-owner");
    expect(canPlaceBot({ actorId: "zachary@example.test", ownerUserId })).toBe(false);
    expect(canPlaceBot({ actorId: "ada@example.test", ownerUserId })).toBe(false);
    expect(canPlaceBot({ actorId: "local-owner", ownerUserId })).toBe(true);
  });
});

describe("firstUnseenPerson (#1061)", () => {
  const visible = (id: string) => id === "usr_bob";
  it("lets a member add a person the directory shows, and keep the room as is", () => {
    expect(firstUnseenPerson({ actorId: "usr_ann", before: ["usr_ann"], after: ["usr_ann", "usr_bob"], visible })).toBeNull();
    expect(firstUnseenPerson({ actorId: "usr_ann", before: ["usr_zed"], after: ["usr_zed"], visible })).toBeNull();
  });
  it("refuses a person outside the directory and any team entry", () => {
    expect(firstUnseenPerson({ actorId: "usr_ann", before: [], after: ["usr_eve"], visible })).toBe("usr_eve");
    expect(firstUnseenPerson({ actorId: "usr_ann", before: [], after: ["team:ops"], visible: () => true })).toBe("team:ops");
  });
});
