import { afterEach, describe, expect, it, vi } from "vitest";

import { CALL_MODE_KEY, CALL_MODES, callModeHint, parseCallMode } from "./call-mode";
import { t } from "./i18n";

describe("call mode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("defaults to taking turns and accepts only known modes", () => {
    expect(parseCallMode(null)).toBe("turns");
    expect(parseCallMode("live")).toBe("live");
    expect(parseCallMode("LIVE")).toBe("turns");
    expect(CALL_MODES.map((mode) => t(mode.label))).toEqual(["Take turns", "Live"]);
  });

  // Turning Live on is where the person learns what leaves the computer.
  it("says, where Live is chosen, what a Live call sends to OpenAI", () => {
    const live = callModeHint("live");
    expect(live).toContain("A Live call sends your voice to OpenAI, along with the chat's recent messages, the bot's answers and the details of any approval it asks for. The OpenAI key stays on your computer.");
    expect(callModeHint("turns")).toBe("You talk, then the bot answers in its own voice. Listening stays on this computer.");
  });

  it("remembers the choice and survives storage that refuses writes", async () => {
    const stored = new Map<string, string>([[CALL_MODE_KEY, "live"]]);
    vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
    const mode = await import("./call-mode");
    expect(mode.callMode()).toBe("live");
    mode.setCallMode("turns");
    expect(stored.get(CALL_MODE_KEY)).toBe("turns");

    vi.resetModules();
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    const blocked = await import("./call-mode");
    expect(blocked.callMode()).toBe("turns");
    blocked.setCallMode("live");
    expect(blocked.callMode()).toBe("live");
  });
});
