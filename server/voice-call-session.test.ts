import { describe, expect, it } from "vitest";

import { VOICE_CALL_IDLE_MS, VoiceCallSessions, voiceCallTurnSettle } from "./voice-call-session.ts";

describe("VoiceCallSessions", () => {
  it("marks every send to a thread on a live call, typed or said", () => {
    let now = 1_000;
    const calls = new VoiceCallSessions(() => now);
    expect(calls.markFor("t1", undefined)).toBeUndefined();
    calls.start("t1", "call-0123456789", "fr");
    // a typed send (no mark) on the call's thread is a call turn
    expect(calls.markFor("t1", undefined)).toEqual({ callId: "call-0123456789", language: "fr" });
    // the page's own mark wins (it carries interrupted, heard, utterance)
    expect(calls.markFor("t1", { callId: "call-0123456789", interrupted: true })).toEqual({ callId: "call-0123456789", interrupted: true });
    // another thread is not on the call
    expect(calls.markFor("t2", undefined)).toBeUndefined();
    now += 1_000;
    expect(calls.end("t1", "call-other-123")).toBe(false);
    expect(calls.end("t1", "call-0123456789")).toBe(true);
    expect(calls.markFor("t1", undefined)).toBeUndefined();
  });

  it("ends a call the page never closed after an idle stretch", () => {
    let now = 0;
    const calls = new VoiceCallSessions(() => now);
    calls.start("t1", "call-0123456789");
    now += VOICE_CALL_IDLE_MS - 1;
    expect(calls.active("t1")).toBeTruthy();
    // a turn on the call keeps it alive
    calls.markFor("t1", undefined);
    now += VOICE_CALL_IDLE_MS - 1;
    expect(calls.active("t1")).toBeTruthy();
    now += 2;
    expect(calls.active("t1")).toBeUndefined();
  });

  it("delivers one spoken utterance once, whatever the send id", () => {
    const calls = new VoiceCallSessions();
    calls.start("t1", "call-0123456789");
    expect(calls.claimUtterance("t1", "call-0123456789", "utt-00000001", "send-a")).toEqual({ first: true });
    expect(calls.claimUtterance("t1", "call-0123456789", "utt-00000001", "send-b")).toEqual({ first: false, sendId: "send-a" });
    expect(calls.claimUtterance("t1", "call-0123456789", "utt-00000002", "send-c")).toEqual({ first: true });
  });

  it("lets the bot ask to hang up, and a newer call is not that one", () => {
    const calls = new VoiceCallSessions();
    expect(calls.requestEnd("t1")).toBeUndefined();
    calls.start("t1", "call-0123456789");
    expect(calls.requestEnd("t1")).toEqual({ callId: "call-0123456789" });
    // asking again does not invent a second hang-up
    expect(calls.requestEnd("t1")).toEqual({ callId: "call-0123456789" });
    expect(calls.active("t1")?.callId).toBe("call-0123456789");
    // the person hung up first: the turn that finishes finds nothing
    expect(calls.end("t1", "call-0123456789")).toBe(true);
    expect(calls.takeEnding("t1")).toBeUndefined();

    calls.start("t1", "call-0123456789");
    calls.requestEnd("t1");
    calls.start("t1", "call-newer-123456");
    expect(calls.takeEnding("t1")).toBeUndefined();
    expect(calls.active("t1")?.callId).toBe("call-newer-123456");
    expect(calls.requestEnd("t1")).toEqual({ callId: "call-newer-123456" });
    expect(calls.end("t1", "call-old-000000")).toBe(false);
    expect(calls.settleEnding("t1", "completed")).toEqual({ callId: "call-newer-123456" });
    expect(calls.active("t1")).toBeUndefined();
    expect(calls.takeEnding("t1")).toBeUndefined();
  });

  it("names a failed or interrupted turn so the hang-up is not taken", () => {
    expect(voiceCallTurnSettle({ ok: true })).toBe("completed");
    expect(voiceCallTurnSettle({ ok: false })).toBe("failed");
    expect(voiceCallTurnSettle({ ok: false, stopReason: "error" })).toBe("failed");
    expect(voiceCallTurnSettle({ ok: false, stopReason: "interrupted" })).toBe("interrupted");
    expect(voiceCallTurnSettle({ ok: false }, true)).toBe("interrupted");
    // a person who cut the goodbye wins over an engine that still said ok
    expect(voiceCallTurnSettle({ ok: true }, true)).toBe("interrupted");
    expect(voiceCallTurnSettle({ ok: true, stopReason: "interrupted" })).toBe("interrupted");
  });

  it("drops a hang-up request when that turn fails, and the call stays", () => {
    const calls = new VoiceCallSessions();
    calls.start("t1", "call-0123456789");
    calls.requestEnd("t1");
    expect(calls.settleEnding("t1", "failed")).toBeUndefined();
    expect(calls.active("t1")?.callId).toBe("call-0123456789");
    expect(calls.takeEnding("t1")).toBeUndefined();
  });

  it("drops a hang-up request when that turn is interrupted, and the call stays", () => {
    const calls = new VoiceCallSessions();
    calls.start("t1", "call-0123456789");
    calls.requestEnd("t1");
    expect(calls.settleEnding("t1", "interrupted")).toBeUndefined();
    expect(calls.active("t1")?.callId).toBe("call-0123456789");
    expect(calls.takeEnding("t1")).toBeUndefined();
  });

  it("reports a call turn's MCP servers that changed since its last turn", () => {
    const calls = new VoiceCallSessions();
    expect(calls.noteMcp("t1", ["a"])).toEqual({ added: [], removed: [] });
    calls.start("t1", "call-0123456789");
    expect(calls.noteMcp("t1", ["a", "b"])).toEqual({ added: [], removed: [] });
    expect(calls.noteMcp("t1", ["a", "b"])).toEqual({ added: [], removed: [] });
    expect(calls.noteMcp("t1", ["a", "c"])).toEqual({ added: ["c"], removed: ["b"] });
  });
});
