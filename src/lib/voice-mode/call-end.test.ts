import { describe, expect, it } from "vitest";

import { BOT_HANGUP_CAP_MS, BOT_HANGUP_SETTLE_MS, decideBotHangup } from "./call-end.ts";

describe("decideBotHangup", () => {
  it("waits while the goodbye is still being said", () => {
    expect(decideBotHangup({ speaking: true, heardSpeech: false, elapsedMs: 0 })).toBe("wait");
    expect(decideBotHangup({ speaking: true, heardSpeech: true, elapsedMs: BOT_HANGUP_CAP_MS - 1 })).toBe("wait");
  });

  it("hangs up once that speech goes quiet", () => {
    expect(decideBotHangup({ speaking: false, heardSpeech: true, elapsedMs: 0 })).toBe("hangup");
  });

  it("waits a moment for a goodbye that has not started, then hangs up", () => {
    expect(decideBotHangup({ speaking: false, heardSpeech: false, elapsedMs: BOT_HANGUP_SETTLE_MS - 1 })).toBe("wait");
    expect(decideBotHangup({ speaking: false, heardSpeech: false, elapsedMs: BOT_HANGUP_SETTLE_MS })).toBe("hangup");
  });

  it("hangs up at the cap even if speech never goes quiet", () => {
    expect(decideBotHangup({ speaking: true, heardSpeech: true, elapsedMs: BOT_HANGUP_CAP_MS })).toBe("hangup");
  });
});
