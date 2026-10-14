// @vitest-environment happy-dom
// The /data-window page: one bot's Data, and nothing while the experimental
// switch is off, whoever opened the address.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ dataWindow: true, hydrated: true as true | undefined }));
const panelProps = vi.hoisted(() => [] as Array<{ bot: { id: string }; requestedCard?: { id: string } }>);
vi.mock("@/state/store", () => ({
  useStore: () => ({
    state: {
      hydrated: fixture.hydrated,
      config: { features: { dataWindow: fixture.dataWindow } },
      bots: [{ id: "scout", name: "Scout", threadId: "t1" }],
      dataView: null,
    },
    dispatch: vi.fn(),
  }),
  StoreProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("./DataPanel", () => ({
  DataPanel: (props: { bot: { id: string }; requestedCard?: { id: string } }) => {
    panelProps.push(props);
    return createElement("div", { "data-testid": "data-panel" });
  },
}));

const { DataWindowBody } = await import("./DataWindow");

let root: Root | null = null;
const mount = async (hash: string) => {
  location.hash = hash;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root!.render(createElement(DataWindowBody)));
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  return container;
};
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  fixture.dataWindow = true;
  fixture.hydrated = true;
  panelProps.length = 0;
});

describe("Data window page", () => {
  it("shows the bot's Data on the card the address names, under the window's title", async () => {
    const container = await mount("#bot=scout&card=c_1");
    await vi.waitFor(() => expect(container.querySelector('[data-testid="data-panel"]')).not.toBeNull());
    expect(panelProps.at(-1)?.bot.id).toBe("scout");
    expect(panelProps.at(-1)?.requestedCard?.id).toBe("c_1");
    expect(container.querySelector("h1")?.textContent).toBe("Data: Scout");
    expect(document.title).toBe("Data: Scout");
  });

  it("refuses while the experimental switch is off", async () => {
    fixture.dataWindow = false;
    const container = await mount("#bot=scout");
    expect(container.querySelector('[data-testid="data-panel"]')).toBeNull();
    expect(container.textContent).toContain("The Data window is off");
  });

  it("says so for an unknown bot, and waits for the store before deciding", async () => {
    const unknown = await mount("#bot=ghost");
    expect(unknown.querySelector('[data-testid="data-panel"]')).toBeNull();
    expect(unknown.textContent).toContain("This bot is not available here.");
    root?.unmount();
    fixture.hydrated = undefined;
    fixture.dataWindow = false;
    const loading = await mount("#bot=scout");
    expect(loading.textContent).toContain("Loading data");
    expect(loading.textContent).not.toContain("The Data window is off");
  });
});
