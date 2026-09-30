import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bindHoverIntent, createHoverIntent } from "./sidebar-hover-intent";

function setup({ pinned = false, enabled = true } = {}) {
  const state = { open: false, pinned, enabled };
  const intent = createHoverIntent({
    openDelayMs: 80,
    closeDelayMs: 250,
    active: () => state.enabled && !state.pinned,
    setOpen: (open) => {
      state.open = open;
    },
  });
  return { state, intent };
}

describe("sidebar hover intent", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // The failure path seen in the desktop app: a modal opened from the Tools
  // menu closes while the pointer rests on the pill. Blink then sends a
  // pointerover whose relatedTarget is a React-managed parent and no
  // pointerout, which React's synthetic onPointerEnter never reports; only
  // the native pointerenter reaches the root. That native event alone must
  // open the menu.
  it("opens from a lone native pointerenter, with no pointerout/pointerover pair", () => {
    const { state, intent } = setup();
    const root = new EventTarget();
    const unbind = bindHoverIntent(root, intent);

    root.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(79);
    expect(state.open).toBe(false);
    vi.advanceTimersByTime(1);
    expect(state.open).toBe(true);

    unbind();
  });

  it("keeps a grace period on leave, and re-entering cancels the close", () => {
    const { state, intent } = setup();
    const root = new EventTarget();
    bindHoverIntent(root, intent);

    root.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(80);
    root.dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(200);
    expect(state.open).toBe(true);
    root.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(1000);
    expect(state.open).toBe(true);

    root.dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(250);
    expect(state.open).toBe(false);
  });

  it("does nothing while pinned by a click or when hover is off", () => {
    const pinned = setup({ pinned: true });
    pinned.state.open = true;
    pinned.intent.leave();
    vi.advanceTimersByTime(1000);
    expect(pinned.state.open).toBe(true);

    const clickOnly = setup({ enabled: false });
    clickOnly.intent.enter();
    vi.advanceTimersByTime(1000);
    expect(clickOnly.state.open).toBe(false);
  });

  it("reads the pin at event time, so unpinning restores hover", () => {
    const { state, intent } = setup({ pinned: true });
    intent.enter();
    vi.advanceTimersByTime(100);
    expect(state.open).toBe(false);
    state.pinned = false;
    intent.enter();
    vi.advanceTimersByTime(80);
    expect(state.open).toBe(true);
  });

  it("unbinding removes the listeners and drops a pending open", () => {
    const { state, intent } = setup();
    const root = new EventTarget();
    const unbind = bindHoverIntent(root, intent);
    root.dispatchEvent(new Event("pointerenter"));
    unbind();
    vi.advanceTimersByTime(1000);
    expect(state.open).toBe(false);
    root.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(1000);
    expect(state.open).toBe(false);
  });

  it("the footer popover binds hover natively, not through React's enter/leave props", () => {
    const source = readFileSync(new URL("./SidebarPopoverMenu.tsx", import.meta.url), "utf8");
    expect(source).toContain("bindHoverIntent(");
    expect(source).not.toMatch(/onPointerEnter=|onPointerLeave=|onMouseEnter=|onMouseLeave=/);
  });
});
