import { describe, expect, it } from "vitest";

import { feedbackMailto, FEEDBACK_ADDRESS } from "./feedback";

describe("Send feedback", () => {
  it("drafts a mail to the public mailbox with the version and system, nothing attached", () => {
    const url = feedbackMailto({ version: "0.5.8", system: "macOS" });
    expect(FEEDBACK_ADDRESS).toBe("hello@pulsatrix.ca");
    expect(url.startsWith("mailto:hello@pulsatrix.ca?")).toBe(true);
    const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(params.get("subject")).toContain("0.5.8");
    expect(params.get("body")).toContain("Sagax 0.5.8");
    expect(params.get("body")).toContain("macOS");
    expect(url).not.toMatch(/attach/i);
    expect(url.length).toBeLessThanOrEqual(1900);
  });
});
