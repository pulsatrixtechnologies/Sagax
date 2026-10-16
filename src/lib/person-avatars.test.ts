import { describe, expect, it } from "vitest";

import type { ConfigStatus } from "@/state/store";
import { withViewerAvatar } from "./person-avatars";

const ME = "pr_00000001-0000-4000-8000-000000000000";
const config = (avatarUrl?: string) => ({
  viewer: { operator: false, principalId: ME, email: "a@example.test", name: "Ada", role: "member", ...(avatarUrl ? { avatarUrl } : {}) },
}) as unknown as ConfigStatus;

describe("the viewer's own photo from a person.avatar frame", () => {
  it("replaces the viewer's avatar with the new versioned URL", () => {
    const next = withViewerAvatar(config(`/api/people/${ME}/avatar?v=old`), { principalId: ME.toUpperCase(), avatarUrl: `/api/people/${ME}/avatar?v=new` });
    expect(next.viewer?.avatarUrl).toBe(`/api/people/${ME}/avatar?v=new`);
  });

  it("drops it when the photo was removed", () => {
    const next = withViewerAvatar(config(`/api/people/${ME}/avatar?v=old`), { principalId: ME, avatarUrl: null });
    expect(next.viewer).not.toHaveProperty("avatarUrl");
  });

  it("leaves the config alone for someone else, an unchanged URL or a URL that is not ours", () => {
    const base = config(`/api/people/${ME}/avatar?v=old`);
    expect(withViewerAvatar(base, { principalId: "pr_00000002-0000-4000-8000-000000000000", avatarUrl: null })).toBe(base);
    expect(withViewerAvatar(base, { principalId: ME, avatarUrl: `/api/people/${ME}/avatar?v=old` })).toBe(base);
    // an outside URL is never put in the config: it reads as removed
    expect(withViewerAvatar(base, { principalId: ME, avatarUrl: "https://evil.example.test/x.png" }).viewer).not.toHaveProperty("avatarUrl");
  });
});
