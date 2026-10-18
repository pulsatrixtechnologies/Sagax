import { describe, expect, it } from "vitest";

import { looksEnglish, readEnglish, readsEnglishText } from "./english-reading.ts";

describe("English reading for the voice", () => {
  it("reads an ISO date and a 24 hour time as a person says them", () => {
    expect(readEnglish("The backup ran on 2026-10-18.")).toBe("The backup ran on October 18, 2026.");
    expect(readEnglish("Next run 2026-10-19T15:30:00Z.")).toBe("Next run October 19, 2026 at 3:30 PM UTC.");
    expect(readEnglish("Meeting at 15:30, then 09:00 tomorrow.")).toBe("Meeting at 3:30 PM, then 9 AM tomorrow.");
    expect(readEnglish("At 12:00 and 00:00 and 00:15.")).toBe("At noon and midnight and 12:15 AM.");
    expect(readEnglish("It ended at 17:45:12.")).toBe("It ended at 5:45 PM.");
  });

  it("leaves a time that already says AM or PM, or could be either", () => {
    expect(readEnglish("At 3:30 PM, then 3:30.")).toBe("At 3:30 PM, then 3:30.");
    expect(readEnglish("At 10:15 am.")).toBe("At 10:15 am.");
  });

  it("leaves what is no date or time", () => {
    expect(readEnglish("Version 1.8.35 and ratio 16:9.")).toBe("Version 1.8.35 and ratio 16:9.");
    expect(readEnglish("Not a date 2026-13-45 nor 25:99.")).toBe("Not a date 2026-13-45 nor 25:99.");
    expect(readEnglish("Hello there")).toBe("Hello there");
    expect(readEnglish("Uptime 00:45:12, it took 03:12, elapsed 13:05.")).toBe("Uptime 00:45:12, it took 03:12, elapsed 13:05.");
  });

  it("an automatic call reads English only when the text looks English", () => {
    expect(looksEnglish("The job is done and it is fine.")).toBe(true);
    expect(looksEnglish("Le travail est fait.")).toBe(false);
    expect(looksEnglish("OK")).toBe(false);
    expect(readsEnglishText("en", "OK")).toBe(true);
    expect(readsEnglishText("en-CA", "OK")).toBe(true);
    expect(readsEnglishText("auto", "The job is done at 15:30.")).toBe(true);
    expect(readsEnglishText("auto", "El trabajo está hecho.")).toBe(false);
    expect(readsEnglishText("es", "The job is done.")).toBe(false);
  });
});
