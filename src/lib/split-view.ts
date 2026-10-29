// The split view (#1504): several conversations side by side and stacked in
// one window, like the editor groups of a code editor. The window's content
// is a tree: a leaf is a section, a split lays its children out in a row
// (side by side) or a column (stacked) with their share of the space. One
// leaf is always the main chat (the one the sidebar selection drives, with
// every window-wide part); the others each show one bot's or one group's
// conversation with their own composer (SplitWorkspace.tsx).
//
// A section is made by dragging a bot, a group or a thread row from the
// sidebar to an edge of the window (or onto a section's middle, which
// replaces what it shows), or with Split right / Split down in the
// conversation's "..." menu. A section closes from its header; the handle
// between two sections resizes them. The layout is this device's own
// (localStorage, `sagax.splitView.layout.v1`): a split depends on the
// screen it was made for, so it is not one of the person's synced
// preferences.
import { useSyncExternalStore } from "react";

/** What a section shows. Without a threadId it follows the conversation's
 * open thread; with one it stays on that thread. */
export type SplitTarget =
  | { kind: "bot"; botId: string; threadId?: string }
  | { kind: "group"; groupId: string; threadId?: string };

export type SplitLeaf = { type: "leaf"; id: string; target: SplitTarget | null };
export type SplitBranch = { type: "split"; id: string; dir: "row" | "column"; children: SplitNode[]; sizes: number[] };
export type SplitNode = SplitLeaf | SplitBranch;
/** Where a drop or a split puts the new section, beside its anchor. */
export type SplitEdge = "left" | "right" | "top" | "bottom";

/** The main chat's leaf: its target is null (it follows the selection). */
export const MAIN_LEAF_ID = "main";
export const SPLIT_LAYOUT_KEY = "sagax.splitView.layout.v1";
/** The drag payload a sidebar bot, group or thread row carries. */
export const SPLIT_DRAG_TYPE = "application/x-sagax-split";
/** The smallest share a section can be resized down to. */
export const SPLIT_MIN_SHARE = 0.12;

export const MAIN_LEAF: SplitLeaf = { type: "leaf", id: MAIN_LEAF_ID, target: null };

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function sameTarget(a: SplitTarget | null, b: SplitTarget | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind || (a.threadId ?? null) !== (b.threadId ?? null)) return false;
  return a.kind === "bot" ? a.botId === (b as { botId: string }).botId : a.groupId === (b as { groupId: string }).groupId;
}

/** Every section, the main chat's first, in reading order. */
export function splitLeaves(node: SplitNode): SplitLeaf[] {
  return node.type === "leaf" ? [node] : node.children.flatMap(splitLeaves);
}

/** Whether the window is split at all. */
export function isSplit(node: SplitNode): boolean {
  return node.type === "split";
}

const normalize = (sizes: number[]): number[] => {
  const total = sizes.reduce((sum, size) => sum + (Number.isFinite(size) && size > 0 ? size : 0), 0);
  if (total <= 0) return sizes.map(() => 1 / sizes.length);
  return sizes.map((size) => (Number.isFinite(size) && size > 0 ? size : 0) / total);
};

const dirOf = (edge: SplitEdge): "row" | "column" => (edge === "left" || edge === "right" ? "row" : "column");
const before = (edge: SplitEdge) => edge === "left" || edge === "top";

/** A split with one child is that child; a child split in the same
 * direction folds into its parent (its share divided among its children). */
function tidy(node: SplitNode): SplitNode {
  if (node.type === "leaf") return node;
  const children: SplitNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, index) => {
    const clean = tidy(child);
    const share = node.sizes[index] ?? 0;
    if (clean.type === "split" && clean.dir === node.dir) {
      clean.children.forEach((grandchild, inner) => {
        children.push(grandchild);
        sizes.push(share * (clean.sizes[inner] ?? 0));
      });
    } else {
      children.push(clean);
      sizes.push(share);
    }
  });
  if (children.length === 0) return MAIN_LEAF;
  if (children.length === 1) return children[0]!;
  return { ...node, children, sizes: normalize(sizes) };
}

/** A new section showing `target`, beside the node `anchorId` (the whole
 * window when it is the root's id or null) on `edge`. Beside a node that
 * already sits in a split of that direction, it takes half the node's share;
 * otherwise the node and the new section split its place in two. */
export function insertSection(layout: SplitNode, target: SplitTarget, edge: SplitEdge, anchorId: string | null = null): { layout: SplitNode; leafId: string } {
  const leaf: SplitLeaf = { type: "leaf", id: newId("pane"), target };
  const dir = dirOf(edge);
  const pair = (node: SplitNode): SplitBranch => ({
    type: "split",
    id: newId("split"),
    dir,
    children: before(edge) ? [leaf, node] : [node, leaf],
    sizes: [0.5, 0.5],
  });
  if (anchorId === null || anchorId === layout.id) {
    // The window's edge: a row grows by one at that end, anything else wraps.
    if (layout.type === "split" && layout.dir === dir) {
      const n = layout.children.length;
      const share = 1 / (n + 1);
      const scaled = layout.sizes.map((size) => size * (1 - share));
      return {
        leafId: leaf.id,
        layout: before(edge)
          ? { ...layout, children: [leaf, ...layout.children], sizes: [share, ...scaled] }
          : { ...layout, children: [...layout.children, leaf], sizes: [...scaled, share] },
      };
    }
    return { leafId: leaf.id, layout: pair(layout) };
  }
  const visit = (node: SplitNode): SplitNode => {
    if (node.type === "leaf") return node;
    const index = node.children.findIndex((child) => child.id === anchorId);
    if (index >= 0) {
      const anchor = node.children[index]!;
      if (node.dir === dir) {
        const half = (node.sizes[index] ?? 0) / 2;
        const children = node.children.slice();
        const sizes = node.sizes.slice();
        const at = before(edge) ? index : index + 1;
        children.splice(at, 0, leaf);
        sizes[index] = half;
        sizes.splice(at, 0, half);
        return { ...node, children, sizes };
      }
      const children = node.children.slice();
      children[index] = pair(anchor);
      return { ...node, children };
    }
    return { ...node, children: node.children.map(visit) };
  };
  if (layout.type === "leaf") return { leafId: leaf.id, layout: layout.id === anchorId ? pair(layout) : layout };
  return { leafId: leaf.id, layout: visit(layout) };
}

/** Closes a section; the main chat's never closes. */
export function removeSection(layout: SplitNode, leafId: string): SplitNode {
  if (leafId === MAIN_LEAF_ID) return layout;
  const visit = (node: SplitNode): SplitNode => {
    if (node.type === "leaf") return node;
    const keep = node.children.map((child, index) => ({ child, size: node.sizes[index] ?? 0 })).filter(({ child }) => !(child.type === "leaf" && child.id === leafId));
    return { ...node, children: keep.map(({ child }) => visit(child)), sizes: normalize(keep.map(({ size }) => size)) };
  };
  return tidy(visit(layout));
}

/** A section now shows another conversation (a drop on its middle). */
export function replaceSection(layout: SplitNode, leafId: string, target: SplitTarget): SplitNode {
  if (leafId === MAIN_LEAF_ID) return layout;
  const visit = (node: SplitNode): SplitNode =>
    node.type === "leaf" ? (node.id === leafId ? { ...node, target } : node) : { ...node, children: node.children.map(visit) };
  return visit(layout);
}

/** Moves the line between child `index` and `index + 1` of split `splitId`
 * by `delta` (a share of that split's length), each side kept at least
 * SPLIT_MIN_SHARE. */
export function resizeSplit(layout: SplitNode, splitId: string, index: number, delta: number): SplitNode {
  const visit = (node: SplitNode): SplitNode => {
    if (node.type === "leaf") return node;
    if (node.id !== splitId) return { ...node, children: node.children.map(visit) };
    const a = node.sizes[index];
    const b = node.sizes[index + 1];
    if (a === undefined || b === undefined) return node;
    const pairTotal = a + b;
    const min = Math.min(SPLIT_MIN_SHARE, pairTotal / 2);
    const nextA = Math.min(pairTotal - min, Math.max(min, a + delta));
    const sizes = node.sizes.slice();
    sizes[index] = nextA;
    sizes[index + 1] = pairTotal - nextA;
    return { ...node, sizes };
  };
  return visit(layout);
}

const validTarget = (value: unknown): value is SplitTarget => {
  if (!value || typeof value !== "object") return false;
  const target = value as Record<string, unknown>;
  if (target.threadId !== undefined && typeof target.threadId !== "string") return false;
  if (target.kind === "bot") return typeof target.botId === "string" && target.botId.length > 0;
  if (target.kind === "group") return typeof target.groupId === "string" && target.groupId.length > 0;
  return false;
};

/** A stored layout, or null when it is not one (an older or damaged copy).
 * It must hold the main chat's leaf exactly once. */
export function parseSplitLayout(raw: string | null): SplitNode | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  let mains = 0;
  const ids = new Set<string>();
  const read = (node: unknown, depth: number): SplitNode | null => {
    if (!node || typeof node !== "object" || depth > 12) return null;
    const n = node as Record<string, unknown>;
    if (typeof n.id !== "string" || ids.has(n.id)) return null;
    ids.add(n.id);
    if (n.type === "leaf") {
      if (n.id === MAIN_LEAF_ID) {
        mains += 1;
        return MAIN_LEAF;
      }
      if (!validTarget(n.target)) return null;
      const target = n.target;
      return { type: "leaf", id: n.id, target: target.kind === "bot"
        ? { kind: "bot", botId: target.botId, ...(target.threadId ? { threadId: target.threadId } : {}) }
        : { kind: "group", groupId: target.groupId, ...(target.threadId ? { threadId: target.threadId } : {}) } };
    }
    if (n.type !== "split" || (n.dir !== "row" && n.dir !== "column") || !Array.isArray(n.children) || !Array.isArray(n.sizes)) return null;
    if (n.children.length !== n.sizes.length || n.children.length < 2) return null;
    const children: SplitNode[] = [];
    for (const child of n.children) {
      const parsed = read(child, depth + 1);
      if (!parsed) return null;
      children.push(parsed);
    }
    const sizes = (n.sizes as unknown[]).map((size) => (typeof size === "number" ? size : 0));
    return { type: "split", id: n.id, dir: n.dir, children, sizes: normalize(sizes) };
  };
  const layout = read(value, 0);
  return layout && mains === 1 ? tidy(layout) : null;
}

/** The drag payload of a sidebar row: a bot, a group, or one thread of
 * either (ownerId is the bot's or the group's id, told apart on drop). */
export type SplitDrag = { kind: "bot" | "group"; id: string } | { kind: "thread"; ownerId: string; threadId: string };

export function splitDragData(drag: SplitDrag): string {
  return JSON.stringify(drag);
}

export function parseSplitDrag(raw: string): SplitDrag | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if ((value.kind === "bot" || value.kind === "group") && typeof value.id === "string" && value.id) return { kind: value.kind, id: value.id };
    if (value.kind === "thread" && typeof value.ownerId === "string" && value.ownerId && typeof value.threadId === "string" && value.threadId) {
      return { kind: "thread", ownerId: value.ownerId, threadId: value.threadId };
    }
  } catch {
    /* not ours */
  }
  return null;
}

/** What a dragged row shows in a section, given the bots and groups known. */
export function dragTarget(drag: SplitDrag, known: { bots: ReadonlyArray<{ id: string }>; groups: ReadonlyArray<{ id: string }> }): SplitTarget | null {
  if (drag.kind !== "thread") {
    if (drag.kind === "bot") return known.bots.some((bot) => bot.id === drag.id) ? { kind: "bot", botId: drag.id } : null;
    return known.groups.some((group) => group.id === drag.id) ? { kind: "group", groupId: drag.id } : null;
  }
  if (known.bots.some((bot) => bot.id === drag.ownerId)) return { kind: "bot", botId: drag.ownerId, threadId: drag.threadId };
  if (known.groups.some((group) => group.id === drag.ownerId)) return { kind: "group", groupId: drag.ownerId, threadId: drag.threadId };
  return null;
}

/** The edge of a box a point is nearest, when it is within `band` (a share
 * of the box's width or height) of it; null in the middle. */
export function edgeAt(point: { x: number; y: number }, box: { left: number; top: number; width: number; height: number }, band = 0.25): SplitEdge | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const fx = (point.x - box.left) / box.width;
  const fy = (point.y - box.top) / box.height;
  const candidates: Array<[SplitEdge, number]> = [["left", fx], ["right", 1 - fx], ["top", fy], ["bottom", 1 - fy]];
  const [edge, distance] = candidates.reduce((best, next) => (next[1] < best[1] ? next : best));
  return distance <= band ? edge : null;
}

// ── this window's layout (a module store, remembered on this device) ──

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

const storage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

function readStored(): SplitNode {
  try {
    return parseSplitLayout(storage()?.getItem(SPLIT_LAYOUT_KEY) ?? null) ?? MAIN_LEAF;
  } catch {
    return MAIN_LEAF;
  }
}

let current: SplitNode | null = null;
const listeners = new Set<() => void>();

export function currentSplitLayout(): SplitNode {
  if (current === null) current = readStored();
  return current;
}

/** Sets this window's layout and remembers it on this device. */
export function setSplitLayout(next: SplitNode): void {
  const layout = tidy(next);
  current = layout;
  try {
    const store = storage();
    if (layout.type === "leaf") store?.removeItem(SPLIT_LAYOUT_KEY);
    else store?.setItem(SPLIT_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    /* this session only */
  }
  for (const listener of listeners) listener();
}

export function updateSplitLayout(change: (layout: SplitNode) => SplitNode): void {
  setSplitLayout(change(currentSplitLayout()));
}

/** Split right / Split down from the main chat's "..." menu: the
 * conversation in a new section beside the main chat. */
export function splitBesideMain(target: SplitTarget, edge: SplitEdge): void {
  updateSplitLayout((layout) => insertSection(layout, target, edge, MAIN_LEAF_ID).layout);
}

/** Forgets the stored layout (tests). */
export function resetSplitLayout(): void {
  current = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSplitLayout(): SplitNode {
  return useSyncExternalStore(subscribe, currentSplitLayout, currentSplitLayout);
}
