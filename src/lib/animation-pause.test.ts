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
  it("pauses a hidden main window and a blurred one", () => {
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
    doc.hasFocus = () => false;
    expect(animationsPaused()).toBe(true);
  });

  it("does not treat blur as a pause for a floating mascot or Hibou 98", () => {
    const doc: FakeDoc = {
      hidden: false,
      visibilityState: "visible",
      documentElement: { dataset: { floatingBot: "" } },
      hasFocus: () => false,
      addEventListener: vi.fn(),
    };
    stub(doc);
    expect(animationsPaused()).toBe(false);
    delete doc.documentElement.dataset.floatingBot;
    doc.documentElement.dataset.retroDetached = "";
    expect(animationsPaused()).toBe(false);
    doc.hidden = true;
    doc.visibilityState = "hidden";
    expect(animationsPaused()).toBe(true);
  });

  it("sets the CSS pause attribute while blurred, and clears it on focus", () => {
    const doc: FakeDoc = {
      hidden: false,
      visibilityState: "visible",
      documentElement: { dataset: {} },
      hasFocus: () => false,
      addEventListener: vi.fn(),
    };
    stub(doc);
    applyAnimationPauseAttribute();
    expect(doc.documentElement.dataset.animationsPaused).toBe("");
    doc.hasFocus = () => true;
    applyAnimationPauseAttribute();
    expect(doc.documentElement.dataset.animationsPaused).toBeUndefined();
    // Reduced motion must not pause play-state: entrance animations would
    // stay stuck on their first keyframe. The stylesheets turn them off.
    resetAnimationPauseForTests();
    stub(doc, true);
    doc.hasFocus = () => true;
    applyAnimationPauseAttribute();
    expect(doc.documentElement.dataset.animationsPaused).toBeUndefined();
  });
});
