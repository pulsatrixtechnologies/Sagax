// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOVER_DWELL_MS, HOVER_FADE_MS, useHoverDwell } from "./use-hover-dwell";

let host: HTMLDivElement;
let root: Root;

function Probe({ enabled = true }: { enabled?: boolean }) {
  const { shown, mounted, handlers } = useHoverDwell(enabled);
  return createElement("div", { "data-probe": true, ...handlers }, mounted ? createElement("i", { "data-line": shown ? "shown" : "fading" }) : null);
}
const probe = () => host.querySelector("[data-probe]")!;
const line = () => host.querySelector("[data-line]")?.getAttribute("data-line") ?? null;
// React derives enter/leave from over/out, so the events are sent that way.
const pointer = (type: "pointerenter" | "pointerleave", pointerType = "mouse") =>
  act(async () => {
    probe().dispatchEvent(new PointerEvent(type === "pointerenter" ? "pointerover" : "pointerout", {
      bubbles: true, pointerType, relatedTarget: document.body,
    }));
  });
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(async () => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Probe)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("useHoverDwell", () => {
  it("appears after the pointer rests 1200 ms, not before", async () => {
    expect(HOVER_DWELL_MS).toBe(1200);
    await pointer("pointerenter");
    await wait(1199);
    expect(line()).toBeNull();
    await wait(1);
    expect(line()).toBe("shown");
  });

  it("never appears when the pointer leaves first", async () => {
    await pointer("pointerenter");
    await wait(800);
    await pointer("pointerleave");
    await wait(2000);
    expect(line()).toBeNull();
  });

  it("fades out on leave, then unmounts", async () => {
    await pointer("pointerenter");
    await wait(1200);
    await pointer("pointerleave");
    expect(line()).toBe("fading");
    await wait(HOVER_FADE_MS);
    expect(line()).toBeNull();
  });

  it("ignores touch, and a disabled row", async () => {
    await pointer("pointerenter", "touch");
    await wait(3000);
    expect(line()).toBeNull();
    await act(async () => root.render(createElement(Probe, { enabled: false })));
    await pointer("pointerenter");
    await wait(3000);
    expect(line()).toBeNull();
  });
});
