import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prefs = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/notification-preferences", () => ({ nudgeSoundEnabled: () => prefs.enabled }));

import { onDesktopNudge, onNudgeReceived } from "./desktop-nudge";
import { NUDGE_SOUND_URL, playNudgeSound, resetNudgeSoundLog } from "./nudge-sound";

const instances: Array<{ src: string; volume: number; play: ReturnType<typeof vi.fn> }> = [];
let playResult: () => Promise<void> | undefined;
let nudgeWindow: ReturnType<typeof vi.fn>;

beforeEach(() => {
  instances.length = 0;
  prefs.enabled = true;
  playResult = () => Promise.resolve();
  resetNudgeSoundLog();
  nudgeWindow = vi.fn();
  vi.stubGlobal("window", { ogb: { nudgeWindow } });
  vi.stubGlobal(
    "Audio",
    class {
      volume = 1;
      play = vi.fn(() => playResult());
      constructor(public src: string) {
        instances.push(this);
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("nudge sound", () => {
  it("plays once on a received nudge, with the window shake, at a reduced volume", () => {
    onNudgeReceived();
    expect(nudgeWindow).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(1);
    expect(instances[0].src).toBe(NUDGE_SOUND_URL);
    expect(instances[0].volume).toBe(0.6);
    expect(instances[0].play).toHaveBeenCalledTimes(1);
  });

  it("does not play on the sender's own shake", () => {
    onDesktopNudge();
    expect(nudgeWindow).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(0);
  });

  it("plays nothing when the preference is off", () => {
    prefs.enabled = false;
    onNudgeReceived();
    expect(nudgeWindow).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(0);
  });

  it("fails silently and logs once when the browser refuses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    playResult = () => Promise.reject(new Error("NotAllowedError"));
    playNudgeSound();
    playNudgeSound();
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("survives an Audio constructor that throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("Audio", class {
      constructor() {
        throw new Error("no audio");
      }
    });
    expect(() => playNudgeSound()).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("ships the file in public/, which vite copies to dist/ (resources/ui when packaged)", () => {
    expect(NUDGE_SOUND_URL.startsWith("/")).toBe(true);
    const file = join(process.cwd(), "public", NUDGE_SOUND_URL.slice(1));
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(1000);
  });
});
