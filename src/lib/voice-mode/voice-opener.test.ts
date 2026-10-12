import { describe, expect, it } from "vitest";

import { acceptVoiceOpener, type VoiceOpenerOwner } from "./voice-opener";

const owner: VoiceOpenerOwner = {
  threadId: "thread-1",
  callId: "call-0123456789",
  utteranceId: "utt-0123456789",
  replyStarted: false,
};

describe("acceptVoiceOpener", () => {
  it("speaks a clip for the utterance that was just sent", () => {
    expect(acceptVoiceOpener(owner, { ...owner, text: "Let me check." })).toBe("Let me check.");
  });

  it("drops a clip after the utterance changes or the main reply starts", () => {
    expect(acceptVoiceOpener(owner, { ...owner, utteranceId: "utt-other999", text: "Let me check." })).toBeNull();
    expect(acceptVoiceOpener({ ...owner, replyStarted: true }, { ...owner, text: "Let me check." })).toBeNull();
    expect(acceptVoiceOpener(null, { ...owner, text: "Let me check." })).toBeNull();
  });
});
