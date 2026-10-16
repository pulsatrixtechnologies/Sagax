// The approval card's request (src/components/PublishedPages.tsx): the access
// and expiry are the person's choices, sent as given; the preview frame never
// has same-origin.
import { describe, expect, it } from "vitest";

import { pageFrameSandbox } from "../../shared/published-pages";
import { expiryFromHours, frameEscaped, publishBody } from "./PublishedPages";

describe("published page card", () => {
  it("publishBody carries the version, the access the person picked and the expiry", () => {
    const now = 1_000_000;
    expect(publishBody(3, "private", 0, now)).toEqual({ version: 3, access: "private", expiresAt: null });
    expect(publishBody(1, "link", 24, now)).toEqual({ version: 1, access: "link", expiresAt: now + 24 * 3_600_000 });
    expect(expiryFromHours(0, now)).toBeNull();
  });

  it("previews in a sandbox with scripts only (HTML) or nothing (Markdown)", () => {
    expect(pageFrameSandbox("html")).toBe("allow-scripts");
    expect(pageFrameSandbox("markdown")).toBe("");
  });

  it("a second load of the preview frame is a navigation away and resets it", () => {
    expect(frameEscaped(1)).toBe(false);
    expect(frameEscaped(2)).toBe(true);
  });
});
