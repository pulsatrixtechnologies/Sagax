import { describe, expect, it } from "vitest";

import { windowChromeOptions } from "./window-chrome.mjs";

describe("window chrome", () => {
  it("uses inset traffic lights on macOS", () => {
    expect(windowChromeOptions("darwin")).toEqual({
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 16 },
    });
  });

  it("hides the native title bar on Windows; caption buttons are renderer-drawn", () => {
    expect(windowChromeOptions("win32")).toEqual({
      titleBarStyle: "hidden",
    });
  });

  it("keeps Linux window chrome native", () => {
    expect(windowChromeOptions("linux")).toEqual({});
  });
});

describe("traffic lights per skin", () => {
  it("moves the macOS lights into the Hibou 98 title bar and back", async () => {
    const { trafficLightsForSkin, TRAFFIC_LIGHTS } = await import("./window-chrome.mjs");
    expect(trafficLightsForSkin("darwin", "retro98")).toEqual({ x: 10, y: 7 });
    expect(trafficLightsForSkin("darwin", "pulsatrix")).toEqual({ ...TRAFFIC_LIGHTS });
    expect(trafficLightsForSkin("win32", "retro98")).toBeNull();
    expect(trafficLightsForSkin("linux", "retro98")).toBeNull();
  });
});
