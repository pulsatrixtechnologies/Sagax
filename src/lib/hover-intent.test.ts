// The screen's controls come in on intent: a mouse resting ~2 s, keyboard
// focus at once, a tap at once (for a few seconds).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HOVER_INTENT_MS, HoverIntent, TAP_REVEAL_MS } from "./hover-intent";

describe("HoverIntent", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const make = () => {
    const changes: boolean[] = [];
    const intent = new HoverIntent((shown) => changes.push(shown));
    return { intent, changes };
  };

  it("waits about 2 seconds of hover before showing the controls", () => {
    const { intent, changes } = make();
    expect(HOVER_INTENT_MS).toBe(2_000);
    intent.pointerEnter("mouse");
    vi.advanceTimersByTime(1_999);
    expect(intent.revealed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(intent.revealed).toBe(true);
    expect(changes).toEqual([true]);
  });

  it("ignores a pointer only passing over, and hides when it leaves", () => {
    const { intent, changes } = make();
    intent.pointerEnter("mouse");
    vi.advanceTimersByTime(1_500);
    intent.pointerLeave("mouse");
    vi.advanceTimersByTime(5_000);
    expect(changes).toEqual([]);
    intent.pointerEnter("pen");
    vi.advanceTimersByTime(HOVER_INTENT_MS);
    intent.pointerLeave("pen");
    expect(changes).toEqual([true, false]);
  });

  it("shows at once on keyboard focus and hides when focus leaves", () => {
    const { intent, changes } = make();
    intent.focusIn();
    expect(intent.revealed).toBe(true);
    intent.focusOut();
    expect(intent.revealed).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("keeps the controls while focus is inside even if the mouse leaves", () => {
    const { intent } = make();
    intent.pointerEnter("mouse");
    vi.advanceTimersByTime(HOVER_INTENT_MS);
    intent.focusIn();
    intent.pointerLeave("mouse");
    expect(intent.revealed).toBe(true);
  });

  it("shows at once on a tap, then hides a few seconds later", () => {
    const { intent, changes } = make();
    intent.pointerEnter("touch");
    expect(intent.revealed).toBe(false);
    intent.pointerDown("touch");
    expect(intent.revealed).toBe(true);
    vi.advanceTimersByTime(TAP_REVEAL_MS - 1);
    expect(intent.revealed).toBe(true);
    vi.advanceTimersByTime(1);
    expect(intent.revealed).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("does not reveal on a mouse press alone, and stops its timers on dispose", () => {
    const { intent, changes } = make();
    intent.pointerDown("mouse");
    intent.pointerEnter("mouse");
    intent.dispose();
    vi.advanceTimersByTime(HOVER_INTENT_MS * 2);
    expect(changes).toEqual([]);
  });
});
