import { createElement, type EffectCallback, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_ONBOARDING, WELCOME_VERSION } from "@/lib/onboarding";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.values[index], () => {}];
  },
  useRef: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = { current: initial };
    return fixture.values[index];
  },
  useCallback: (fn: unknown) => fn,
  useEffect: (_effect: EffectCallback) => {},
}));
const store = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({ state: store.state, dispatch: vi.fn() }),
}));
vi.mock("@/lib/feature-flags", () => ({ connectedAppsEnabled: () => true }));
vi.mock("./Spotlight", () => ({ Spotlight: () => null }));
import { GuidedTour } from "./GuidedTour";
import { Spotlight } from "./Spotlight";

function render() {
  fixture.index = 0;
  fixture.values = [];
  let tree: ReactNode = null;
  function Capture() {
    tree = GuidedTour();
    return tree;
  }
  renderToStaticMarkup(createElement(Capture));
  return tree as { type?: unknown } | null;
}

const done = { ...EMPTY_ONBOARDING, completedAt: "2026-09-23T00:00:00.000Z", version: WELCOME_VERSION };

beforeEach(() => {
  vi.stubGlobal("window", {});
  store.state = { config: { onboarding: done }, welcomeOpen: false, tourOpen: false, computerOpen: false, pluginsOpen: false };
});

describe("guided tour start", () => {
  it("does not start by itself on a first launch after onboarding", () => {
    expect(render()).toBeNull();
  });

  it("does not start by itself when the config has not loaded", () => {
    store.state = { ...store.state, config: undefined };
    expect(render()).toBeNull();
  });

  it("still starts when opened on purpose", () => {
    store.state = { ...store.state, tourOpen: true };
    expect(render()?.type).toBe(Spotlight);
  });

  it("resumes a tour the person had already begun", () => {
    store.state = { ...store.state, config: { onboarding: { ...done, hintsSeen: ["tour.composer"] } } };
    expect(render()?.type).toBe(Spotlight);
  });
});
