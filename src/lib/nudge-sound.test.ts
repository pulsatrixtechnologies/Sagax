import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prefs = vi.hoisted(() => ({ nudgeSound: true, nudgeShake: true, sound: true, persistent: true }));
vi.mock("@/lib/notification-preferences", () => ({
  attentionSettings: () => ({ ...prefs, badge: true }),
}));
vi.mock("@/lib/i18n", () => ({
  t: (key: string, values?: Record<string, string>) => (values?.name ? `${key}:${values.name}` : key),
}));

import { onNudgeReceived } from "./desktop-nudge";
import { NUDGE_SOUND_URL, playNudgeSound, primeNudgeSound, resetNudgeSoundLog } from "./nudge-sound";

const instances: Array<{ src: string; volume: number; preload: string; play: ReturnType<typeof vi.fn>; load: ReturnType<typeof vi.fn> }> = [];
let playResult: () => Promise<void> | undefined;
let nudgeWindow: ReturnType<typeof vi.fn>;
let notify: ReturnType<typeof vi.fn>;
let focused = false;

const NOW = 5_000_000;
const frame = { fromName: "Alice", at: NOW - 1000, open: { groupId: "dm-1", threadId: "dm-thread" } };

beforeEach(() => {
  instances.length = 0;
  Object.assign(prefs, { nudgeSound: true, nudgeShake: true, sound: true, persistent: true });
  playResult = () => Promise.resolve();
  focused = false;
  resetNudgeSoundLog();
  nudgeWindow = vi.fn();
  notify = vi.fn();
  vi.stubGlobal("window", { focus: vi.fn(), ogb: { nudgeWindow, notify, onNotificationClick: () => () => {} } });
  vi.stubGlobal("document", { hasFocus: () => focused });
  vi.stubGlobal(
    "Audio",
    class {
      volume = 1;
      preload = "";
      currentTime = 0;
      play = vi.fn(() => playResult());
      load = vi.fn();
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

describe("a received nudge", () => {
  it("rings once at a reduced volume, asks the shell to shake, and leaves a persistent notification when the window is behind", async () => {
    await onNudgeReceived(frame, vi.fn(), NOW);
    expect(nudgeWindow).toHaveBeenCalledWith({ shake: true });
    expect(instances).toHaveLength(1);
    expect(instances[0].src).toBe(NUDGE_SOUND_URL);
    expect(instances[0].volume).toBe(0.6);
    expect(instances[0].play).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledOnce();
    // the sound already rang: the banner does not ring a second time
    expect(notify.mock.calls[0][0]).toMatchObject({ title: "nudge.notify.title:Alice", persistent: true, sound: false, bounce: "critical", flash: true });
  });

  it("a click on that notification opens the conversation the line went to", async () => {
    let click: ((id: string) => void) | undefined;
    vi.stubGlobal("window", { focus: vi.fn(), ogb: { nudgeWindow, notify, onNotificationClick: (cb: (id: string) => void) => { click = cb; return () => {}; } } });
    const open = vi.fn();
    // a fresh module: the page wires the shell's clicks once, on its first notification
    vi.resetModules();
    const fresh = await import("./desktop-nudge");
    await fresh.onNudgeReceived(frame, open, NOW);
    click?.(notify.mock.calls.at(-1)![0].id);
    expect(open).toHaveBeenCalledWith({ botId: "", threadId: "dm-thread" });
  });

  it("no notification when the window is in front: the ring and the shake are enough", async () => {
    focused = true;
    await onNudgeReceived(frame, vi.fn(), NOW);
    expect(nudgeWindow).toHaveBeenCalledOnce();
    expect(notify).not.toHaveBeenCalled();
  });

  it("when the sound cannot play, the notification rings instead", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    playResult = () => Promise.reject(new Error("NotAllowedError"));
    await onNudgeReceived(frame, vi.fn(), NOW);
    expect(notify.mock.calls[0][0]).toMatchObject({ sound: true });
  });

  it("follows the sound and shake switches", async () => {
    prefs.nudgeSound = false;
    prefs.nudgeShake = false;
    await onNudgeReceived(frame, vi.fn(), NOW);
    expect(nudgeWindow).toHaveBeenCalledWith({ shake: false });
    expect(instances).toHaveLength(0);
    expect(notify.mock.calls[0][0]).toMatchObject({ sound: false });
  });

  it("a stale replay neither rings nor shakes", async () => {
    await onNudgeReceived({ ...frame, at: NOW - 10 * 60_000 }, vi.fn(), NOW);
    expect(nudgeWindow).not.toHaveBeenCalled();
    expect(instances).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("nudge sound", () => {
  it("is loaded once at start and that element plays every nudge", async () => {
    primeNudgeSound();
    primeNudgeSound();
    expect(instances).toHaveLength(1);
    expect(instances[0].preload).toBe("auto");
    expect(instances[0].load).toHaveBeenCalledOnce();
    expect(await playNudgeSound()).toBe(true);
    expect(await playNudgeSound()).toBe(true);
    expect(instances).toHaveLength(1);
    expect(instances[0].play).toHaveBeenCalledTimes(2);
  });

  it("fails silently, says so, and logs once when the browser refuses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    playResult = () => Promise.reject(new Error("NotAllowedError"));
    expect(await playNudgeSound()).toBe(false);
    expect(await playNudgeSound()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("survives an Audio constructor that throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("Audio", class {
      constructor() {
        throw new Error("no audio");
      }
    });
    expect(await playNudgeSound()).toBe(false);
    expect(() => primeNudgeSound()).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("ships the file in public/, which vite copies to dist/ (resources/ui when packaged)", () => {
    expect(NUDGE_SOUND_URL.startsWith("/")).toBe(true);
    const file = join(process.cwd(), "public", NUDGE_SOUND_URL.slice(1));
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(1000);
  });
});
