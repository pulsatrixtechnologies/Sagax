import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_PREFERENCE_KEYS } from "../../shared/user-preferences";
import {
  DEFAULT_SIDEBAR_HIDDEN,
  SIDEBAR_HIDDEN_KEY,
  entriesToUnhide,
  hiddenKey,
  hideFromSidebar,
  parseSidebarHidden,
  readSidebarHidden,
  serializeSidebarHidden,
  setUnhideOnMessage,
  showInSidebar,
  withHidden,
  withoutHidden,
} from "./sidebar-hidden";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

describe("sidebar hidden entries", () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("travels with the person's synced preferences on an organization server", () => {
    expect(USER_PREFERENCE_KEYS).toContain(SIDEBAR_HIDDEN_KEY);
  });

  it("defaults to nothing hidden, people coming back on a new message and bots not", () => {
    expect(parseSidebarHidden(null)).toEqual({ items: [], unhideOnMessage: { people: true, bots: false } });
    expect(parseSidebarHidden("{not json")).toBe(DEFAULT_SIDEBAR_HIDDEN);
    expect(parseSidebarHidden(JSON.stringify({ items: "x" })).items).toEqual([]);
  });

  it("hides and shows back one entry by kind and id, people by lowercased principal", () => {
    let prefs = withHidden(DEFAULT_SIDEBAR_HIDDEN, "bot", "maya", 10);
    prefs = withHidden(prefs, "person", "PR_Ada", 11);
    prefs = withHidden(prefs, "bot", "maya", 12);
    expect(prefs.items).toEqual([{ kind: "person", id: "pr_ada", at: 11 }, { kind: "bot", id: "maya", at: 12 }]);
    expect(withoutHidden(prefs, [hiddenKey("person", "pr_ada")]).items).toEqual([{ kind: "bot", id: "maya", at: 12 }]);
    expect(parseSidebarHidden(serializeSidebarHidden(prefs))).toEqual(prefs);
  });

  it("persists in localStorage and reads back after a reload", () => {
    hideFromSidebar("group", "g1", 100);
    hideFromSidebar("person", "pr_ada", 101);
    const stored = JSON.parse(storage.map.get(SIDEBAR_HIDDEN_KEY)!);
    expect(stored.items).toHaveLength(2);
    expect(readSidebarHidden().items.map((item) => hiddenKey(item.kind, item.id))).toEqual(["group:g1", "person:pr_ada"]);
    showInSidebar("group:g1");
    expect(readSidebarHidden().items).toEqual([{ kind: "person", id: "pr_ada", at: 101 }]);
    setUnhideOnMessage("bots", true);
    expect(parseSidebarHidden(storage.map.get(SIDEBAR_HIDDEN_KEY)).unhideOnMessage).toEqual({ people: true, bots: true });
  });

  it("brings back people on a new unread message, bots only when asked", () => {
    let prefs = withHidden(DEFAULT_SIDEBAR_HIDDEN, "bot", "maya", 100);
    prefs = withHidden(prefs, "person", "pr_ada", 100);
    prefs = withHidden(prefs, "group", "ops", 100);
    const fresh = { unread: true, messages: [{ at: 200 }] };
    const old = { unread: true, messages: [{ at: 50 }] };
    const input = {
      bots: [{ id: "maya", ...fresh }],
      groups: [{ id: "ops", ...old }],
      personGroup: (id: string) => (id === "pr_ada" ? { id: "dm", ...fresh } : undefined),
    };
    expect(entriesToUnhide(prefs, input)).toEqual(["person:pr_ada"]);
    expect(entriesToUnhide({ ...prefs, unhideOnMessage: { people: false, bots: true } }, input)).toEqual(["bot:maya"]);
    // read already: stays hidden
    expect(entriesToUnhide(prefs, { ...input, personGroup: () => ({ id: "dm", ...fresh, unread: false }) })).toEqual([]);
  });
});
