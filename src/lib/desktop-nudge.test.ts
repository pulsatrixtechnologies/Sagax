import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prefs = vi.hoisted(() => ({ nudgeSound: true, nudgeShake: true }));
const sound = vi.hoisted(() => ({ play: vi.fn(async () => true) }));
const notes = vi.hoisted(() => ({ present: vi.fn(() => true) }));
vi.mock("./notification-preferences", () => ({
  attentionSettings: () => ({ sound: true, persistent: true, badge: true, nudgeSound: prefs.nudgeSound, nudgeShake: prefs.nudgeShake }),
}));
vi.mock("./nudge-sound", () => ({ playNudgeSound: sound.play }));
vi.mock("./notify", () => ({ presentNotification: notes.present }));

import { onNudgeReceived, onNudgeSent, onNudgeSentEcho, resetPlayedNudges, shakePage } from "./desktop-nudge";

const NOW = 1_800_000_000_000;

function desktop(focused = false) {
  const nudgeWindow = vi.fn();
  vi.stubGlobal("window", { ogb: { nudgeWindow }, focus: vi.fn() });
  vi.stubGlobal("document", { hasFocus: () => focused });
  return nudgeWindow;
}

function browser(focused = false) {
  const classes = new Set<string>();
  const appended: Array<{ id: string; textContent: string }> = [];
  const root = {
    offsetWidth: 1,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
    appendChild: (node: { id: string; textContent: string }) => appended.push(node),
  };
  const doc = {
    hasFocus: () => focused,
    documentElement: root,
    head: root,
    getElementById: (id: string) => appended.find((node) => node.id === id) ?? null,
    createElement: () => ({ id: "", textContent: "" }),
  };
  const focus = vi.fn();
  vi.stubGlobal("window", { focus });
  vi.stubGlobal("document", doc);
  return { classes, appended, focus };
}

beforeEach(() => {
  resetPlayedNudges();
  prefs.nudgeSound = true;
  prefs.nudgeShake = true;
  sound.play.mockClear();
  notes.present.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a nudge received", () => {
  it("brings the desktop window to the front, shakes it, rings and notifies when it was behind", async () => {
    const nudgeWindow = desktop(false);
    await onNudgeReceived({ id: "n1", fromName: "Alice", at: NOW }, vi.fn(), NOW);
    expect(nudgeWindow).toHaveBeenCalledWith({ shake: true, role: "received" });
    expect(sound.play).toHaveBeenCalledTimes(1);
    expect(notes.present).toHaveBeenCalledTimes(1);
  });

  it("still comes to the front when this computer turned the shake off", async () => {
    prefs.nudgeShake = false;
    const nudgeWindow = desktop(true);
    await onNudgeReceived({ id: "n1", fromName: "Alice", at: NOW }, vi.fn(), NOW);
    expect(nudgeWindow).toHaveBeenCalledWith({ shake: false, role: "received" });
    expect(notes.present).not.toHaveBeenCalled();
  });

  it("does nothing for a stale replay or a nudge already played", async () => {
    const nudgeWindow = desktop(false);
    await onNudgeReceived({ id: "old", fromName: "Alice", at: NOW - 10 * 60_000 }, vi.fn(), NOW);
    expect(nudgeWindow).not.toHaveBeenCalled();
    await onNudgeReceived({ id: "n2", fromName: "Alice", at: NOW }, vi.fn(), NOW);
    await onNudgeReceived({ id: "n2", fromName: "Alice", at: NOW }, vi.fn(), NOW);
    expect(nudgeWindow).toHaveBeenCalledTimes(1);
  });

  it("in a browser, shakes the page, asks for focus and rings", async () => {
    vi.useFakeTimers();
    const page = browser(false);
    await onNudgeReceived({ id: "n3", fromName: "Alice", at: NOW }, vi.fn(), NOW);
    expect(page.classes.has("sagax-page-nudge")).toBe(true);
    expect(page.appended.map((node) => node.id)).toEqual(["sagax-page-nudge-style"]);
    expect(page.focus).toHaveBeenCalled();
    expect(sound.play).toHaveBeenCalledTimes(1);
    expect(notes.present).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    expect(page.classes.has("sagax-page-nudge")).toBe(false);
  });
});

describe("a nudge sent", () => {
  it("shakes and rings the sender's own window at once, with no notification", async () => {
    const nudgeWindow = desktop(true);
    await onNudgeSent({ ok: true, id: "s1", at: NOW } as { id: string; at: number }, NOW);
    expect(nudgeWindow).toHaveBeenCalledWith({ shake: true, role: "sent" });
    expect(sound.play).toHaveBeenCalledTimes(1);
    expect(notes.present).not.toHaveBeenCalled();
  });

  it("skips the server's echo of the nudge this window already played", async () => {
    const nudgeWindow = desktop(true);
    await onNudgeSent({ id: "s2", at: NOW }, NOW);
    await onNudgeSentEcho({ id: "s2", at: NOW }, NOW);
    expect(nudgeWindow).toHaveBeenCalledTimes(1);
    expect(sound.play).toHaveBeenCalledTimes(1);
  });

  it("another window of the sender plays the echo", async () => {
    const nudgeWindow = desktop(false);
    await onNudgeSentEcho({ id: "s3", at: NOW }, NOW);
    expect(nudgeWindow).toHaveBeenCalledWith({ shake: true, role: "sent" });
    expect(sound.play).toHaveBeenCalledTimes(1);
    expect(notes.present).not.toHaveBeenCalled();
  });

  it("an older server that answers no id still shakes the sender's window", async () => {
    const nudgeWindow = desktop(true);
    await onNudgeSent({ ok: true } as { id?: unknown }, NOW);
    expect(nudgeWindow).toHaveBeenCalledWith({ shake: true, role: "sent" });
  });

  it("follows the sound switch", async () => {
    prefs.nudgeSound = false;
    desktop(true);
    await onNudgeSent({ id: "s4", at: NOW }, NOW);
    expect(sound.play).not.toHaveBeenCalled();
  });
});

describe("shakePage", () => {
  it("is a no-op without a document", () => {
    expect(shakePage(undefined)).toBe(false);
  });
});
