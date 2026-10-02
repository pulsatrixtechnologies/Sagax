// Sagax sends no usage analytics: the module must stay inert.
import { describe, expect, it, vi } from "vitest";

import * as analytics from "./analytics";

describe("analytics", () => {
  it("sends nothing", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    analytics.initAnalytics();
    analytics.track("app_opened", { platform: "desktop" });
    analytics.identifyEmail("someone@example.com");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("has no opt-out switch left to expose", () => {
    expect("setAnalyticsEnabled" in analytics).toBe(false);
    expect("analyticsEnabled" in analytics).toBe(false);
  });
});
