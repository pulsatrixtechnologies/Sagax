import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import {
  buildFloatingSnapshot,
  floatingMenu,
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
import { isFloatingEvent, isFloatingSnapshot, mascotFields, type FloatingMenuItem } from "./protocol";

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
    const ids = (menu: FloatingMenuItem[]) => menu.filter((item) => item.type !== "separator").map((item) => item.id);
    expect(ids(snapshot(bot()).menu)).toEqual(["balloon", "open", "dock", "top", "fly"]);
    expect(snapshot(bot(), newFloatingSession(), undefined, false).menu.find((item) => item.id === "top")).toMatchObject({ checked: false });
    expect(ids(snapshot(bot(), newFloatingSession(), undefined, null).menu)).toEqual(["balloon", "open", "dock", "fly"]);
  });

  const full = { ...labels, ...Object.fromEntries(["menuTalk", "menuCloseChat", "menuCall", "menuHangUp", "menuSwitch", "menuMoves", "menuSnooze", "menuHideMascot", "menuOptions", "menuSettings", "menuLively"].map((key) => [key, key])) } as FloatingLabels;
  const bots = [{ id: "bot_a", name: "Ada", floating: true }, { id: "bot_b", name: "Bo", floating: false }, { id: "bot_c", name: "Cy", floating: true }];
  const moves = [{ clip: "wave", label: "Wave" }, { clip: "dance", label: "Dance" }];

  it("gives the balloon's composer row its clip and the model chip's text", () => {
    const b = bot();
    const session = { ...newFloatingSession(), open: true };
    const withRow = buildFloatingSnapshot({ bot: b, session, status: floatingStatus(b, session, undefined), labels: { ...labels, attach: "Attach a file" }, avatar: null, retro: false, reduced: false, locale: "en", alwaysOnTop: true, model: { label: "GPT-5 high", title: "Change the model in the app" } });
    expect(withRow.balloon?.input).toEqual({ label: "inputLabel", placeholder: "placeholder", send: "send", attach: "Attach a file", model: "GPT-5 high", modelTitle: "Change the model in the app" });
    // no model known: no chip
    expect(snapshot(b, session).balloon?.input).toEqual({ label: "inputLabel", placeholder: "placeholder", send: "send" });
  });

  it("lays the menu out as JC asked: talk, call, open; switch bot and moves; hide; options and settings", () => {
    const menu = floatingMenu(full, newFloatingSession(), true, true, { call: "start", bots, moves }, "bot_a");
    expect(menu.map((item) => item.type === "separator" ? "-" : item.id)).toEqual(["balloon", "call", "open", "-", "switch", "moves", "-", "snooze", "dock", "-", "options", "settings"]);
    expect(menu.map((item) => item.label).filter(Boolean)).toEqual(["menuTalk", "menuCall", "menuOpen", "menuSwitch", "menuMoves", "menuSnooze", "menuHideMascot", "menuOptions", "menuSettings"]);
    // Switch bot: the person's bots, this one checked, one already on the desktop greyed out
    const switching = menu.find((item) => item.id === "switch")!.items!;
    expect(switching.map((item) => item.id)).toEqual(["switch:bot_a", "switch:bot_b", "switch:bot_c"]);
    expect(switching[0]).toMatchObject({ checked: true });
    expect(switching[1].enabled).toBeUndefined();
    expect(switching[2]).toMatchObject({ enabled: false });
    // Moves: the character's, by clip
    expect(menu.find((item) => item.id === "moves")!.items).toEqual([{ id: "move:wave", label: "Wave" }, { id: "move:dance", label: "Dance" }]);
    // the desktop options in their own submenu
    expect(menu.find((item) => item.id === "options")!.items!.map((item) => item.id)).toEqual(["top", "fly", "lively"]);
  });

  it("names the chat item after its state, the call item after the call, and leaves out what has nothing to offer", () => {
    const open = floatingMenu(full, { ...newFloatingSession(), open: true }, null, true, { call: "end", bots: bots.slice(0, 1), moves: [] }, "bot_a");
    expect(open[0]).toMatchObject({ id: "balloon", label: "menuCloseChat" });
    expect(open.find((item) => item.id === "call")).toMatchObject({ label: "menuHangUp" });
    // one bot: no switch; no moves: no Moves
    expect(open.some((item) => item.id === "switch" || item.id === "moves")).toBe(false);
    expect(floatingMenu(full, newFloatingSession(), null, true, {}, "bot_a").some((item) => item.id === "call")).toBe(false);
    // every id fits the protocol's (a switch to a 64-character bot id included)
    const long = floatingMenu(full, newFloatingSession(), true, true, { bots: [...bots, { id: "b".repeat(64), name: "Long", floating: false }] }, "bot_a");
    expect(isFloatingSnapshot({ ...snapshot(bot()), menu: long })).toBe(true);
    expect(isFloatingEvent({ type: "menu", id: `switch:${"b".repeat(64)}` })).toBe(true);
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
    expect(mascotFields(old)).toEqual({ task: "idle", mood: 0.6, flyAway: true, hints: { mood: "", working: "" }, liveliness: "normal" });
    expect(mascotFields({ task: "working", mood: -3, flyAway: false })).toMatchObject({ task: "working", mood: 0, flyAway: false });
  });
});
