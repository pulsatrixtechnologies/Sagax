// @vitest-environment happy-dom
// The Sort by prefix offer (#1442 follow-up): the banner is marked seen only
// when the sort worked or the person closed it with the x. A failed try, or a
// server without the route, leaves it. The action stays in the section menu
// and the folder menu while a [X] title remains, and a soft migration frees a
// bot whose first try had already consumed it.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Routine } from "@/lib/routines";
import { ROUTINE_PREFIX_OFFER_KEY, routinePrefixOfferAnswered, settleRoutinePrefixOffer } from "@/lib/routine-folder-prefs";

const fixture = vi.hoisted(() => ({
  state: { routinesLoadState: "ready", routineFolders: {} as Record<string, string[]>, config: {} as Record<string, unknown> },
  dispatch: vi.fn(),
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch, flushBotPatches: async () => {} }),
}));

const { RoutineFolderList } = await import("./RoutineFolders");
const { resetServerFeatures } = await import("@/lib/server-features");

const bot = { id: "bot-1", threadId: "t1", name: "Scout", title: "", description: "", notifications: false, color: "green", unread: false, messages: [] };
const routine = (id: string, name: string, folder?: string): Routine => ({
  id, name, ...(folder ? { folder } : {}), prompt: "x", target: "bot", botId: bot.id, runOn: "maus", enabled: true,
  schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] }, durationMinutes: 5, nextRunAt: null, createdAt: 0, updatedAt: 0,
} as Routine);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let host: HTMLDivElement;
let root: Root;
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const mount = async (routines: Routine[]) => {
  await act(async () => { root.render(createElement(RoutineFolderList, { bot: bot as never, routines, runs: [], grouped: true, viewerPrincipalId: null, onOpen: () => {}, onCreateIn: () => {} })); });
  await flush();
};
const offer = () => host.querySelector("[data-routine-prefix-offer]");
const stored = () => { try { return JSON.parse(localStorage.getItem(ROUTINE_PREFIX_OFFER_KEY) ?? "{}") as Record<string, unknown>; } catch { return {}; } };

beforeEach(() => {
  setLocale("en");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetServerFeatures();
  localStorage.clear();
  fixture.dispatch.mockReset();
  fixture.state.routineFolders = {};
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const prefixed = [routine("r1", "[Reports] Morning"), routine("r2", "[Reports] Weekly"), routine("r3", "Loose")];

describe("the Sort by prefix banner", () => {
  it("a failed try does not consume it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(500, { error: "boom" })));
    await mount(prefixed);
    await act(async () => { (host.querySelector("[data-routine-prefix-sort]") as HTMLButtonElement).click(); });
    await flush();
    expect(routinePrefixOfferAnswered("bot-1")).toBe(false);
    expect(offer()).not.toBeNull();
  });

  it("a server without the route does not consume it, and it is back once the server is current", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(404, { error: "no route: POST /api/routines/folders" })));
    await mount(prefixed);
    await act(async () => { (host.querySelector("[data-routine-prefix-sort]") as HTMLButtonElement).click(); });
    await flush();
    expect(stored()).toEqual({});
    expect(routinePrefixOfferAnswered("bot-1")).toBe(false);
  });

  it("a sort that worked consumes it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { folders: ["Reports"], routines: [routine("r1", "Morning", "Reports")], undo: { botId: "bot-1", folders: [], routines: [] } })));
    await mount(prefixed);
    await act(async () => { (host.querySelector("[data-routine-prefix-sort]") as HTMLButtonElement).click(); });
    await flush();
    expect(routinePrefixOfferAnswered("bot-1")).toBe(true);
    expect(offer()).toBeNull();
    expect(host.querySelector("[data-routine-folder-undo]")).not.toBeNull();
  });

  it("closing it with the x consumes it, and the action stays in the folder menu", async () => {
    fixture.state.routineFolders = { "bot-1": ["Reports"] };
    await mount([...prefixed, routine("r4", "Done", "Reports")]);
    act(() => (host.querySelector("[aria-label='Not now']") as HTMLButtonElement).click());
    expect(routinePrefixOfferAnswered("bot-1")).toBe(true);
    expect(offer()).toBeNull();
    act(() => (host.querySelector("[data-routine-folder-more]") as HTMLButtonElement).click());
    const menu = document.querySelector("[data-routine-folder-menu=folder]");
    expect(menu?.querySelector("[data-routine-folder-action=sort-by-prefix]")?.textContent).toBe("Sort by prefix");
  });

  it("the folder menu has no such action when no title starts with [X]", async () => {
    fixture.state.routineFolders = { "bot-1": ["Reports"] };
    await mount([routine("r1", "Morning", "Reports")]);
    act(() => (host.querySelector("[data-routine-folder-more]") as HTMLButtonElement).click());
    expect(document.querySelector("[data-routine-folder-action=sort-by-prefix]")).toBeNull();
  });
});

describe("the soft migration", () => {
  it("frees a bot marked seen that still has [X] titles and no folder, once", () => {
    localStorage.setItem(ROUTINE_PREFIX_OFFER_KEY, JSON.stringify({ "bot-1": true, "bot-2": true }));
    expect(settleRoutinePrefixOffer("bot-1", { loaded: true, hasPrefixTitles: true, hasFolders: false })).toBe(false);
    // the person closes it again: it is not freed a second time
    localStorage.setItem(ROUTINE_PREFIX_OFFER_KEY, JSON.stringify({ "bot-1": true }));
    expect(settleRoutinePrefixOffer("bot-1", { loaded: true, hasPrefixTitles: true, hasFolders: false })).toBe(true);
  });

  it("leaves a bot that has folders, no [X] title, or routines not loaded yet", () => {
    localStorage.setItem(ROUTINE_PREFIX_OFFER_KEY, JSON.stringify({ a: true, b: true, c: true }));
    expect(settleRoutinePrefixOffer("a", { loaded: true, hasPrefixTitles: true, hasFolders: true })).toBe(true);
    expect(settleRoutinePrefixOffer("b", { loaded: true, hasPrefixTitles: false, hasFolders: false })).toBe(true);
    expect(settleRoutinePrefixOffer("c", { loaded: false, hasPrefixTitles: true, hasFolders: false })).toBe(true);
    // c was not judged: it is freed once its routines load
    expect(settleRoutinePrefixOffer("c", { loaded: true, hasPrefixTitles: true, hasFolders: false })).toBe(false);
  });

  it("a touched bot shows the banner again on screen", async () => {
    localStorage.setItem(ROUTINE_PREFIX_OFFER_KEY, JSON.stringify({ "bot-1": true }));
    await mount(prefixed);
    expect(offer()).not.toBeNull();
  });
});
