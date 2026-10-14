import { describe, expect, it } from "vitest";

import { isInternalVoiceCallEnd } from "./voice-call-internal.ts";

describe("isInternalVoiceCallEnd", () => {
  it("matches only POST /api/internal/voice-call/end", () => {
    expect(isInternalVoiceCallEnd("POST", "/api/internal/voice-call/end")).toBe(true);
    expect(isInternalVoiceCallEnd("GET", "/api/internal/voice-call/end")).toBe(false);
    expect(isInternalVoiceCallEnd("POST", "/api/internal/voice-call/end/")).toBe(false);
    expect(isInternalVoiceCallEnd("POST", "/api/internal/voice-note")).toBe(false);
  });
});
