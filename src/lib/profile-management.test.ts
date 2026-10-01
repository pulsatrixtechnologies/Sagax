import { describe, expect, it } from "vitest";
import { managedProfile, personAvatarSrc } from "./profile-management";

describe("managedProfile", () => {
  it("reads the config's viewer block of an organization server", () => {
    const viewer = {
      operator: false, principalId: "pr_1", email: "jc@example.test", name: "Jean-Christophe", role: "admin", canCreateBots: true,
      profileManagedBy: "perspicax", profileManageUrl: "https://pulsatrix.example.test/console/me",
    };
    expect(managedProfile(viewer)).toEqual({ by: "perspicax", url: "https://pulsatrix.example.test/console/me", name: "Jean-Christophe", email: "jc@example.test" });
  });

  it("keeps a solo server's and an older server's profile editable", () => {
    expect(managedProfile({ operator: true, principalId: "pr_1", email: "jc@example.test", name: "JC", role: "owner", canCreateBots: true })).toBeNull();
    expect(managedProfile(undefined)).toBeNull();
    expect(managedProfile(null)).toBeNull();
    expect(managedProfile({ profileManagedBy: true })).toBeNull();
  });

  it("drops a link that is not a web page", () => {
    expect(managedProfile({ profileManagedBy: "perspicax", profileManageUrl: "file:///etc/passwd" })?.url).toBeNull();
    expect(managedProfile({ profileManagedBy: "perspicax" })).toEqual({ by: "perspicax", url: null, name: "", email: "" });
  });

  it("carries the Perspicax avatar this server serves, nothing from elsewhere", () => {
    const base = { profileManagedBy: "perspicax", name: "JC" };
    expect(managedProfile({ ...base, avatarUrl: "/api/people/pr_1/avatar?v=0a1b" })?.avatarUrl).toBe("/api/people/pr_1/avatar?v=0a1b");
    expect(managedProfile({ ...base, avatarUrl: "https://tracker.example.test/p.png" })?.avatarUrl).toBeUndefined();
    expect(managedProfile({ ...base, avatarUrl: "/api/attachments/x.png" })?.avatarUrl).toBeUndefined();
    expect(personAvatarSrc("/api/people/pr_1/avatar")).toBe("/api/people/pr_1/avatar");
    expect(personAvatarSrc("/api/people/../avatar")).toBeUndefined();
  });
});
