// @vitest-environment happy-dom
// #1495: Full screen did nothing in an artifact's own window, because the
// full-screen layer was only drawn by the main app's ArtifactsHost.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const artifact = {
  id: "a1", botId: "b1", title: "Sales dashboard", favorite: false, popped: true, createdAt: 1, updatedAt: 2, rev: 1,
  refresh: { state: "idle", failures: 0 },
  html: "<body><p>Orders: 128</p></body>",
};

vi.mock("@/lib/artifacts", () => ({
  useArtifact: () => ({ artifact, error: null }),
  useArtifactWatch: () => {},
  refreshArtifact: async () => {},
}));

import { ArtifactWindowBody } from "./ArtifactStandaloneWindow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("artifact's own window: Full screen (#1495)", () => {
  let root: Root | null = null;
  let requestFullscreen: ReturnType<typeof vi.fn>;
  let exitFullscreen: ReturnType<typeof vi.fn>;
  let fullscreenElement: Element | null = null;

  beforeEach(() => {
    fullscreenElement = null;
    requestFullscreen = vi.fn(async function (this: Element) {
      fullscreenElement = document.documentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    exitFullscreen = vi.fn(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: requestFullscreen });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  async function mount() {
    const host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(createElement(ArtifactWindowBody, { data: { botId: "b1", artifactId: "a1" } }));
    });
  }

  it("opens the full-screen layer and puts the window full screen", async () => {
    await mount();
    expect(document.querySelector("[data-artifact-fullscreen-layer]")).toBeNull();
    const button = document.querySelector<HTMLButtonElement>("[data-artifact-fullscreen]");
    expect(button).not.toBeNull();
    await act(async () => { button!.click(); });
    expect(document.querySelector("[data-artifact-fullscreen-layer]")).not.toBeNull();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("leaving the system full screen closes the layer", async () => {
    await mount();
    await act(async () => { document.querySelector<HTMLButtonElement>("[data-artifact-fullscreen]")!.click(); });
    expect(document.querySelector("[data-artifact-fullscreen-layer]")).not.toBeNull();
    await act(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(document.querySelector("[data-artifact-fullscreen-layer]")).toBeNull();
  });

  it("Exit full screen leaves the system full screen too", async () => {
    await mount();
    await act(async () => { document.querySelector<HTMLButtonElement>("[data-artifact-fullscreen]")!.click(); });
    await act(async () => { document.querySelector<HTMLButtonElement>("[data-artifact-exit-fullscreen]")!.click(); });
    expect(document.querySelector("[data-artifact-fullscreen-layer]")).toBeNull();
    expect(exitFullscreen).toHaveBeenCalled();
  });
});
