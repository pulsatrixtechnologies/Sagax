// Automatic approval levels for members' bots (server/member-auto-approval.ts).
import { describe, expect, it } from "vitest";

import { memberAutoApprovalAllowed, memberAutoChangeRefused, memberAutoLevelResets, memberAutoResetPending, memberTurnLevel, type MemberAutoResetBot } from "./member-auto-approval.ts";

describe("memberAutoApprovalAllowed", () => {
  it("is off unless an admin saved true", () => {
    expect(memberAutoApprovalAllowed(undefined)).toBe(false);
    expect(memberAutoApprovalAllowed({})).toBe(false);
    expect(memberAutoApprovalAllowed({ memberAutoApproval: false })).toBe(false);
    expect(memberAutoApprovalAllowed({ memberAutoApproval: "true" })).toBe(false);
    expect(memberAutoApprovalAllowed({ memberAutoApproval: true })).toBe(true);
  });
});

describe("memberTurnLevel", () => {
  it("runs Auto and Auto-accept edits as Ask while the organization does not allow them", () => {
    expect(memberTurnLevel("auto", false)).toBe("ask");
    expect(memberTurnLevel("edits", false)).toBe("ask");
    expect(memberTurnLevel("auto", true)).toBe("auto");
    expect(memberTurnLevel("edits", true)).toBe("edits");
  });

  it("leaves Ask, Full and Custom to their own rules", () => {
    for (const allowed of [true, false]) {
      expect(memberTurnLevel("ask", allowed)).toBe("ask");
      expect(memberTurnLevel("full", allowed)).toBe("full");
      expect(memberTurnLevel("custom", allowed)).toBe("custom");
    }
  });
});

describe("memberAutoChangeRefused", () => {
  const base = { memberOwned: true, policyAllowed: false };

  it("refuses a member's bot moving to Auto or Auto-accept edits while the setting is off", () => {
    expect(memberAutoChangeRefused({ ...base, froms: ["ask"], to: "auto" })).toBe(true);
    expect(memberAutoChangeRefused({ ...base, froms: [undefined], to: "edits" })).toBe(true);
    expect(memberAutoChangeRefused({ ...base, froms: ["full"], to: "auto" })).toBe(true);
    expect(memberAutoChangeRefused({ ...base, froms: ["auto", "ask"], to: "auto" })).toBe(true);
  });

  it("lets the same level through (a profile resend), and Ask always", () => {
    expect(memberAutoChangeRefused({ ...base, froms: ["auto"], to: "auto" })).toBe(false);
    expect(memberAutoChangeRefused({ ...base, froms: ["auto"], to: "ask" })).toBe(false);
  });

  it("never refuses an admin's bot, or once the organization allows it", () => {
    expect(memberAutoChangeRefused({ ...base, memberOwned: false, froms: ["ask"], to: "auto" })).toBe(false);
    expect(memberAutoChangeRefused({ ...base, policyAllowed: true, froms: ["ask"], to: "auto" })).toBe(false);
  });

  it("leaves Full and Custom to their own refusals", () => {
    expect(memberAutoChangeRefused({ ...base, froms: ["ask"], to: "full" })).toBe(false);
    expect(memberAutoChangeRefused({ ...base, froms: ["ask"], to: "custom" })).toBe(false);
  });
});

describe("memberAutoLevelResets", () => {
  const bots: MemberAutoResetBot[] = [
    {
      id: "member", approvalMode: "auto", autoApprove: true,
      tasks: [
        { threadId: "m-auto", approvalMode: "auto", autoApprove: true },
        { threadId: "m-edits", approvalMode: "edits", autoApprove: false },
        { threadId: "m-ask", approvalMode: "ask", autoApprove: false },
        { threadId: "m-full", approvalMode: "full", autoApprove: false },
        { threadId: "m-legacy", autoApprove: true },
        { threadId: "m-inherits" },
      ],
    },
    { id: "member-edits", approvalMode: "edits", tasks: [] },
    { id: "member-legacy", autoApprove: true },
    { id: "member-ask", approvalMode: "ask", tasks: [{ threadId: "ma-custom", approvalMode: "custom" }] },
    { id: "admin", approvalMode: "auto", autoApprove: true, tasks: [{ threadId: "a-auto", approvalMode: "auto" }] },
  ];
  const memberOwned = (bot: MemberAutoResetBot) => bot.id !== "admin";

  it("names every saved automatic level of members' bots, and nothing else", () => {
    expect(memberAutoLevelResets(bots, memberOwned)).toEqual({
      bots: ["member", "member-edits", "member-legacy"],
      threads: [
        { botId: "member", threadId: "m-auto" },
        { botId: "member", threadId: "m-edits" },
        { botId: "member", threadId: "m-legacy" },
      ],
    });
  });

  it("is empty with no member's bot", () => {
    expect(memberAutoLevelResets(bots, () => false)).toEqual({ bots: [], threads: [] });
  });
});

describe("memberAutoResetPending", () => {
  it("runs once, on an organization server only", () => {
    expect(memberAutoResetPending("perspicax", undefined)).toBe(true);
    expect(memberAutoResetPending("perspicax", {})).toBe(true);
    expect(memberAutoResetPending("perspicax", { memberAutoResetAt: 1 })).toBe(false);
    expect(memberAutoResetPending("solo", {})).toBe(false);
  });
});
