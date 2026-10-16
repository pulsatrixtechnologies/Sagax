import { describe, expect, it } from "vitest";

import {
  CAPTURE_HOOK_SCRIPT,
  MEETING_CHAT_OPEN_SCRIPT,
  MEETING_CHAT_READ_SCRIPT,
  MEETING_DISCARD_SCRIPT,
  MEETING_DRAIN_SCRIPT,
  MEETING_LEAVING_TEXT,
  MEETING_LEAVE_MARK_SCRIPT,
  MEETING_START_SCRIPT,
  MEETING_STATE_SCRIPT,
  MEETING_STOP_SCRIPT,
} from "./meet-scripts.ts";
import { MeetingSession, type MeetingBrowser } from "./meeting-session.ts";

const AUDIO = Buffer.alloc(2_048, 7).toString("base64");

/** A scripted Meet: the page states it walks through, one per state read,
 * and a chat the bot writes in and participants can write in. */
function fakeMeet(options: {
  states: Array<{ text?: string; leave?: boolean; people?: number } | null>;
  posted?: boolean;
  chunks?: number;
  joinReady?: boolean;
  /** Chat lines a participant adds when the state at this index is read. */
  say?: Record<number, string>;
  /** The chat cannot be read from this state read on. */
  chatFailsFrom?: number;
  /** Chat lines a participant adds just before the chat read at this index. */
  sayOnChatRead?: Record<number, string>;
}) {
  let chatReads = 0;
  const calls: string[] = [];
  const chat: string[] = ["In-call messages", "Messages can only be seen by people in the call"];
  let stateIndex = 0;
  let chunksLeft = options.chunks ?? 2;
  let started = false;
  let typing = "";
  const browser: MeetingBrowser = {
    open: async (url) => { calls.push(`open ${url}`); },
    click: async (selector) => {
      calls.push(`click ${selector}`);
      if (selector === "[data-sagax-send]" && options.posted !== false) chat.push(typing);
      return true;
    },
    close: async () => { calls.push("close"); },
    eval: async (script) => {
      if (script === CAPTURE_HOOK_SCRIPT) return { installed: true };
      if (script.includes("const name = ")) return { nameInput: true, nameFilled: true, joinReady: options.joinReady ?? true };
      if (script === MEETING_STATE_SCRIPT) {
        const index = stateIndex++;
        if (options.say?.[index]) chat.push(options.say[index]!);
        const state = options.states[Math.min(index, options.states.length - 1)];
        return state === null ? null : { url: "https://meet.google.com/abc-defg-hij", ...state };
      }
      if (script === MEETING_CHAT_READ_SCRIPT) {
        const read = chatReads++;
        if (options.sayOnChatRead?.[read]) chat.push(options.sayOnChatRead[read]!);
        if (options.chatFailsFrom !== undefined && stateIndex > options.chatFailsFrom) return { ok: false };
        return { ok: true, lines: [...chat] };
      }
      if (script === MEETING_CHAT_OPEN_SCRIPT) { calls.push("chat"); return { opened: true, box: true }; }
      if (script.includes("data-sagax-send")) {
        typing = JSON.parse(/const text = (".*");\n/.exec(script)![1]!) as string;
        calls.push(`type ${typing.slice(0, 20)}`);
        return { typed: true, send: true };
      }
      if (script.includes("posted:")) {
        const text = JSON.parse(/const text = (".*");\n/.exec(script)![1]!) as string;
        const count = chat.filter((line) => line === text).length;
        return { posted: count > 0, count };
      }
      if (script === MEETING_START_SCRIPT) { calls.push("start"); started = true; return { started: true }; }
      if (script === MEETING_STOP_SCRIPT) { calls.push("stop"); return { stopped: true }; }
      if (script === MEETING_DISCARD_SCRIPT) { calls.push("discard"); chunksLeft = 0; return { discarded: true }; }
      if (script === MEETING_DRAIN_SCRIPT) {
        calls.push("drain");
        if (!started || chunksLeft <= 0) return { chunks: [] };
        chunksLeft--;
        return { chunks: [{ seq: 1, at: 1_000, mime: "audio/webm;codecs=opus", data: AUDIO }] };
      }
      if (script === MEETING_LEAVE_MARK_SCRIPT) return { leave: true };
      return null;
    },
  };
  return { browser, calls, chat };
}

function session(browser: MeetingBrowser, transcribe = async () => "Hello team.", extra: Partial<ConstructorParameters<typeof MeetingSession>[0]> = {}) {
  const updates: Array<Record<string, unknown>> = [];
  let clock = 0;
  const instance = new MeetingSession({
    url: "https://meet.google.com/abc-defg-hij",
    displayName: "Ada (transcription)",
    botName: "Ada",
    announcement: "Ada (transcription) prend des notes. Écrivez « stop » ici et je quitte.",
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

  it("leaves at once when a participant objects in the chat, dropping untranscribed audio", async () => {
    const meet = fakeMeet({ states: [{ leave: true }, { leave: true }, { leave: true }, { leave: true }], say: { 1: "Please stop recording" }, chunks: 5 });
    const transcribed: number[] = [];
    const { instance } = session(meet.browser, async () => { transcribed.push(1); return "said"; }, { drainMs: 60_000 });
    const outcome = await instance.run();
    expect(outcome).toMatchObject({ status: "ended", endReason: "participant", detail: "Left at a participant's request." });
    expect(meet.calls).toContain("discard");
    expect(meet.calls).not.toContain("drain");
    expect(transcribed).toEqual([]);
    expect(meet.chat).toContain(MEETING_LEAVING_TEXT);
    expect(meet.calls.indexOf("discard")).toBeLessThan(meet.calls.indexOf("click [data-sagax-leave]"));
  });

  it("treats a line naming the bot as an objection, but never its own announcement", async () => {
    const objected = fakeMeet({ states: [{ leave: true }], say: { 2: "ada, can you go?" } });
    expect((await session(objected.browser).instance.run()).endReason).toBe("participant");
    const quiet = fakeMeet({ states: [{ leave: true }, { leave: true }, { leave: true }, { text: "You left the meeting" }], say: { 1: "Next slide please" } });
    const outcome = await session(quiet.browser).instance.run();
    expect(outcome.endReason).toBeUndefined();
    expect(outcome.status).toBe("ended");
  });

  it("counts three unreadable polls in a row as the end of the meeting", async () => {
    const meet = fakeMeet({ states: [{ leave: true }, null, null, null] });
    const outcome = await session(meet.browser).instance.run();
    expect(outcome.status).toBe("ended");
    expect(outcome.detail).toContain("stopped answering");
    expect(meet.calls).toContain("stop");
  });

  it("counts an unreadable chat as unknown too", async () => {
    const meet = fakeMeet({ states: [{ leave: true }], chatFailsFrom: 2 });
    const outcome = await session(meet.browser).instance.run();
    expect(outcome.detail).toContain("stopped answering");
  });

  it("refuses to record when the chat cannot be read after the announcement", async () => {
    const meet = fakeMeet({ states: [{ leave: true }], chatFailsFrom: 0 });
    const outcome = await session(meet.browser).instance.run();
    expect(outcome.status).toBe("failed");
    expect(meet.calls).not.toContain("start");
  });

  it("announces again when someone joins and every 10 minutes", async () => {
    const meet = fakeMeet({ states: [{ leave: true, people: 2 }, { leave: true, people: 2 }, { leave: true, people: 3 }, { leave: true, people: 3 }, { text: "You left the meeting" }] });
    await session(meet.browser).instance.run();
    expect(meet.chat.filter((line) => line.startsWith("Ada (transcription) prend"))).toHaveLength(2);
    const timed = fakeMeet({ states: [{ leave: true }, { leave: true }, { leave: true }, { text: "You left the meeting" }] });
    await session(timed.browser, undefined, { announceEveryMs: 3_000 }).instance.run();
    expect(timed.chat.filter((line) => line.startsWith("Ada (transcription) prend")).length).toBeGreaterThan(1);
  });

  it("gives up when the page stops answering in the waiting room", async () => {
    const meet = fakeMeet({ states: [{ text: "Asking to be let in" }, null, null, null] });
    const outcome = await session(meet.browser).instance.run();
    expect(outcome.status).toBe("failed");
    expect(meet.calls).not.toContain("start");
  });

  it("hears an objection made while it announces itself, before recording anything", async () => {
    // Chat read 0 is before the announcement, read 1 right after it.
    const meet = fakeMeet({ states: [{ leave: true }], sayOnChatRead: { 1: "je refuse" } });
    const outcome = await session(meet.browser).instance.run();
    expect(outcome).toMatchObject({ endReason: "participant", recorded: false });
    expect(meet.calls).not.toContain("start");
  });

  it("hears an objection made while it announces itself again", async () => {
    // Reads: 0 before, 1 baseline, 2 first poll, 3 right after the re-announcement.
    const meet = fakeMeet({ states: [{ leave: true }, { leave: true }, { leave: true }], sayOnChatRead: { 3: "no thanks" } });
    const outcome = await session(meet.browser, undefined, { announceEveryMs: 1 }).instance.run();
    expect(outcome.endReason).toBe("participant");
    expect(meet.calls).toContain("discard");
  });
});
