import { describe, expect, it } from "vitest";

import type { ConfigStatus } from "@/state/store";
import { canEditBotField, canStepPrimary, showBotArchive, showBotDelete, showBotRename, showServerSectionMove, viewerOwnsBot } from "./bot-capabilities";

const ZARA = "pr_00000000-0000-4000-8000-000000000002";
const member = {
  viewer: { operator: false, principalId: ZARA, email: "zara@example.test", name: "zara", role: "member", canCreateBots: true },
} as ConfigStatus;
const own = { ownerUserId: ZARA };
const other = { ownerUserId: "pr_other" };

describe("canEditBotField", () => {
  it("lets a solo server, an admin and a missing viewer edit every field", () => {
    expect(canEditBotField(null, other, "cwd")).toBe(true);
    expect(canEditBotField({ viewer: { ...member.viewer!, role: "admin", operator: false } } as ConfigStatus, other, "approvalMode")).toBe(true);
    expect(canEditBotField({ viewer: { ...member.viewer!, operator: true, role: "owner" } } as ConfigStatus, other, "computer")).toBe(true);
  });

  it("lets an organization member edit member fields only on a bot they own", () => {
    expect(viewerOwnsBot(member, own)).toBe(true);
    expect(viewerOwnsBot(member, other)).toBe(false);
    for (const field of ["name", "soul", "notifications", "modelSelection", "avatarUrl", "color"]) {
      expect(canEditBotField(member, own, field), field).toBe(true);
    }
    for (const field of ["cwd", "computer", "approvalMode", "mcpServers", "fallback", "voice", "speakReplies", "memoryEnabled", "chiefOfStaff", "outbound", "approvePeerComms"]) {
      expect(canEditBotField(member, own, field), field).toBe(false);
    }
  });

  it("lets a member who does not own the bot change only how it looks", () => {
    expect(canEditBotField(member, other, "color")).toBe(true);
    expect(canEditBotField(member, other, "mascotSkin")).toBe(true);
    expect(canEditBotField(member, other, "name")).toBe(false);
    expect(canEditBotField(member, other, "soul")).toBe(false);
  });

  it("treats a draft as the member's own bot, and a read-only person as unable to edit", () => {
    expect(canEditBotField(member, { ownerUserId: undefined }, "name", { draft: true })).toBe(true);
    expect(canEditBotField(member, { ownerUserId: undefined }, "computer", { draft: true })).toBe(false);
    const readOnly = { viewer: { ...member.viewer!, botsReadOnly: true } } as ConfigStatus;
    expect(canEditBotField(readOnly, own, "name")).toBe(false);
    expect(canEditBotField(readOnly, own, "color")).toBe(false);
  });
});

describe("sidebar actions a member may not see", () => {
  const admin = { viewer: { ...member.viewer!, role: "admin" } } as ConfigStatus;
  const readOnly = { viewer: { ...member.viewer!, botsReadOnly: true } } as ConfigStatus;

  it("hides rename for a member who does not own the bot", () => {
    expect(showBotRename(member, own)).toBe(true);
    expect(showBotRename(member, other)).toBe(false);
    expect(showBotRename(admin, other)).toBe(true);
    expect(showBotRename(readOnly, own)).toBe(false);
  });

  it("hides archive for every organization member, including the owner", () => {
    expect(showBotArchive(member)).toBe(false);
    expect(showBotArchive(admin)).toBe(true);
    expect(showBotArchive(null)).toBe(true);
  });

  it("hides delete unless the member owns the bot, and always for a read-only person", () => {
    expect(showBotDelete(member, own)).toBe(true);
    expect(showBotDelete(member, other)).toBe(false);
    expect(showBotDelete(readOnly, own)).toBe(false);
    expect(showBotDelete(admin, other)).toBe(true);
  });

  it("keeps a personal section move and hides a server section move for a member", () => {
    expect(showServerSectionMove(member, true)).toBe(true);
    expect(showServerSectionMove(member, false)).toBe(false);
    expect(showServerSectionMove(admin, false)).toBe(true);
  });
});

describe("canStepPrimary", () => {
  it("keeps the switch for the owner and for a solo server, and hides it while a member is drafting", () => {
    expect(canStepPrimary(null, other)).toBe(true);
    expect(canStepPrimary(member, own)).toBe(true);
    expect(canStepPrimary(member, other)).toBe(false);
    expect(canStepPrimary(member, own, { draft: true })).toBe(false);
    expect(canStepPrimary({ viewer: { ...member.viewer!, botsReadOnly: true } } as ConfigStatus, own)).toBe(false);
  });
});
