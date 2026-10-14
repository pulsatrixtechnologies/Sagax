// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { dataWindowHref, dataWindowName, openDataWindow, readDataWindowTarget, subscribeDataWindowMessages } from "./data-window";

afterEach(() => vi.unstubAllGlobals());

describe("Data window address", () => {
  it("names a bot and a card, and refuses anything else", () => {
    expect(dataWindowHref("scout")).toBe("/data-window#bot=scout");
    expect(dataWindowHref("scout", "c_1")).toBe("/data-window#bot=scout&card=c_1");
    expect(readDataWindowTarget("#bot=scout&card=c_1")).toEqual({ botId: "scout", cardId: "c_1" });
    expect(readDataWindowTarget("#bot=scout&card=bad%20id")).toEqual({ botId: "scout" });
    expect(readDataWindowTarget("#bot=..%2Fx")).toBeNull();
    expect(readDataWindowTarget("")).toBeNull();
    expect(dataWindowName("team:scout")).toBe("sagax-data-team_scout");
  });
});

describe("openDataWindow", () => {
  it("asks main in the desktop app, and asks an already open window for the card", async () => {
    const open = vi.fn(async () => "focused" as const);
    vi.stubGlobal("ogb", { dataWindow: { open } });
    const heard: unknown[] = [];
    const stop = subscribeDataWindowMessages((message) => heard.push(message));
    try {
      expect(await openDataWindow({ botId: "scout", title: "Data: Scout", cardId: "c_2" })).toBe("focused");
      expect(open).toHaveBeenCalledWith({ botId: "scout", title: "Data: Scout", cardId: "c_2" });
      await vi.waitFor(() => expect(heard).toEqual([{ type: "card", botId: "scout", cardId: "c_2" }]));
    } finally { stop(); }
  });

  it("reports a refusal from main (the experimental switch is off there)", async () => {
    vi.stubGlobal("ogb", { dataWindow: { open: vi.fn(async () => { throw new Error("no"); }) } });
    expect(await openDataWindow({ botId: "scout", title: "Data" })).toBe("refused");
    expect(await openDataWindow({ botId: "bad id", title: "Data" })).toBe("refused");
  });

  it("opens one named browser window per bot outside the desktop app", async () => {
    const focus = vi.fn();
    const open = vi.fn(() => ({ focus }) as unknown as Window);
    vi.stubGlobal("open", open);
    expect(await openDataWindow({ botId: "scout", title: "Data", cardId: "c_1" })).toBe("created");
    expect(open).toHaveBeenCalledWith("/data-window#bot=scout&card=c_1", "sagax-data-scout");
    expect(focus).toHaveBeenCalled();
    open.mockReturnValueOnce(null as unknown as Window);
    expect(await openDataWindow({ botId: "scout", title: "Data" })).toBe("blocked");
  });
});
