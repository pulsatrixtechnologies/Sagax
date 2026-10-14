// Full-duplex is off by default on every channel. The Advanced toggle
// turns it on. Rev 3 resets the rev-2 "on" every 0.5.x build stored as
// its default.
import { describe, expect, it } from "vitest";

import { defaultFullDuplex, FULL_DUPLEX_REV } from "./voice-build";
import { cleanCallSettings, DEFAULT_CALL_SETTINGS } from "./call-settings";

describe("defaultFullDuplex", () => {
  it("is off on every channel", () => {
    expect(defaultFullDuplex({ dev: true })).toBe(false);
    expect(defaultFullDuplex({ testFlight: true })).toBe(false);
    expect(defaultFullDuplex({ publicRelease: true })).toBe(false);
    expect(defaultFullDuplex()).toBe(false);
  });
});

describe("CallSettings.fullDuplex default", () => {
  it("is off, and a person's own choice under rev 3 persists", () => {
    expect(DEFAULT_CALL_SETTINGS.fullDuplex).toBe(false);
    expect(FULL_DUPLEX_REV).toBe(3);
    expect(cleanCallSettings({ input: "auto", pause: "short" }).fullDuplex).toBe(false);
    expect(cleanCallSettings({ fullDuplex: true, fullDuplexRev: 3 }).fullDuplex).toBe(true);
    expect(cleanCallSettings({ fullDuplex: false, fullDuplexRev: 3 }).fullDuplex).toBe(false);
  });

  it("drops the on that 0.5.x stored as its default (rev 2 and older)", () => {
    expect(cleanCallSettings({ fullDuplex: true, fullDuplexRev: 2 }).fullDuplex).toBe(false);
    expect(cleanCallSettings({ fullDuplex: true }).fullDuplex).toBe(false);
    expect(cleanCallSettings({ fullDuplex: "yes" }).fullDuplex).toBe(false);
  });
});
