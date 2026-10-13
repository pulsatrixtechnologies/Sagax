// Pure duplex turn policy: barge-in of speech cancels that reply. Talking
// while it thinks does not interrupt (the send forks, stops, or replaces).
// Flag off keeps today's steer-while-thinking behavior.
import { describe, expect, it } from "vitest";

import { bargeInEffects, thinkingCueMs } from "./duplex-policy";

describe("duplex barge-in policy", () => {
  it("duplex talking while the bot is thinking does not interrupt: the send forks or stops", () => {
    expect(bargeInEffects({ duplex: true, botBusy: true, botAudible: false })).toBe("none");
  });

  it("flag off while thinking does not interrupt", () => {
    expect(bargeInEffects({ duplex: false, botBusy: true, botAudible: false })).toBe("none");
  });

  it("duplex barge-in while speaking cancels and interrupts", () => {
    expect(bargeInEffects({ duplex: true, botBusy: true, botAudible: true })).toBe("cancel-and-interrupt");
  });

  it("flag off while speaking still cancels and interrupts", () => {
    expect(bargeInEffects({ duplex: false, botBusy: true, botAudible: true })).toBe("cancel-and-interrupt");
  });

  it("speaking after the turn finished only drops remaining speech", () => {
    expect(bargeInEffects({ duplex: true, botBusy: false, botAudible: true })).toBe("cancel-speech-only");
    expect(bargeInEffects({ duplex: false, botBusy: false, botAudible: true })).toBe("cancel-speech-only");
  });

  it("idle listening is not a barge-in", () => {
    expect(bargeInEffects({ duplex: true, botBusy: false, botAudible: false })).toBe("none");
    expect(bargeInEffects({ duplex: false, botBusy: false, botAudible: false })).toBe("none");
  });

  it("thinking cue is 400 ms when duplex, 1200 ms otherwise", () => {
    expect(thinkingCueMs(true)).toBe(400);
    expect(thinkingCueMs(false)).toBe(1200);
  });

  it("background work: barge-in over speech drops the voice and does not interrupt the task", () => {
    expect(bargeInEffects({ duplex: true, botBusy: true, botAudible: true, backgroundWork: true })).toBe("cancel-speech-only");
  });

  it("kill-switch off still interrupts a speaking busy turn even if a tool chip is open", () => {
    expect(bargeInEffects({ duplex: false, botBusy: true, botAudible: true, backgroundWork: true })).toBe("cancel-and-interrupt");
  });

  it("background work: talking while it thinks does not interrupt the task", () => {
    expect(bargeInEffects({ duplex: true, botBusy: true, botAudible: false, backgroundWork: true })).toBe("none");
  });

  it("kill-switch off while thinking with a tool chip still does not interrupt", () => {
    expect(bargeInEffects({ duplex: false, botBusy: true, botAudible: false, backgroundWork: true })).toBe("none");
  });
});
