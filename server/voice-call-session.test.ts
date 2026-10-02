import { describe, expect, it } from "vitest";

import { VOICE_CALL_IDLE_MS, VoiceCallSessions } from "./voice-call-session.ts";

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

  it("keeps a call's MCP servers from turn to turn", () => {
    const calls = new VoiceCallSessions();
    // no call: what the turn resolved, untouched
    expect(calls.stableMcp("t1", { a: 1 })).toEqual({ servers: { a: 1 }, restored: [] });
    calls.start("t1", "call-0123456789");
    expect(calls.stableMcp("t1", { a: 1, b: 2 })).toEqual({ servers: { a: 1, b: 2 }, restored: [] });
    // b failed to refresh for this turn: it comes back from the call's set
    expect(calls.stableMcp("t1", { a: 3 })).toEqual({ servers: { a: 3, b: 2 }, restored: ["b"] });
  });
});
