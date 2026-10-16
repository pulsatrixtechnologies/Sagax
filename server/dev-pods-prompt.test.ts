import { describe, expect, it } from "vitest";

import { DEV_PODS_PROMPT, DevPodsThreads, devPodsPrompt, parseDevPods } from "./dev-pods-prompt.ts";

describe("coding view instruction", () => {
  it("reads only \"on\" from the send", () => {
    expect(parseDevPods("on")).toBe(true);
    for (const value of [undefined, null, "off", true, 1, "ON"]) expect(parseDevPods(value)).toBe(false);
  });

  it("adds the line only while the conversation's newest send said on", () => {
    const threads = new DevPodsThreads();
    expect(devPodsPrompt(threads.isOn("t1"))).toBe("");
    threads.note("t1", true);
    expect(devPodsPrompt(threads.isOn("t1"))).toBe(DEV_PODS_PROMPT);
    expect(threads.isOn("t2")).toBe(false);
    threads.note("t1", false);
    expect(devPodsPrompt(threads.isOn("t1"))).toBe("");
  });

  it("tells the bot the view opens by itself and to say so when asked", () => {
    expect(DEV_PODS_PROMPT).toMatch(/opens? by (?:itself|themselves)/);
    expect(DEV_PODS_PROMPT).toMatch(/turn on coding mode/);
  });
});
