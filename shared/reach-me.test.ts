import { describe, expect, it } from "vitest";

import { maskNumber, normalizePhone, parseReachMe, readReachDecision, splitReachReply, withinReachHours } from "./reach-me.ts";

describe("Reach me settings", () => {
  it("parses channels, the number and hours; refuses an unknown channel", () => {
    const parsed = parseReachMe({ channels: ["sms", "push", "sms"], smsNumber: "514 555 0123", hours: { always: false, timeZone: "America/Toronto", ranges: [{ days: [5, 1, 1], start: "08:00", end: "18:00" }] } });
    expect(parsed).toEqual({ ok: true, settings: { channels: ["sms", "push"], smsNumber: "+15145550123", hours: { always: false, timeZone: "America/Toronto", ranges: [{ days: [1, 5], start: "08:00", end: "18:00" }] } } });
    expect(parseReachMe({ channels: ["pigeon"] })).toMatchObject({ ok: false, field: "channels" });
  });
  it("text messages need the person's own number", () => {
    expect(parseReachMe({ channels: ["sms"] })).toMatchObject({ ok: false, field: "smsNumber" });
    expect(parseReachMe({ channels: ["push"], smsNumber: "12" })).toMatchObject({ ok: false, field: "smsNumber" });
  });
  it("refuses a bad time zone or time", () => {
    expect(parseReachMe({ channels: [], hours: { always: false, timeZone: "Mars/Base", ranges: [{ days: [1], start: "08:00", end: "09:00" }] } })).toMatchObject({ ok: false, field: "hours" });
    expect(parseReachMe({ channels: [], hours: { always: false, timeZone: "UTC", ranges: [{ days: [1], start: "8h", end: "09:00" }] } })).toMatchObject({ ok: false, field: "hours" });
  });
  it("masks a number like Perspicax does", () => {
    expect(maskNumber("+15145550123")).toBe("***0123");
    expect(normalizePhone("+1 (514) 555-0123")).toBe("+15145550123");
  });
});

describe("Reach me hours", () => {
  // Monday 2026-10-26 in Toronto (UTC-4 then)
  const at = (iso: string) => Date.parse(iso);
  const weekdays = { always: false as const, timeZone: "America/Toronto", ranges: [{ days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" }] };
  it("in and out of a range, in the person's zone", () => {
    expect(withinReachHours(weekdays, at("2026-10-26T13:00:00Z"))).toBe(true); // 09:00 local
    expect(withinReachHours(weekdays, at("2026-10-26T11:30:00Z"))).toBe(false); // 07:30 local
    expect(withinReachHours(weekdays, at("2026-10-25T15:00:00Z"))).toBe(false); // Sunday
    expect(withinReachHours({ always: true }, 0)).toBe(true);
  });
  it("a range past midnight belongs to the day it starts", () => {
    const nights = { always: false as const, timeZone: "UTC", ranges: [{ days: [5], start: "22:00", end: "07:00" }] };
    expect(withinReachHours(nights, at("2026-10-30T23:00:00Z"))).toBe(true); // Friday 23:00
    expect(withinReachHours(nights, at("2026-10-31T03:00:00Z"))).toBe(true); // Saturday 03:00
    expect(withinReachHours(nights, at("2026-10-31T23:00:00Z"))).toBe(false); // Saturday 23:00
  });
});

describe("Reach me replies", () => {
  it("the code comes first, any case, then the words", () => {
    expect(splitReachReply("k7q2 oui")).toBeNull(); // 2 and Q are not in the alphabet
    expect(splitReachReply("KM3X oui")).toEqual({ code: "KM3X", rest: "oui" });
    expect(splitReachReply(" km3x: Mardi 10 h")).toEqual({ code: "KM3X", rest: "Mardi 10 h" });
    expect(splitReachReply("oui KM3X")).toBeNull();
    expect(splitReachReply("KM3XY oui")).toBeNull();
  });
  it("reads one word: yes or no, in French or English", () => {
    expect(readReachDecision("Oui merci")).toBe("allow");
    expect(readReachDecision("no")).toBe("deny");
    expect(readReachDecision("non, pas ça")).toBe("deny");
    expect(readReachDecision("peut-être")).toBeNull();
  });
});
