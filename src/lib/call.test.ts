import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearVoiceCallId, currentCall, deferCallCleanup, endCall, setVoiceCallId, startCall, voiceCallId } from "./call";

describe("call ownership", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { ogb: { speechStop: vi.fn(async () => {}) } });
    endCall();
  });

  it("does not let stale cleanup hang up a newer call", () => {
    startCall("bot-a");
    startCall("bot-b");

    expect(endCall("bot-a")).toBe(false);
    expect(currentCall()).toBe("bot-b");
    expect(endCall("bot-b")).toBe(true);
    expect(currentCall()).toBeNull();
  });

  it("does not let StrictMode's effect probe hang up a new call", async () => {
    startCall("bot-a");
    let mounted = false;
    deferCallCleanup("bot-a", () => mounted);
    mounted = true;

    await Promise.resolve();

    expect(currentCall()).toBe("bot-a");
  });

  it("hangs up after a genuine call-screen unmount", async () => {
    startCall("bot-a");
    deferCallCleanup("bot-a", () => false);

    await Promise.resolve();

    expect(currentCall()).toBeNull();
  });

  it("marks sends as call turns only while that bot's voice call is live", () => {
    setVoiceCallId("bot-a", "call-a");
    expect(voiceCallId("bot-a")).toBeNull(); // not on the line yet
    startCall("bot-a");
    expect(voiceCallId("bot-a")).toBe("call-a");
    expect(voiceCallId("bot-b")).toBeNull();
    // a newer call's id survives the old call's teardown
    setVoiceCallId("bot-a", "call-b");
    clearVoiceCallId("bot-a", "call-a");
    expect(voiceCallId("bot-a")).toBe("call-b");
    endCall("bot-a");
    expect(voiceCallId("bot-a")).toBeNull();
    clearVoiceCallId("bot-a", "call-b");
  });
});
