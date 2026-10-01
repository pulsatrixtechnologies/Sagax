import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  floatBot,
  floatingBotPrefs,
  floatingBots,
  isBotFloating,
  MAX_FLOATING_BOTS,
  nextLiveliness,
  readFloatingBotPrefs,
  readFloatingBots,
  resetFloatingBotsForTests,
  setFloatingFlyAway,
  setFloatingLiveliness,
  setFloatingBotOnTop,
  setFloatingBotPosition,
  subscribeFloatingBots,
  unfloatBot,
  type FloatingStorage,
} from "./floating-bots";

const here = dirname(fileURLToPath(import.meta.url));

function memoryStorage(): FloatingStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

beforeEach(() => resetFloatingBotsForTests());

describe("floating bots: the per-device list", () => {
  it("floats a bot once, remembers it, and takes it back", () => {
    const storage = memoryStorage();
    let changes = 0;
    subscribeFloatingBots(() => (changes += 1));
    expect(floatBot("bot_a", storage)).toBe(true);
    expect(floatBot("bot_a", storage)).toBe(true);
    expect(floatingBots()).toEqual([{ id: "bot_a", top: true }]);
    expect(isBotFloating("bot_a")).toBe(true);
    expect(readFloatingBots(storage)).toEqual([{ id: "bot_a", top: true }]);
    unfloatBot("bot_a", storage);
    expect(isBotFloating("bot_a")).toBe(false);
    expect(readFloatingBots(storage)).toEqual([]);
    expect(changes).toBe(2);
  });

  it("keeps several bots, their always-on-top choice and their in-app spot", () => {
    const storage = memoryStorage();
    floatBot("bot_a", storage);
    floatBot("bot_b", storage);
    setFloatingBotOnTop("bot_b", false, storage);
    setFloatingBotPosition("bot_a", { right: 40, bottom: 120 }, storage);
    setFloatingBotPosition("bot_a", { right: Number.NaN, bottom: 1 }, storage);
    expect(readFloatingBots(storage)).toEqual([
      { id: "bot_a", top: true, pos: { right: 40, bottom: 120 } },
      { id: "bot_b", top: false },
    ]);
  });

  it("refuses a bad id and caps how many bots float", () => {
    const storage = memoryStorage();
    expect(floatBot("../evil", storage)).toBe(false);
    for (let i = 0; i < MAX_FLOATING_BOTS; i += 1) expect(floatBot(`bot_${i}`, storage)).toBe(true);
    expect(floatBot("bot_extra", storage)).toBe(false);
    expect(floatingBots()).toHaveLength(MAX_FLOATING_BOTS);
  });

  it("reads back only well-formed entries, once each", () => {
    const storage = memoryStorage();
    storage.setItem("omb.floatingBots.v1", JSON.stringify({
      bots: [
        { id: "bot_a", top: false, pos: { right: 10, bottom: "x" } },
        { id: "bot_a" },
        { id: "no spaces allowed" },
        null,
        { id: "bot_b", pos: { right: 5, bottom: 6 } },
      ],
    }));
    expect(readFloatingBots(storage)).toEqual([
      { id: "bot_a", top: false },
      { id: "bot_b", top: true, pos: { right: 5, bottom: 6 } },
    ]);
    storage.setItem("omb.floatingBots.v1", "{not json");
    expect(readFloatingBots(storage)).toEqual([]);
    expect(readFloatingBots(undefined)).toEqual([]);
  });

  it("keeps the brain and the drawings out of the eager bundle", () => {
    const eager = [
      readFileSync(join(here, "floating-bots.ts"), "utf8"),
      readFileSync(join(here, "../components/FloatingBotsHost.tsx"), "utf8"),
      readFileSync(join(here, "../components/Sidebar.tsx"), "utf8"),
      readFileSync(join(here, "../App.tsx"), "utf8"),
    ].join("\n");
    const staticImports = [...eager.matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map(([, from]) => from);
    expect(staticImports.some((from) => from.includes("floating-bots/"))).toBe(false);
    expect(eager).toContain('import("@/components/floating-bots/FloatingBots")');
  });
});

describe("floating bots: the fly-away setting", () => {
  it("is on by default and survives a reload once switched off", () => {
    const storage = memoryStorage();
    expect(readFloatingBotPrefs(storage)).toEqual({ flyAway: true, liveliness: "normal" });
    let changes = 0;
    subscribeFloatingBots(() => (changes += 1));
    setFloatingFlyAway(false, storage);
    setFloatingFlyAway(false, storage);
    expect(floatingBotPrefs().flyAway).toBe(false);
    expect(changes).toBe(1);
    expect(readFloatingBotPrefs(storage)).toEqual({ flyAway: false, liveliness: "normal" });
    setFloatingFlyAway(true, storage);
    expect(readFloatingBotPrefs(storage)).toEqual({ flyAway: true, liveliness: "normal" });
  });

  it("reads a broken or missing record as the default", () => {
    const storage = memoryStorage();
    storage.setItem("omb.floatingBots.prefs.v1", "{nope");
    expect(readFloatingBotPrefs(storage)).toEqual({ flyAway: true, liveliness: "normal" });
    storage.setItem("omb.floatingBots.prefs.v1", JSON.stringify({ flyAway: "no" }));
    expect(readFloatingBotPrefs(storage)).toEqual({ flyAway: true, liveliness: "normal" });
    expect(readFloatingBotPrefs(undefined)).toEqual({ flyAway: true, liveliness: "normal" });
  });

  it("keeps an activity level, cycled by the menu, and ignores an unknown one", () => {
    const storage = memoryStorage();
    setFloatingLiveliness("lively", storage);
    expect(readFloatingBotPrefs(storage)).toEqual({ flyAway: true, liveliness: "lively" });
    setFloatingLiveliness("wild" as never, storage);
    expect(readFloatingBotPrefs(storage).liveliness).toBe("lively");
    expect(nextLiveliness("calm")).toBe("normal");
    expect(nextLiveliness("lively")).toBe("calm");
  });

  it("keeps three.js out of every chunk but the floating mascot's", () => {
    const settings = readFileSync(join(here, "../components/SettingsModal.tsx"), "utf8");
    expect(settings).not.toMatch(/from\s+"three"/);
    expect(settings).not.toMatch(/from\s+"@\/components\/floating-bots\//);
    const view = readFileSync(join(here, "../components/floating-bots/FloatingBotView.tsx"), "utf8");
    expect(view).not.toMatch(/from\s+"three"/);
    expect(view).not.toMatch(/from\s+"\.\/owl3d\//);
    const registry = readFileSync(join(here, "../components/floating-bots/mascots.tsx"), "utf8");
    expect(registry).not.toMatch(/from\s+"three"/);
    expect(registry).toContain('import("./owl3d/Owl3D")');
  });
});
