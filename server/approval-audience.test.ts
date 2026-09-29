import { describe, expect, it } from "vitest";
import { answerApproval, approvalAnswerStatus, approvalAudience, approvalDelivery, receivesApprovalCard } from "./approval-audience.ts";

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
    expect(receivesApprovalCard({ userId: "jc", deviceId: null }, audience)).toBe(false);
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

  it("refuses a non-owner answer and leaves the card unchanged", () => {
    const audience = approvalAudience({ ownerUserId: "jc", host: { kind: "fleet" } });
    const card = { id: "m1", kind: "options" as const, card: { title: "Approval needed", requestId: "r1", tool: "bash" } };
    const before = { ...card, card: { ...card.card } };
    const refused = answerApproval({ callerUserId: "zachary@example.test", audience, card });
    expect(refused).toEqual({ status: 403, card });
    expect(refused.card).toBe(card);
    expect(card).toEqual(before);
    expect(card.card).not.toHaveProperty("answered");
  });

  it("leaves questions and an approval with no live bot on the ordinary answer path", () => {
    const audience = approvalAudience({ ownerUserId: "jc", host: { kind: "fleet" } });
    expect(approvalAnswerStatus({
      question: true,
      audience,
      callerUserId: "zachary@example.test",
    })).toBeNull();
    expect(approvalAnswerStatus({
      question: false,
      audience: null,
      callerUserId: "zachary@example.test",
    })).toBeNull();
    expect(approvalAnswerStatus({
      question: false,
      audience,
      callerUserId: "zachary@example.test",
    })).toBe(403);
    expect(approvalAnswerStatus({
      question: false,
      audience,
      callerUserId: "jc",
    })).toBeNull();
  });

  it("matches the owner on any device when the host is the fleet", () => {
    const audience = approvalAudience({ ownerUserId: "jc", host: { kind: "fleet" } });
    expect(audience.deviceId).toBeNull();
    expect(receivesApprovalCard({ userId: "jc", deviceId: null }, audience)).toBe(true);
    expect(receivesApprovalCard({ userId: "jc", deviceId: "studio" }, audience)).toBe(true);
    expect(receivesApprovalCard({ userId: "zachary@example.test", deviceId: null }, audience)).toBe(false);
  });
});
