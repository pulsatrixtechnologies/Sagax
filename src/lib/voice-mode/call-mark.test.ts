// Every call view marks its turns as call turns the same way (call-mark.ts):
// the live call and the older macOS dictation call.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { markVoiceCall, type VoiceCallMarkDeps } from "./call-mark";

function fakeDeps(language?: string) {
  const ids = new Map<string, string>();
  const sessions: Array<[string, string, Record<string, unknown>]> = [];
  let alive: (() => void) | null = null;
  const stopAlive = vi.fn();
  const deps: VoiceCallMarkDeps = {
    setId: (botId, callId) => ids.set(botId, callId),
    clearId: (botId, callId) => {
      if (ids.get(botId) === callId) ids.delete(botId);
    },
    session: (botId, state, call) => sessions.push([botId, state, call]),
    keepAlive: (fn) => {
      alive = fn;
      return stopAlive;
    },
    language: () => language,
  };
  return { deps, ids, sessions, stopAlive, beat: () => alive?.() };
}

describe("markVoiceCall", () => {
  it("marks the call on the page and on the server, heartbeats it, and ends both", () => {
    const t = fakeDeps("fr");
    const end = markVoiceCall({ botId: "b1", threadId: "t1", callId: "call-1234" }, t.deps);
    expect(t.ids.get("b1")).toBe("call-1234");
    expect(t.sessions).toEqual([["b1", "start", { callId: "call-1234", threadId: "t1", language: "fr" }]]);
    t.beat();
    expect(t.sessions.at(-1)).toEqual(["b1", "alive", { callId: "call-1234", threadId: "t1", language: "fr" }]);
    end();
    expect(t.stopAlive).toHaveBeenCalledOnce();
    expect(t.sessions.at(-1)).toEqual(["b1", "end", { callId: "call-1234", threadId: "t1", language: "fr" }]);
    expect(t.ids.has("b1")).toBe(false);
  });

  it("an automatic language is not sent, and an old call's teardown never clears a newer call", () => {
    const t = fakeDeps("auto");
    const endOld = markVoiceCall({ botId: "b1", threadId: "t1", callId: "call-old-1" }, t.deps);
    expect(t.sessions[0]![2]).toEqual({ callId: "call-old-1", threadId: "t1" });
    markVoiceCall({ botId: "b1", threadId: "t1", callId: "call-new-1" }, t.deps);
    endOld();
    expect(t.ids.get("b1")).toBe("call-new-1");
  });
});

describe("the call views", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  it("the older macOS call marks its turns like the live call: same hook, voiceCall on each send", () => {
    const view = read("../../components/CallView.tsx");
    const older = view.slice(view.indexOf("function Call({ bot }"));
    expect(older).toContain("useVoiceCallMark(bot.id, bot.threadId)");
    expect(older).toMatch(/dispatch\(\{ type: "send", botId: bot\.id, text: said, threadId: bot\.threadId, voiceCall: \{ callId \} \}\)/);
    // the bot's end_call hangs it up, and a written follow-up is never said
    expect(older).toContain("VOICE_CALL_ENDED_EVENT");
    expect(older).toContain("spokenPart(reply.text)");
    expect(read("../../components/voice-mode/LiveCall.tsx")).toContain("useVoiceCallMark(bot.id, bot.threadId)");
  });
});
