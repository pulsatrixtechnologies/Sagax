// The split view (#1504): the layout tree, its edits, the stored copy and
// the drag payload of a sidebar row.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentSplitLayout,
  dragTarget,
  edgeAt,
  insertSection,
  MAIN_LEAF,
  MAIN_LEAF_ID,
  parseSplitDrag,
  parseSplitLayout,
  removeSection,
  replaceSection,
  resetSplitLayout,
  resizeSplit,
  setSplitLayout,
  splitBesideMain,
  splitDragData,
  splitLeafPanelSide,
  splitLeaves,
  SPLIT_LAYOUT_KEY,
  SPLIT_MIN_SHARE,
  type SplitNode,
} from "./split-view";

const scout = { kind: "bot" as const, botId: "scout" };
const pepper = { kind: "bot" as const, botId: "pepper", threadId: "t-1" };
const room = { kind: "group" as const, groupId: "room" };

const shape = (node: SplitNode): unknown =>
  node.type === "leaf"
    ? node.id === MAIN_LEAF_ID ? "main" : node.target && (node.target.kind === "bot" ? node.target.botId : node.target.groupId)
    : { [node.dir]: node.children.map(shape), sizes: node.sizes.map((size) => Math.round(size * 100) / 100) };

describe("the layout tree", () => {
  it("splits the window at an edge, and a row grows at its ends", () => {
    let layout: SplitNode = MAIN_LEAF;
    layout = insertSection(layout, scout, "right").layout;
    expect(shape(layout)).toEqual({ row: ["main", "scout"], sizes: [0.5, 0.5] });
    layout = insertSection(layout, room, "left").layout;
    expect(shape(layout)).toEqual({ row: ["room", "main", "scout"], sizes: [0.33, 0.33, 0.33] });
    layout = insertSection(layout, pepper, "bottom").layout;
    expect(shape(layout)).toEqual({ column: [{ row: ["room", "main", "scout"], sizes: [0.33, 0.33, 0.33] }, "pepper"], sizes: [0.5, 0.5] });
  });

  it("splits one section beside itself: half its share in a row of that direction, a new split otherwise", () => {
    const first = insertSection(MAIN_LEAF, scout, "right");
    const beside = insertSection(first.layout, room, "right", first.leafId);
    expect(shape(beside.layout)).toEqual({ row: ["main", "scout", "room"], sizes: [0.5, 0.25, 0.25] });
    const stacked = insertSection(first.layout, room, "bottom", first.leafId);
    expect(shape(stacked.layout)).toEqual({ row: ["main", { column: ["scout", "room"], sizes: [0.5, 0.5] }], sizes: [0.5, 0.5] });
    const besideMain = insertSection(first.layout, pepper, "left", MAIN_LEAF_ID);
    expect(shape(besideMain.layout)).toEqual({ row: ["pepper", "main", "scout"], sizes: [0.25, 0.25, 0.5] });
  });

  it("closes a section and folds what is left; the main chat never closes", () => {
    const first = insertSection(MAIN_LEAF, scout, "right");
    const second = insertSection(first.layout, room, "bottom", first.leafId);
    const closed = removeSection(second.layout, second.leafId);
    expect(shape(closed)).toEqual({ row: ["main", "scout"], sizes: [0.5, 0.5] });
    expect(removeSection(closed, first.leafId)).toEqual(MAIN_LEAF);
    expect(removeSection(closed, MAIN_LEAF_ID)).toBe(closed);
  });

  it("folds a split of the same direction into its parent when a section between them closes", () => {
    const a = insertSection(MAIN_LEAF, scout, "right");
    const b = insertSection(a.layout, room, "bottom", a.leafId);
    const c = insertSection(b.layout, pepper, "right", b.leafId);
    const closed = removeSection(c.layout, a.leafId);
    expect(shape(closed)).toEqual({ row: ["main", "room", "pepper"], sizes: [0.5, 0.25, 0.25] });
  });

  it("replaces what a section shows, never the main chat", () => {
    const first = insertSection(MAIN_LEAF, scout, "right");
    expect(shape(replaceSection(first.layout, first.leafId, room))).toEqual({ row: ["main", "room"], sizes: [0.5, 0.5] });
    expect(replaceSection(first.layout, MAIN_LEAF_ID, room)).toEqual(first.layout);
  });

  it("resizes two neighbours, each kept at its smallest share", () => {
    const { layout } = insertSection(MAIN_LEAF, scout, "right");
    const id = layout.id;
    expect(shape(resizeSplit(layout, id, 0, 0.2))).toEqual({ row: ["main", "scout"], sizes: [0.7, 0.3] });
    const squeezed = resizeSplit(layout, id, 0, 5);
    expect(squeezed.type === "split" && squeezed.sizes[1]).toBeCloseTo(SPLIT_MIN_SHARE);
  });

  it("lists every section, the main chat's included", () => {
    const { layout } = insertSection(MAIN_LEAF, scout, "top");
    expect(splitLeaves(layout).map((leaf) => leaf.id)[1]).toBe(MAIN_LEAF_ID);
  });
});

describe("the stored layout", () => {
  it("reads back what it wrote, and refuses a copy without exactly one main chat", () => {
    const { layout } = insertSection(MAIN_LEAF, pepper, "right");
    expect(parseSplitLayout(JSON.stringify(layout))).toEqual(layout);
    expect(parseSplitLayout(null)).toBeNull();
    expect(parseSplitLayout("{")).toBeNull();
    expect(parseSplitLayout(JSON.stringify({ type: "split", id: "s", dir: "row", children: [{ type: "leaf", id: "a", target: scout }, { type: "leaf", id: "b", target: room }], sizes: [1, 1] }))).toBeNull();
    expect(parseSplitLayout(JSON.stringify({ type: "split", id: "s", dir: "row", children: [MAIN_LEAF, { type: "leaf", id: "b", target: { kind: "nope" } }], sizes: [1, 1] }))).toBeNull();
  });

  describe("on this device", () => {
    const stored = new Map<string, string>();
    beforeEach(() => {
      stored.clear();
      vi.stubGlobal("localStorage", {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => void stored.set(key, value),
        removeItem: (key: string) => void stored.delete(key),
      });
      resetSplitLayout();
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      resetSplitLayout();
    });

    it("remembers a split and forgets it once the window is whole again", () => {
      splitBesideMain(scout, "right");
      expect(stored.has(SPLIT_LAYOUT_KEY)).toBe(true);
      resetSplitLayout();
      expect(shape(currentSplitLayout())).toEqual({ row: ["main", "scout"], sizes: [0.5, 0.5] });
      setSplitLayout(MAIN_LEAF);
      expect(stored.has(SPLIT_LAYOUT_KEY)).toBe(false);
    });

    it("opens whole when storage refuses", () => {
      vi.stubGlobal("localStorage", { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => {} });
      resetSplitLayout();
      expect(currentSplitLayout()).toEqual(MAIN_LEAF);
      expect(() => splitBesideMain(scout, "bottom")).not.toThrow();
      expect(shape(currentSplitLayout())).toEqual({ column: ["main", "scout"], sizes: [0.5, 0.5] });
    });
  });
});

describe("a sidebar row dragged into the window", () => {
  const known = { bots: [{ id: "scout" }], groups: [{ id: "room" }] };

  it("carries a bot, a group or one thread of either", () => {
    expect(dragTarget(parseSplitDrag(splitDragData({ kind: "bot", id: "scout" }))!, known)).toEqual(scout);
    expect(dragTarget(parseSplitDrag(splitDragData({ kind: "group", id: "room" }))!, known)).toEqual(room);
    expect(dragTarget(parseSplitDrag(splitDragData({ kind: "thread", ownerId: "scout", threadId: "t-9" }))!, known)).toEqual({ kind: "bot", botId: "scout", threadId: "t-9" });
    expect(dragTarget(parseSplitDrag(splitDragData({ kind: "thread", ownerId: "room", threadId: "t-2" }))!, known)).toEqual({ kind: "group", groupId: "room", threadId: "t-2" });
    expect(dragTarget({ kind: "bot", id: "gone" }, known)).toBeNull();
    expect(parseSplitDrag("nope")).toBeNull();
  });

  it("lands on the nearest edge, or in the middle", () => {
    const box = { left: 0, top: 0, width: 400, height: 200 };
    expect(edgeAt({ x: 10, y: 100 }, box)).toBe("left");
    expect(edgeAt({ x: 395, y: 100 }, box)).toBe("right");
    expect(edgeAt({ x: 200, y: 5 }, box)).toBe("top");
    expect(edgeAt({ x: 200, y: 190 }, box)).toBe("bottom");
    expect(edgeAt({ x: 200, y: 100 }, box)).toBeNull();
  });
});

describe("the side a section's bot panel opens on", () => {
  it("docks to the window edge nearest the section, the right one on a tie", () => {
    const left = insertSection(MAIN_LEAF, scout, "left");
    expect(splitLeafPanelSide(left.layout, left.leafId)).toBe("left");
    expect(splitLeafPanelSide(left.layout, MAIN_LEAF_ID)).toBe("right");
    const right = insertSection(MAIN_LEAF, scout, "right");
    expect(splitLeafPanelSide(right.layout, right.leafId)).toBe("right");
    // Three in a row: the middle one sits on the window's middle, right.
    const three = insertSection(left.layout, pepper, "right");
    expect(splitLeafPanelSide(three.layout, left.leafId)).toBe("left");
    expect(splitLeafPanelSide(three.layout, MAIN_LEAF_ID)).toBe("right");
    expect(splitLeafPanelSide(three.layout, three.leafId)).toBe("right");
    // Stacked over the whole width: the usual right edge.
    const below = insertSection(MAIN_LEAF, room, "bottom");
    expect(splitLeafPanelSide(below.layout, below.leafId)).toBe("right");
    // Inside a column on the left half: still the left edge.
    const nested = insertSection(left.layout, room, "bottom", left.leafId);
    expect(splitLeafPanelSide(nested.layout, nested.leafId)).toBe("left");
    expect(splitLeafPanelSide(nested.layout, "gone")).toBeNull();
  });
});
