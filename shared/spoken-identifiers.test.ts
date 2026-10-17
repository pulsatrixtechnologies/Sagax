import { describe, expect, it } from "vitest";

import { stripSpokenIdentifiers } from "./spoken-identifiers.ts";

const say = (text: string) => stripSpokenIdentifiers(text).replace(/\s+/g, " ").trim();

describe("stripSpokenIdentifiers", () => {
  it("drops UUIDs, hashes, JWTs and tokens", () => {
    expect(say("The thread 3f2a9c1e-7b4d-4e2a-9f10-0c5b8d7e6a21 is archived.")).toBe("The thread is archived.");
    expect(say("Fixed in commit 9fceb02d0ae598e95dc970b74767f19372d61af8.")).toBe("Fixed in commit.");
    expect(say("Fixed in a1b2c3d4, yesterday.")).toBe("Fixed in, yesterday.");
    expect(say("Token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N is set")).toBe("Token is set");
    expect(say("Use whsec_Q2x9vLm4Tz8Kp1Rb7Yw3 now")).toBe("Use now");
    expect(say("The call call-0123456789 ended")).toBe("The call ended");
  });

  it("drops ticket numbers and labelled ids, and the brackets left around them", () => {
    expect(say("The printer ticket (#481516) is closed.")).toBe("The printer ticket is closed.");
    expect(say("Ticket #481516 is closed.")).toBe("Ticket is closed.");
    expect(say("The member (id: 4242) answered.")).toBe("The member answered.");
    expect(say("Le billet ID 42 est fermé.")).toBe("Le billet est fermé.");
  });

  it("keeps only the last name of an absolute or home path", () => {
    expect(say("Saved to /Users/someone/Documents/report.pdf for you.")).toBe("Saved to report.pdf for you.");
    expect(say("It lives in ~/Library/Logs/app")).toBe("It lives in app");
    expect(say("Copied to C:\\Users\\someone\\Desktop\\notes.txt")).toBe("Copied to notes.txt");
  });

  it("leaves amounts, dates, times, phone numbers and words alone", () => {
    for (const text of [
      "It costs 1,250.50 dollars and is due 2026-10-17 at 15:30.",
      "Call 514-555-0123 tomorrow.",
      "C'est 24/7, en km/h, about 3/4 done.",
      "The decade of facade internationalization, COVID-19 and the ed25519 key.",
      "We are at 3 of 10, PR 702 is open.",
      "L'idée est bonne, I'd say so.",
    ]) {
      expect(say(text)).toBe(text);
    }
  });

  it("stays fast on a long run of digits or a long label", () => {
    const started = Date.now();
    stripSpokenIdentifiers(`${"1".repeat(50_000)} id ${"2".repeat(50_000)}`);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
