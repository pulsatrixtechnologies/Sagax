import { describe, expect, it } from "vitest";

import {
  CLIENT_BOT_PATCH_FIELDS,
  MEMBER_BOT_FIELDS,
  clientBotPatchViolation,
  isMemberBotField,
  memberBotFieldViolation,
  viewerCapabilities,
} from "./viewer-capabilities";

describe("viewer capabilities", () => {
  it("gives an admin every installation write and a member none", () => {
    expect(viewerCapabilities({ admin: true })).toEqual({
      editConfig: true,
      manageKeys: true,
      manageComputers: true,
      viewUsage: true,
      manageBackups: true,
      pairDevices: true,
    });
    expect(viewerCapabilities({ admin: false, pairDevices: true })).toEqual({
      editConfig: false,
      manageKeys: false,
      manageComputers: false,
      viewUsage: false,
      manageBackups: false,
      pairDevices: true,
    });
    expect(viewerCapabilities({ admin: false }).pairDevices).toBe(false);
  });

  it("lets a member set look, name, instructions and model, and nothing a bot may do", () => {
    for (const field of CLIENT_BOT_PATCH_FIELDS) expect(isMemberBotField(field), field).toBe(true);
    expect(memberBotFieldViolation({
      name: "Scout", title: "Research", description: "Looks things up", soul: "Be brief.",
      notifications: true, avatarUrl: "", modelSelection: { instanceId: "codex" }, requireAvailableModel: true,
      color: "green",
    })).toBeNull();
    for (const field of ["cwd", "computer", "approvalMode", "mcpServers", "browserProfile", "peers", "chiefOfStaff", "section", "visibility", "fallback", "voice", "speakReplies", "memoryEnabled", "alwaysAllow", "outbound", "cloudBackend", "managedSections", "approvePeerComms"]) {
      expect(memberBotFieldViolation({ name: "Scout", [field]: null }), field).toBe(field);
    }
    expect(clientBotPatchViolation({ color: "green", autoApprove: true })).toBe("autoApprove");
    expect(MEMBER_BOT_FIELDS).toContain("modelSelection");
    expect(MEMBER_BOT_FIELDS).not.toContain("approvalMode");
  });
});
