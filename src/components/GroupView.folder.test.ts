// #1098 (2026-10-28): the owner of a group sets its working folder with no
// admin. Every member holds folders.roomWorkingFolder; the panel still
// asks that they own the group, and the server checks the path.
import { describe, expect, it } from "vitest";

import type { ConfigStatus } from "@/state/store";
import { MEMBER_ALWAYS_PERMISSIONS, MEMBER_DEFAULT_PERMISSIONS } from "../../shared/permissions";
import { roomFolderEditable } from "./GroupView";

const member = (permissions?: readonly string[]) =>
  ({ viewer: { operator: false, principalId: "pr_me", role: "member", ...(permissions ? { permissions: [...permissions] } : {}) } }) as unknown as ConfigStatus;

describe("a group's working folder", () => {
  it("is the member's to set on a group they own, with or without a list from Perspicax", () => {
    expect(roomFolderEditable({ ownerId: "pr_me" }, member())).toBe(true);
    expect(roomFolderEditable({ ownerId: "pr_me" }, member(MEMBER_ALWAYS_PERMISSIONS))).toBe(true);
    expect(MEMBER_DEFAULT_PERMISSIONS).toContain("folders.roomWorkingFolder");
    expect(MEMBER_ALWAYS_PERMISSIONS).toContain("folders.roomWorkingFolder");
  });
});
