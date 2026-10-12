// EchoGuard's 250 ms playback window: delayed speaker residue is still
// echo, a person 9 dB above the expected echo is not. Unit evidence for
// speakers-without-headphones; not a live room.
import { describe, expect, it } from "vitest";

import { EchoGuard } from "./echo";

describe("EchoGuard delayed residue (~250 ms window)", () => {
  it("residue 3 frames after playback is still echo", () => {
    const guard = new EchoGuard();
    const playback = 0.1;
    const residue = playback * 0.05;
    for (let i = 0; i < 16; i++) {
      expect(guard.update(residue, playback)).toBe(true);
    }
    for (let i = 0; i < 3; i++) {
      expect(guard.update(residue, 0), `silent frame ${i + 1}`).toBe(true);
    }
  });

  it("a person 9 dB above the expected echo is not echo", () => {
    const guard = new EchoGuard();
    const playback = 0.1;
    const residue = playback * 0.05;
    for (let i = 0; i < 16; i++) guard.update(residue, playback);
    expect(guard.update(residue, playback)).toBe(true);
    const person = playback * guard.estimate * 10 ** (9 / 20);
    expect(guard.update(person, playback)).toBe(false);
  });
});
