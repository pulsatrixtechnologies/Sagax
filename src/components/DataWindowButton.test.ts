// @vitest-environment happy-dom
// The chat header's Data button: absent while the experimental switch is
// off, a round button beside the threads button while it is on.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ dataWindow: false, dataView: null as null | { botId: string; threadId: string; cardId: string } }));
const dispatch = vi.hoisted(() => vi.fn());
const openDataWindow = vi.hoisted(() => vi.fn(async () => "created"));
vi.mock("@/state/store", () => ({
  useStore: () => ({ state: { config: { features: { dataWindow: fixture.dataWindow } }, dataView: fixture.dataView }, dispatch }),
}));
vi.mock("@/lib/data-window", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/data-window")>(), openDataWindow }));

const { DataWindowButton, DataWindowViewSync } = await import("./DataWindowButton");
const { CIRCLE_BUTTON } = await import("@/lib/circle-button");
const { postDataWindowMessage } = await import("@/lib/data-window");

let root: Root | null = null;
const render = (node: ReturnType<typeof createElement>) => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root!.render(node));
  return container;
};
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  fixture.dataWindow = false;
  fixture.dataView = null;
  dispatch.mockClear();
  openDataWindow.mockClear();
  vi.unstubAllGlobals();
});

describe("Data button", () => {
  it("is absent while the experimental switch is off", () => {
    const container = render(createElement(DataWindowButton, { bot: { id: "scout", name: "Scout" } }));
    expect(container.querySelector("[data-data-window-button]")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows as a round button with an accessible name and opens this bot's window", async () => {
    fixture.dataWindow = true;
    const container = render(createElement(DataWindowButton, { bot: { id: "scout", name: "Scout" } }));
    const button = container.querySelector<HTMLButtonElement>("[data-data-window-button]")!;
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-label")).toBe("Open the Data window");
    for (const token of CIRCLE_BUTTON.split(" ")) expect(button.className).toContain(token);
    expect(button.querySelector("svg.lucide-database")).not.toBeNull();
    button.click();
    expect(openDataWindow).toHaveBeenCalledWith({ botId: "scout", title: "Data: Scout" });
  });

  it("is absent on the companion connection, where Data is not served", () => {
    fixture.dataWindow = true;
    vi.stubGlobal("ogb", { remoteClient: { active: true } });
    const container = render(createElement(DataWindowButton, { bot: { id: "scout", name: "Scout" } }));
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("Data window view sync", () => {
  it("keeps the result in view in the window, and clears only that bot's when it goes", async () => {
    render(createElement(DataWindowViewSync));
    const view = { botId: "scout", threadId: "t1", cardId: "c_1" };
    postDataWindowMessage({ type: "view", botId: "scout", view });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "dataView", view }));
    dispatch.mockClear();
    // another bot's window closing leaves this one's view alone
    postDataWindowMessage({ type: "view", botId: "atlas", view: null });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(dispatch).not.toHaveBeenCalled();
  });
});
