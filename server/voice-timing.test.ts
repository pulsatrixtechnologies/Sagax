// Voice timings for the Events lens (server/voice-timing.ts): numbers only.
import { describe, expect, it } from "vitest";

import { callTurnNotice, parseVoiceClientTiming, streamedTranscriptNotice, uploadedTranscriptNotice } from "./voice-timing.ts";

describe("voice timing notices", () => {
  it("says how long the whole-recording upload took and for how much audio", () => {
    // 3 s of 16 kHz 16-bit mono WAV
    expect(uploadedTranscriptNotice({ bytes: 44 + 3 * 32_000, mime: "audio/wav", ms: 1_240 })).toBe("Voice: speech to text (whole recording) took 1.2 s for 3.0 s of audio");
    expect(uploadedTranscriptNotice({ bytes: 20_480, mime: "audio/webm", ms: 640 })).toBe("Voice: speech to text (whole recording) took 640 ms for 20 KB of audio");
  });

  it("says when the streamed final words came after the end of speech", () => {
    expect(streamedTranscriptNotice(312)).toBe("Voice: speech to text (streaming) gave the final words 312 ms after the end of speech");
  });

  it("keeps only sane page timings and never the words", () => {
    expect(parseVoiceClientTiming({ endpointMs: 560.4, sttMs: -1, dispatchMs: "20", text: "secret words" })).toEqual({ endpointMs: 560 });
    expect(parseVoiceClientTiming("nope")).toBeUndefined();
    expect(parseVoiceClientTiming({})).toBeUndefined();
  });

  it("reads a turn without the page's stages", () => {
    expect(callTurnNotice({ dispatchMs: 12, engineMs: 3, warm: true, firstTokenMs: 640 })).toBe("Voice turn: turn setup 12 ms, engine 3 ms (warm), first words 640 ms; 655 ms from the end of speech to the first words");
  });
});
