import { describe, expect, it } from "vitest";

import { parseMailAlias, plusTag, routineMailAddress } from "./routine-mail-alias.ts";

describe("routine mail alias", () => {
  it("keeps a short tag and refuses anything that could change the address", () => {
    expect(parseMailAlias(" Reports ")).toEqual({ ok: true, alias: "reports" });
    expect(parseMailAlias("")).toEqual({ ok: true });
    expect(parseMailAlias(null)).toEqual({ ok: true });
    expect(parseMailAlias("a+b")).toEqual({ ok: false, error: "A mail tag is 1 to 32 letters or digits." });
    expect(parseMailAlias("has space")).toEqual({ ok: false, error: "A mail tag is 1 to 32 letters or digits." });
    expect(parseMailAlias(3)).toEqual({ ok: false, error: "A mail tag is 1 to 32 letters or digits." });
  });

  it("reads the tag on an inbound address and builds the tagged address", () => {
    expect(plusTag("bot+reports@example.org")).toBe("reports");
    expect(plusTag("Bot+Reports@example.org")).toBe("reports");
    expect(plusTag("bot@example.org")).toBeNull();
    expect(plusTag("bot+a+b@example.org")).toBeNull();
    expect(routineMailAddress("bot@example.org", "reports")).toBe("bot+reports@example.org");
    expect(routineMailAddress("bot+already@example.org", "reports")).toBeNull();
    expect(routineMailAddress("not an address", "reports")).toBeNull();
  });
});
