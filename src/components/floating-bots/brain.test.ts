import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import {
  buildFloatingSnapshot,
  clampOverlayPosition,
  defaultOverlayPosition,
  floatingStatus,
  floatingTask,
  newFloatingSession,
  plainReply,
  replyAfter,
  truncateReply,
  type FloatingBot,
  type FloatingLabels,
} from "./brain";
import { isFloatingEvent, isFloatingSnapshot, mascotFields } from "./protocol";

const labels: FloatingLabels = Object.fromEntries(
  ["character", "inputLabel", "placeholder", "send", "open", "close", "hello", "thinking", "approvalTitle", "approval", "errorTitle", "error", "menuOpen", "menuHide", "menuShow", "menuTop", "menuDock", "menuFly", "moodLow", "moodOk", "moodHappy", "working"].map((key) => [key, key]),
) as unknown as FloatingLabels;

const msg = (partial: Partial<Message>): Message => ({ id: crypto.randomUUID(), role: "bot", kind: "text", at: 1, ...partial });

function bot(partial: Partial<FloatingBot> = {}): FloatingBot {
  return { id: "bot_a", name: "Ada", color: "green", mascotSkin: null, threadId: "t1", messages: [], busy: false, activity: "idle", ...partial };
}

const snapshot = (b: FloatingBot, session = newFloatingSession(), stream?: string, alwaysOnTop: boolean | null = true) =>
  buildFloatingSnapshot({ bot: b, session, status: floatingStatus(b, session, stream), labels, avatar: null, retro: false, reduced: false, locale: "fr", alwaysOnTop });

describe("floating bot brain: the reply", () => {
  it("collects what the bot said after the message sent from the balloon", () => {
    const messages = [msg({ text: "old answer" }), msg({ role: "user", sendId: "s1", text: "hi" }), msg({ kind: "activity", text: "tool" }), msg({ text: "one" }), msg({ text: "two" })];
    expect(replyAfter(messages, "s1")).toEqual({ found: true, text: "one\n\ntwo" });
    expect(replyAfter(messages, "nope")).toEqual({ found: false, text: "" });
    expect(replyAfter([msg({ role: "user", id: "optimistic-s2", text: "x" })], "s2").found).toBe(true);
  });

  it("reads markdown as plain text and cuts a long reply at a word", () => {
    expect(plainReply("## Title\n**bold** and `code` and [a link](https://x)")).toBe("Title\nbold and code and a link");
    const long = truncateReply("word ".repeat(1000), 100);
    expect(long.truncated).toBe(true);
    expect(long.text.length).toBeLessThanOrEqual(101);
    expect(long.text.endsWith("…")).toBe(true);
    expect(truncateReply("short")).toEqual({ text: "short", truncated: false });
  });
});

describe("floating bot brain: poses and balloons", () => {
  it("rests idle with no balloon until clicked, then says hello with an input", () => {
    const closed = snapshot(bot());
    expect(closed.pose).toBe("idle");
    expect(closed.balloon).toBeNull();
    const open = snapshot(bot(), { ...newFloatingSession(), open: true });
    expect(open.balloon).toMatchObject({ kind: "chat", text: "hello", input: { send: "send" } });
    expect(isFloatingSnapshot(open)).toBe(true);
  });

  it("thinks while the turn runs, talks while it streams", () => {
    const session = { ...newFloatingSession(), open: true, threadId: "t1", sendId: "s1", asked: "hi" };
    const busy = bot({ busy: true, messages: [msg({ role: "user", sendId: "s1", text: "hi" })] });
    expect(snapshot(busy, session)).toMatchObject({ pose: "think", balloon: { kind: "thinking", asked: "hi" } });
    expect(snapshot(busy, session, "Hel")).toMatchObject({ pose: "speak", balloon: { kind: "chat", text: "Hel", streaming: true } });
  });

  it("follows the thread's own task, not whichever thread the app shows", () => {
    const session = { ...newFloatingSession(), open: true, threadId: "t2", sendId: "s1", lastReply: "kept" };
    const b = bot({ threadId: "t1", busy: false, tasks: [{ threadId: "t2", busy: true }] });
    expect(snapshot(b, session).pose).toBe("think");
    const idle = bot({ threadId: "t1", tasks: [{ threadId: "t2", busy: false }] });
    expect(snapshot(idle, session).balloon).toMatchObject({ kind: "chat", text: "kept" });
  });

  it("shows a short balloon with the link for approvals and errors", () => {
    const session = { ...newFloatingSession(), open: true, sendId: "s1" };
    expect(snapshot(bot({ activity: "waiting-on-you" }), session)).toMatchObject({ pose: "alert", balloon: { kind: "approval", input: null, open: "open" } });
    expect(snapshot(bot(), { ...session, error: true })).toMatchObject({ pose: "alert", balloon: { kind: "error", title: "errorTitle" } });
  });

  it("offers the right-click menu, with always-on-top only on the desktop", () => {
    expect(snapshot(bot()).menu.map((item) => item.id)).toEqual(["open", "balloon", "top", "fly", "dock"]);
    expect(snapshot(bot(), newFloatingSession(), undefined, false).menu.find((item) => item.id === "top")).toMatchObject({ checked: false });
    expect(snapshot(bot(), newFloatingSession(), undefined, null).menu.map((item) => item.id)).toEqual(["open", "balloon", "fly", "dock"]);
  });

  it("checks what comes back from a window", () => {
    expect(isFloatingEvent({ type: "send", text: "hi" })).toBe(true);
    expect(isFloatingEvent({ type: "send", text: "  " })).toBe(false);
    expect(isFloatingEvent({ type: "menu", id: "../x" })).toBe(false);
    expect(isFloatingEvent({ type: "eval" })).toBe(false);
    expect(isFloatingEvent({ type: "play" })).toBe(true);
    expect(isFloatingEvent({ type: "pet" })).toBe(true);
  });
});

describe("floating bot brain: the in-app overlay stays on screen", () => {
  const size = { width: 96, height: 96 };
  it("clamps a dropped bot inside the viewport", () => {
    expect(clampOverlayPosition({ right: -50, bottom: 99999 }, { width: 400, height: 800 }, size)).toEqual({ right: 8, bottom: 800 - 96 - 8 });
    expect(clampOverlayPosition({ right: 5000, bottom: 2 }, { width: 400, height: 800 }, size)).toEqual({ right: 400 - 96 - 8, bottom: 8 });
    expect(clampOverlayPosition({ right: 10, bottom: 10 }, { width: 50, height: 50 }, size)).toEqual({ right: 8, bottom: 8 });
  });
  it("puts new bots side by side", () => {
    expect(defaultOverlayPosition(0, size).right).toBeLessThan(defaultOverlayPosition(1, size).right);
  });
});

describe("floating bot brain: the mascot", () => {
  const full = (b: FloatingBot, session = newFloatingSession(), extra: { mood?: number; flyAway?: boolean } = {}) =>
    buildFloatingSnapshot({ bot: b, session, status: floatingStatus(b, session, undefined), labels, avatar: null, retro: false, reduced: false, locale: "en", alwaysOnTop: true, ...extra });

  it("tells the mascot when its bot works, waits, fails or rests", () => {
    const session = newFloatingSession();
    expect(floatingTask(bot(), session, floatingStatus(bot(), session, undefined))).toBe("idle");
    expect(full(bot({ busy: true })).task).toBe("working");
    // any of its threads counts, not only the one on screen
    expect(full(bot({ tasks: [{ threadId: "t9", busy: true }] })).task).toBe("working");
    expect(full(bot({ busy: true, tasks: [{ threadId: "t9", busy: true, activity: "waiting-on-you" }] })).task).toBe("waiting");
    expect(full(bot(), { ...session, error: true }).task).toBe("error");
  });

  it("sends the mood with its label, and the fly-away setting", () => {
    expect(full(bot())).toMatchObject({ mood: 0.6, flyAway: true, hints: { mood: "moodOk", working: "working" } });
    expect(full(bot(), newFloatingSession(), { mood: 0.123, flyAway: false })).toMatchObject({ mood: 0.12, flyAway: false, hints: { mood: "moodLow" } });
    expect(full(bot(), newFloatingSession(), { mood: 7 })).toMatchObject({ mood: 1, hints: { mood: "moodHappy" } });
    expect(full(bot(), newFloatingSession(), { flyAway: false }).menu.find((item) => item.id === "fly")).toMatchObject({ checked: false });
  });

  it("fills in the mascot's fields for a snapshot from an older brain", () => {
    const old = { ...full(bot()) } as Partial<ReturnType<typeof full>>;
    delete old.task;
    delete old.mood;
    delete old.hints;
    expect(mascotFields(old)).toEqual({ task: "idle", mood: 0.6, flyAway: true, hints: { mood: "", working: "" } });
    expect(mascotFields({ task: "working", mood: -3, flyAway: false })).toMatchObject({ task: "working", mood: 0, flyAway: false });
  });
});
