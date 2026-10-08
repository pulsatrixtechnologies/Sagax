import { describe, expect, it } from "vitest";
import { DEFAULT_HOTKEY, hotkeyAction, hotkeyBot, hotkeyConfig, type HotkeyContext } from "./hotkey";

const idle: HotkeyContext = { enabled: true, botId: "ada", canCall: true, callBot: null, muted: false, push: false, talking: false };
const onCall: HotkeyContext = { ...idle, callBot: "ada" };

describe("hotkeyAction", () => {
  it("press: starts the call with the mascot's bot", () => {
    expect(hotkeyAction("tap", idle)).toBe("start");
  });

  it("press while another bot is on a call: starts this one (the other ends, as the call button does)", () => {
    expect(hotkeyAction("tap", { ...idle, callBot: "grace" })).toBe("start");
  });

  it("press again: mutes, then unmutes", () => {
    expect(hotkeyAction("tap", onCall)).toBe("mute");
    expect(hotkeyAction("tap", { ...onCall, muted: true })).toBe("unmute");
  });

  it("hold in push to talk: talks while held, the release stops", () => {
    expect(hotkeyAction("hold", { ...onCall, push: true })).toBe("talk");
    expect(hotkeyAction("release", { ...onCall, push: true, talking: true })).toBe("release");
  });

  it("hold hands-free, or muted: the same as a press", () => {
    expect(hotkeyAction("hold", onCall)).toBe("mute");
    expect(hotkeyAction("hold", { ...onCall, push: true, muted: true })).toBe("unmute");
  });

  it("hold with no call: starts it", () => {
    expect(hotkeyAction("hold", { ...idle, push: true })).toBe("start");
  });

  it("a release without a talk does nothing", () => {
    expect(hotkeyAction("release", onCall)).toBe("none");
  });

  it("off, hidden (no mascot) or no voice mode: nothing", () => {
    expect(hotkeyAction("tap", { ...idle, enabled: false })).toBe("none");
    expect(hotkeyAction("tap", { ...idle, botId: null })).toBe("none");
    expect(hotkeyAction("tap", { ...idle, canCall: false })).toBe("none");
  });

  it("a talk under way is still released when the mascot was hidden meanwhile", () => {
    expect(hotkeyAction("release", { ...onCall, botId: null, talking: true })).toBe("release");
  });
});

describe("hotkeyBot", () => {
  it("the mascot on the call first, else the first shown, else none", () => {
    expect(hotkeyBot(["ada", "grace"], "grace")).toBe("grace");
    expect(hotkeyBot(["ada", "grace"], "linus")).toBe("ada");
    expect(hotkeyBot(["ada"], null)).toBe("ada");
    expect(hotkeyBot([], "ada")).toBeNull();
  });
});

describe("hotkeyConfig", () => {
  it("on only with the setting and a mascot shown", () => {
    expect(hotkeyConfig({ enabled: true, accelerator: DEFAULT_HOTKEY, botId: "ada", callBot: null, push: false })).toEqual({ enabled: true, accelerator: DEFAULT_HOTKEY, hold: false });
    expect(hotkeyConfig({ enabled: true, accelerator: DEFAULT_HOTKEY, botId: null, callBot: null, push: false }).enabled).toBe(false);
    expect(hotkeyConfig({ enabled: false, accelerator: DEFAULT_HOTKEY, botId: "ada", callBot: null, push: false }).enabled).toBe(false);
  });

  it("holds are read only on this mascot's push-to-talk call", () => {
    expect(hotkeyConfig({ enabled: true, accelerator: DEFAULT_HOTKEY, botId: "ada", callBot: "ada", push: true }).hold).toBe(true);
    expect(hotkeyConfig({ enabled: true, accelerator: DEFAULT_HOTKEY, botId: "ada", callBot: "ada", push: false }).hold).toBe(false);
    expect(hotkeyConfig({ enabled: true, accelerator: DEFAULT_HOTKEY, botId: "ada", callBot: null, push: true }).hold).toBe(false);
    expect(hotkeyConfig({ enabled: false, accelerator: DEFAULT_HOTKEY, botId: "ada", callBot: "ada", push: true }).hold).toBe(false);
  });
});
