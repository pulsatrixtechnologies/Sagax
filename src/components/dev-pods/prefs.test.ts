import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, devPodsTurnField, resetDevPodPrefsForTest, setDevPodsEnabled } from "./prefs";

describe("coding view field on a send", () => {
  it("says devPods on only while the view is on on this device", () => {
    resetDevPodPrefsForTest({ ...DEFAULT_PREFS });
    expect(devPodsTurnField()).toEqual({});
    setDevPodsEnabled(true);
    expect(devPodsTurnField()).toEqual({ devPods: "on" });
    setDevPodsEnabled(false);
    expect(devPodsTurnField()).toEqual({});
  });
});
