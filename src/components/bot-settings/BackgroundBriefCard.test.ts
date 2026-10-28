import { describe, expect, it } from "vitest";

import { briefQueueText } from "./BackgroundBriefCard";

describe("background brief screen", () => {
  it("says the queue stays empty when no app is connected", () => {
    expect(briefQueueText({ notice: "no_apps", suggestions: [] })).toBe("No app is connected. The queue stays empty.");
    expect(briefQueueText({ apps: 0 })).toBe("No app is connected. The queue stays empty.");
    expect(briefQueueText({ apps: 2, suggestions: [] })).toBeNull();
  });
});
