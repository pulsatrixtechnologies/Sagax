import { describe, expect, it } from "vitest";

import { initialState, reducer } from "./store";

describe("Achievements modal state", () => {
  it("opens and closes, and is one modal at a time with Settings and the other pop-ups", () => {
    const withSettings = reducer(initialState, { type: "toggleAppSettings", open: true, section: "appearance" });
    const opened = reducer(withSettings, { type: "toggleAchievements", open: true });
    expect(opened.achievementsOpen).toBe(true);
    expect(opened.appSettingsOpen).toBe(false);

    expect(reducer(opened, { type: "toggleAppSettings", open: true }).achievementsOpen).toBe(false);
    expect(reducer(opened, { type: "togglePlugins", open: true }).achievementsOpen).toBe(false);
    expect(reducer(opened, { type: "toggleTriggers", open: true }).achievementsOpen).toBe(false);
    expect(reducer(opened, { type: "showRoutines" }).achievementsOpen).toBe(false);
    expect(reducer(opened, { type: "showTeamMap" }).achievementsOpen).toBe(false);
    expect(reducer(opened, { type: "toggleAchievements" }).achievementsOpen).toBe(false);
    // closing it leaves Settings closed too
    expect(reducer(opened, { type: "toggleAchievements", open: false }).appSettingsOpen).toBe(false);
    expect(initialState.achievementsOpen).toBe(false);
  });
});
