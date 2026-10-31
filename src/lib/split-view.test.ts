// The split view (#1504): the layout tree, its edits, the stored copy and
// the drag payload of a sidebar row.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentSplitLayout,
  dragTarget,
  edgeAt,
  currentSplitLeafFocus,
  ensureSection,
  findSection,
  focusSplitLeaf,
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

  it("finds the section that already shows a target (#1781)", () => {
    const first = insertSection(MAIN_LEAF, scout, "right");
    const second = insertSection(first.layout, room, "bottom", first.leafId);
    expect(findSection(second.layout, scout)?.id).toBe(first.leafId);
    expect(findSection(second.layout, room)?.id).toBe(second.leafId);
    expect(findSection(second.layout, pepper)).toBeUndefined();
    // A different thread of the same bot is another conversation.
    expect(findSection(second.layout, { kind: "bot", botId: "scout", threadId: "other" })).toBeUndefined();
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

    it("focuses an existing section instead of opening a copy (#1781)", () => {
      const first = ensureSection(scout, "right");
      expect(shape(currentSplitLayout())).toEqual({ row: ["main", "scout"], sizes: [0.5, 0.5] });
      expect(currentSplitLeafFocus()).toEqual({ leafId: first, nonce: 1 });
      // Split right / down again, or a drop asking for the same bot: focus only.
      expect(ensureSection(scout, "bottom")).toBe(first);
      expect(ensureSection(scout, "right")).toBe(first);
      expect(shape(currentSplitLayout())).toEqual({ row: ["main", "scout"], sizes: [0.5, 0.5] });
      expect(currentSplitLeafFocus().nonce).toBe(3);
      splitBesideMain(scout, "bottom");
      expect(shape(currentSplitLayout())).toEqual({ row: ["main", "scout"], sizes: [0.5, 0.5] });
      // A different conversation still opens a new section (beside main).
      const roomId = ensureSection(room, "bottom");
      expect(roomId).not.toBe(first);
      expect(shape(currentSplitLayout())).toEqual({ row: [{ column: ["main", "room"], sizes: [0.5, 0.5] }, "scout"], sizes: [0.5, 0.5] });
      focusSplitLeaf(first);
      expect(currentSplitLeafFocus().leafId).toBe(first);
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
