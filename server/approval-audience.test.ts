import { describe, expect, it } from "vitest";
import { approvalAudience, approvalDelivery, receivesApprovalCard } from "./approval-audience.ts";

describe("approval audience", () => {
  it("sends the card to the owner session on the executing machine", () => {
    expect(approvalAudience({
      ownerUserId: "jc",
      host: { kind: "machine", userId: "jc", deviceId: "studio" },
    })).toEqual({ userId: "jc", deviceId: "studio" });
  });

  it("does not take channel members as an audience", () => {
    const audience = approvalAudience({ ownerUserId: "jc", host: { kind: "fleet" } });
    expect(audience.userId).toBe("jc");
    expect(Object.keys(audience)).toEqual(["userId", "deviceId"]);
  });

  it("keeps the card for that session and withholds the payload from everyone else", () => {
    const audience = approvalAudience({
      ownerUserId: "jc",
      host: { kind: "machine", userId: "jc", deviceId: "studio" },
    });
    const card = { id: "m1", kind: "options" as const, card: { title: "Approval needed", requestId: "r1", tool: "bash" } };
    expect(receivesApprovalCard({ userId: "jc", deviceId: "studio" }, audience)).toBe(true);
    expect(receivesApprovalCard({ userId: "jc", deviceId: "laptop" }, audience)).toBe(false);
    expect(approvalDelivery({
      audience,
      viewer: { userId: "jc", deviceId: "studio" },
      message: card,
      ownerName: "Jean-Christophe",
    })).toBe(card);
    const other = approvalDelivery({
      audience,
      viewer: { userId: "zachary@example.test", deviceId: null },
      message: card,
      ownerName: "Jean-Christophe",
    });
    expect(other).toEqual({
      id: "m1",
      kind: "options",
      state: "waiting-on-owner",
      ownerName: "Jean-Christophe",
    });
    expect(other).not.toHaveProperty("card");
    const settled = approvalDelivery({
      audience,
      viewer: { userId: "zachary@example.test", deviceId: null },
      message: { ...card, card: { ...card.card, answered: "allow" } },
      ownerName: "Jean-Christophe",
    });
    expect(settled).not.toHaveProperty("card");
    expect(settled).not.toHaveProperty("state");
  });

  it("matches the owner on any device when the host is the fleet", () => {
    const audience = approvalAudience({ ownerUserId: "jc", host: { kind: "fleet" } });
    expect(audience.deviceId).toBeNull();
    expect(receivesApprovalCard({ userId: "jc", deviceId: null }, audience)).toBe(true);
    expect(receivesApprovalCard({ userId: "jc", deviceId: "studio" }, audience)).toBe(true);
    expect(receivesApprovalCard({ userId: "zachary@example.test", deviceId: null }, audience)).toBe(false);
  });
});
