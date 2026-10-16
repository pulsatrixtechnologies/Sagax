import { describe, expect, it } from "vitest";

import { findMeetingLink, meetingDisplayName, parseMeetingUrl } from "./meeting-links.ts";

describe("meeting links", () => {
  it("normalizes a Google Meet link to its code", () => {
    expect(parseMeetingUrl("https://meet.google.com/abc-defg-hij?authuser=1&hs=122")).toEqual({
      provider: "google-meet", url: "https://meet.google.com/abc-defg-hij", code: "abc-defg-hij",
    });
  });

  it("recognizes Zoom and Teams links", () => {
    expect(parseMeetingUrl("https://us02web.zoom.us/j/12345678901?pwd=AbC.12")).toMatchObject({ provider: "zoom", code: "12345678901", url: "https://us02web.zoom.us/j/12345678901?pwd=AbC.12" });
    expect(parseMeetingUrl("https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=x")?.provider).toBe("teams");
    expect(parseMeetingUrl("https://teams.live.com/meet/9876543")?.provider).toBe("teams");
  });

  it("refuses look-alikes, other schemes and credentials", () => {
    expect(parseMeetingUrl("https://meet.google.com.evil.test/abc-defg-hij")).toBeNull();
    expect(parseMeetingUrl("http://meet.google.com/abc-defg-hij")).toBeNull();
    expect(parseMeetingUrl("https://user:pw@meet.google.com/abc-defg-hij")).toBeNull();
    expect(parseMeetingUrl("https://meet.google.com/landing")).toBeNull();
    expect(parseMeetingUrl("https://evilzoom.us/j/12345678901")).toBeNull();
    expect(parseMeetingUrl("javascript:alert(1)")).toBeNull();
  });

  it("finds the first link in free text, without trailing punctuation", () => {
    expect(findMeetingLink("Join us at https://meet.google.com/abc-defg-hij. Thanks")?.code).toBe("abc-defg-hij");
    expect(findMeetingLink("no link here")).toBeNull();
  });

  it("names the bot as a notetaker, without markup or control characters", () => {
    expect(meetingDisplayName("Ada")).toBe("Ada (transcription)");
    expect(meetingDisplayName("<b>Ada</b>\u0007")).toBe("bAda/b (transcription)");
    expect(meetingDisplayName("   ")).toBe("Bot (transcription)");
  });
});
