// EchoGuard keeps 512 ms of playback and lines the microphone up with it.
// A speakerphone or Bluetooth return (about 150 to 300 ms) is still echo.
// For the first second the coupling stays at least at its prior. Unit
// evidence; not a live room.
import { describe, expect, it } from "vitest";

import { EchoGuard } from "./echo";

describe("EchoGuard delayed residue", () => {
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

  it("within the first second, 9 dB above the learned coupling is still echo", () => {
    const guard = new EchoGuard();
    const playback = 0.1;
    const residue = playback * 0.05;
    for (let i = 0; i < 16; i++) guard.update(residue, playback);
    expect(guard.update(residue, playback)).toBe(true);
    expect(guard.estimate).toBeLessThan(0.1);
    // 9 dB over what was learned, still under the prior the first second keeps
    const person = playback * guard.estimate * 10 ** (9 / 20);
    expect(guard.update(person, playback)).toBe(true);
  });

  it("after the first second, a person 9 dB above the learned coupling is not echo", () => {
    const guard = new EchoGuard();
    const playback = 0.1;
    const residue = playback * 0.05;
    for (let i = 0; i < 40; i++) guard.update(residue, playback);
    const person = playback * guard.estimate * 10 ** (9 / 20);
    expect(guard.update(person, playback)).toBe(false);
  });

  it("locks an eight-frame speaker delay and still hears the person", () => {
    const guard = new EchoGuard();
    const played = 0.2;
    const residue = played * 0.05;
    for (let i = 0; i < 8; i++) guard.update(0, played);
    for (let i = 0; i < 8; i++) guard.update(residue, 0);
    expect(guard.lagFrames).toBe(8);
    expect(guard.lingering).toBe(true);
    expect(guard.update(residue, 0)).toBe(true);
    expect(guard.update(0.2, 0)).toBe(false);
  });
});
