import { describe, expect, it } from "vitest";

import { MEMBER_DEFAULT_PERMISSIONS, PERMISSION_KEYS } from "../shared/permissions.ts";
import { effectivePermissions, permissionList } from "./org-permissions.ts";

describe("effectivePermissions", () => {
  it("an admin holds every key", () => {
    const admin = effectivePermissions({ admin: true, fromDirectory: [], botsUseOnly: true });
    expect(admin.source).toBe("admin");
    expect(permissionList(admin)).toEqual([...PERMISSION_KEYS]);
    expect(admin.narrowedBy).toEqual([]);
  });

  it("no list from Perspicax: the member defaults, so nothing regresses", () => {
    const member = effectivePermissions({ admin: false, fromDirectory: null });
    expect(member.source).toBe("defaults");
    expect(permissionList(member)).toEqual([...MEMBER_DEFAULT_PERMISSIONS]);
  });

  it("a list from Perspicax is taken as is, even empty", () => {
    expect(permissionList(effectivePermissions({ admin: false, fromDirectory: ["usage.view"] }))).toEqual(["usage.view"]);
    const none = effectivePermissions({ admin: false, fromDirectory: [] });
    expect(none.source).toBe("perspicax");
    expect(permissionList(none)).toEqual([]);
  });

  it("the person sheet narrows on top of the profiles", () => {
    const sheet = effectivePermissions({
      admin: false,
      fromDirectory: ["bots.create", "bots.tools", "sharing.grants", "apps.ownIntegrations", "usage.view"],
      botsUseOnly: true,
      integrationsOff: true,
    });
    expect(permissionList(sheet)).toEqual(["usage.view"]);
    expect(sheet.narrowedBy).toEqual(["sagax_bots", "sagax_integrations"]);
  });
});
