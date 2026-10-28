// The usage measure stays off until the person turns it on. Events go only
// to this server, with a closed schema and no person name.
import { describe, expect, it, vi } from "vitest";

import * as analytics from "./analytics";

describe("analytics", () => {
  it("sends nothing until the person turns the measure on, and never a name", async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/events")) return new Response("{}", { status: 202 });
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { enabled: boolean };
        return new Response(JSON.stringify({ enabled: body.enabled, count: 0 }), { status: 200 });
      }
      return new Response(JSON.stringify({ enabled: false, count: 0 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    await analytics.setUsageMeterEnabled(false);
    fetchSpy.mockClear();
    await analytics.initAnalytics();
    analytics.track("app_opened", { surface: "desktop" });
    analytics.identifyEmail("someone@example.com");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("/api/me/usage-meter");
    await analytics.setUsageMeterEnabled(true);
    analytics.track("app_opened", { surface: "desktop", name: "Ada" });
    analytics.track("page_view", {});
    const posts = fetchSpy.mock.calls.filter((call) => String(call[0]).endsWith("/events"));
    expect(posts).toHaveLength(1);
    const posted = posts[0]!;
    expect(JSON.parse(String((posted[1] as RequestInit).body))).toEqual({
      name: "app_opened",
      props: { surface: "desktop" },
    });
    expect(JSON.stringify(fetchSpy.mock.calls)).not.toContain("someone@example.com");
    expect(JSON.stringify(fetchSpy.mock.calls)).not.toContain("Ada");
    await analytics.setUsageMeterEnabled(false);
    vi.unstubAllGlobals();
  });

  it("does not bring back the old analytics switch names", () => {
    expect("setAnalyticsEnabled" in analytics).toBe(false);
    expect("analyticsEnabled" in analytics).toBe(false);
    expect(typeof analytics.setUsageMeterEnabled).toBe("function");
  });
});
