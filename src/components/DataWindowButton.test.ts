// @vitest-environment happy-dom
// The bot's Data window item (the conversation's "..." menu): absent while
// the experimental switch is off, an item that opens this bot's window
// while it is on.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ dataWindow: false, dataView: null as null | { botId: string; threadId: string; cardId: string } }));
const dispatch = vi.hoisted(() => vi.fn());
const openDataWindow = vi.hoisted(() => vi.fn(async () => "created"));
const api = vi.hoisted(() => vi.fn(async () => ({ features: { dataWindow: false } })));
vi.mock("@/state/store", () => ({
  api,
  useStore: () => ({ state: { config: { features: { dataWindow: fixture.dataWindow } }, dataView: fixture.dataView }, dispatch }),
}));
vi.mock("@/lib/data-window", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/data-window")>(), openDataWindow }));

const { useDataWindowItem, DataWindowViewSync } = await import("./DataWindowButton");

/** Shows the item the hook returns as a button, or nothing. */
function DataWindowProbe({ bot }: { bot: { id: string; name: string } }) {
  const item = useDataWindowItem(bot);
  return item ? createElement("button", { "data-data-window-button": "", "aria-label": item.label, onClick: item.onOpen }) : null;
}
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
  api.mockClear();
  vi.unstubAllGlobals();
});

describe("Data item", () => {
  it("is absent while the experimental switch is off", () => {
    const container = render(createElement(DataWindowProbe, { bot: { id: "scout", name: "Scout" } }));
    expect(container.querySelector("button")).toBeNull();
  });

  it("opens this bot's window, and says so in the chat when the browser blocks it", async () => {
    fixture.dataWindow = true;
    const container = render(createElement(DataWindowProbe, { bot: { id: "scout", name: "Scout" } }));
    const button = container.querySelector<HTMLButtonElement>("[data-data-window-button]")!;
    expect(button.getAttribute("aria-label")).toBe("Open the Data window");
    button.click();
    expect(openDataWindow).toHaveBeenCalledWith({ botId: "scout", title: "Data: Scout" });
    openDataWindow.mockImplementationOnce(async () => "blocked");
    button.click();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "error", message: expect.stringContaining("blocked") }));
  });

  it("says the window is off only when the server answered off, and rereads the config", async () => {
    // The desktop asked the server again: its switch is off. This page's
    // config was stale, so it is read again and Settings shows the truth.
    fixture.dataWindow = true;
    openDataWindow.mockImplementationOnce(async () => "off");
    const container = render(createElement(DataWindowProbe, { bot: { id: "scout", name: "Scout" } }));
    container.querySelector<HTMLButtonElement>("[data-data-window-button]")!.click();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "error", message: expect.stringContaining("The Data window is off") }));
    expect(api).toHaveBeenCalledWith("/api/config");
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "configStatus", config: { features: { dataWindow: false } } }));
  });

  it("never says the window is off when the desktop could not ask the server, or refused for another reason", async () => {
    fixture.dataWindow = true;
    const container = render(createElement(DataWindowProbe, { bot: { id: "scout", name: "Scout" } }));
    const button = container.querySelector<HTMLButtonElement>("[data-data-window-button]")!;
    openDataWindow.mockImplementationOnce(async () => "unavailable");
    button.click();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "error", message: expect.stringContaining("could not check") }));
    openDataWindow.mockImplementationOnce(async () => "refused");
    button.click();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "error", message: expect.stringContaining("could not open") }));
    expect(dispatch).not.toHaveBeenCalledWith({ type: "error", message: expect.stringContaining("is off") });
    expect(api).not.toHaveBeenCalled();
  });

  it("is absent on the companion connection, where Data is not served", () => {
    fixture.dataWindow = true;
    vi.stubGlobal("ogb", { remoteClient: { active: true } });
    const container = render(createElement(DataWindowProbe, { bot: { id: "scout", name: "Scout" } }));
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
