import { beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "./i18n";
import {
  buildPaletteSections,
  latestGoalRun,
  loadPaletteRecents,
  paletteCategoryLabel,
  PALETTE_GROUP_ORDER,
  PALETTE_RECENTS_KEY,
  rememberPaletteRecent,
  type PaletteContext,
} from "./palette-commands";
import type { Bot, Group, Message } from "@/state/store";

const bot = (id: string, name: string, title?: string) => ({ id, name, title }) as unknown as Bot;
const room = (id: string, name: string, messages: Message[] = []) =>
  ({ id, name, threadId: `t-${id}`, messages }) as unknown as Group;

function context(overrides: Partial<PaletteContext> = {}): PaletteContext {
  return {
    bots: [bot("b1", "Momo", "Support"), bot("b2", "Moss")],
    groups: [room("g1", "Launch room")],
    query: "",
    messageHits: [],
    recents: [],
    isMac: true,
    desktop: true,
    canCreateBots: true,
    advanced: true,
    ...overrides,
  };
}

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

beforeEach(() => {
  setLocale("en");
});

describe("buildPaletteSections", () => {
  it("lists the groups in the fixed order with no query", () => {
    const sections = buildPaletteSections(context());
    expect(sections.map((section) => section.group)).toEqual(["conversations", "bots", "navigation", "settings", "help"]);
    const order = sections.map((section) => PALETTE_GROUP_ORDER.indexOf(section.group));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("puts recent items first and takes them out of their own group", () => {
    const sections = buildPaletteSections(context({ recents: ["settings:appearance", "bot:b2", "gone:item"] }));
    expect(sections[0]!.group).toBe("recent");
    expect(sections[0]!.items.map((item) => item.id)).toEqual(["settings:appearance", "bot:b2"]);
    const bots = sections.find((section) => section.group === "bots")!;
    expect(bots.items.map((item) => item.id)).toEqual(["bot:b1"]);
    expect(paletteCategoryLabel(sections[0]!.items[0]!)).toBe("Settings: Appearance");
  });

  it("gives the first nine bots their roster shortcut and commands theirs", () => {
    const sections = buildPaletteSections(context({ isMac: false }));
    const bots = sections.find((section) => section.group === "bots")!;
    expect(bots.items.map((item) => item.shortcut)).toEqual([["Ctrl", "1"], ["Ctrl", "2"]]);
    const nav = sections.find((section) => section.group === "navigation")!;
    expect(nav.items[0]).toMatchObject({ id: "cmd:newConversation", shortcut: ["Ctrl", "N"] });
  });

  it("keeps the groups while searching, fuzzy and accent-folded", () => {
    const sections = buildPaletteSections(context({ query: "mom" }));
    expect(sections.map((section) => section.group)).toEqual(["bots"]);
    const searched = buildPaletteSections(context({ query: "kbd", recents: ["help:shortcuts"] }));
    // no query-less Recent group while searching
    expect(searched.map((section) => section.group)).toEqual(["help"]);
    expect(searched[0]!.items[0]!.id).toBe("help:shortcuts");
    setLocale("fr");
    const french = buildPaletteSections(context({ query: "reglages" }));
    expect(french.find((section) => section.group === "settings")?.label).toBe("Réglages");
  });

  it("shows transcript hits under Messages only for a query", () => {
    const hit = { name: "Momo", threadId: "t1", messageId: "m1", snippet: "hello", matchStart: 0, matchLength: 5 } as never;
    expect(buildPaletteSections(context({ messageHits: [hit] })).some((s) => s.group === "messages")).toBe(false);
    const sections = buildPaletteSections(context({ query: "hello", messageHits: [hit] }));
    expect(sections.map((section) => section.group)).toEqual(["messages"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(buildPaletteSections(context({ query: "zzzzqqq" }))).toEqual([]);
  });

  it("leaves out what the person cannot use here", () => {
    const ids = buildPaletteSections(context({ canCreateBots: false, advanced: false, desktop: false }))
      .flatMap((section) => section.items.map((item) => item.id));
    expect(ids).not.toContain("cmd:newBot");
    expect(ids).not.toContain("cmd:connectApps");
    expect(ids).not.toContain("settings:updates");
    const settings = buildPaletteSections(context({ desktop: false })).find((s) => s.group === "settings")!;
    expect(settings.items[0]!.shortcut).toBeUndefined();
  });

  it("offers the current bot's settings", () => {
    const settings = buildPaletteSections(context({ currentBotId: "b1" })).find((s) => s.group === "settings")!;
    expect(settings.items.at(-1)).toMatchObject({ label: "Momo settings", action: { kind: "botSettings", botId: "b1" } });
  });
});

describe("Goal group", () => {
  const goalMessage = (status: string) =>
    ({ id: "goal-1", kind: "goal.run", goalRun: { status, goal: "Ship it" } }) as unknown as Message;

  it("only starts a goal when the channel has none yet", () => {
    const sections = buildPaletteSections(context({ goal: { groupId: "g1", threadId: "t-g1" } }));
    const goal = sections.find((section) => section.group === "goal")!;
    expect(goal.items.map((item) => item.id)).toEqual(["goal:start"]);
  });

  it("adds status for the newest card and stop while it works", () => {
    const working = room("g1", "Launch", [goalMessage("completed"), goalMessage("working")]);
    const latest = latestGoalRun(working);
    expect(latest).toEqual({ messageId: "goal-1", status: "working", goal: "Ship it" });
    const goal = buildPaletteSections(context({ goal: { groupId: "g1", threadId: "t-g1", latest } }))
      .find((section) => section.group === "goal")!;
    expect(goal.items.map((item) => item.id)).toEqual(["goal:start", "goal:status", "goal:stop"]);
    const done = buildPaletteSections(context({ goal: { groupId: "g1", threadId: "t-g1", latest: { ...latest!, status: "completed" } } }))
      .find((section) => section.group === "goal")!;
    expect(done.items.map((item) => item.id)).toEqual(["goal:start", "goal:status"]);
  });

  it("is absent outside a channel", () => {
    expect(buildPaletteSections(context()).some((section) => section.group === "goal")).toBe(false);
  });
});

describe("palette recents", () => {
  it("keeps the newest five, without duplicates or one-off rows", () => {
    const store = memoryStore();
    for (const id of ["a", "b", "c", "d", "e", "f", "c"]) rememberPaletteRecent(id, store);
    expect(loadPaletteRecents(store)).toEqual(["c", "f", "e", "d", "b"]);
    rememberPaletteRecent("msg:t1:m1", store);
    rememberPaletteRecent("goal:stop", store);
    expect(loadPaletteRecents(store)[0]).toBe("c");
  });

  it("survives broken or missing storage", () => {
    const store = memoryStore();
    store.data.set(PALETTE_RECENTS_KEY, "{not json");
    expect(loadPaletteRecents(store)).toEqual([]);
    expect(loadPaletteRecents(null)).toEqual([]);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadPaletteRecents(throwing)).toEqual([]);
    // the open palette still shows it; nothing is kept for next time
    expect(rememberPaletteRecent("a", throwing)).toEqual(["a"]);
  });
});
