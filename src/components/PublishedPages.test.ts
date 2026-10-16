// The approval card's request (src/components/PublishedPages.tsx): the access
// and expiry are the person's choices, sent as given; the preview frame never
// has same-origin.
import { describe, expect, it } from "vitest";

import { PAGE_FRAME_SANDBOX } from "../../shared/published-pages";
import { expiryFromHours, publishBody } from "./PublishedPages";

describe("published page card", () => {
  it("publishBody carries the version, the access the person picked and the expiry", () => {
    const now = 1_000_000;
    expect(publishBody(3, "private", 0, now)).toEqual({ version: 3, access: "private", expiresAt: null });
    expect(publishBody(1, "link", 24, now)).toEqual({ version: 1, access: "link", expiresAt: now + 24 * 3_600_000 });
    expect(expiryFromHours(0, now)).toBeNull();
  });

  it("previews in a sandbox without same-origin, top navigation or popups", () => {
    const flags = PAGE_FRAME_SANDBOX.split(" ");
    expect(flags).toContain("allow-scripts");
    expect(flags).not.toContain("allow-same-origin");
    expect(flags.some((flag) => flag.startsWith("allow-top-navigation"))).toBe(false);
    expect(flags.some((flag) => flag.startsWith("allow-popups"))).toBe(false);
  });
});
