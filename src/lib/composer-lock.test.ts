// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lockedNow, SNAPSHOT_LOCK_MAX_MS, useBoundedLock } from "./composer-lock";

describe("lockedNow", () => {
  it("locks only while a page is awaited, and never past the bound", () => {
    expect(lockedNow(false, null, 1_000)).toBe(false);
    expect(lockedNow(true, null, 1_000)).toBe(false);
    expect(lockedNow(true, 1_000, 1_000)).toBe(true);
    expect(lockedNow(true, 1_000, 1_000 + SNAPSHOT_LOCK_MAX_MS - 1)).toBe(true);
    expect(lockedNow(true, 1_000, 1_000 + SNAPSHOT_LOCK_MAX_MS)).toBe(false);
  });
});

describe("useBoundedLock", () => {
  let host: HTMLDivElement;
  let root: Root;
  let seen: boolean[];
  function Probe({ awaiting }: { awaiting: boolean }) {
    seen.push(useBoundedLock(awaiting, 50));
    return null;
  }
  beforeEach(() => {
    vi.useFakeTimers();
    seen = [];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });
  it("gives the lock back by itself when the page never lands, and starts over on a new wait", () => {
    act(() => root.render(createElement(Probe, { awaiting: true })));
    expect(seen.at(-1)).toBe(true);
    act(() => { vi.advanceTimersByTime(49); });
    expect(seen.at(-1)).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(seen.at(-1)).toBe(false);
    // the page lands, then a new switch: locked again, for a fresh bound
    act(() => root.render(createElement(Probe, { awaiting: false })));
    expect(seen.at(-1)).toBe(false);
    act(() => root.render(createElement(Probe, { awaiting: true })));
    expect(seen.at(-1)).toBe(true);
  });
  it("is free as soon as the page lands", () => {
    act(() => root.render(createElement(Probe, { awaiting: true })));
    act(() => root.render(createElement(Probe, { awaiting: false })));
    expect(seen.at(-1)).toBe(false);
  });
});
