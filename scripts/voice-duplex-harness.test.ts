import { describe, expect, it } from "vitest";

import { runVoiceDuplexHarness } from "./voice-duplex-harness.ts";

describe("voice duplex harness", () => {
  it("duplex barge-in leaves a single active turn and no queued follow-up", () => {
    const out = runVoiceDuplexHarness({ duplex: true });
    expect(out.spoken).toEqual(["It is sunny."]);
    expect(out.queuedAfter).toBe(0);
    expect(out.interrupts).toBe(1);
    expect(out.sends).toEqual(["tell me a story", "what about the weather"]);
  });

  it("flag off still stacks the follow-up after the first answer", () => {
    const out = runVoiceDuplexHarness({ duplex: false });
    expect(out.spoken).toEqual(["Once upon a time.", "It is sunny."]);
    expect(out.queuedAfter).toBe(0);
    expect(out.interrupts).toBe(0);
  });
});
