// The picker's state dots (JC 2026-10-15): yellow while asleep or waking,
// green when up, a quiet neutral grey when off, not started, or failed.
import { afterEach, describe, expect, it } from "vitest";

import { browserDot, reportScreenDot, resetScreenDots, SCREEN_DOT_CLASS, screenDot, screenDots } from "./screen-status";

afterEach(() => resetScreenDots());

describe("screen dots", () => {
  it("maps each screen state to its colour", () => {
    expect(screenDot("running")).toBe("online");
    expect(screenDot("paused")).toBe("asleep");
    expect(screenDot("starting")).toBe("asleep");
    expect(screenDot("off")).toBe("offline");
    // an error, the cluster's after the wake limit included: neutral, never red
    expect(screenDot("error")).toBe("offline");
    expect(screenDot(null)).toBe("offline");
    // the cluster waking: asleep whatever the state read says
    expect(screenDot("error", true)).toBe("asleep");
    expect(screenDot("off", true)).toBe("asleep");
  });

  it("is green for a live browser session, neutral otherwise", () => {
    expect(browserDot(true)).toBe("online");
    expect(browserDot(false)).toBe("offline");
  });

  it("uses theme tokens only, and no danger colour", () => {
    expect(SCREEN_DOT_CLASS).toEqual({ asleep: "bg-warning", online: "bg-success", offline: "bg-ink-tertiary/50" });
    for (const value of Object.values(SCREEN_DOT_CLASS)) expect(value).not.toMatch(/danger|red/);
  });

  it("keeps the last known dot of each screen", () => {
    reportScreenDot("server", "asleep");
    reportScreenDot("desktop:d1", "online");
    const before = screenDots();
    reportScreenDot("server", "asleep");
    expect(screenDots()).toBe(before);
    expect(screenDots()).toEqual({ server: "asleep", "desktop:d1": "online" });
  });
});
