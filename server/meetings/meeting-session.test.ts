import { describe, expect, it } from "vitest";

import {
  CAPTURE_HOOK_SCRIPT,
  MEETING_CHAT_OPEN_SCRIPT,
  MEETING_DRAIN_SCRIPT,
  MEETING_LEAVE_MARK_SCRIPT,
  MEETING_START_SCRIPT,
  MEETING_STATE_SCRIPT,
  MEETING_STOP_SCRIPT,
} from "./meet-scripts.ts";
import { MeetingSession, type MeetingBrowser } from "./meeting-session.ts";

const AUDIO = Buffer.alloc(2_048, 7).toString("base64");

/** A scripted Meet: the page states it walks through, one per state read. */
function fakeMeet(options: { states: Array<{ text?: string; leave?: boolean }>; posted?: boolean; chunks?: number; joinReady?: boolean }) {
  const calls: string[] = [];
  let stateIndex = 0;
  let chunksLeft = options.chunks ?? 2;
  let started = false;
  const browser: MeetingBrowser = {
    open: async (url) => { calls.push(`open ${url}`); },
    click: async (selector) => { calls.push(`click ${selector}`); return true; },
    close: async () => { calls.push("close"); },
    eval: async (script) => {
      if (script === CAPTURE_HOOK_SCRIPT) return { installed: true };
      if (script.includes("const name = ")) return { nameInput: true, nameFilled: true, joinReady: options.joinReady ?? true };
      if (script === MEETING_STATE_SCRIPT) {
        const state = options.states[Math.min(stateIndex, options.states.length - 1)]!;
        stateIndex++;
        return { url: "https://meet.google.com/abc-defg-hij", ...state };
      }
      if (script === MEETING_CHAT_OPEN_SCRIPT) { calls.push("chat"); return { opened: true, box: true }; }
      if (script.includes("data-sagax-send")) { calls.push("type"); return { typed: true, send: true }; }
      if (script.includes("posted:")) return { posted: options.posted ?? true };
      if (script === MEETING_START_SCRIPT) { calls.push("start"); started = true; return { started: true }; }
      if (script === MEETING_STOP_SCRIPT) { calls.push("stop"); return { stopped: true }; }
      if (script === MEETING_DRAIN_SCRIPT) {
        if (!started || chunksLeft <= 0) return { chunks: [] };
        chunksLeft--;
        return { chunks: [{ seq: 1, at: 1_000, mime: "audio/webm;codecs=opus", data: AUDIO }] };
      }
      if (script === MEETING_LEAVE_MARK_SCRIPT) return { leave: true };
      return null;
    },
  };
  return { browser, calls };
}

function session(browser: MeetingBrowser, transcribe = async () => "Hello team.", extra: Partial<ConstructorParameters<typeof MeetingSession>[0]> = {}) {
  const updates: Array<Record<string, unknown>> = [];
  let clock = 0;
  const instance = new MeetingSession({
    url: "https://meet.google.com/abc-defg-hij",
    displayName: "Ada (notes)",
    announcement: "Ada (notes) is taking notes",
    browser,
    transcribe,
    update: (patch) => updates.push(patch),
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    pollMs: 3_000,
    drainMs: 1,
    ...extra,
  });
  return { instance, updates };
}

describe("MeetingSession", () => {
  it("joins, announces, then records, transcribes and leaves when the meeting ends", async () => {
    const meet = fakeMeet({ states: [{ text: "Asking to be let in" }, { leave: true }, { leave: true }, { leave: true }, { text: "You left the meeting" }] });
    const { instance, updates } = session(meet.browser);
    const outcome = await instance.run();
    expect(outcome.status).toBe("ended");
    expect(outcome.recorded).toBe(true);
    expect(outcome.lines.map((line) => line.text)).toEqual(["Hello team.", "Hello team."]);
    expect(updates.map((update) => update.status).filter(Boolean)).toEqual(["joining", "waiting", "announcing", "recording"]);
    // The consent announcement is sent before anything records.
    expect(meet.calls.indexOf("click [data-sagax-send]")).toBeLessThan(meet.calls.indexOf("start"));
    expect(meet.calls).toContain("click [data-sagax-join]");
    expect(meet.calls.at(-1)).toBe("close");
  });

  it("fails closed: no visible announcement, no recording", async () => {
    const meet = fakeMeet({ states: [{ leave: true }], posted: false });
    const { instance } = session(meet.browser);
    const outcome = await instance.run();
    expect(outcome.status).toBe("failed");
    expect(outcome.recorded).toBe(false);
    expect(outcome.detail).toContain("nothing was recorded");
    expect(meet.calls).not.toContain("start");
    expect(meet.calls).toContain("click [data-sagax-leave]");
  });

  it("reports a host's refusal as declined", async () => {
    const meet = fakeMeet({ states: [{ text: "Asking to be let in" }, { text: "Someone in the call denied your request to join" }] });
    const outcome = await session(meet.browser).instance.run();
    expect(outcome.status).toBe("declined");
    expect(meet.calls).not.toContain("start");
  });

  it("gives up when nobody lets the bot in", async () => {
    const meet = fakeMeet({ states: [{ text: "Asking to be let in" }] });
    const outcome = await session(meet.browser, undefined, { admissionMs: 30_000 }).instance.run();
    expect(outcome.status).toBe("failed");
    expect(outcome.detail).toContain("Nobody let the bot in");
  });

  it("fails when the guest screen never appears", async () => {
    const meet = fakeMeet({ states: [{ text: "Sign in" }], joinReady: false });
    const outcome = await session(meet.browser).instance.run();
    expect(outcome.status).toBe("failed");
    expect(meet.calls).not.toContain("click [data-sagax-join]");
  });

  it("stops at the time limit and still drains what was recorded", async () => {
    const meet = fakeMeet({ states: [{ leave: true }], chunks: 1 });
    const { instance } = session(meet.browser, undefined, { maxMs: 60_000 });
    const outcome = await instance.run();
    expect(outcome.status).toBe("ended");
    expect(outcome.detail).toContain("3 hour limit");
    expect(outcome.lines).toHaveLength(1);
    expect(meet.calls).toContain("stop");
  });

  it("leaves at the person's request", async () => {
    const meet = fakeMeet({ states: [{ leave: true }], chunks: 0 });
    const { instance } = session(meet.browser, undefined, {
      sleep: async () => { instance.requestLeave(); },
    });
    const outcome = await instance.run();
    expect(outcome.status).toBe("ended");
  });

  it("keeps going when a segment cannot be transcribed, and says so", async () => {
    const meet = fakeMeet({ states: [{ leave: true }, { leave: true }, { text: "The call has ended" }], chunks: 1 });
    const outcome = await session(meet.browser, async () => { throw new Error("stt down"); }).instance.run();
    expect(outcome.status).toBe("ended");
    expect(outcome.lines).toHaveLength(0);
    expect(outcome.detail).toContain("could not be transcribed");
  });
});
