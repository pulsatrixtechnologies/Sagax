import { describe, expect, it } from "vitest";

import { computerAction, needsRecover } from "./computer-recover";

describe("computer recover (parity R7, system 6)", () => {
  it("is offered for a stuck computer only, as on the phone (ComputerCare.needsRecover)", () => {
    expect(needsRecover({ configured: false, state: "stopped" })).toBe(false);
    expect(needsRecover({ configured: true, state: "running" })).toBe(false);
    expect(needsRecover({ configured: true, state: "ready", problem: "  " })).toBe(false);
    expect(needsRecover({ configured: true, state: "running", problem: "unreachable" })).toBe(true);
    expect(needsRecover({ configured: true, state: "running", waking: { since: 1, elapsedMs: 2 } })).toBe(true);
    expect(needsRecover({ configured: true, state: "unavailable" })).toBe(true);
  });

  it("names the one action the row offers: recover when stuck, update now otherwise", () => {
    expect(computerAction(null)).toBeNull();
    expect(computerAction({ configured: false, state: "missing" })).toBeNull();
    expect(computerAction({ configured: true, state: "running" })).toBe("update");
    expect(computerAction({ configured: true, state: "unavailable" })).toBe("recover");
  });
});
