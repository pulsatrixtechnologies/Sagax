import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { currentCall, endCall, startCall } from "@/lib/call";
import { liveCallNow, publishLiveCall, retractLiveCall, type LiveCallData } from "@/lib/voice-mode/live-call-store";
import type { VoiceCall } from "@/lib/voice-mode/call";
import { DEFAULT_CALL_SETTINGS } from "@/lib/voice-mode/call-settings";
import { DEFAULT_VOICE_MODE_SETTINGS } from "../../../shared/voice-mode";
import { Balloon } from "./Balloon";
import { FloatingBotView } from "./FloatingBotView";
import { MascotCallCardView, MascotCallPill, pushLevel } from "./MascotCall";
import { callLevels, mascotCallSnapshot, NO_PANEL, runMascotCallEvent, type MascotCallDeps } from "./mascot-call";
import { isFloatingEvent, mascotFields, type FloatingCall, type FloatingSnapshot } from "./protocol";

function fakeCall(enrolled = false) {
  const analyser = (level: number) => ({ getByteTimeDomainData: (data: Uint8Array) => data.fill(128 + Math.round(level * 127)) });
  return {
    setMuted: vi.fn(),
    hold: vi.fn(),
    resume: vi.fn(),
    interrupt: vi.fn(),
    pushToTalk: vi.fn(),
    forgetVoice: vi.fn(),
    enrolled,
    analysers: { bot: analyser(0.3), mic: analyser(0.1) },
  } as unknown as VoiceCall & { setMuted: ReturnType<typeof vi.fn>; interrupt: ReturnType<typeof vi.fn> };
}

function liveFor(botId: string, phase: LiveCallData["state"]["phase"] = "listening", call = fakeCall()): LiveCallData {
  return {
    botId,
    call,
    state: { phase, muted: false, botBusy: false, botAudible: phase === "speaking", ducked: false },
    startedAt: 1_000,
    heard: "what I am saying",
    caption: "what the bot says",
    note: null,
    notice: null,
    transcript: [{ id: "m1", who: "you", text: "Hello" }, { id: "m2", who: "bot", text: "Hi there", interrupted: true }],
    metrics: {},
    retry: vi.fn(),
  };
}

function deps(over: Partial<MascotCallDeps> = {}): MascotCallDeps & { closeBalloon: ReturnType<typeof vi.fn> } {
  return {
    available: true,
    live: liveCallNow(),
    current: currentCall,
    start: startCall,
    end: endCall,
    closeBalloon: vi.fn(),
    voices: vi.fn(),
    preview: vi.fn(),
    enroll: vi.fn(),
    forget: vi.fn(),
    writeSettings: vi.fn(),
    writeCallSettings: vi.fn(),
    ...over,
  } as MascotCallDeps & { closeBalloon: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.stubGlobal("window", { ogb: { speechStop: vi.fn(async () => {}) } });
});
afterEach(() => {
  endCall();
  const live = liveCallNow();
  if (live) retractLiveCall(live.call);
  vi.unstubAllGlobals();
});

describe("a voice call with the desktop mascot", () => {
  it("starts the app's call for its bot from the mascot and closes the balloon; ends it the same way", () => {
    const d = deps();
    runMascotCallEvent("bot_a", "start", {}, d);
    expect(currentCall()).toBe("bot_a");
    expect(d.closeBalloon).toHaveBeenCalledOnce();
    runMascotCallEvent("bot_a", "end", {}, deps());
    expect(currentCall()).toBeNull();
  });

  it("starts nothing where voice mode does not serve the bot", () => {
    runMascotCallEvent("bot_a", "start", {}, deps({ available: false }));
    expect(currentCall()).toBeNull();
  });

  it("keeps one call at a time across the app and the mascots", () => {
    // a call in the app with one bot, then the mascot of another calls
    startCall("bot_app");
    runMascotCallEvent("bot_mascot", "start", {}, deps());
    expect(currentCall()).toBe("bot_mascot");
    // the mascot's end never hangs up another bot's call
    runMascotCallEvent("bot_app", "end", {}, deps());
    expect(currentCall()).toBe("bot_mascot");
    // a call started in the app takes the line back
    startCall("bot_app");
    expect(currentCall()).toBe("bot_app");
  });

  it("drives only the call with its own bot", () => {
    const call = fakeCall();
    startCall("bot_a");
    publishLiveCall(liveFor("bot_a", "speaking", call));
    runMascotCallEvent("bot_a", "mute", {}, deps());
    runMascotCallEvent("bot_a", "interrupt", {}, deps());
    expect(call.setMuted).toHaveBeenCalledWith(true);
    expect(call.interrupt).toHaveBeenCalledOnce();
    // another mascot's window cannot touch it
    runMascotCallEvent("bot_b", "mute", {}, deps());
    runMascotCallEvent("bot_b", "hold", {}, deps());
    expect(call.setMuted).toHaveBeenCalledOnce();
    expect(call.hold).not.toHaveBeenCalled();
    const d = deps();
    runMascotCallEvent("bot_a", "settings", { patch: { voice: "eve" } }, d);
    expect(d.writeSettings).toHaveBeenCalledWith({ voice: "eve" });
  });

  it("shows the app's call on the mascot, in sync with it", () => {
    const live = liveFor("bot_a", "hearing", fakeCall(true));
    const shown = mascotCallSnapshot(live, NO_PANEL, DEFAULT_VOICE_MODE_SETTINGS, DEFAULT_CALL_SETTINGS);
    expect(shown).toMatchObject({ phase: "hearing", line: "what I am saying", startedAt: 1_000, push: false, enrollment: { state: "enrolled" } });
    expect(shown.transcript).toEqual([{ id: "m1", who: "you", text: "Hello" }, { id: "m2", who: "bot", text: "Hi there", interrupted: true }]);
    expect(mascotCallSnapshot(liveFor("bot_a", "speaking"), NO_PANEL, DEFAULT_VOICE_MODE_SETTINGS, { ...DEFAULT_CALL_SETTINGS, input: "push" })).toMatchObject({ line: "what the bot says", push: true, botAudible: true });
    // the store is the one source: what the engine publishes is what the mascot gets
    publishLiveCall(live);
    expect(liveCallNow()).toBe(live);
    retractLiveCall(fakeCall());
    expect(liveCallNow()).toBe(live);
    retractLiveCall(live.call);
    expect(liveCallNow()).toBeNull();
  });

  it("sends the levels of both sides, quiet on hold or muted", () => {
    const data = new Uint8Array(64);
    const levels = callLevels(liveFor("bot_a", "speaking"), data);
    expect(levels.bot).toBeGreaterThan(levels.mic);
    expect(callLevels(liveFor("bot_a", "held"), data)).toEqual({ bot: 0, mic: 0 });
    const muted = liveFor("bot_a");
    muted.state = { ...muted.state, muted: true };
    expect(callLevels(muted, data).mic).toBe(0);
    expect(pushLevel([0.1, 0.2, 0.3], 0.9, 3)).toEqual([0.2, 0.3, 0.9]);
  });

  it("takes only known call actions back from a window", () => {
    expect(isFloatingEvent({ type: "call", action: "start" })).toBe(true);
    expect(isFloatingEvent({ type: "call", action: "dial-911" })).toBe(false);
  });
});

const CALL: FloatingCall = {
  phase: "speaking",
  muted: false,
  botAudible: true,
  push: false,
  startedAt: Date.now() - 65_000,
  line: "Here is the answer",
  transcript: [{ id: "m1", who: "you", text: "What time is it?" }],
  note: null,
  notice: null,
  settings: DEFAULT_VOICE_MODE_SETTINGS,
  callSettings: DEFAULT_CALL_SETTINGS,
  voices: [{ id: "eve", label: "Eve" }],
  voicesError: null,
  enrollment: { state: "none" },
  previewing: null,
};

function snapshot(over: Partial<FloatingSnapshot> = {}): FloatingSnapshot {
  return {
    v: 1, id: "bot_a", name: "Sagax", label: "Sagax", color: "green", skin: "none", avatar: null, pose: "speak", reduced: false, retro: false,
    sparkle: 0, locale: "en", menu: [], balloon: null, ...mascotFields({}), hints: { mood: "", working: "", call: "Call Sagax" }, ...over,
  };
}

describe("the mascot's call pill", () => {
  it("is the app's pill scaled down: waveform, Settings, Transcript, Mic and a red End", () => {
    const html = renderToStaticMarkup(createElement(MascotCallPill, { call: CALL, name: "Sagax", card: null, onCard: () => undefined, onEvent: () => undefined, hover: () => undefined }));
    for (const part of ["data-voice-waveform", "data-voice-gear", "data-voice-transcript-toggle", "data-voice-mute", "data-voice-end", "bg-danger", 'data-voice-phase="speaking"']) expect(html).toContain(part);
    expect(html).not.toContain("data-voice-ptt");
    expect(renderToStaticMarkup(createElement(MascotCallPill, { call: { ...CALL, push: true }, name: "Sagax", card: null, onCard: () => undefined, onEvent: () => undefined, hover: () => undefined }))).toContain("data-voice-ptt");
  });

  it("expands into the transcript or the settings, like the app", () => {
    const transcript = renderToStaticMarkup(createElement(MascotCallCardView, { call: CALL, name: "Sagax", card: "transcript", onEvent: () => undefined, hover: () => undefined }));
    expect(transcript).toContain("What time is it?");
    expect(transcript).toContain('data-voice-line="live"');
    expect(transcript).toContain("1:05");
    const settings = renderToStaticMarkup(createElement(MascotCallCardView, { call: CALL, name: "Sagax", card: "settings", onEvent: () => undefined, hover: () => undefined }));
    expect(settings).toContain("data-voice-call-settings");
    expect(settings).toContain("data-voice-hold");
  });

  it("stands under the mascot, which takes its call pose; the balloon offers the call", () => {
    const html = renderToStaticMarkup(createElement(FloatingBotView, { snapshot: snapshot({ call: CALL }), onEvent: () => undefined, mover: { coords: "screen", moveBy: () => undefined, moved: () => undefined } }));
    expect(html).toContain('data-call="speaking"');
    expect(html).toContain("fb-call-pill");
    const muted = renderToStaticMarkup(createElement(FloatingBotView, { snapshot: snapshot({ call: { ...CALL, muted: true } }), onEvent: () => undefined, mover: { coords: "screen", moveBy: () => undefined, moved: () => undefined } }));
    expect(muted).toContain('data-call="quiet"');
    const balloon = { kind: "chat" as const, text: "Hi", streaming: false, truncated: false, open: "Open", close: "Close", input: null };
    const props = { botId: "bot_a", name: "Sagax", balloon, retro: false, side: { below: false, right: false }, room: { x: 0, y: 0, w: 480, h: 400 }, onEvent: () => undefined, hover: () => undefined, pinLabel: "" };
    expect(renderToStaticMarkup(createElement(Balloon, { ...props, callLabel: "Call Sagax" }))).toContain('aria-label="Call Sagax"');
    expect(renderToStaticMarkup(createElement(Balloon, props))).not.toContain("data-call-start");
  });
});
