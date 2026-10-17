// Automatic approval levels for members' bots (server/member-auto-approval.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { memberAutoApprovalAllowed, memberAutoChangeRefused, memberAutoLevelResets, memberAutoResetPending, memberRoomTurnLevel, memberTurnLevel, type MemberAutoResetBot } from "./member-auto-approval.ts";

describe("memberAutoApprovalAllowed", () => {
  it("is on unless an admin saved false", () => {
    expect(memberAutoApprovalAllowed(undefined)).toBe(true);
    expect(memberAutoApprovalAllowed({})).toBe(true);
    expect(memberAutoApprovalAllowed({ memberAutoApproval: true })).toBe(true);
    expect(memberAutoApprovalAllowed({ memberAutoApproval: false })).toBe(false);
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

describe("memberRoomTurnLevel (a Primary Bot's handoff in a room)", () => {
  it("never lifts a member's bot to Auto or Auto-accept edits while the organization turned them off", () => {
    expect(memberRoomTurnLevel("auto", false)).toBe("ask");
    expect(memberRoomTurnLevel("edits", false)).toBe("ask");
    expect(memberRoomTurnLevel("auto", true)).toBe("auto");
    expect(memberRoomTurnLevel("edits", true)).toBe("edits");
  });

  it("is what the server's room turns apply to a member's bot (index.ts roomTurnApprovalMode)", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const start = source.indexOf("function roomTurnApprovalMode(");
    const body = source.slice(start, source.indexOf("\n}\n", start));
    expect(start).toBeGreaterThan(-1);
    expect(body).toMatch(/if \(memberOwnedInOrg\(bot\)\) return memberRoomTurnLevel\(level, memberAutoApprovalAllowed\(cfg\.organization\)\);/);
    // applied after the handoff's delegated level, not before
    expect(body.indexOf("delegatedLevel(")).toBeLessThan(body.indexOf("memberRoomTurnLevel("));
  });

  it("the owner's permission mode of a member's bot runs as Approval while the setting is off (index.ts effectivePermissionMode)", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const start = source.indexOf("function effectivePermissionMode(");
    const body = source.slice(start, source.indexOf("\n}\n", start));
    expect(body).toMatch(/if \(mode !== "approval" && memberOwnedInOrg\(bot\) && !memberAutoApprovalAllowed\(cfg\.organization\)\) return "approval";/);
  });

  it("keeps Custom at Ask and leaves Ask and Full to their own rules", () => {
    for (const allowed of [true, false]) {
      expect(memberRoomTurnLevel("custom", allowed)).toBe("ask");
      expect(memberRoomTurnLevel("ask", allowed)).toBe("ask");
      expect(memberRoomTurnLevel("full", allowed)).toBe("full");
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
  it("never runs by default, nor while the setting is on", () => {
    expect(memberAutoResetPending("perspicax", undefined)).toBe(false);
    expect(memberAutoResetPending("perspicax", {})).toBe(false);
    expect(memberAutoResetPending("perspicax", { memberAutoApproval: true })).toBe(false);
  });

  it("runs once an admin turned it off, on an organization server only", () => {
    expect(memberAutoResetPending("perspicax", { memberAutoApproval: false })).toBe(true);
    expect(memberAutoResetPending("perspicax", { memberAutoApproval: false, memberAutoResetAt: 1 })).toBe(false);
    expect(memberAutoResetPending("solo", { memberAutoApproval: false })).toBe(false);
  });
});
