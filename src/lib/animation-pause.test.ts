import { afterEach, describe, expect, it, vi } from "vitest";
import { animationsPaused, applyAnimationPauseAttribute, resetAnimationPauseForTests } from "./animation-pause";

interface FakeDoc {
  hidden: boolean;
  visibilityState: DocumentVisibilityState;
  documentElement: { dataset: Record<string, string> };
  hasFocus: () => boolean;
  addEventListener: ReturnType<typeof vi.fn>;
}

function stub(doc: FakeDoc, reduced = false) {
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    matchMedia: () => ({ matches: reduced, addEventListener: vi.fn() }),
  });
}

afterEach(() => {
  resetAnimationPauseForTests();
  vi.unstubAllGlobals();
});

describe("animationsPaused", () => {
  it("pauses a hidden or minimized window only", () => {
    const doc: FakeDoc = {
      hidden: true,
      visibilityState: "hidden",
      documentElement: { dataset: {} },
      hasFocus: () => true,
      addEventListener: vi.fn(),
    };
    stub(doc);
    expect(animationsPaused()).toBe(true);
    doc.hidden = false;
    doc.visibilityState = "visible";
    expect(animationsPaused()).toBe(false);
  });

  it("keeps a visible window that lost focus animating", () => {
    const doc: FakeDoc = {
      hidden: false,
      visibilityState: "visible",
      documentElement: { dataset: {} },
      hasFocus: () => false,
      addEventListener: vi.fn(),
    };
    stub(doc);
    expect(animationsPaused()).toBe(false);
    doc.documentElement.dataset.floatingBot = "";
    expect(animationsPaused()).toBe(false);
  });

  it("sets the CSS pause attribute while hidden, and clears it when shown", () => {
    const doc: FakeDoc = {
      hidden: true,
      visibilityState: "hidden",
      documentElement: { dataset: {} },
      hasFocus: () => true,
      addEventListener: vi.fn(),
    };
    stub(doc);
    applyAnimationPauseAttribute();
    expect(doc.documentElement.dataset.animationsPaused).toBe("");
    doc.hidden = false;
    doc.visibilityState = "visible";
    applyAnimationPauseAttribute();
    expect(doc.documentElement.dataset.animationsPaused).toBeUndefined();
    // Reduced motion must not pause play-state: entrance animations would
    // stay stuck on their first keyframe. The stylesheets turn them off.
    resetAnimationPauseForTests();
    stub(doc, true);
    applyAnimationPauseAttribute();
    expect(doc.documentElement.dataset.animationsPaused).toBeUndefined();
  });
});
